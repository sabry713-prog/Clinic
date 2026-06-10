import {
  Injectable,
  type NestMiddleware,
} from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import {
  httpRequestsTotal,
  httpRequestDurationSeconds,
} from "./metrics.registry";

/**
 * Prometheus HTTP instrumentation middleware.
 *
 * Records:
 *   http_requests_total{service, path, method, status}
 *   http_request_duration_seconds{service, path, method}
 *
 * Path normalization: strips UUIDs and numeric path segments to avoid
 * high-cardinality label values. E.g.:
 *   /api/v1/patients/550e8400-e29b-41d4-a716-446655440000
 *   → /api/v1/patients/:id
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const startTime = process.hrtime.bigint();
    const path = normalizePath(req.path);
    const method = req.method;

    res.on("finish", () => {
      const durationNs = process.hrtime.bigint() - startTime;
      const durationSeconds = Number(durationNs) / 1e9;
      const status = String(res.statusCode);

      httpRequestsTotal
        .labels({ service: "core", path, method, status })
        .inc();

      httpRequestDurationSeconds
        .labels({ service: "core", path, method })
        .observe(durationSeconds);
    });

    next();
  }
}

/**
 * Replace UUIDs and pure-numeric path segments with a placeholder so that
 * each unique route pattern maps to a single time-series label rather than one
 * series per resource ID.
 */
function normalizePath(rawPath: string): string {
  return rawPath
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":id",
    )
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}
