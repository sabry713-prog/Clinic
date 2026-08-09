/**
 * Unit tests for IntakeService — staff-assisted check-in capture
 * (CLAUDE.md §2: reason_for_visit_text is verbatim, never interpreted).
 */

import { IntakeService } from "./intake.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import type { Pool, QueryResult } from "pg";

const mockScopeService = {
  assertPatientInScope: jest.fn(),
} as unknown as PatientScopeService;

const USER_ID = "user-001";
const PATIENT_ID = "patient-001";

beforeEach(() => {
  jest.clearAllMocks();
  (mockScopeService.assertPatientInScope as jest.Mock).mockResolvedValue(undefined);
});

function makeSpyPool(intakeRow: Record<string, unknown>) {
  const query = jest.fn((sql: string) => {
    if (sql.includes("INSERT INTO app.intake_record")) {
      return Promise.resolve({ rows: [intakeRow] } as unknown as QueryResult);
    }
    if (sql.includes("INSERT INTO app.patient_contact")) {
      return Promise.resolve({ rows: [] } as unknown as QueryResult);
    }
    return Promise.resolve({ rows: [] } as unknown as QueryResult);
  });
  return { query } as unknown as Pool;
}

describe("IntakeService.capture — verbatim text discipline", () => {
  it("passes reason_for_visit_text through unchanged apart from whitespace trim", async () => {
    const raw = "  patient reports she has been feeling unwell since yesterday  ";
    const pool = makeSpyPool({
      id: "intake-1",
      patient_id: PATIENT_ID,
      appointment_id: null,
      contact_confirmed: false,
      contact_phone: null,
      contact_email: null,
      preferred_channel: null,
      reason_for_visit_text: raw.trim(),
      captured_by: USER_ID,
      captured_at: "2026-07-10T00:00:00Z",
    });
    const svc = new IntakeService(pool, mockScopeService);
    await svc.capture(USER_ID, PATIENT_ID, {
      appointmentId: null,
      contactConfirmed: false,
      contactPhone: null,
      contactEmail: null,
      preferredChannel: null,
      reasonForVisitText: raw,
    });

    const insertCall = (pool.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
      sql.includes("INSERT INTO app.intake_record"),
    );
    const params = insertCall[1] as unknown[];
    // reason_for_visit_text is the 7th positional param in the INSERT
    expect(params[6]).toBe(raw.trim());
  });

  it("does not upsert app.patient_contact when no contact fields are supplied", async () => {
    const pool = makeSpyPool({
      id: "intake-1",
      patient_id: PATIENT_ID,
      appointment_id: null,
      contact_confirmed: false,
      contact_phone: null,
      contact_email: null,
      preferred_channel: null,
      reason_for_visit_text: "cough",
      captured_by: USER_ID,
      captured_at: "2026-07-10T00:00:00Z",
    });
    const svc = new IntakeService(pool, mockScopeService);
    await svc.capture(USER_ID, PATIENT_ID, {
      appointmentId: null,
      contactConfirmed: false,
      contactPhone: null,
      contactEmail: null,
      preferredChannel: null,
      reasonForVisitText: "cough",
    });

    const contactCall = (pool.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
      sql.includes("INSERT INTO app.patient_contact"),
    );
    expect(contactCall).toBeUndefined();
  });

  it("upserts app.patient_contact when a phone is supplied", async () => {
    const pool = makeSpyPool({
      id: "intake-1",
      patient_id: PATIENT_ID,
      appointment_id: null,
      contact_confirmed: true,
      contact_phone: "+966500000000",
      contact_email: null,
      preferred_channel: "sms",
      reason_for_visit_text: null,
      captured_by: USER_ID,
      captured_at: "2026-07-10T00:00:00Z",
    });
    const svc = new IntakeService(pool, mockScopeService);
    await svc.capture(USER_ID, PATIENT_ID, {
      appointmentId: null,
      contactConfirmed: true,
      contactPhone: "+966500000000",
      contactEmail: null,
      preferredChannel: "sms",
      reasonForVisitText: null,
    });

    const contactCall = (pool.query as jest.Mock).mock.calls.find(([sql]: [string]) =>
      sql.includes("INSERT INTO app.patient_contact"),
    );
    expect(contactCall).toBeDefined();
  });
});
