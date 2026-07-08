/**
 * Admin endpoints -- quarantine, user management, audit search, audit verify,
 * config, and DSR coordination.
 *
 * All endpoints require hospital_admin or sysadmin role.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  Res,
  ForbiddenException,
  NotFoundException,
  Logger,
  HttpCode,
  Inject,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  IsString,
  IsIn,
  IsEmail,
  IsArray,
  IsOptional,
  IsDateString,
} from "class-validator";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { SessionService } from "../auth/session.service";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { v4 as uuidv4 } from "uuid";
import { AuditVerifyService } from "../audit/audit-verify.service";
import { WormExportService } from "../audit/worm-export.service";

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class ResolveQuarantineDto {
  @IsIn(["merge", "keep_separate"])
  action!: "merge" | "keep_separate";

  @IsString()
  reason!: string;
}

class CreateUserDto {
  @IsString()
  external_subject!: string;

  @IsString()
  display_name!: string;

  @IsEmail()
  email!: string;

  @IsIn(["ar", "en"])
  @IsOptional()
  preferred_language?: "ar" | "en";

  @IsArray()
  @IsString({ each: true })
  roles!: string[];
}

class UpdateUserRolesDto {
  @IsArray()
  @IsString({ each: true })
  roles!: string[];
}

class AuditQueryDto {
  @IsOptional()
  @IsString()
  actor_id?: string;

  @IsOptional()
  @IsString()
  target_type?: string;

  @IsOptional()
  @IsString()
  target_id?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @IsDateString()
  until?: string;

  @IsOptional()
  @IsIn(["SUCCESS", "FAILURE", "REFUSED"])
  outcome?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  limit?: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

@ApiTags("admin")
@Controller("admin")
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly sessions: SessionService,
    private readonly auditVerify: AuditVerifyService,
    private readonly wormExport: WormExportService,
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
    if (session.roles[0] !== undefined) req.authenticatedUserRole = session.roles[0];
    return session.userId;
  }

  // ─── Quarantine ────────────────────────────────────────────────────────────

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

    return { message: `Quarantine record ${newStatus}` };
  }

  // ─── User management ───────────────────────────────────────────────────────

  @Get("users")
  @ApiOperation({ summary: "List users (cursor paginated)" })
  async listUsers(
    @Req() req: Request,
    @Query("cursor") cursor?: string,
    @Query("limit") limitStr?: string,
  ) {
    this.assertAdmin(req);
    const limit = Math.min(parseInt(limitStr ?? "20", 10) || 20, 100);

    let rows;
    if (cursor) {
      rows = await this.pool.query(
        `SELECT u.id, u.display_name, u.email,
                COALESCE(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles,
                u.disabled_at, u.created_at
         FROM app."user" u
         LEFT JOIN app.user_role r ON r.user_id = u.id
         WHERE u.created_at < (SELECT created_at FROM app."user" WHERE id = $1)
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT $2`,
        [cursor, limit + 1],
      );
    } else {
      rows = await this.pool.query(
        `SELECT u.id, u.display_name, u.email,
                COALESCE(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles,
                u.disabled_at, u.created_at
         FROM app."user" u
         LEFT JOIN app.user_role r ON r.user_id = u.id
         GROUP BY u.id
         ORDER BY u.created_at DESC
         LIMIT $1`,
        [limit + 1],
      );
    }

    const data = rows.rows.slice(0, limit);
    const hasMore = rows.rows.length > limit;
    const nextCursor = hasMore ? (data[data.length - 1] as { id: string } | undefined)?.id ?? null : null;

    return {
      data,
      pagination: { next_cursor: nextCursor, has_more: hasMore },
    };
  }

  @Post("users")
  @HttpCode(201)
  @ApiOperation({ summary: "Create user" })
  async createUser(
    @Req() req: Request,
    @Body() body: CreateUserDto,
  ) {
    const userId = this.assertAdmin(req);
    const requestId = uuidv4() as RequestId;

    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO app."user"
         (external_subject, display_name, email, preferred_language, roles, tenant_id)
       VALUES ($1, $2, $3, $4, $5,
         (SELECT id FROM app.tenant LIMIT 1))
       RETURNING id`,
      [
        body.external_subject,
        body.display_name,
        body.email,
        body.preferred_language ?? "ar",
        JSON.stringify(body.roles),
      ],
    );

    const newUserId = result.rows[0]!.id;

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "USER_CREATED",
      target_type: "user",
      target_id: newUserId,
      outcome: "SUCCESS",
      metadata_json: { roles: body.roles },
      request_id: requestId,
    });

    return { id: newUserId };
  }

  @Patch("users/:id")
  @HttpCode(200)
  @ApiOperation({ summary: "Update user roles" })
  async updateUserRoles(
    @Req() req: Request,
    @Param("id") targetId: string,
    @Body() body: UpdateUserRolesDto,
  ): Promise<{ message: string }> {
    const userId = this.assertAdmin(req);
    const requestId = uuidv4() as RequestId;

    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM app."user" WHERE id = $1`,
      [targetId],
    );
    if (!existing.rows[0]) throw new NotFoundException("User not found");

    await this.pool.query(
      `UPDATE app."user" SET roles = $1 WHERE id = $2`,
      [JSON.stringify(body.roles), targetId],
    );

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "ROLE_CHANGED",
      target_type: "user",
      target_id: targetId,
      outcome: "SUCCESS",
      metadata_json: { new_roles: body.roles },
      request_id: requestId,
    });

    return { message: "Roles updated" };
  }

  @Delete("users/:id")
  @HttpCode(200)
  @ApiOperation({ summary: "Soft-disable a user" })
  async disableUser(
    @Req() req: Request,
    @Param("id") targetId: string,
  ): Promise<{ message: string }> {
    const userId = this.assertAdmin(req);
    const requestId = uuidv4() as RequestId;

    const existing = await this.pool.query<{ id: string; disabled_at: Date | null }>(
      `SELECT id, disabled_at FROM app."user" WHERE id = $1`,
      [targetId],
    );
    if (!existing.rows[0]) throw new NotFoundException("User not found");
    if (existing.rows[0].disabled_at) {
      throw new ForbiddenException("User already disabled");
    }

    await this.pool.query(
      `UPDATE app."user" SET disabled_at = now() WHERE id = $1`,
      [targetId],
    );

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "USER_DISABLED",
      target_type: "user",
      target_id: targetId,
      outcome: "SUCCESS",
      metadata_json: {},
      request_id: requestId,
    });

    return { message: "User disabled" };
  }

  // ─── Audit search ──────────────────────────────────────────────────────────

  @Get("audit")
  @ApiOperation({ summary: "Search audit log" })
  async searchAudit(@Req() req: Request, @Query() query: AuditQueryDto) {
    const userId = this.assertAdmin(req);
    const requestId = uuidv4() as RequestId;

    const limit = Math.min(parseInt(query.limit ?? "50", 10) || 50, 200);
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (query.actor_id) {
      conditions.push(`e.actor_id = $${idx++}`);
      params.push(query.actor_id);
    }
    if (query.target_type) {
      conditions.push(`e.target_type = $${idx++}`);
      params.push(query.target_type);
    }
    if (query.target_id) {
      conditions.push(`e.target_id = $${idx++}`);
      params.push(query.target_id);
    }
    if (query.action) {
      conditions.push(`e.action = $${idx++}`);
      params.push(query.action);
    }
    if (query.since) {
      conditions.push(`e.ts >= $${idx++}`);
      params.push(query.since);
    }
    if (query.until) {
      conditions.push(`e.ts <= $${idx++}`);
      params.push(query.until);
    }
    if (query.outcome) {
      conditions.push(`e.outcome = $${idx++}`);
      params.push(query.outcome);
    }
    if (query.cursor) {
      conditions.push(`e.ts < (SELECT ts FROM audit.event WHERE id = $${idx++})`);
      params.push(query.cursor);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await this.pool.query(
      `SELECT e.id, e.ts, e.actor_id, u.display_name AS actor_display_name,
              e.actor_role, e.action, e.target_type, e.target_id,
              e.outcome, e.metadata_json, e.request_id
       FROM audit.event e
       LEFT JOIN app."user" u ON u.id = e.actor_id
       ${where}
       ORDER BY e.ts DESC, e.id DESC
       LIMIT $${idx}`,
      [...params, limit + 1],
    );

    const data = result.rows.slice(0, limit).map((row: Record<string, unknown>) => ({
      id: row["id"],
      ts: row["ts"],
      actor: {
        id: row["actor_id"],
        display_name: row["actor_display_name"],
        role: row["actor_role"],
      },
      action: row["action"],
      target_type: row["target_type"],
      target_id: row["target_id"],
      outcome: row["outcome"],
      metadata_json: row["metadata_json"],
      request_id: row["request_id"],
    }));

    const hasMore = result.rows.length > limit;
    const nextCursor = hasMore ? (data[data.length - 1] as { id: string } | undefined)?.id ?? null : null;

    // Audit the access (per spec: AUDIT_LOG_ACCESSED)
    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "AUDIT_LOG_ACCESSED",
      target_type: "audit.event",
      target_id: null,
      outcome: "SUCCESS",
      metadata_json: { filters: { action: query.action, since: query.since, until: query.until } },
      request_id: requestId,
    });

    return {
      data,
      pagination: { next_cursor: nextCursor, has_more: hasMore },
    };
  }

  @Post("audit/verify")
  @HttpCode(200)
  @ApiOperation({ summary: "Verify audit log hash-chain integrity" })
  async verifyAudit(@Req() req: Request) {
    this.assertAdmin(req);
    return this.auditVerify.verifyChain();
  }

  @Get("audit/summary")
  @ApiOperation({ summary: "DPO compliance summary — audit aggregates for a date range" })
  async auditSummary(@Req() req: Request, @Query() query: AuditQueryDto) {
    this.assertAdmin(req);

    const conds: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (query.since) { conds.push(`ts >= $${i++}`); params.push(query.since); }
    if (query.until) { conds.push(`ts <= $${i++}`); params.push(query.until); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [totals, byAction, byOutcome, patients, chain] = await Promise.all([
      this.pool.query<{ total: string; first_ts: string | null; last_ts: string | null; actors: string }>(
        `SELECT count(*)::text AS total, min(ts)::text AS first_ts, max(ts)::text AS last_ts,
                count(DISTINCT actor_id)::text AS actors
           FROM audit.event ${where}`, params),
      this.pool.query<{ action: string; n: string }>(
        `SELECT action, count(*)::text AS n FROM audit.event ${where}
          GROUP BY action ORDER BY count(*) DESC`, params),
      this.pool.query<{ outcome: string; n: string }>(
        `SELECT outcome, count(*)::text AS n FROM audit.event ${where}
          GROUP BY outcome ORDER BY outcome`, params),
      this.pool.query<{ n: string }>(
        `SELECT count(DISTINCT target_id)::text AS n FROM audit.event ${where}
          ${where ? "AND" : "WHERE"} target_type = 'patient'`, params),
      this.auditVerify.verifyChain(),
    ]);

    const t = totals.rows[0];
    return {
      range: { since: query.since ?? null, until: query.until ?? null },
      total_events: Number(t?.total ?? 0),
      distinct_actors: Number(t?.actors ?? 0),
      distinct_patients_accessed: Number(patients.rows[0]?.n ?? 0),
      first_event_at: t?.first_ts ?? null,
      last_event_at: t?.last_ts ?? null,
      by_action: byAction.rows.map((r) => ({ action: r.action, count: Number(r.n) })),
      by_outcome: byOutcome.rows.map((r) => ({ outcome: r.outcome, count: Number(r.n) })),
      integrity: { verified: chain.passed, violations: chain.violations.length },
      generated_at: new Date().toISOString(),
    };
  }

  @Post("audit/export-worm")
  @HttpCode(200)
  @ApiOperation({ summary: "Manually trigger yesterday's WORM audit export" })
  async exportWorm(@Req() req: Request): Promise<{ message: string }> {
    this.assertAdmin(req);
    await this.wormExport.exportYesterday();
    return { message: "WORM export triggered successfully" };
  }

  @Get("audit/export")
  @ApiOperation({ summary: "Export audit log as NDJSON stream" })
  async exportAudit(@Req() req: Request, @Query() query: AuditQueryDto, @Res() res: Response) {
    this.assertAdmin(req);

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (query.since) { conditions.push(`ts >= $${idx++}`); params.push(query.since); }
    if (query.until) { conditions.push(`ts <= $${idx++}`); params.push(query.until); }
    if (query.action) { conditions.push(`action = $${idx++}`); params.push(query.action); }
    if (query.actor_id) { conditions.push(`actor_id = $${idx++}`); params.push(query.actor_id); }
    if (query.outcome) { conditions.push(`outcome = $${idx++}`); params.push(query.outcome); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const client = await this.pool.connect();
    try {
      const queryResult = await client.query(
        `SELECT id, ts, actor_id, actor_role, action, target_type, target_id, outcome, metadata_json, request_id
         FROM audit.event ${where} ORDER BY ts ASC`,
        params,
      );
      for (const row of queryResult.rows) {
        res.write(JSON.stringify(row) + "\n");
      }
      res.end();
    } catch {
      res.end();
    } finally {
      client.release();
    }
  }

  // ─── NPHIES rejection analytics ─────────────────────────────────────────────

  @Get("nphies/rejection-analytics")
  @ApiOperation({ summary: "Factual dashboard of NPHIES claim outcomes and rejection codes over time" })
  async nphiesRejectionAnalytics(@Req() req: Request, @Query() query: AuditQueryDto) {
    this.assertAdmin(req);

    const conds: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (query.since) { conds.push(`submitted_at >= $${i++}`); params.push(query.since); }
    if (query.until) { conds.push(`submitted_at <= $${i++}`); params.push(query.until); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [totals, byStatus, byCode, byWeek] = await Promise.all([
      this.pool.query<{ total: string; rejected: string; first_ts: string | null; last_ts: string | null }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'rejected')::text AS rejected,
                min(submitted_at)::text AS first_ts, max(submitted_at)::text AS last_ts
           FROM app.nphies_claim ${where}`, params),
      this.pool.query<{ status: string; n: string }>(
        `SELECT status, count(*)::text AS n FROM app.nphies_claim ${where}
          GROUP BY status ORDER BY status`, params),
      this.pool.query<{ code: string; n: string }>(
        `SELECT code, count(*)::text AS n
           FROM app.nphies_claim, unnest(rejection_codes) AS code
           ${where} ${where ? "AND" : "WHERE"} status = 'rejected'
          GROUP BY code ORDER BY count(*) DESC`, params),
      this.pool.query<{ week: string; total: string; rejected: string }>(
        `SELECT date_trunc('week', submitted_at)::date::text AS week,
                count(*)::text AS total,
                count(*) FILTER (WHERE status = 'rejected')::text AS rejected
           FROM app.nphies_claim ${where}
          GROUP BY week ORDER BY week`, params),
    ]);

    const t = totals.rows[0];
    const total = Number(t?.total ?? 0);
    const rejected = Number(t?.rejected ?? 0);

    return {
      range: { since: query.since ?? null, until: query.until ?? null },
      total_claims: total,
      rejected_claims: rejected,
      rejection_rate: total > 0 ? Math.round((rejected / total) * 1000) / 1000 : 0,
      first_claim_at: t?.first_ts ?? null,
      last_claim_at: t?.last_ts ?? null,
      by_status: byStatus.rows.map((r) => ({ status: r.status, count: Number(r.n) })),
      by_rejection_code: byCode.rows.map((r) => ({ code: r.code, count: Number(r.n) })),
      by_week: byWeek.rows.map((r) => ({ week: r.week, total: Number(r.total), rejected: Number(r.rejected) })),
      disclaimer: "Factual counts of submitted claim outcomes. Not billing advice; rejection codes reflect the configured connector's responses.",
      generated_at: new Date().toISOString(),
    };
  }

  // ─── Config ────────────────────────────────────────────────────────────────

  @Get("config")
  @ApiOperation({ summary: "Get hospital configuration" })
  async getConfig(@Req() req: Request) {
    this.assertAdmin(req);

    const result = await this.pool.query<{ config_json: Record<string, unknown> }>(
      `SELECT config_json FROM app.tenant LIMIT 1`,
    );
    return result.rows[0]?.config_json ?? {};
  }

  @Patch("config")
  @HttpCode(200)
  @ApiOperation({ summary: "Update hospital configuration" })
  async updateConfig(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ): Promise<{ message: string }> {
    const userId = this.assertAdmin(req);
    const requestId = uuidv4() as RequestId;

    await this.pool.query(
      `UPDATE app.tenant
       SET config_json = config_json || $1::jsonb`,
      [JSON.stringify(body)],
    );

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "CONFIG_CHANGED",
      target_type: "tenant",
      target_id: null,
      outcome: "SUCCESS",
      metadata_json: { keys_updated: Object.keys(body) },
      request_id: requestId,
    });

    return { message: "Config updated" };
  }
}
