/**
 * AuditVerifyService -- verifies the audit log hash chain.
 *
 * Runs hourly via setInterval on module init.
 * Also called synchronously by POST /api/v1/admin/audit/verify.
 */

import { Injectable, Logger, Inject, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { verifyAuditChain } from "@clinical-copilot/audit";

export interface VerifyViolation {
  readonly event_id: string;
  readonly reason: string;
}

export interface VerifyResult {
  readonly passed: boolean;
  readonly events_verified: number;
  readonly violations: readonly VerifyViolation[];
  readonly started_at: string;
  readonly finished_at: string;
}

@Injectable()
export class AuditVerifyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditVerifyService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onModuleInit(): void {
    // Run hourly
    this.intervalHandle = setInterval(() => {
      void this.verifyChain().then((result) => {
        if (!result.passed) {
          this.logger.error({
            event: "audit_chain_integrity_failure",
            violations: result.violations,
            events_verified: result.events_verified,
          });
        } else {
          this.logger.log({
            event: "audit_chain_integrity_ok",
            events_verified: result.events_verified,
          });
        }
      });
    }, 60 * 60 * 1000); // 1 hour
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
    }
  }

  async verifyChain(): Promise<VerifyResult> {
    const startedAt = new Date().toISOString();

    // Count events first
    const countResult = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM audit.event",
    );
    const eventsVerified = parseInt(countResult.rows[0]?.count ?? "0", 10);

    const chainResult = await verifyAuditChain(this.pool);

    const finishedAt = new Date().toISOString();

    if (chainResult.valid) {
      return {
        passed: true,
        events_verified: eventsVerified,
        violations: [],
        started_at: startedAt,
        finished_at: finishedAt,
      };
    }

    const violations: VerifyViolation[] = chainResult.broken_at
      ? [{ event_id: chainResult.broken_at, reason: chainResult.reason ?? "unknown" }]
      : [];

    return {
      passed: false,
      events_verified: eventsVerified,
      violations,
      started_at: startedAt,
      finished_at: finishedAt,
    };
  }
}
