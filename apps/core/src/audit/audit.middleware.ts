import {
  Injectable,
  type NestMiddleware,
  Inject,
  Logger,
} from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
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
import { AuditOutboxService } from "./audit-outbox.service";

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

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly outbox: AuditOutboxService,
  ) {}

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

      // M08: the response is already sent, so this write cannot be part of the
      // request's transaction. What it CAN be is durable -- the event goes into
      // audit.outbox in one INSERT and the flusher retries it into audit.event
      // until it lands. Previously a failed write was retried a few times in
      // this process and then dropped on stderr, which meant a crash or a
      // database blip could lose the event outright.
      void this.outbox
        .enqueue({
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
        })
        .catch((err: unknown) => {
          // The queue itself is unreachable (the database is down), so there is
          // nothing durable left to write to. stderr is the last resort, and it
          // is loud: this is the only path that can still lose an event.
          this.logger.error(
            { event: "audit_enqueue_dead_letter", request_id: requestId, action, err },
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
              actor_id: (req.authenticatedUserId) ?? null,
            }) + "\n",
          );
        });
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
