/**
 * Unit tests for AvailabilityService — slot generation, exclusion of
 * already-scheduled slots, and the unique-index-violation -> 409 translation
 * that provides the actual booking race-safety guarantee.
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import { AvailabilityService } from "./availability.service";
import { AppointmentService, type AppointmentRow } from "../patient-engagement/appointment.service";
import type { Pool, QueryResult } from "pg";

const PATIENT_ID = "patient-001";
const DEPARTMENT = "Cardiology";
const TEST_DATE = "2026-08-03";
const DAY_OF_WEEK = new Date(`${TEST_DATE}T00:00:00Z`).getUTCDay();

function makeMockPool(rows: Record<string, unknown[]>): Pool {
  return {
    query: jest.fn((sql: string) => {
      for (const [key, value] of Object.entries(rows)) {
        if (sql.includes(key)) return Promise.resolve({ rows: value } as QueryResult);
      }
      return Promise.resolve({ rows: [] } as unknown as QueryResult);
    }),
  } as unknown as Pool;
}

const AVAILABILITY_ROW = {
  clinician_display: null,
  day_of_week: DAY_OF_WEEK,
  start_time: "09:00:00",
  end_time: "10:00:00",
  slot_duration_minutes: 30,
};

const BOOKED_ROW: AppointmentRow = {
  id: "appt-1",
  patient_id: PATIENT_ID,
  scheduled_at: `${TEST_DATE}T09:00:00.000Z`,
  appointment_type: "follow_up",
  status: "scheduled",
  department_display: DEPARTMENT,
  clinician_display: null,
  created_by: null,
  updated_at: "2026-08-01T00:00:00.000Z",
};

function makeAppointmentService(scheduleSelfServiceImpl?: () => Promise<AppointmentRow>): AppointmentService {
  return {
    scheduleSelfService: jest.fn(scheduleSelfServiceImpl ?? (() => Promise.resolve(BOOKED_ROW))),
  } as unknown as AppointmentService;
}

describe("AvailabilityService.getSlots", () => {
  it("generates slots from one availability window at the configured duration", async () => {
    const pool = makeMockPool({ "FROM app.provider_availability": [AVAILABILITY_ROW] });
    const svc = new AvailabilityService(pool, makeAppointmentService());
    const slots = await svc.getSlots(DEPARTMENT, null, TEST_DATE, TEST_DATE);
    expect(slots.map((s) => s.start)).toEqual([
      `${TEST_DATE}T09:00:00.000Z`,
      `${TEST_DATE}T09:30:00.000Z`,
    ]);
  });

  it("excludes a slot already occupied by a scheduled appointment", async () => {
    const pool = makeMockPool({
      "FROM app.provider_availability": [AVAILABILITY_ROW],
      "FROM hospital.appointment": [{ scheduled_at: `${TEST_DATE}T09:00:00.000Z`, clinician_display: null }],
    });
    const svc = new AvailabilityService(pool, makeAppointmentService());
    const slots = await svc.getSlots(DEPARTMENT, null, TEST_DATE, TEST_DATE);
    expect(slots.map((s) => s.start)).toEqual([`${TEST_DATE}T09:30:00.000Z`]);
  });

  it("returns nothing for a department with no availability configured", async () => {
    const pool = makeMockPool({});
    const svc = new AvailabilityService(pool, makeAppointmentService());
    const slots = await svc.getSlots("Neurology", null, TEST_DATE, TEST_DATE);
    expect(slots).toEqual([]);
  });

  // S4.4 — clinician-gender scheduling preference. The pool mock ignores the
  // bound params, so the filter's SQL predicate is asserted directly: the
  // third parameter is the requested gender.
  it("filters availability rows by the requested clinician gender", async () => {
    const pool = makeMockPool({ "FROM app.provider_availability": [{ ...AVAILABILITY_ROW, clinician_gender: "female" }] });
    const svc = new AvailabilityService(pool, makeAppointmentService());
    const slots = await svc.getSlots(DEPARTMENT, null, TEST_DATE, TEST_DATE, "female");
    expect(slots).toHaveLength(2);
    const call = (pool.query as unknown as jest.Mock).mock.calls[0]!;
    expect(call[1]).toEqual([DEPARTMENT, null, "female"]);
    expect(String(call[0])).toContain("clinician_gender = $3::text");
  });

  it("passes NULL (no preference) by default so unfiltered queries are unchanged", async () => {
    const pool = makeMockPool({ "FROM app.provider_availability": [AVAILABILITY_ROW] });
    const svc = new AvailabilityService(pool, makeAppointmentService());
    await svc.getSlots(DEPARTMENT, null, TEST_DATE, TEST_DATE);
    const call = (pool.query as unknown as jest.Mock).mock.calls[0]!;
    expect(call[1]).toEqual([DEPARTMENT, null, null]);
  });
});

describe("AvailabilityService.bookSlot", () => {
  it("books a valid open slot", async () => {
    const pool = makeMockPool({ "FROM app.provider_availability": [AVAILABILITY_ROW] });
    const appointments = makeAppointmentService();
    const svc = new AvailabilityService(pool, appointments);
    const result = await svc.bookSlot(PATIENT_ID, DEPARTMENT, "follow_up", null, `${TEST_DATE}T09:00:00.000Z`);
    expect(result.status).toBe("scheduled");
    expect(appointments.scheduleSelfService).toHaveBeenCalled();
  });

  it("rejects a slotStart that doesn't fall on a valid generated boundary", async () => {
    const pool = makeMockPool({ "FROM app.provider_availability": [AVAILABILITY_ROW] });
    const svc = new AvailabilityService(pool, makeAppointmentService());
    await expect(
      svc.bookSlot(PATIENT_ID, DEPARTMENT, "follow_up", null, `${TEST_DATE}T09:17:00.000Z`),
    ).rejects.toThrow(BadRequestException);
  });

  it("translates a unique-index violation (23505) into a 409 conflict", async () => {
    const pool = makeMockPool({ "FROM app.provider_availability": [AVAILABILITY_ROW] });
    const appointments = makeAppointmentService(() => {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    });
    const svc = new AvailabilityService(pool, appointments);
    await expect(
      svc.bookSlot(PATIENT_ID, DEPARTMENT, "follow_up", null, `${TEST_DATE}T09:00:00.000Z`),
    ).rejects.toThrow(ConflictException);
  });

  it("re-throws non-conflict errors from the insert unchanged", async () => {
    const pool = makeMockPool({ "FROM app.provider_availability": [AVAILABILITY_ROW] });
    const appointments = makeAppointmentService(() => {
      throw new Error("some other db error");
    });
    const svc = new AvailabilityService(pool, appointments);
    await expect(
      svc.bookSlot(PATIENT_ID, DEPARTMENT, "follow_up", null, `${TEST_DATE}T09:00:00.000Z`),
    ).rejects.toThrow("some other db error");
  });
});
