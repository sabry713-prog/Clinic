/**
 * Unit tests for HospitalSysConnectorService — the dummy/stub HIS
 * transactional connector (docs/architecture/his-connector-hospital-sys.md).
 * Focused on the two properties that matter regardless of what a real
 * backend eventually does: idempotency (never double-transmit) and honest
 * live-mode failure.
 */

import { HospitalSysConnectorService } from "./hospital-sys-connector.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import { NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Pool, QueryResult } from "pg";

const mockScopeService = {
  assertPatientInScope: jest.fn(),
} as unknown as PatientScopeService;

const PATIENT_ID = "patient-001";
const USER_ID = "user-001";

function makeConfig(values: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * Stateful mock pool: models app.service_request / app.refill_request as
 * fixed canned rows, and app.his_order_transmission as a real in-memory
 * table so idempotency/upsert behavior can be exercised across repeated
 * calls the same way it would against real Postgres.
 */
function makeStatefulPool() {
  const transmissions: Record<string, unknown>[] = [];
  const query = jest.fn((sql: string, params?: unknown[]) => {
    if (sql.includes("FROM app.service_request") || sql.includes("FROM app.refill_request")) {
      const id = params?.[0] as string;
      const patientId = params?.[1] as string;
      if (patientId !== PATIENT_ID) return Promise.resolve({ rows: [] } as unknown as QueryResult);
      return Promise.resolve({ rows: [{ display: `Order ${id}` }] } as unknown as QueryResult);
    }
    if (sql.includes("SELECT") && sql.includes("FROM app.his_order_transmission") && sql.includes("idempotency_key = $1")) {
      const key = params?.[0] as string;
      const row = transmissions.find((t) => t["idempotency_key"] === key && ["pending", "accepted"].includes(t["status"] as string));
      return Promise.resolve({ rows: row ? [row] : [] } as unknown as QueryResult);
    }
    if (sql.includes("INSERT INTO app.his_order_transmission")) {
      const [patientId, sourceType, sourceId, idempotencyKey, status, reasonCode, reasonText, mode, transmittedBy] = params!;
      const existingIdx = transmissions.findIndex((t) => t["idempotency_key"] === idempotencyKey);
      const row = {
        id: existingIdx >= 0 ? transmissions[existingIdx]!["id"] : `tx-${transmissions.length + 1}`,
        patient_id: patientId,
        source_type: sourceType,
        source_id: sourceId,
        idempotency_key: idempotencyKey,
        message_type: "ORM_O01",
        status,
        backend_reason_code: reasonCode,
        backend_reason_text: reasonText,
        mode,
        transmitted_by: transmittedBy,
        transmitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (existingIdx >= 0) transmissions[existingIdx] = row;
      else transmissions.push(row);
      return Promise.resolve({ rows: [row] } as unknown as QueryResult);
    }
    return Promise.resolve({ rows: [] } as unknown as QueryResult);
  });
  return { query, transmissions } as unknown as Pool & { transmissions: Record<string, unknown>[] };
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockScopeService.assertPatientInScope as jest.Mock).mockResolvedValue(undefined);
});

describe("HospitalSysConnectorService.transmit — idempotency", () => {
  it("a second transmit() call for the same order returns the existing row, not a duplicate", async () => {
    const pool = makeStatefulPool();
    const svc = new HospitalSysConnectorService(pool, mockScopeService, makeConfig());

    const first = await svc.transmit(USER_ID, PATIENT_ID, "service_request", "sr-1");
    const second = await svc.transmit(USER_ID, PATIENT_ID, "service_request", "sr-1");

    expect(second.id).toBe(first.id);
    // Only ever one row for this order, regardless of outcome (accepted rows
    // are short-circuited by the pending/accepted pre-check; rejected rows
    // hit the upsert, which still keeps exactly one row per idempotency key).
    const rowsForOrder = (pool as unknown as { transmissions: Record<string, unknown>[] }).transmissions.filter(
      (t) => t["source_id"] === "sr-1",
    );
    expect(rowsForOrder).toHaveLength(1);
  });

  it("different orders get independent transmissions", async () => {
    const pool = makeStatefulPool();
    const svc = new HospitalSysConnectorService(pool, mockScopeService, makeConfig());

    const a = await svc.transmit(USER_ID, PATIENT_ID, "service_request", "sr-1");
    const b = await svc.transmit(USER_ID, PATIENT_ID, "service_request", "sr-2");

    expect(a.id).not.toBe(b.id);
  });
});

describe("HospitalSysConnectorService.transmit — safety/scope", () => {
  it("404s when the referenced order does not belong to this patient", async () => {
    const pool = makeStatefulPool();
    const svc = new HospitalSysConnectorService(pool, mockScopeService, makeConfig());

    await expect(svc.transmit(USER_ID, "some-other-patient", "service_request", "sr-1")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("live mode throws HOSPITAL_SYS_LIVE_NOT_CONFIGURED rather than transmitting", async () => {
    const pool = makeStatefulPool();
    const svc = new HospitalSysConnectorService(pool, mockScopeService, makeConfig({ HIS_CONNECTOR: "live" }));

    await expect(svc.transmit(USER_ID, PATIENT_ID, "service_request", "sr-1")).rejects.toThrow();
    expect((pool as unknown as { transmissions: unknown[] }).transmissions).toHaveLength(0);
  });
});

describe("HospitalSysConnectorService.transmit — stub determinism", () => {
  it("the same source id always produces the same simulated outcome", async () => {
    const outcomes: string[] = [];
    for (let i = 0; i < 3; i++) {
      const pool = makeStatefulPool();
      const svc = new HospitalSysConnectorService(pool, mockScopeService, makeConfig());
      const result = await svc.transmit(USER_ID, PATIENT_ID, "refill_request", "rr-fixed-id");
      outcomes.push(`${result.status}:${result.backend_reason_code ?? ""}`);
    }
    expect(new Set(outcomes).size).toBe(1);
  });
});
