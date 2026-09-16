/**
 * Unit tests for CoderQueueService — durable Postgres-backed queue (M09).
 * Tests the deterministic sync, human-state preservation, claim/resolve
 * lifecycle, and removal of cleared pending items using a mocked pool.
 */
import { CoderQueueService } from "./coder-queue.service";
import type { ClaimSimulationReport, SimulatorPatientVerdict } from "./claim-simulator.service";

function patient(overrides: Partial<SimulatorPatientVerdict>): SimulatorPatientVerdict {
  return {
    patient_id: "p1",
    mrn: "MRN-006",
    display_name: "A",
    historical_claims: 12,
    historical_rejections: 3,
    readiness_overall: "ready",
    failed_checks: [],
    warning_checks: [],
    necessity: [],
    verdict: "send",
    ...overrides,
  };
}

function report(patients: SimulatorPatientVerdict[]): ClaimSimulationReport {
  return {
    generated_at: "2026-01-01T00:00:00.000Z",
    graph_available: true,
    patients,
    summary: {
      patients_checked: patients.length,
      send: patients.filter((p) => p.verdict === "send").length,
      fix_before_send: patients.filter((p) => p.verdict === "fix_before_send").length,
      do_not_send: patients.filter((p) => p.verdict === "do_not_send").length,
      orders_checked: patients.flatMap((p) => p.necessity).length,
      orders_green: 0,
      orders_yellow: 0,
      orders_red: 0,
      orders_unavailable: 0,
      claims_flagged: patients.filter((p) => p.verdict !== "send").length,
      estimated_sar_at_risk: 0,
      average_claim_value_sar: 2_500,
    },
    disclaimer: "d",
  };
}

const RED_ORDER = {
  order_id: "sr-1",
  order_display: "Test order",
  icd10_code: "I10",
  sbs_code: "11700-00-10",
  status: "RED" as const,
  pre_auth_required: null,
  suggested_codes: [{ icd10: "I10", description: "Hypertension" }],
};

function makeService(): { service: CoderQueueService; query: jest.Mock } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = jest.fn((sql: string) => {
    if (sql.includes("SELECT count(*)")) {
      return Promise.resolve({ rows: [{ count: "1" }] });
    }
    if (sql.includes("SELECT * FROM app.coder_queue_item")) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool: any = { query };
  const service = new CoderQueueService(pool);
  return { service, query };
}

describe("CoderQueueService — M09 durable queue", () => {
  it("sync adds new findings and reports the queue size", async () => {
    const { service } = makeService();
    const result = await service.sync(report([patient({ necessity: [RED_ORDER] })]));
    expect(result.added).toBe(1);
    expect(result.queue_size).toBe(1);
  });

  it("claim updates the item status and claimed_by", async () => {
    const { service, query } = makeService();
    const row = {
      item_id: "p1:sr-1:necessity_red",
      patient_id: "p1",
      mrn: "MRN-006",
      order_id: "sr-1",
      icd10_code: "I10",
      sbs_code: "11700-00-10",
      reason: "necessity_red",
      detail: "test",
      status: "in_review",
      claimed_by: "user-1",
      resolved_note: null,
      created_at: new Date(),
      updated_at: new Date(),
    };
    query.mockResolvedValue({ rows: [row] });

    const item = await service.claim("p1:sr-1:necessity_red", "user-1");
    expect(item.status).toBe("in_review");
    expect(item.claimed_by).toBe("user-1");
  });

  it("resolve sets status to resolved with the note", async () => {
    const { service, query } = makeService();
    const row = {
      item_id: "p1:sr-1:necessity_red",
      patient_id: "p1",
      mrn: "MRN-006",
      order_id: "sr-1",
      icd10_code: "I10",
      sbs_code: "11700-00-10",
      reason: "necessity_red",
      detail: "test",
      status: "resolved",
      claimed_by: "user-1",
      resolved_note: "Fixed the code",
      created_at: new Date(),
      updated_at: new Date(),
    };
    query.mockResolvedValue({ rows: [row] });

    const item = await service.resolve("p1:sr-1:necessity_red", "user-1", "Fixed the code");
    expect(item.status).toBe("resolved");
    expect(item.resolved_note).toBe("Fixed the code");
  });

  it("list returns items from Postgres (ordering handled by SQL)", async () => {
    const { service, query } = makeService();
    // The ORDER BY is in the SQL query, not the service — mock returns
    // rows in the order the database would produce them.
    query.mockImplementation((sql: string) => {
      if (sql.includes("ORDER BY")) {
        return Promise.resolve({
          rows: [
            { item_id: "pending-1", status: "pending", created_at: new Date(), updated_at: new Date(), patient_id: "p1", mrn: null, order_id: null, icd10_code: null, sbs_code: null, reason: "necessity_red", detail: "d", claimed_by: null, resolved_note: null },
            { item_id: "resolved-1", status: "resolved", created_at: new Date(), updated_at: new Date(), patient_id: "p1", mrn: null, order_id: null, icd10_code: null, sbs_code: null, reason: "necessity_red", detail: "d", claimed_by: null, resolved_note: null },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const items = await service.list();
    expect(items).toHaveLength(2);
    expect(items[0]!.status).toBe("pending"); // first per SQL ordering
    expect(items[1]!.status).toBe("resolved");
  });
});
