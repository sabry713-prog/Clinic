/**
 * Unit tests for PatientEngagementConnectorService — the dummy/stub reminder
 * connector (docs/architecture/patient-engagement-connector.md). Focused on
 * determinism, honest live-mode failure, scope safety, and the
 * confirmed-contact precondition.
 */
import { PatientEngagementConnectorService } from "./reminder-connector.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Pool, QueryResult } from "pg";

const mockScopeService = {
  assertPatientInScope: jest.fn(),
} as unknown as PatientScopeService;

const PATIENT_ID = "patient-001";
const USER_ID = "user-001";
const APPOINTMENT_ID = "appt-001";

function makeConfig(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function makeStatefulPool(opts: { hasContact?: boolean } = {}) {
  const hasContact = opts.hasContact ?? true;
  const sends: Record<string, unknown>[] = [];
  const query = jest.fn((sql: string, params?: unknown[]) => {
    if (sql.includes("FROM hospital.appointment")) {
      const id = params?.[0] as string;
      const patientId = params?.[1] as string;
      if (id !== APPOINTMENT_ID || patientId !== PATIENT_ID) {
        return Promise.resolve({ rows: [] } as unknown as QueryResult);
      }
      return Promise.resolve({
        rows: [{ scheduled_at: "2026-08-01T10:00:00.000Z", appointment_type: "follow_up", department_display: "Cardiology" }],
      } as unknown as QueryResult);
    }
    if (sql.includes("FROM app.patient_contact")) {
      if (!hasContact) return Promise.resolve({ rows: [] } as unknown as QueryResult);
      return Promise.resolve({ rows: [{ phone: "+966500000000", email: "patient@example.com" }] } as unknown as QueryResult);
    }
    if (sql.includes("INSERT INTO app.reminder_send")) {
      const [patientId, appointmentId, channel, status, mode, templateUsed, renderedMessage, detail, sentBy] = params!;
      const row = {
        id: `send-${sends.length + 1}`,
        patient_id: patientId,
        appointment_id: appointmentId,
        channel,
        status,
        mode,
        template_used: templateUsed,
        rendered_message: renderedMessage,
        simulated_outcome_detail: detail,
        sent_by: sentBy,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      sends.push(row);
      return Promise.resolve({ rows: [row] } as unknown as QueryResult);
    }
    return Promise.resolve({ rows: [] } as unknown as QueryResult);
  });
  return { query, sends } as unknown as Pool & { sends: Record<string, unknown>[] };
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockScopeService.assertPatientInScope as jest.Mock).mockResolvedValue(undefined);
});

describe("PatientEngagementConnectorService.send — determinism", () => {
  it("the same (appointment, channel, patient) always produces the same simulated outcome", async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const pool = makeStatefulPool();
      const svc = new PatientEngagementConnectorService(pool, mockScopeService, makeConfig());
      const result = await svc.send(USER_ID, PATIENT_ID, APPOINTMENT_ID, "sms");
      outcomes.push(`${result.status}:${result.simulated_outcome_detail ?? ""}`);
    }
    expect(new Set(outcomes).size).toBe(1);
  });

  it("repeat sends for the same appointment/channel are allowed (no idempotency block)", async () => {
    const pool = makeStatefulPool();
    const svc = new PatientEngagementConnectorService(pool, mockScopeService, makeConfig());
    const first = await svc.send(USER_ID, PATIENT_ID, APPOINTMENT_ID, "sms");
    const second = await svc.send(USER_ID, PATIENT_ID, APPOINTMENT_ID, "sms");
    expect(second.id).not.toBe(first.id);
    expect((pool as unknown as { sends: unknown[] }).sends).toHaveLength(2);
  });
});

describe("PatientEngagementConnectorService.send — safety", () => {
  it("404s when the referenced appointment does not belong to this patient", async () => {
    const pool = makeStatefulPool();
    const svc = new PatientEngagementConnectorService(pool, mockScopeService, makeConfig());
    await expect(svc.send(USER_ID, "some-other-patient", APPOINTMENT_ID, "sms")).rejects.toThrow(NotFoundException);
  });

  it("throws PATIENT_CONTACT_NOT_CONFIRMED when no contact is on file for the channel", async () => {
    const pool = makeStatefulPool({ hasContact: false });
    const svc = new PatientEngagementConnectorService(pool, mockScopeService, makeConfig());
    await expect(svc.send(USER_ID, PATIENT_ID, APPOINTMENT_ID, "sms")).rejects.toThrow(BadRequestException);
    expect((pool as unknown as { sends: unknown[] }).sends).toHaveLength(0);
  });

  it("live mode throws PATIENT_ENGAGEMENT_LIVE_NOT_CONFIGURED rather than sending", async () => {
    const pool = makeStatefulPool();
    const svc = new PatientEngagementConnectorService(pool, mockScopeService, makeConfig({ PATIENT_ENGAGEMENT_CONNECTOR: "live" }));
    await expect(svc.send(USER_ID, PATIENT_ID, APPOINTMENT_ID, "sms")).rejects.toThrow();
    expect((pool as unknown as { sends: unknown[] }).sends).toHaveLength(0);
  });
});

describe("PatientEngagementConnectorService.send — template content", () => {
  it("the rendered message contains only administrative facts, never a reason for visit", async () => {
    const pool = makeStatefulPool();
    const svc = new PatientEngagementConnectorService(pool, mockScopeService, makeConfig());
    const result = await svc.send(USER_ID, PATIENT_ID, APPOINTMENT_ID, "sms");
    expect(result.rendered_message).toContain("follow_up");
    expect(result.rendered_message).toContain("Cardiology");
    expect(result.rendered_message.toLowerCase()).not.toContain("diagnos");
  });
});
