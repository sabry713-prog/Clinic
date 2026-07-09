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
import { InterpreterModule } from "./interpreter/interpreter.module";
import { AmbientModule } from "./ambient/ambient.module";

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
    DatabaseModule,
    HealthModule,
    AuthModule,
    RbacModule,
    PatientModule,
    IngestionModule,
    AdminModule,
    NarrativeProxyModule,
    QAProxyModule,
    HandoffModule,
    DraftModule,
    ConditionModule,
    ServiceRequestModule,
    NphiesModule,
    InterpreterModule,
    AmbientModule,
    DsrModule,
    MetricsModule,
    FeatureFlagsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditMiddleware).forRoutes("*");
  }
}
