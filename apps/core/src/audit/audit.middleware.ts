import {
  Injectable,
  type NestMiddleware,
  Inject,
  Logger,
} from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import type {
  AuditOutcome,
  RequestId,
  UserId,
  UserRole,
} from "@clinical-copilot/shared-types";
import { trace } from "@opentelemetry/api";
import { v4 as uuidv4 } from "uuid";

// Extend Express Request type to carry audit context
declare module "express" {
  interface Request {
    requestId?: string;
    authenticatedUserId?: string;
    authenticatedUserRole?: string;
  }
}

// Route templates that should not be audited (liveness probes)
const SKIP_AUDIT_PATHS = new Set(["/api/v1/health"]);

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuditMiddleware.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // Assign a request ID for correlation
    const requestId = (req.headers["x-request-id"] as string | undefined) ?? uuidv4();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    const path = req.path;
    const method = req.method;

    res.on("finish", () => {
      // Skip audit for health probe
      if (SKIP_AUDIT_PATHS.has(path)) return;

      const outcome: AuditOutcome =
        res.statusCode >= 500
          ? "FAILURE"
          : res.statusCode === 403 || res.statusCode === 401
            ? "REFUSED"
            : "SUCCESS";

      // Action = METHOD PATH_TEMPLATE (path params replaced)
      const action = `HTTP_${method}_${this.normalisePathTemplate(path)}`;

      const traceId =
        trace.getActiveSpan()?.spanContext().traceId ?? null;

      // M08 (readiness assessment): generic audit writes previously
      // failed open — a lost write was only logged, the event gone.
      // Now: bounded retry with backoff; on final failure, the event
      // is dead-lettered to stderr so it's recoverable from logs.
      const attempt = async (retries: number): Promise<void> => {
        try {
          await writeAuditEvent(this.pool, {
            actor_id: (req.authenticatedUserId as UserId | undefined) ?? null,
            actor_role: (req.authenticatedUserRole as UserRole | undefined) ?? null,
            action,
            target_type: null,
            target_id: null,
            outcome,
            metadata_json: {
              method,
              status_code: res.statusCode,
              trace_id: traceId,
              // Never include query params, body, or any PHI
            },
            request_id: requestId as RequestId,
          });
        } catch (err) {
          if (retries > 0) {
            await new Promise((r) => setTimeout(r, 50 * (4 - retries)));
            return attempt(retries - 1);
          }
          this.logger.error(
            { event: "audit_write_dead_letter", request_id: requestId, action, err },
            "AuditMiddleware",
          );
          process.stderr.write(
            JSON.stringify({
              dead_letter: "audit_event",
              ts: new Date().toISOString(),
              request_id: requestId,
              action,
              method,
              status_code: res.statusCode,
              actor_id: (req.authenticatedUserId as string | undefined) ?? null,
            }) + "\n",
          );
        }
      };

      void attempt(3);
    });

    next();
  }

  /**
   * Replace UUID-like segments in paths with :id placeholder to avoid
   * high-cardinality audit action strings.
   */
  private normalisePathTemplate(path: string): string {
    const UUID_RE =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    return path.replace(UUID_RE, ":id").replace(/\/+$/, "") || "/";
  }
}
