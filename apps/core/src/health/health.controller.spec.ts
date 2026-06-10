import { Test } from "@nestjs/testing";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
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
});
