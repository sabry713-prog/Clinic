import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { HealthResponse } from "@clinical-copilot/shared-types";

@ApiTags("health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Service liveness check" })
  check(): HealthResponse {
    return {
      status: "ok",
      service: "clinical-copilot-core",
      ts: new Date().toISOString(),
    };
  }
}
