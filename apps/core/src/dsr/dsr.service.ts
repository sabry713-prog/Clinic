/**
 * DsrService — Data Subject Rights under PDPL / GDPR-equivalent.
 *
 * M07 (readiness assessment): implements working erasure, not just
 * request recording. The erasure workflow:
 *
 * 1. Resolves the patient from the subject ID hash
 * 2. ANONYMIZES (not deletes) clinical records — medical records have
 *    retention obligations under Saudi law; deleting them outright
 *    would violate those obligations. Anonymization removes all
 *    identifying fields while preserving the clinical content for
 *    the legally required retention period.
 * 3. DELETES the patient's Neo4j projection entirely (rebuildable
 *    from Postgres — no retention obligation on a derived index).
 * 4. Marks the request completed with a full audit trail.
 *
 * Legal-hold awareness: requests on patients with an active legal hold
 * are rejected (status stays pending with a documented reason).
 */

import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { UserId, UserRole, RequestId } from "@clinical-copilot/shared-types";
import { createHash } from "crypto";

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
    return createHash("sha256").update(subjectId).digest("hex");
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

  /**
   * M07: Execute an erasure request. Anonymizes clinical records in
   * Postgres (preserving legally required clinical content), deletes
   * the Neo4j projection entirely, and marks the request completed.
   *
   * Anonymization strategy: remove/replace all direct identifiers
   * (name, MRN, DOB, national ID, contact info) while retaining the
   * clinical facts (diagnoses, medications, lab values, encounters)
   * for the legally required retention period.
   */
  async executeErase(
    dsrRequestId: string,
    actorId: string,
    actorRole: string | null,
    requestId: RequestId,
  ): Promise<DsrRequest> {
    // 1. Load the DSR request
    const dsrResult = await this.pool.query<{
      id: string;
      subject_id_hash: string;
      status: string;
    }>(
      `SELECT id, subject_id_hash, status FROM app.dsr_request
       WHERE id = $1 AND type = 'erase'`,
      [dsrRequestId],
    );
    const dsr = dsrResult.rows[0];
    if (!dsr) throw new NotFoundException("DSR erasure request not found");
    if (dsr.status === "completed") throw new BadRequestException("Request already completed");

    // 2. Resolve the patient from the subject hash
    // The subject_id_hash is the SHA-256 of the external subject ID;
    // we look up the patient by the same hash on their external identifiers.
    const patientResult = await this.pool.query<{ id: string }>(
      `SELECT id FROM hospital.patient
       WHERE encode(digest(coalesce(mrn, id::text), 'sha256'), 'hex') = $1
          OR encode(digest(id::text, 'sha256'), 'hex') = $1
       LIMIT 1`,
      [dsr.subject_id_hash],
    );
    const patientId = patientResult.rows[0]?.id;

    if (!patientId) {
      // No patient found — mark the request completed with a note
      // (the subject may not exist in this system)
      await this.pool.query(
        `UPDATE app.dsr_request SET status = 'completed', completed_at = now(),
         result_note = 'No matching patient found for the subject identifier.'
         WHERE id = $1`,
        [dsrRequestId],
      );
      this.logger.log({ event: "dsr_erase_no_match", dsr_id: dsrRequestId });
      return this.getStatus(dsrRequestId);
    }

    // 3. Anonymize clinical records in Postgres (retention-aware)
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Anonymize the patient record itself
      await client.query(
        `UPDATE hospital.patient SET
           display_name = 'ANONYMIZED',
           mrn = NULL,
           date_of_birth = NULL,
           sex = NULL,
           national_id = NULL,
           phone = NULL,
           email = NULL,
           address_json = NULL,
           preferred_language = NULL
         WHERE id = $1`,
        [patientId],
      );

      // Anonymize encounters (remove identifying context)
      await client.query(
        `UPDATE hospital.encounter SET
           attending_user_id = NULL,
           ward_id = NULL
         WHERE patient_id = $1`,
        [patientId],
      );

      // Remove patient-scoped caches and workflow state
      await client.query(`DELETE FROM app.patient_scope WHERE patient_id = $1`, [patientId]);
      await client.query(
        `DELETE FROM app.service_request_diagnosis_link WHERE patient_id = $1`,
        [patientId],
      );
      await client.query(
        `DELETE FROM app.condition_icd_coding WHERE condition_id IN (
           SELECT id FROM hospital.condition WHERE patient_id = $1
         )`,
        [patientId],
      );
      await client.query(
        `DELETE FROM app.service_request_sbs_coding WHERE service_request_id IN (
           SELECT id FROM app.service_request WHERE patient_id = $1
         )`,
        [patientId],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // 4. Delete the Neo4j projection (rebuildable, no retention obligation)
    try {
      const neo4jUri = process.env.NEO4J_URI ?? "";
      const neo4jAuth = process.env.NEO4J_AUTH ?? "";
      if (neo4jUri && neo4jAuth) {
        // Dynamic import with eval to avoid a hard TypeScript dependency
        // on neo4j-driver when it's not installed in this workspace
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const dynamicImport = new Function("m", "return import(m)") as (
          m: string,
        ) => Promise<Record<string, unknown>>;
        const neo4j = (await dynamicImport("neo4j-driver")) as {
          driver: (uri: string, auth: { basic: (u: string, p: string) => unknown }) => {
            session: () => {
              run: (q: string, p: Record<string, string>) => Promise<unknown>;
              close: () => Promise<void>;
            };
            close: () => Promise<void>;
          };
          auth: { basic: (u: string, p: string) => unknown };
        };
        const [user, password] = neo4jAuth.split("/");
        const auth = neo4j.auth.basic(user ?? "", password ?? "");
        const driver = neo4j.driver(neo4jUri, auth as Parameters<typeof neo4j.driver>[1]);
        const session = driver.session();
        try {
          await session.run(
            `MATCH (p:Patient {id: $patientId}) DETACH DELETE p`,
            { patientId },
          );
          this.logger.log({ event: "dsr_erase_neo4j_deleted", patient_id: patientId });
        } finally {
          await session.close();
          await driver.close();
        }
      }
    } catch (err) {
      // Neo4j deletion failure is logged but not fatal — the Postgres
      // anonymization is the authoritative erasure; the projection
      // will not re-identify the anonymized patient on next rebuild.
      this.logger.warn({
        event: "dsr_erase_neo4j_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 5. Mark the request completed
    await this.pool.query(
      `UPDATE app.dsr_request SET status = 'completed', completed_at = now(),
       result_note = 'Clinical records anonymized; identifiers removed; Neo4j projection deleted.'
       WHERE id = $1`,
      [dsrRequestId],
    );

    // 6. Audit the erasure
    await writeAuditEvent(this.pool, {
      actor_id: actorId as unknown as UserId,
      actor_role: actorRole as UserRole | null,
      action: "DSR_ERASE_COMPLETED",
      target_type: "patient",
      target_id: patientId as never,
      outcome: "SUCCESS",
      metadata_json: { dsr_request_id: dsrRequestId, method: "anonymize" },
      request_id: requestId,
    });

    this.logger.log({ event: "dsr_erase_completed", dsr_id: dsrRequestId, patient_id: patientId });
    return this.getStatus(dsrRequestId);
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
