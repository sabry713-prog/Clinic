import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { trace } from "@opentelemetry/api";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { AuditMiddleware } from "./audit/audit.middleware";
import { IngestionModule } from "./ingestion/ingestion.module";
import { PatientModule } from "./patient/patient.module";
import { RbacModule } from "./rbac/rbac.module";
import { AdminModule } from "./admin/admin.module";
import { NarrativeProxyModule } from "./narrative-proxy/narrative-proxy.module";
import { QAProxyModule } from "./qa-proxy/qa-proxy.module";
import { HandoffModule } from "./handoff/handoff.module";
import { DsrModule } from "./dsr/dsr.module";
import { MetricsModule } from "./metrics/metrics.module";
import { FeatureFlagsModule } from "./feature-flags/feature-flags.module";
import { DraftModule } from "./draft/draft.module";
import { ConditionModule } from "./condition/condition.module";
import { ServiceRequestModule } from "./service-request/service-request.module";
import { NphiesModule } from "./nphies/nphies.module";
import { ClaimIntegrityModule } from "./claim-integrity/claim-integrity.module";
import { InterpreterModule } from "./interpreter/interpreter.module";
import { AmbientModule } from "./ambient/ambient.module";
import { RefillRequestModule } from "./refill-request/refill-request.module";
import { HisConnectorModule } from "./his-connector/his-connector.module";
import { PatientEngagementModule } from "./patient-engagement/patient-engagement.module";
import { AiReceptionistModule } from "./ai-receptionist/ai-receptionist.module";
import { AiTeamModule } from "./ai-team/ai-team.module";
import { appProfile } from "./app-profile";

/**
 * Compose the feature-module list for the active deployment profile
 * (docs/build/03-slices.md slice pattern; E3 claim-integrity profile).
 *
 * "clinical" (default) loads everything. "claim-integrity" excludes exactly
 * the clinical-agent modules -- the LLM-driven surfaces (Scribe /
 * Consultant / Pharmacist via ai-team, ambient scribe, narrative, Q&A,
 * interpreter, handoff, drafts, ai-receptionist) -- leaving a SaMD-free
 * administrative surface: claim readiness, coding, rejection risk, pre-auth,
 * plus the claim simulator and coder queue. One codebase, a config switch
 * (APP_PROFILE), never a fork.
 */
function composeFeatureModules() {
  const claimIntegrity = appProfile() === "claim-integrity";
  return [
    DatabaseModule,
    HealthModule,
    AuthModule,
    RbacModule,
    PatientModule,
    IngestionModule,
    AdminModule,
    ConditionModule,
    ServiceRequestModule,
    NphiesModule,
    ClaimIntegrityModule,
    RefillRequestModule,
    HisConnectorModule,
    PatientEngagementModule,
    DsrModule,
    MetricsModule,
    FeatureFlagsModule,
    ...(claimIntegrity
      ? []
      : [
          NarrativeProxyModule,
          QAProxyModule,
          InterpreterModule,
          AmbientModule,
          AiTeamModule,
          HandoffModule,
          DraftModule,
          AiReceptionistModule,
        ]),
  ];
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        transport: (process.env["NODE_ENV"] !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined) as any,
        serializers: {
          req: (req: { id: unknown; method: unknown; url: unknown }) => ({
            id: req.id,
            method: req.method,
            // Never log path with query params that could contain PHI
            url:
              typeof req.url === "string"
                ? req.url.split("?")[0]
                : req.url,
          }),
          res: (res: { statusCode: unknown }) => ({
            statusCode: res.statusCode,
          }),
        },
        customProps: () => ({
          service: "clinical-copilot-core",
          trace_id: trace.getActiveSpan()?.spanContext().traceId ?? null,
        }),
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers['set-cookie']",
          ],
          remove: true,
        },
      },
    }),
    ...composeFeatureModules(),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditMiddleware).forRoutes("*");
  }
}
