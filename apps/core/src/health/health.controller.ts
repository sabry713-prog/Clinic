/**
 * HealthController — H02 (readiness assessment): enriched health checks.
 *
 * Three endpoints:
 *
 * GET /health        — liveness: is the process running? (no external calls;
 *                      returns immediately even when everything else is down)
 * GET /health/ready  — readiness: are dependencies reachable? (checks
 *                      Postgres, Neo4j (via veritas-graph), orchestrator,
 *                      and reports connector modes + reference freshness)
 * GET /health/preflight — full pre-demo check: readiness + a real read-only
 *                      workflow assertion (patient count, audit count)
 *
 * The old /health was process-only — it said "ok" even when the database
 * was down. Now the status is honest: "ok" | "degraded" | "unavailable".
 */

import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Inject, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import type { HealthResponse } from "@clinical-copilot/shared-types";
import { activeModuleNames, appProfile, clinicalAgentsLoaded } from "../app-profile";

interface DependencyCheck {
  readonly name: string;
  readonly status: "up" | "down" | "degraded";
  readonly detail: string;
  readonly latency_ms: number;
}

interface ReadinessResponse {
  readonly status: "ok" | "degraded" | "unavailable";
  readonly service: string;
  readonly ts: string;
  readonly profile: string;
  readonly clinical_agents_loaded: boolean;
  readonly modules: readonly string[];
  readonly dependencies: readonly DependencyCheck[];
  readonly connector_modes: {
    readonly nphies: string;
    readonly profiles_verified: boolean;
  };
}

@ApiTags("health")
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Liveness: the process is running. No external calls. */
  @Get()
  @ApiOperation({ summary: "Liveness check — process is up (no external dependencies)" })
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

  /** Readiness: are dependencies reachable? Checks Postgres, graph, orchestrator. */
  @Get("ready")
  @ApiOperation({ summary: "Readiness check — external dependencies reachable" })
  async readiness(): Promise<ReadinessResponse> {
    const checks = await Promise.all([
      this.checkPostgres(),
      this.checkGraphService(),
      this.checkOrchestrator(),
    ]);

    const anyDown = checks.some((c) => c.status === "down");
    const anyDegraded = checks.some((c) => c.status === "degraded");
    const status = anyDown ? "unavailable" : anyDegraded ? "degraded" : "ok";

    return {
      status,
      service: "clinical-copilot-core",
      ts: new Date().toISOString(),
      profile: appProfile(),
      clinical_agents_loaded: clinicalAgentsLoaded(),
      modules: activeModuleNames(),
      dependencies: checks,
      connector_modes: {
        nphies: process.env.NPHIES_CONNECTOR ?? "stub",
        profiles_verified: false,
      },
    };
  }

  /** Preflight: readiness + a real read-only workflow check. Run before a demo. */
  @Get("preflight")
  @ApiOperation({ summary: "Full pre-demo check: dependencies + real workflow assertions" })
  async preflight(): Promise<ReadinessResponse & { workflow: { patient_count: number; audit_events: number; graph_nodes: number | null } }> {
    const base = await this.readiness();

    // Real read-only workflow checks
    let patient_count = 0;
    let audit_events = 0;
    let graph_nodes: number | null = null;

    try {
      const patients = await this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM hospital.patient`,
      );
      patient_count = Number(patients.rows[0]?.count ?? 0);
    } catch { /* already reported in dependencies */ }

    try {
      const audit = await this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.audit_event`,
      );
      audit_events = Number(audit.rows[0]?.count ?? 0);
    } catch { /* already reported */ }

    try {
      const graphUrl = process.env.GRAPH_SERVICE_URL ?? "http://127.0.0.1:5004";
      const resp = await fetch(`${graphUrl}/api/v1/nscre/evaluate-encounter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: "preflight-check" }),
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        // Just checking it responds — the patient doesn't need to exist
        graph_nodes = -1; // signal "graph reachable" without a real count
      }
    } catch { /* already reported */ }

    return { ...base, workflow: { patient_count, audit_events, graph_nodes } };
  }

  private async checkPostgres(): Promise<DependencyCheck> {
    const start = Date.now();
    try {
      const result = await this.pool.query<{ ok: number }>("SELECT 1 AS ok");
      const latency = Date.now() - start;
      return {
        name: "postgres",
        status: result.rows[0]?.ok === 1 ? "up" : "down",
        detail: "SELECT 1 succeeded",
        latency_ms: latency,
      };
    } catch (err) {
      return {
        name: "postgres",
        status: "down",
        detail: `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        latency_ms: Date.now() - start,
      };
    }
  }

  private async checkGraphService(): Promise<DependencyCheck> {
    const start = Date.now();
    const url = process.env.GRAPH_SERVICE_URL ?? "http://127.0.0.1:5004";
    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      const latency = Date.now() - start;
      if (resp.ok) {
        return { name: "veritas-graph", status: "up", detail: "Health check passed", latency_ms: latency };
      }
      return { name: "veritas-graph", status: "degraded", detail: `HTTP ${resp.status}`, latency_ms: latency };
    } catch {
      return {
        name: "veritas-graph",
        status: "degraded",
        detail: "Unreachable — evidence chains and necessity verdicts unavailable",
        latency_ms: Date.now() - start,
      };
    }
  }

  private async checkOrchestrator(): Promise<DependencyCheck> {
    const start = Date.now();
    const url = process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:5005";
    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      const latency = Date.now() - start;
      if (resp.ok) {
        return { name: "orchestrator", status: "up", detail: "Health check passed", latency_ms: latency };
      }
      return { name: "orchestrator", status: "degraded", detail: `HTTP ${resp.status}`, latency_ms: latency };
    } catch {
      return {
        name: "orchestrator",
        status: "degraded",
        detail: "Unreachable — SOAP generation and agent actions unavailable",
        latency_ms: Date.now() - start,
      };
    }
  }
}
