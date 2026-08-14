/**
 * ClaimIntegrityController — the RCM batch surface (E3).
 *
 * Routes follow the rejection-analytics precedent (docs/api/08-nphies.md):
 * these aggregate across patients rather than reading one patient's record,
 * so they are admin-guarded (hospital_admin / sysadmin) with the same
 * assertAdmin shape as AdminController, not patient-scoped.
 *
 * Everything here is administrative claim paperwork (CLAUDE.md §2): the
 * simulator is read-only (nothing is submitted to any payer) and the queue
 * holds completeness/necessity findings only. All endpoints are audit-logged.
 */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { SessionService } from "../auth/session.service";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { v4 as uuidv4 } from "uuid";
import {
  ClaimSimulatorService,
  type ClaimSimulationReport,
} from "./claim-simulator.service";
import { CoderQueueService, type CoderQueueItem, type CoderQueueSyncResult } from "./coder-queue.service";

class ResolveQueueItemDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

function uid(req: Request): string {
  return req.authenticatedUserId ?? "";
}

@ApiTags("claim-integrity")
@ApiCookieAuth("session_id")
@Controller("admin/nphies")
export class ClaimIntegrityController {
  constructor(
    private readonly simulator: ClaimSimulatorService,
    private readonly queue: CoderQueueService,
    private readonly sessions: SessionService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  /** Same guard as AdminController.assertAdmin — the RCM/coder surface is
   * hospital_admin / sysadmin until a dedicated coder role exists. */
  private assertAdmin(req: Request): string {
    const cookies = req.cookies as Record<string, string | undefined>;
    const sessionId = cookies.session_id;
    if (!sessionId) throw new ForbiddenException("Unauthenticated");
    const session = this.sessions.get(sessionId);
    if (!session) throw new ForbiddenException("Session expired");
    const isAdmin =
      session.roles.includes("hospital_admin") || session.roles.includes("sysadmin");
    if (!isAdmin) throw new ForbiddenException("Admin role required");
    req.authenticatedUserId = session.userId;
    if (session.roles[0] !== undefined) req.authenticatedUserRole = session.roles[0];
    return session.userId;
  }

  private async audit(
    req: Request,
    action: string,
    targetId: string | null,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action,
      target_type: "claim_integrity",
      target_id: targetId,
      outcome: "SUCCESS",
      // Counts and codes only — never patient-identifying values.
      metadata_json: meta,
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
  }

  @Get("claim-simulator")
  @ApiOperation({
    summary:
      "Deterministic 'check before you send' batch simulation over the seeded claim batch " +
      "(readiness + coding + necessity verdicts; nothing is submitted)",
  })
  async runSimulation(@Req() req: Request): Promise<ClaimSimulationReport> {
    const userId = this.assertAdmin(req);
    const report = await this.simulator.simulateBatch(userId);
    await this.audit(req, "NPHIES_CLAIM_SIMULATOR_RUN", null, {
      patients_checked: report.summary.patients_checked,
      do_not_send: report.summary.do_not_send,
      fix_before_send: report.summary.fix_before_send,
      graph_available: report.graph_available,
    });
    return report;
  }

  @Post("coder-queue/sync")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Re-run the claim simulation and rebuild the coder review queue from its flagged findings",
  })
  async syncQueue(@Req() req: Request): Promise<CoderQueueSyncResult> {
    this.assertAdmin(req);
    const report = await this.simulator.simulateBatch(uid(req));
    const result = this.queue.sync(report);
    await this.audit(req, "NPHIES_CODER_QUEUE_SYNC", null, {
      queue_size: result.queue_size,
      added: result.added,
      removed: result.removed,
    });
    return result;
  }

  @Get("coder-queue")
  @ApiOperation({ summary: "List coder review queue items (pending first)" })
  async listQueue(@Req() req: Request): Promise<{ items: readonly CoderQueueItem[] }> {
    this.assertAdmin(req);
    const items = this.queue.list();
    await this.audit(req, "NPHIES_CODER_QUEUE_VIEW", null, { count: items.length });
    return { items };
  }

  @Post("coder-queue/:itemId/claim")
  @HttpCode(200)
  @ApiOperation({ summary: "Mark a queue item as in review by the current user" })
  async claimItem(@Req() req: Request, @Param("itemId") itemId: string): Promise<CoderQueueItem> {
    const userId = this.assertAdmin(req);
    const item = this.queue.claim(itemId, userId);
    // target_id must be a UUID (audit schema); the queue item's composite id
    // (patient:order:reason) rides in metadata_json instead.
    await this.audit(req, "NPHIES_CODER_QUEUE_CLAIM", null, {
      item_id: itemId,
      reason: item.reason,
    });
    return item;
  }

  @Post("coder-queue/:itemId/resolve")
  @HttpCode(200)
  @ApiOperation({ summary: "Resolve a queue item with a note" })
  async resolveItem(
    @Req() req: Request,
    @Param("itemId") itemId: string,
    @Body() body: ResolveQueueItemDto,
  ): Promise<CoderQueueItem> {
    const userId = this.assertAdmin(req);
    const item = this.queue.resolve(itemId, userId, body.note);
    await this.audit(req, "NPHIES_CODER_QUEUE_RESOLVE", null, {
      item_id: itemId,
      reason: item.reason,
    });
    return item;
  }
}
