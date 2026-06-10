import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { trace } from "@opentelemetry/api";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { AuditMiddleware } from "./audit/audit.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env["NODE_ENV"] !== "production"
            ? { target: "pino-pretty", options: { colorize: true } }
            : undefined,
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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditMiddleware).forRoutes("*");
  }
}
