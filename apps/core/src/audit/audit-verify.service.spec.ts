/**
 * AuditVerifyService tests
 *
 * Verifies:
 * - Chain passes on untampered events
 * - Chain detects tampered hash_self
 * - Chain detects tampered hash_prev
 */

import { createHash } from "node:crypto";

// We test verifyAuditChain from the audit package directly
// (it's pure logic, no NestJS needed)

function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function computeHash(row: {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  metadata_json: Record<string, unknown>;
  request_id: string | null;
  hash_prev: string | null;
}): string {
  return createHash("sha256")
    .update(canonicalJson({
      id: row.id,
      ts: row.ts,
      actor_id: row.actor_id,
      actor_role: row.actor_role,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      outcome: row.outcome,
      metadata_json: row.metadata_json,
      request_id: row.request_id,
      hash_prev: row.hash_prev,
    }), "utf8")
    .digest("hex");
}

// Build a chain of N events
function buildChain(n: number) {
  const rows: Array<{
    id: string;
    ts: string;
    actor_id: string | null;
    actor_role: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    outcome: string;
    metadata_json: Record<string, unknown>;
    request_id: string | null;
    hash_prev: string | null;
    hash_self: string;
  }> = [];

  let prevHash: string | null = null;
  for (let i = 0; i < n; i++) {
    const base = {
      id: `id-${i}`,
      ts: `2026-06-10T0${i}:00:00.000Z`,
      actor_id: "user-1",
      actor_role: "physician",
      action: "PATIENT_VIEW",
      target_type: "patient",
      target_id: `patient-${i}`,
      outcome: "SUCCESS",
      metadata_json: {},
      request_id: `req-${i}`,
      hash_prev: prevHash,
    };
    const hash_self = computeHash(base);
    rows.push({ ...base, hash_self });
    prevHash = hash_self;
  }
  return rows;
}

function makePool(rows: unknown[]) {
  return {
    query: jest.fn().mockImplementation((sql: string) => {
      if (typeof sql === "string" && sql.includes("COUNT")) {
        return Promise.resolve({ rows: [{ count: String(rows.length) }] });
      }
      return Promise.resolve({ rows });
    }),
  };
}

describe("AuditVerifyService", () => {
  it("passes on untampered chain", async () => {
    const { AuditVerifyService } = await import("./audit-verify.service");
    const chain = buildChain(5);
    const pool = makePool(chain);
    const service = new AuditVerifyService(pool as unknown as import("pg").Pool);
    const result = await service.verifyChain();

    expect(result.passed).toBe(true);
    expect(result.events_verified).toBe(5);
    expect(result.violations).toHaveLength(0);
  });

  it("detects tampered hash_self", async () => {
    const { AuditVerifyService } = await import("./audit-verify.service");
    const chain = buildChain(5);
    // Tamper with event at index 2
    const tampered = chain.map((row, i) =>
      i === 2 ? { ...row, hash_self: "tampered_hash_self" } : row,
    );
    const pool = makePool(tampered);
    const service = new AuditVerifyService(pool as unknown as import("pg").Pool);
    const result = await service.verifyChain();

    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]?.event_id).toBe("id-2");
  });

  it("detects tampered hash_prev", async () => {
    const { AuditVerifyService } = await import("./audit-verify.service");
    const chain = buildChain(5);
    // Tamper hash_prev of event at index 3
    const tampered = chain.map((row, i) =>
      i === 3 ? { ...row, hash_prev: "tampered_hash_prev" } : row,
    );
    const pool = makePool(tampered);
    const service = new AuditVerifyService(pool as unknown as import("pg").Pool);
    const result = await service.verifyChain();

    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]?.event_id).toBe("id-3");
  });
});
