import { Test } from "@nestjs/testing";
import { HealthController } from "./health.controller";
import { PG_POOL } from "../database/database.module";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPool: any = {
  query: jest.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
};

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
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
});
