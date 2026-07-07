/**
 * IcdCodingService — SNOMED → ICD-10-AM coding with clinician confirmation.
 *
 * Suggestions are DETERMINISTIC vocabulary lookups against
 * app.snomed_icd10am_map (no model call). Nothing is persisted at suggest
 * time; only an explicit clinician confirmation writes to
 * app.condition_icd_coding. The clinical diagnosis itself was already
 * documented by the doctor — this service only maps its billing vocabulary
 * (CLAUDE.md §2: the system never diagnoses or interprets).
 */

import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { PatientScopeService } from "../patient/patient-scope.service";

export interface ConditionCoding {
  readonly condition_id: string;
  readonly condition_display: string | null;
  readonly snomed_code: string | null;
  readonly onset_date: string | null;
  readonly confirmed: {
    readonly icd10am_code: string;
    readonly icd10am_display: string;
    readonly confirmed_at: string;
  } | null;
  readonly suggestion: {
    readonly icd10am_code: string;
    readonly icd10am_display: string;
  } | null;
}

export interface CodingStatus {
  readonly patient_id: string;
  readonly conditions: readonly ConditionCoding[];
  readonly disclaimer: string;
}

const DISCLAIMER =
  "Deterministic vocabulary mapping of clinician-documented diagnoses for claim coding. Suggestions come from a reference table; codes are stored only after clinician confirmation. Not a clinical assessment.";

@Injectable()
export class IcdCodingService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async status(userId: string, patientId: string): Promise<CodingStatus> {
    await this.scope.assertPatientInScope(userId, patientId);

    const rows = await this.pool.query<{
      condition_id: string;
      condition_display: string | null;
      snomed_code: string | null;
      onset_date: string | null;
      confirmed_code: string | null;
      confirmed_display: string | null;
      confirmed_at: string | null;
      suggested_code: string | null;
      suggested_display: string | null;
    }>(
      `SELECT c.id AS condition_id,
              c.code_display AS condition_display,
              c.code AS snomed_code,
              c.onset_date::text AS onset_date,
              cc.icd10am_code AS confirmed_code,
              cc.icd10am_display AS confirmed_display,
              cc.confirmed_at::text AS confirmed_at,
              m.icd10am_code AS suggested_code,
              m.icd10am_display AS suggested_display
       FROM hospital.condition c
       LEFT JOIN app.condition_icd_coding cc ON cc.condition_id = c.id
       LEFT JOIN app.snomed_icd10am_map m ON m.snomed_code = c.code
       WHERE c.patient_id = $1 AND c.status = 'active'
       ORDER BY c.onset_date DESC NULLS LAST, c.code_display`,
      [patientId],
    );

    return {
      patient_id: patientId,
      conditions: rows.rows.map((r) => ({
        condition_id: r.condition_id,
        condition_display: r.condition_display,
        snomed_code: r.snomed_code,
        onset_date: r.onset_date,
        confirmed:
          r.confirmed_code !== null && r.confirmed_display !== null && r.confirmed_at !== null
            ? {
                icd10am_code: r.confirmed_code,
                icd10am_display: r.confirmed_display,
                confirmed_at: r.confirmed_at,
              }
            : null,
        suggestion:
          r.suggested_code !== null && r.suggested_display !== null
            ? { icd10am_code: r.suggested_code, icd10am_display: r.suggested_display }
            : null,
      })),
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Persists a clinician-confirmed ICD-10-AM code for one condition.
   * The confirmed code must match the reference-map suggestion for the
   * condition's SNOMED code — free-text codes are rejected so nothing
   * unvetted can enter the claim path.
   */
  async confirm(
    userId: string,
    patientId: string,
    conditionId: string,
  ): Promise<ConditionCoding> {
    await this.scope.assertPatientInScope(userId, patientId);

    const cond = await this.pool.query<{
      id: string;
      code: string | null;
      code_display: string | null;
      onset_date: string | null;
      icd10am_code: string | null;
      icd10am_display: string | null;
    }>(
      `SELECT c.id, c.code, c.code_display, c.onset_date::text AS onset_date,
              m.icd10am_code, m.icd10am_display
       FROM hospital.condition c
       LEFT JOIN app.snomed_icd10am_map m ON m.snomed_code = c.code
       WHERE c.id = $1 AND c.patient_id = $2 AND c.status = 'active'`,
      [conditionId, patientId],
    );
    const c = cond.rows[0];
    if (!c) {
      throw new BadRequestException({
        error: { code: "CONDITION_NOT_FOUND", message: "Active condition not found for this patient" },
      });
    }
    if (c.icd10am_code === null || c.icd10am_display === null) {
      throw new BadRequestException({
        error: {
          code: "NO_MAPPING_AVAILABLE",
          message: "No ICD-10-AM mapping exists for this condition's SNOMED code",
        },
      });
    }

    const inserted = await this.pool.query<{ confirmed_at: string }>(
      `INSERT INTO app.condition_icd_coding
         (condition_id, patient_id, snomed_code, icd10am_code, icd10am_display, confirmed_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (condition_id) DO UPDATE
         SET icd10am_code = EXCLUDED.icd10am_code,
             icd10am_display = EXCLUDED.icd10am_display,
             confirmed_by = EXCLUDED.confirmed_by,
             confirmed_at = now()
       RETURNING confirmed_at::text AS confirmed_at`,
      [conditionId, patientId, c.code, c.icd10am_code, c.icd10am_display, userId],
    );

    return {
      condition_id: conditionId,
      condition_display: c.code_display,
      snomed_code: c.code,
      onset_date: c.onset_date,
      confirmed: {
        icd10am_code: c.icd10am_code,
        icd10am_display: c.icd10am_display,
        confirmed_at: inserted.rows[0]?.confirmed_at ?? new Date().toISOString(),
      },
      suggestion: { icd10am_code: c.icd10am_code, icd10am_display: c.icd10am_display },
    };
  }

  /** Removes a previously confirmed code (clinician correction). */
  async unconfirm(userId: string, patientId: string, conditionId: string): Promise<void> {
    await this.scope.assertPatientInScope(userId, patientId);
    await this.pool.query(
      `DELETE FROM app.condition_icd_coding
       WHERE condition_id = $1 AND patient_id = $2`,
      [conditionId, patientId],
    );
  }
}
