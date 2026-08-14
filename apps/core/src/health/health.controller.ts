import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { HealthResponse } from "@clinical-copilot/shared-types";
import { activeModuleNames, appProfile, clinicalAgentsLoaded } from "../app-profile";

@ApiTags("health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Service liveness check + active deployment profile" })
  check(): HealthResponse {
    return {
      status: "ok",
      service: "clinical-copilot-core",
      ts: new Date().toISOString(),
      profile: appProfile(),
      clinical_agents_loaded: clinicalAgentsLoaded(),
      modules: activeModuleNames(),
    };
  }
}
