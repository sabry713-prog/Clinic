import type { Request, Response, NextFunction } from "express";
import { FeatureFlagsMiddleware } from "./feature-flags.middleware";
import { FeatureFlagsService } from "./feature-flags.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(path: string): Partial<Request> {
  return { path, method: "POST" };
}

function makeRes(): {
  res: Partial<Response>;
  statusCode: number | undefined;
  body: unknown;
} {
  const ctx: { statusCode: number | undefined; body: unknown } = {
    statusCode: undefined,
    body: undefined,
  };
  const res = {
    status: jest.fn().mockImplementation((code: number) => {
      ctx.statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation((b: unknown) => {
      ctx.body = b;
    }),
  } as unknown as Partial<Response>;
  return { res, ...ctx };
}

function makeFlags(overrides: Partial<Record<string, boolean>> = {}): FeatureFlagsService {
  return {
    isEnabled: jest.fn().mockImplementation((flag: string) => {
      if (flag in overrides) return overrides[flag];
      return true; // default: everything enabled
    }),
  } as unknown as FeatureFlagsService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FeatureFlagsMiddleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = jest.fn();
  });

  // ── qa.allow_responses=false ─────────────────────────────────────────────

  it("blocks Q&A when qa.allow_responses is false (kill switch)", () => {
    const flags = makeFlags({ "qa.allow_responses": false });
    const mw = new FeatureFlagsMiddleware(flags);

    const req = makeReq("/api/v1/patients/patient-001/qa");
    const { res, statusCode, body } = makeRes();

    mw.use(req as Request, res as Response, next);

    expect(statusCode).toBe(503);
    expect((body as Record<string, unknown>)["flag"]).toBe("qa.allow_responses");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows Q&A when qa.allow_responses is true", () => {
    const flags = makeFlags({ "qa.allow_responses": true });
    const mw = new FeatureFlagsMiddleware(flags);

    const req = makeReq("/api/v1/patients/patient-001/qa");
    const { res } = makeRes();

    mw.use(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });

  // ── narrative.enabled=false ──────────────────────────────────────────────

  it("blocks narrative when narrative.enabled is false", () => {
    const flags = makeFlags({ "narrative.enabled": false });
    const mw = new FeatureFlagsMiddleware(flags);

    const req = makeReq("/api/v1/patients/patient-001/narrative");
    const { res, statusCode, body } = makeRes();

    mw.use(req as Request, res as Response, next);

    expect(statusCode).toBe(503);
    expect((body as Record<string, unknown>)["flag"]).toBe("narrative.enabled");
    expect(next).not.toHaveBeenCalled();
  });

  // ── handoff.enabled=false ────────────────────────────────────────────────

  it("blocks handoff when handoff.enabled is false", () => {
    const flags = makeFlags({ "handoff.enabled": false });
    const mw = new FeatureFlagsMiddleware(flags);

    const req = makeReq("/api/v1/handoff");
    const { res, statusCode, body } = makeRes();

    mw.use(req as Request, res as Response, next);

    expect(statusCode).toBe(503);
    expect((body as Record<string, unknown>)["flag"]).toBe("handoff.enabled");
    expect(next).not.toHaveBeenCalled();
  });

  // ── unrelated paths always pass through ─────────────────────────────────

  it("passes through health endpoint regardless of flags", () => {
    const flags = makeFlags({
      "qa.allow_responses": false,
      "narrative.enabled": false,
      "handoff.enabled": false,
    });
    const mw = new FeatureFlagsMiddleware(flags);

    const req = makeReq("/api/v1/health");
    const { res } = makeRes();

    mw.use(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
  });
});
