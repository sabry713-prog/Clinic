import { Test } from "@nestjs/testing";
import { HealthController } from "./health.controller";
import { PG_POOL } from "../database/database.module";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPool: any = {
  query: jest.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
};

describe("HealthController", () => {
  let controller: HealthController;

  // Every test in this file must be offline. `readiness()` and `preflight()` fetch the NPHIES
  // engine and two service probes, and the suite was reaching whatever happened to be
  // listening: it took 66 seconds and failed on a machine where a stack was running. That is
  // the worst kind of test -- it passes or fails for reasons outside the code -- and it is
  // also a demo risk, because a running stack is exactly the demo condition. Each test that
  // cares overrides this with its own answers.
  const offlineFetch = () =>
    jest.fn(async (url: unknown) => {
      if (String(url).includes(":5006")) {
        return { ok: true, json: async () => ({ profiles_verified: false }) };
      }
      if (String(url).includes("/api/v1/graph/stats")) {
        return { ok: true, json: async () => ({ nodes: 155, relationships: 812 }) };
      }
      return { ok: true, json: async () => ({ status: "ok" }) };
    });

  beforeEach(async () => {
    global.fetch = offlineFetch() as unknown as typeof fetch;
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PG_POOL, useValue: mockPool }],
    }).compile();

    controller = module.get(HealthController);
  });

  it("GET /health returns status ok", () => {
    const result = controller.check();
    expect(result.status).toBe("ok");
    expect(result.service).toBe("clinical-copilot-core");
    expect(result.ts).toBeDefined();
  });

  it("ts is a valid ISO timestamp", () => {
    const result = controller.check();
    expect(new Date(result.ts).toISOString()).toBe(result.ts);
  });

  it("GET /health/ready reports dependencies", async () => {
    const result = await controller.readiness();
    expect(result.status).toBeDefined();
    expect(["ok", "degraded", "unavailable"]).toContain(result.status);
    expect(result.dependencies).toBeDefined();
    expect(result.dependencies.length).toBeGreaterThan(0);
    expect(result.dependencies[0]!.name).toBe("postgres");
    expect(result.connector_modes).toBeDefined();
  });

  it("GET /health reports postgres down when DB fails", async () => {
    mockPool.query.mockRejectedValueOnce(new Error("connection refused"));
    const result = await controller.readiness();
    const pg = result.dependencies.find((d) => d.name === "postgres");
    expect(pg?.status).toBe("down");
  });

  it("GET /health/preflight returns workflow counts", async () => {
    mockPool.query.mockResolvedValue({ rows: [{ count: "50" }] });
    const result = await controller.preflight();
    expect(result.workflow).toBeDefined();
    expect(result.workflow.patient_count).toBeGreaterThanOrEqual(0);
    expect(result.workflow.audit_events).toBeGreaterThanOrEqual(0);
  });

  describe("the values it must not invent (H02)", () => {
    // Every fetch this controller makes: the NPHIES engine and the two service probes.
    const engineSays = (verified: unknown) =>
      jest.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes(":5006")) {
          return { ok: true, json: async () => ({ profiles_verified: verified }) };
        }
        if (u.includes("/api/v1/graph/stats")) {
          return { ok: true, json: async () => ({ nodes: 155, relationships: 812 }) };
        }
        return { ok: true, json: async () => ({ status: "ok" }) };
      });

    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("reports the engine's answer, so it can become true", async () => {
      // The old code was the literal `false`. This test could not have passed against
      // it, which is the point: the value is now asked for rather than asserted.
      global.fetch = engineSays(true) as unknown as typeof fetch;
      const result = await controller.readiness();
      expect(result.connector_modes.profiles_verified).toBe(true);
    });

    it("stays false when the engine says so", async () => {
      global.fetch = engineSays(false) as unknown as typeof fetch;
      const result = await controller.readiness();
      expect(result.connector_modes.profiles_verified).toBe(false);
    });

    it("fails closed when the engine cannot be reached", async () => {
      global.fetch = jest.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;
      const result = await controller.readiness();
      expect(result.connector_modes.profiles_verified).toBe(false);
    });

    it("preflight reports a real node count, never a sentinel", async () => {
      global.fetch = engineSays(false) as unknown as typeof fetch;
      const result = await controller.preflight();
      expect(result.workflow.graph_nodes).toBe(155);
      expect(result.workflow.graph_nodes).not.toBe(-1);
    });

    it("preflight reports null rather than -1 when the count is unavailable", async () => {
      global.fetch = jest.fn(async (url: unknown) => {
        if (String(url).includes("/api/v1/graph/stats")) return { ok: false };
        return { ok: true, json: async () => ({ profiles_verified: false }) };
      }) as unknown as typeof fetch;
      const result = await controller.preflight();
      expect(result.workflow.graph_nodes).toBeNull();
    });
  });
});
