/**
 * Unit tests for AppointmentService — administrative scheduling only
 * (CLAUDE.md §2: no clinical content, no conflict/urgency logic by design).
 */

import { AppointmentService } from "./appointment.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Pool, QueryResult } from "pg";

const mockScopeService = {
  assertPatientInScope: jest.fn(),
} as unknown as PatientScopeService;

function makeMockPool(rows: Record<string, unknown[]>): Pool {
  return {
    query: jest.fn((sql: string) => {
      for (const [key, value] of Object.entries(rows)) {
        if (sql.includes(key)) {
          return Promise.resolve({ rows: value } as QueryResult);
        }
      }
      return Promise.resolve({ rows: [] } as unknown as QueryResult);
    }),
  } as unknown as Pool;
}

const USER_ID = "user-001";
const PATIENT_ID = "patient-001";

beforeEach(() => {
  jest.clearAllMocks();
  (mockScopeService.assertPatientInScope as jest.Mock).mockResolvedValue(undefined);
});

describe("AppointmentService.schedule", () => {
  it("creates a scheduled-status appointment", async () => {
    const pool = makeMockPool({
      "INSERT INTO hospital.appointment": [
        {
          id: "appt-1",
          patient_id: PATIENT_ID,
          scheduled_at: "2026-08-01T10:00:00Z",
          appointment_type: "follow_up",
          status: "scheduled",
          department_display: "Cardiology",
          clinician_display: null,
          created_by: USER_ID,
          updated_at: "2026-07-10T00:00:00Z",
        },
      ],
    });
    const svc = new AppointmentService(pool, mockScopeService);
    const result = await svc.schedule(USER_ID, PATIENT_ID, "2026-08-01T10:00:00Z", "follow_up", "Cardiology", null);
    expect(result.status).toBe("scheduled");
    expect(result.appointment_type).toBe("follow_up");
  });
});

describe("AppointmentService.updateStatus", () => {
  function makePoolWithExisting(status: string) {
    return makeMockPool({
      "FROM hospital.appointment WHERE id": [
        {
          id: "appt-1",
          patient_id: PATIENT_ID,
          scheduled_at: "2026-08-01T10:00:00Z",
          appointment_type: "follow_up",
          status,
          department_display: "Cardiology",
          clinician_display: null,
          created_by: USER_ID,
          updated_at: "2026-07-10T00:00:00Z",
        },
      ],
      "UPDATE hospital.appointment": [
        {
          id: "appt-1",
          patient_id: PATIENT_ID,
          scheduled_at: "2026-08-01T10:00:00Z",
          appointment_type: "follow_up",
          status: "completed",
          department_display: "Cardiology",
          clinician_display: null,
          created_by: USER_ID,
          updated_at: "2026-07-10T00:01:00Z",
        },
      ],
    });
  }

  it("allows scheduled -> completed", async () => {
    const pool = makePoolWithExisting("scheduled");
    const svc = new AppointmentService(pool, mockScopeService);
    const result = await svc.updateStatus(USER_ID, "appt-1", "completed");
    expect(result.status).toBe("completed");
  });

  it("rejects acting on an already-terminal appointment (completed -> anything)", async () => {
    const pool = makePoolWithExisting("completed");
    const svc = new AppointmentService(pool, mockScopeService);
    await expect(svc.updateStatus(USER_ID, "appt-1", "cancelled")).rejects.toThrow(BadRequestException);
  });

  it("404s on an unknown appointment id", async () => {
    const pool = makeMockPool({});
    const svc = new AppointmentService(pool, mockScopeService);
    await expect(svc.updateStatus(USER_ID, "does-not-exist", "completed")).rejects.toThrow(NotFoundException);
  });
});

describe("AppointmentService.scheduleSelfService", () => {
  it("creates a patient_self_service appointment without calling scope-check", async () => {
    const pool = makeMockPool({
      "INSERT INTO hospital.appointment": [
        {
          id: "appt-2",
          patient_id: PATIENT_ID,
          scheduled_at: "2026-08-01T10:00:00Z",
          appointment_type: "follow_up",
          status: "scheduled",
          department_display: "Cardiology",
          clinician_display: null,
          created_by: null,
          updated_at: "2026-07-10T00:00:00Z",
        },
      ],
    });
    const svc = new AppointmentService(pool, mockScopeService);
    const result = await svc.scheduleSelfService(PATIENT_ID, "2026-08-01T10:00:00Z", "follow_up", "Cardiology", null);
    expect(result.status).toBe("scheduled");
    expect(mockScopeService.assertPatientInScope).not.toHaveBeenCalled();
  });
});

describe("AppointmentService.listOwn", () => {
  it("returns the patient's own appointments without calling scope-check", async () => {
    const pool = makeMockPool({
      "WHERE patient_id = $1 ORDER BY scheduled_at DESC": [
        {
          id: "appt-1",
          patient_id: PATIENT_ID,
          scheduled_at: "2026-08-01T10:00:00Z",
          appointment_type: "follow_up",
          status: "scheduled",
          department_display: "Cardiology",
          clinician_display: null,
          created_by: null,
          updated_at: "2026-07-10T00:00:00Z",
        },
      ],
    });
    const svc = new AppointmentService(pool, mockScopeService);
    const result = await svc.listOwn(PATIENT_ID);
    expect(result).toHaveLength(1);
    expect(mockScopeService.assertPatientInScope).not.toHaveBeenCalled();
  });
});

describe("AppointmentService.selfServiceCancel", () => {
  function makePoolWithExisting(status: string, patientId: string) {
    return makeMockPool({
      "FROM hospital.appointment WHERE id": [
        {
          id: "appt-1",
          patient_id: patientId,
          scheduled_at: "2026-08-01T10:00:00Z",
          appointment_type: "follow_up",
          status,
          department_display: "Cardiology",
          clinician_display: null,
          created_by: null,
          updated_at: "2026-07-10T00:00:00Z",
        },
      ],
      "UPDATE hospital.appointment": [
        {
          id: "appt-1",
          patient_id: patientId,
          scheduled_at: "2026-08-01T10:00:00Z",
          appointment_type: "follow_up",
          status: "cancelled",
          department_display: "Cardiology",
          clinician_display: null,
          created_by: null,
          updated_at: "2026-07-10T00:01:00Z",
        },
      ],
    });
  }

  it("cancels the caller's own scheduled appointment", async () => {
    const pool = makePoolWithExisting("scheduled", PATIENT_ID);
    const svc = new AppointmentService(pool, mockScopeService);
    const result = await svc.selfServiceCancel("appt-1", PATIENT_ID);
    expect(result.status).toBe("cancelled");
  });

  it("404s (not 403) when the appointment belongs to a different patient", async () => {
    const pool = makePoolWithExisting("scheduled", "some-other-patient");
    const svc = new AppointmentService(pool, mockScopeService);
    await expect(svc.selfServiceCancel("appt-1", PATIENT_ID)).rejects.toThrow(NotFoundException);
  });

  it("rejects cancelling an already-terminal appointment", async () => {
    const pool = makePoolWithExisting("completed", PATIENT_ID);
    const svc = new AppointmentService(pool, mockScopeService);
    await expect(svc.selfServiceCancel("appt-1", PATIENT_ID)).rejects.toThrow(BadRequestException);
  });
});

describe("AppointmentService.queue", () => {
  it("returns only administrative fields — identity, schedule, status", async () => {
    const pool = makeMockPool({
      "FROM hospital.appointment a": [
        {
          id: "appt-1",
          patient_id: PATIENT_ID,
          scheduled_at: "2026-08-01T10:00:00Z",
          appointment_type: "follow_up",
          status: "scheduled",
          department_display: "Cardiology",
          clinician_display: null,
          created_by: USER_ID,
          updated_at: "2026-07-10T00:00:00Z",
          patient_mrn: "MRN-010",
          patient_display_name: "Test Patient",
        },
      ],
    });
    const svc = new AppointmentService(pool, mockScopeService);
    const result = await svc.queue();
    expect(result).toHaveLength(1);
    const keys = Object.keys(result[0]!).sort();
    expect(keys).toEqual(
      [
        "id", "patient_id", "scheduled_at", "appointment_type", "status",
        "department_display", "clinician_display", "created_by", "updated_at",
        "patient_mrn", "patient_display_name",
      ].sort(),
    );
  });
});
