import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { FeatureFlagsService } from "./feature-flags.service";
import { FeatureFlagsMiddleware } from "./feature-flags.middleware";

@Module({
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(FeatureFlagsMiddleware)
      .forRoutes(
        // Q&A -- must have qa.allow_responses=true
        { path: "api/v1/patients/*/qa", method: RequestMethod.ALL },
        // Narrative -- must have narrative.enabled=true
        { path: "api/v1/patients/*/narrative", method: RequestMethod.ALL },
        // Handoff -- must have handoff.enabled=true
        { path: "api/v1/handoff*", method: RequestMethod.ALL },
      );
  }
}
