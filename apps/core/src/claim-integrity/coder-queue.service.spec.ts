/**
 * Unit tests for CoderQueueService — deterministic sync from a simulation
 * report, preservation of human state across re-syncs, removal of cleared
 * pending items, and the claim/resolve lifecycle.
 */
import { CoderQueueService } from "./coder-queue.service";
import type { CoderQueueItem } from "./coder-queue.service";
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
  order_display: "Lumbar MRI",
  icd10_code: "Z00.0",
  sbs_code: "56241-00-10",
  status: "RED" as const,
  pre_auth_required: true,
  suggested_codes: [{ icd10: "M54.3", description: "Sciatica" }],
};

/** First element of a queue snapshot — fails the test loudly if the queue is
 * empty where an item was expected (no non-null assertions). */
function sole(items: readonly CoderQueueItem[]): CoderQueueItem {
  const first = items[0];
  if (first === undefined) throw new Error("expected at least one queue item");
  return first;
}

describe("CoderQueueService", () => {
  it("enqueues one item per flagged finding, keyed deterministically", () => {
    const queue = new CoderQueueService();
    const result = queue.sync(
      report([
        patient({ readiness_overall: "blocked", failed_checks: ["identity_complete"], verdict: "do_not_send" }),
        patient({
          patient_id: "p2",
          mrn: "MRN-007",
          necessity: [RED_ORDER],
          verdict: "do_not_send",
        }),
      ]),
    );
    expect(result.added).toBe(2);
    const items = queue.list();
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.reason).sort()).toEqual(["blocked_readiness", "necessity_red"]);
    expect(items.every((i) => i.status === "pending")).toBe(true);
    // Stable identity: patient + order + reason.
    expect(items.map((i) => i.item_id).sort()).toEqual(
      ["p1:blocked_readiness", "p2:sr-1:necessity_red"].sort(),
    );
  });

  it("preserves human state (claim/resolve) across a re-sync of the same findings", () => {
    const queue = new CoderQueueService();
    queue.sync(report([patient({ readiness_overall: "issues", warning_checks: ["orders_coded"], verdict: "fix_before_send" })]));
    const item = sole(queue.list());
    queue.claim(item.item_id, "coder-1");

    const result = queue.sync(
      report([patient({ readiness_overall: "issues", warning_checks: ["orders_coded"], verdict: "fix_before_send" })]),
    );
    expect(result.added).toBe(0);
    expect(result.preserved).toBe(1);
    const after = sole(queue.list());
    expect(after.status).toBe("in_review");
    expect(after.claimed_by).toBe("coder-1");
  });

  it("removes a pending item whose finding cleared, but keeps resolved history", () => {
    const queue = new CoderQueueService();
    queue.sync(report([patient({ readiness_overall: "issues", warning_checks: ["orders_coded"], verdict: "fix_before_send" })]));
    const item = sole(queue.list());
    queue.resolve(item.item_id, "coder-1", "Confirmed the missing SBS code.");

    // Same patient is now clean — resolved item stays as session history.
    const result = queue.sync(report([patient({ verdict: "send" })]));
    expect(result.removed).toBe(0);
    expect(queue.list().map((i) => i.status)).toContain("resolved");

    // A pending (never touched) item whose finding cleared is dropped.
    queue.sync(
      report([
        patient({ patient_id: "p3", mrn: "MRN-8", readiness_overall: "issues", warning_checks: ["x"], verdict: "fix_before_send" }),
      ]),
    );
    const cleared = queue.sync(report([patient({ patient_id: "p3", mrn: "MRN-8", verdict: "send" })]));
    expect(cleared.removed).toBe(1);
    expect(queue.list().some((i) => i.patient_id === "p3")).toBe(false);
  });

  it("claim -> resolve lifecycle updates status and records the note", () => {
    const queue = new CoderQueueService();
    queue.sync(report([patient({ necessity: [RED_ORDER], verdict: "do_not_send" })]));
    const item = sole(queue.list());
    expect(item.reason).toBe("necessity_red");
    expect(item.detail).toContain("Z00.0 -> 56241-00-10");

    const claimed = queue.claim(item.item_id, "coder-2");
    expect(claimed.status).toBe("in_review");

    const resolved = queue.resolve(item.item_id, "coder-2", "Linked M54.3 instead.");
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolved_note).toBe("Linked M54.3 instead.");
  });

  it("rejects operations on unknown items and resolves of already-resolved claims", () => {
    const queue = new CoderQueueService();
    queue.sync(report([patient({ readiness_overall: "issues", warning_checks: ["x"], verdict: "fix_before_send" })]));
    const item = sole(queue.list());
    expect(() => queue.claim("nope", "u")).toThrow();
    queue.resolve(item.item_id, "u", "done.");
    expect(() => queue.claim(item.item_id, "u")).toThrow();
  });
});
