/**
 * DSR (Data Subject Request) Service
 *
 * Handles access and erasure requests under PDPL / GDPR-equivalent requirements.
 * subject_id is hashed server-side (SHA-256) before storage.
 * Erasure requests are subject to medical record retention requirements.
 */

import { Injectable, Logger, Inject, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { UserId, UserRole, RequestId } from "@clinical-copilot/shared-types";

export interface DsrRequest {
  readonly id: string;
  readonly type: "access" | "erase";
  readonly status: string;
  readonly due_at: string | null;
  readonly requested_at: string;
}

@Injectable()
export class DsrService {
  private readonly logger = new Logger(DsrService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private hashSubjectId(subjectId: string): string {
    return createHash("sha256").update(subjectId, "utf8").digest("hex");
  }

  async createAccess(
    subjectId: string,
    reason: string,
    actorId: string | null,
    actorRole: string | null,
    requestId: RequestId,
  ): Promise<DsrRequest> {
    const subjectIdHash = this.hashSubjectId(subjectId);
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const result = await this.pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO app.dsr_request
         (subject_id_hash, type, status, reason, due_at)
       VALUES ($1, 'access', 'pending', $2, $3)
       RETURNING id, created_at`,
      [subjectIdHash, reason, dueAt],
    );

    const row = result.rows[0]!;

    await writeAuditEvent(this.pool, {
      actor_id: actorId as unknown as UserId | null,
      actor_role: actorRole as UserRole | null,
      action: "DSR_RECEIVED",
      target_type: "dsr_request",
      target_id: row.id,
      outcome: "SUCCESS",
      metadata_json: { type: "access" },
      request_id: requestId,
    });

    this.logger.log({ event: "dsr_access_created", dsr_id: row.id });

    return {
      id: row.id,
      type: "access",
      status: "pending",
      due_at: dueAt,
      requested_at: row.created_at.toISOString(),
    };
  }

  async createErase(
    subjectId: string,
    reason: string,
    actorId: string | null,
    actorRole: string | null,
    requestId: RequestId,
  ): Promise<DsrRequest> {
    const subjectIdHash = this.hashSubjectId(subjectId);
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const result = await this.pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO app.dsr_request
         (subject_id_hash, type, status, reason, due_at)
       VALUES ($1, 'erase', 'pending', $2, $3)
       RETURNING id, created_at`,
      [subjectIdHash, reason, dueAt],
    );

    const row = result.rows[0]!;

    await writeAuditEvent(this.pool, {
      actor_id: actorId as unknown as UserId | null,
      actor_role: actorRole as UserRole | null,
      action: "DSR_RECEIVED",
      target_type: "dsr_request",
      target_id: row.id,
      outcome: "SUCCESS",
      metadata_json: { type: "erase" },
      request_id: requestId,
    });

    this.logger.log({ event: "dsr_erase_created", dsr_id: row.id });

    return {
      id: row.id,
      type: "erase",
      status: "pending",
      due_at: dueAt,
      requested_at: row.created_at.toISOString(),
    };
  }

  async getStatus(requestId: string): Promise<DsrRequest> {
    const result = await this.pool.query<{
      id: string;
      type: string;
      status: string;
      due_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, type, status, due_at, created_at
       FROM app.dsr_request WHERE id = $1`,
      [requestId],
    );

    if (!result.rows[0]) throw new NotFoundException("DSR request not found");
    const row = result.rows[0];

    return {
      id: row.id,
      type: row.type as "access" | "erase",
      status: row.status,
      due_at: row.due_at?.toISOString() ?? null,
      requested_at: row.created_at.toISOString(),
    };
  }
}
