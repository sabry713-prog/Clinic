/**
 * Admin endpoints for quarantine management.
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  ForbiddenException,
  NotFoundException,
  Logger,
  HttpCode,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsString, IsIn } from "class-validator";
import { Inject } from "@nestjs/common";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { SessionService } from "../auth/session.service";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { v4 as uuidv4 } from "uuid";

class ResolveQuarantineDto {
  @IsIn(["merge", "keep_separate"])
  action!: "merge" | "keep_separate";

  @IsString()
  reason!: string;
}

@ApiTags("admin")
@Controller("admin")
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly sessions: SessionService,
  ) {}

  private assertAdmin(req: Request): string {
    const sessionId = req.cookies["session_id"] as string | undefined;
    if (!sessionId) throw new ForbiddenException("Unauthenticated");
    const session = this.sessions.get(sessionId);
    if (!session) throw new ForbiddenException("Session expired");
    const isAdmin =
      session.roles.includes("hospital_admin") ||
      session.roles.includes("sysadmin");
    if (!isAdmin) throw new ForbiddenException("Admin role required");
    req.authenticatedUserId = session.userId;
    req.authenticatedUserRole = session.roles[0] ?? undefined;
    return session.userId;
  }

  @Get("quarantine")
  @ApiOperation({ summary: "List open quarantine records" })
  async listQuarantine(@Req() req: Request) {
    this.assertAdmin(req);

    const result = await this.pool.query(
      `SELECT id, candidate_a_id, candidate_b_id, confidence,
              features_json, status, created_at
       FROM app.identity_quarantine
       WHERE status = 'open'
       ORDER BY created_at DESC
       LIMIT 100`,
    );

    return result.rows;
  }

  @Post("quarantine/:id/resolve")
  @HttpCode(200)
  @ApiOperation({ summary: "Resolve a quarantine record" })
  async resolveQuarantine(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: ResolveQuarantineDto,
  ): Promise<{ message: string }> {
    const userId = this.assertAdmin(req);
    const requestId = uuidv4() as RequestId;

    const existing = await this.pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM app.identity_quarantine WHERE id = $1`,
      [id],
    );

    const record = existing.rows[0];
    if (!record) throw new NotFoundException("Quarantine record not found");
    if (record.status !== "open") {
      throw new ForbiddenException("Quarantine record already resolved");
    }

    const newStatus = body.action === "merge" ? "merged" : "kept_separate";

    await this.pool.query(
      `UPDATE app.identity_quarantine
       SET status = $1, resolved_by = $2, resolved_at = now(), reason = $3
       WHERE id = $4`,
      [newStatus, userId, body.reason, id],
    );

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "IDENTITY_QUARANTINE_RESOLVED",
      target_type: "identity_quarantine",
      target_id: id,
      outcome: "SUCCESS",
      metadata_json: { action: body.action },
      request_id: requestId,
    });

    this.logger.log({
      event: "quarantine_resolved",
      quarantine_id: id,
      action: body.action,
      resolved_by: userId,
    });

    return { message: `Quarantine record ${newStatus}` };
  }
}
