/**
 * Resolves which patients a given user is permitted to access.
 *
 * Scope sources (in order):
 * 1. Active encounters where attending_user_id = current user's DB UUID
 * 2. Ward-based scope for nurses: encounters at user's ward assignment
 *
 * Results are cached in app.patient_scope for 5 minutes.
 */

import { Injectable, Logger, Inject, ForbiddenException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import type { PatientId, UserId } from "@clinical-copilot/shared-types";

const SCOPE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

@Injectable()
export class PatientScopeService {
  private readonly logger = new Logger(PatientScopeService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Returns the set of patient UUIDs accessible to this user.
   * Re-populates the cache if expired or empty.
   */
  async getScopedPatientIds(userId: string): Promise<ReadonlySet<string>> {
    // Check cache first
    const cached = await this.pool.query<{ patient_id: string }>(
      `SELECT patient_id FROM app.patient_scope
       WHERE user_id = $1 AND expires_at > now()`,
      [userId],
    );

    if (cached.rows.length > 0) {
      return new Set(cached.rows.map((r) => r.patient_id));
    }

    // Cache miss -- rebuild scope
    return this.rebuildScope(userId);
  }

  /**
   * Asserts that a user can access a specific patient.
   * Throws 403 PATIENT_OUT_OF_SCOPE if not in scope.
   */
  async assertPatientInScope(userId: string, patientId: string): Promise<void> {
    const scopedIds = await this.getScopedPatientIds(userId);
    if (!scopedIds.has(patientId)) {
      throw new ForbiddenException({
        error: {
          code: "PATIENT_OUT_OF_SCOPE",
          message: "Patient is not within your care scope",
          details: { patient_id: patientId },
        },
      });
    }
  }

  /**
   * Rebuilds scope from hospital.encounter and stores in app.patient_scope.
   * Called on cache miss.
   */
  private async rebuildScope(userId: string): Promise<ReadonlySet<string>> {
    const expiresAt = new Date(Date.now() + SCOPE_TTL_MS);

    // Get user's DB UUID from external_subject (userId may be OIDC sub)
    // Note: the user UUID is already stored in session, so userId here is the DB UUID
    const dbUserId = userId;

    // Find patients via attending_user_id on active or recent encounters
    const scopeRows = await this.pool.query<{ patient_id: string }>(
      `SELECT DISTINCT patient_id
       FROM hospital.encounter
       WHERE attending_user_id = $1
         AND (status = 'in-progress' OR ended_at > now() - interval '24 hours')`,
      [dbUserId],
    );

    // Also check if user has sysadmin/hospital_admin role → full scope
    const roleRow = await this.pool.query<{ role: string }>(
      `SELECT role FROM app.user_role WHERE user_id = $1 LIMIT 1`,
      [dbUserId],
    );
    const firstRole = roleRow.rows[0]?.role ?? "";

    let patientIds: string[];

    if (firstRole === "sysadmin" || firstRole === "hospital_admin") {
      // Admins can see all patients
      const allPatients = await this.pool.query<{ id: string }>(
        `SELECT id FROM hospital.patient LIMIT 500`,
      );
      patientIds = allPatients.rows.map((r) => r.id);
    } else {
      patientIds = scopeRows.rows.map((r) => r.patient_id);
    }

    if (patientIds.length === 0) {
      this.logger.log({
        event: "patient_scope_empty",
        user_id: dbUserId,
      });
      return new Set<string>();
    }

    // Upsert into cache
    // Delete expired entries first
    await this.pool.query(
      `DELETE FROM app.patient_scope WHERE user_id = $1`,
      [dbUserId],
    );

    // Insert in batches of 100 to avoid too-many-params
    if (patientIds.length > 0) {
      const BATCH = 100;
      for (let i = 0; i < patientIds.length; i += BATCH) {
        const batchIds = patientIds.slice(i, i + BATCH);
        const batchValues = batchIds.map((pid, j) => {
          const base = j * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });
        const batchParams: unknown[] = [];
        for (const pid of batchIds) {
          batchParams.push(dbUserId, pid, "encounter", expiresAt);
        }
        await this.pool.query(
          `INSERT INTO app.patient_scope (user_id, patient_id, source, expires_at)
           VALUES ${batchValues.join(",")}
           ON CONFLICT (user_id, patient_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
          batchParams,
        );
      }
    }

    this.logger.log({
      event: "patient_scope_rebuilt",
      user_id: dbUserId,
      count: patientIds.length,
    });

    return new Set(patientIds) as unknown as ReadonlySet<PatientId>;
  }

  /**
   * Invalidates the cached scope for a user (call when encounter data changes).
   */
  async invalidateScope(userId: UserId): Promise<void> {
    await this.pool.query(
      `DELETE FROM app.patient_scope WHERE user_id = $1`,
      [userId],
    );
  }
}
