/**
 * LinkageVerdictsService tests — payer-rulebook pair lookups.
 *
 * Pins the governance-critical behaviors: verdicts come verbatim from the
 * graph (never guessed), an unreachable graph yields honest UNAVAILABLE,
 * and the result is read-only information with no suggestion semantics.
 */

import { LinkageVerdictsService } from "./linkage-verdicts.service";
import type { PatientScopeService } from "../patient/patient-scope.service";

type PoolLike = { query: unknown };

function makeService(graphResponds: "ok" | "down" | "bad-shape"): {
  service: LinkageVerdictsService;
  query: { mockResolvedValueOnce: (v: unknown) => void };
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = jest.fn();
  const pool = { query } as unknown as PoolLike;
  const scope = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assertPatientInScope: (jest.fn() as any).mockResolvedValue(undefined),
  } as unknown as PatientScopeService;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fetchMock = jest.fn() as any;
  if (graphResponds === "down") {
    fetchMock.mockRejectedValue(new Error("connection refused"));
  } else if (graphResponds === "bad-shape") {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: "WEIRD" }), { status: 200 }));
  } else {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ status: "GREEN", pre_auth_required: false, evidence_chain: { steps: [] } }),
        { status: 200 },
      ),
    );
  }
  jest.spyOn(globalThis, "fetch").mockImplementation(fetchMock);

  const service = new LinkageVerdictsService(pool as never, scope);
  return { service, query };
}

describe("LinkageVerdictsService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.GRAPH_SERVICE_URL;
  });

  it("returns graph verdicts per candidate pair (order with SBS × coded active condition)", async () => {
    const { service, query } = makeService("ok");
    query.mockResolvedValueOnce({ rows: [{ id: "o1", sbs_code: "11700-00-10" }] });
    query.mockResolvedValueOnce({ rows: [{ id: "c1", icd10_code: "I10" }] });

    const result = await service.verdicts("u1", "p1");

    expect(result.graph_available).toBe(true);
    expect(result.pairs).toEqual([
      { order_id: "o1", condition_id: "c1", status: "GREEN", pre_auth_required: false },
    ]);
    expect(result.disclaimer).toContain("does not suggest linkages");
  });

  it("reports honest UNAVAILABLE when the graph is unreachable — never guesses", async () => {
    const { service, query } = makeService("down");
    query.mockResolvedValueOnce({ rows: [{ id: "o1", sbs_code: "X" }] });
    query.mockResolvedValueOnce({ rows: [{ id: "c1", icd10_code: "I10" }] });

    const result = await service.verdicts("u1", "p1");

    expect(result.graph_available).toBe(false);
    expect(result.pairs.every((p) => p.status === "UNAVAILABLE")).toBe(true);
  });

  it("treats a malformed graph verdict as unavailable rather than inventing one", async () => {
    const { service, query } = makeService("bad-shape");
    query.mockResolvedValueOnce({ rows: [{ id: "o1", sbs_code: "X" }] });
    query.mockResolvedValueOnce({ rows: [{ id: "c1", icd10_code: "I10" }] });

    const result = await service.verdicts("u1", "p1");

    expect(result.graph_available).toBe(false);
    expect(result.pairs[0]!.status).toBe("UNAVAILABLE");
  });

  it("returns an empty list when there is nothing to evaluate", async () => {
    const { service, query } = makeService("ok");
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: "c1", icd10_code: "I10" }] });

    const result = await service.verdicts("u1", "p1");
    expect(result.pairs).toEqual([]);
    expect(result.graph_available).toBe(true);
  });

  it("asserts patient scope before any lookup", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = jest.fn();
    const pool = { query } as unknown as PoolLike;
    const scope = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assertPatientInScope: (jest.fn() as any).mockRejectedValue(new Error("out of scope")),
    } as unknown as PatientScopeService;
    const service = new LinkageVerdictsService(pool as never, scope);

    await expect(service.verdicts("u1", "p1")).rejects.toThrow("out of scope");
    expect(query).not.toHaveBeenCalled();
  });
});
