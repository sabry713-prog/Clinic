/**
 * Unit tests for ClaimSimulatorService — determinism of the batch verdicts,
 * verdict derivation, honest degradation when the graph service is down, and
 * the SAR-at-risk summary. The readiness service and global fetch are mocked;
 * the pool is mocked with the two queries simulateBatch() issues (batch
 * patients, then coded+linked pairs per patient).
 */
import { ClaimSimulatorService, AVERAGE_CLAIM_VALUE_SAR } from "./claim-simulator.service";
import type { ClaimReadinessService, ClaimReadiness } from "../nphies/claim-readiness.service";
import type { Pool, QueryResult } from "pg";

function makeReadiness(overall: ClaimReadiness["overall"]): ClaimReadiness {
  return {
    patient_id: "p1",
    generated_at: "2026-01-01T00:00:00.000Z",
    overall,
    checks:
      overall === "blocked"
        ? [{ id: "identity_complete", label: "x", status: "fail", detail: "d" }]
        : overall === "issues"
          ? [{ id: "orders_coded", label: "x", status: "warning", detail: "d" }]
          : [{ id: "identity_complete", label: "x", status: "pass", detail: "d" }],
    disclaimer: "d",
  };
}

/** Pool mock that discriminates on SQL text (not call order) so repeated
 * simulateBatch() runs see consistent data — the determinism test runs it
 * twice against the same pool. */
function makePool(patientRows: object[], pairRows: object[]): Pool {
  const query = jest.fn((sql: string): Promise<QueryResult> =>
    Promise.resolve(
      sql.includes("JOIN app.nphies_claim")
        ? ({ rows: patientRows } as QueryResult)
        : ({ rows: pairRows } as QueryResult),
    ),
  );
  return { query } as unknown as Pool;
}

const READINESS_USER = "admin-user";

function fakeReadinessService(byOverall: (patientId: string) => ClaimReadiness["overall"]) {
  const evaluate = jest.fn(
    (userId: string, patientId: string): Promise<ClaimReadiness> =>
      Promise.resolve({ ...makeReadiness(byOverall(patientId)), patient_id: patientId }),
  );
  return { evaluate } as unknown as ClaimReadinessService;
}

function graphFetch(status: string): typeof fetch {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({ status, pre_auth_required: status !== "GREEN", suggested_codes: [] }),
  }) as unknown as typeof fetch;
}

const PATIENTS = [
  { id: "p1", mrn: "MRN-006", display_name: "A", claims: "12", rejections: "3" },
  { id: "p2", mrn: "MRN-007", display_name: "B", claims: "12", rejections: "5" },
];

describe("ClaimSimulatorService", () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it("returns identical verdicts across two runs on the same data (deterministic)", async () => {
    const readiness = fakeReadinessService(() => "ready");
    const pool = makePool(PATIENTS, []);
    global.fetch = graphFetch("GREEN");

    const svc = new ClaimSimulatorService(pool, readiness);
    const first = await svc.simulateBatch(READINESS_USER);
    const second = await svc.simulateBatch(READINESS_USER);

    expect(first.patients).toEqual(second.patients);
    expect(first.summary).toEqual(second.summary);
    expect(first.patients.map((p) => [p.mrn, p.verdict])).toEqual([
      ["MRN-006", "send"],
      ["MRN-007", "send"],
    ]);
    expect(first.summary.patients_checked).toBe(2);
    expect(first.summary.estimated_sar_at_risk).toBe(0);
    expect(first.disclaimer).toContain("Not a clinical assessment");
  });

  it("maps a blocked readiness to do_not_send and prices the flagged claim", async () => {
    const readiness = fakeReadinessService(() => "blocked");
    const pool = makePool(
      [{ id: "p-blocked", mrn: "MRN-1", display_name: "A", claims: "1", rejections: "0" }],
      [],
    );
    global.fetch = graphFetch("GREEN");

    const report = await new ClaimSimulatorService(pool, readiness).simulateBatch(READINESS_USER);
    expect(report.patients[0]?.verdict).toBe("do_not_send");
    expect(report.patients[0]?.failed_checks).toContain("identity_complete");
    expect(report.summary.do_not_send).toBe(1);
    expect(report.summary.claims_flagged).toBe(1);
    expect(report.summary.estimated_sar_at_risk).toBe(1 * AVERAGE_CLAIM_VALUE_SAR);
  });

  it("maps readiness issues (warnings only) to fix_before_send", async () => {
    const readiness = fakeReadinessService(() => "issues");
    const pool = makePool(
      [{ id: "p-issues", mrn: "MRN-2", display_name: "B", claims: "1", rejections: "0" }],
      [],
    );
    global.fetch = graphFetch("GREEN");

    const report = await new ClaimSimulatorService(pool, readiness).simulateBatch(READINESS_USER);
    expect(report.patients[0]?.verdict).toBe("fix_before_send");
    expect(report.patients[0]?.warning_checks).toContain("orders_coded");
  });

  it("maps a RED necessity verdict to do_not_send and surfaces suggested codes", async () => {
    const readiness = fakeReadinessService(() => "ready");
    const pool = makePool(
      [{ id: "p-red", mrn: "MRN-3", display_name: "C", claims: "1", rejections: "0" }],
      [{ order_id: "sr-1", order_display: "Lumbar MRI", icd10_code: "Z00.0", sbs_code: "56241-00-10" }],
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: "RED",
          pre_auth_required: true,
          suggested_codes: [{ icd10: "M54.3", description: "Sciatica" }],
        }),
    }) as unknown as typeof fetch;

    const report = await new ClaimSimulatorService(pool, readiness).simulateBatch(READINESS_USER);
    expect(report.patients[0]?.verdict).toBe("do_not_send");
    expect(report.patients[0]?.necessity[0]?.suggested_codes[0]?.icd10).toBe("M54.3");
    expect(report.summary.orders_red).toBe(1);
  });

  it("maps a YELLOW (pre-auth required) necessity verdict to fix_before_send", async () => {
    const readiness = fakeReadinessService(() => "ready");
    const pool = makePool(
      [{ id: "p-yellow", mrn: "MRN-4", display_name: "D", claims: "1", rejections: "0" }],
      [{ order_id: "sr-2", order_display: "Lumbar MRI", icd10_code: "M54.3", sbs_code: "56241-00-10" }],
    );
    global.fetch = graphFetch("YELLOW");

    const report = await new ClaimSimulatorService(pool, readiness).simulateBatch(READINESS_USER);
    expect(report.patients[0]?.verdict).toBe("fix_before_send");
    expect(report.summary.orders_yellow).toBe(1);
  });

  it("degrades honestly to UNAVAILABLE when the graph service is unreachable", async () => {
    const readiness = fakeReadinessService(() => "ready");
    const pool = makePool(PATIENTS, [
      { order_id: "sr-1", order_display: "ECG", icd10_code: "I10", sbs_code: "11700-00-10" },
    ]);
    global.fetch = jest.fn().mockRejectedValue(
      new Error("connection refused"),
    ) as unknown as typeof fetch;

    const report = await new ClaimSimulatorService(pool, readiness).simulateBatch(READINESS_USER);
    expect(report.graph_available).toBe(false);
    // First patient's order is UNAVAILABLE; the second patient's orders are
    // short-circuited to UNAVAILABLE without further fetch attempts.
    expect(report.patients[0]?.necessity[0]?.status).toBe("UNAVAILABLE");
    expect(report.patients[1]?.necessity[0]?.status).toBe("UNAVAILABLE");
    expect(report.summary.orders_unavailable).toBe(2);
    // UNAVAILABLE is absence of information, not a defect — readiness still
    // decides the verdict; the flag lives on graph_available.
    expect(report.patients[0]?.verdict).toBe("send");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
