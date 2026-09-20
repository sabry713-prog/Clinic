/**
 * DocumentationService — how one encounter's note was captured.
 *
 * A small record with a precise job: make it possible to tell a note written by hand from one the
 * ambient capture produced, and to record a patient's refusal to be recorded. Nothing here interprets
 * anything; it is provenance, and the claim can cite it.
 */
import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

export type DocumentationSource = "ambient" | "manual";

export interface DocumentationRecord {
  readonly source: DocumentationSource;
  readonly recording_declined: boolean;
}

@Injectable()
export class DocumentationService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async get(userId: string, patientId: string, encounterId: string): Promise<DocumentationRecord | null> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<DocumentationRecord>(
      `SELECT source, recording_declined FROM app.encounter_documentation
        WHERE patient_id = $1 AND encounter_id = $2`,
      [patientId, encounterId],
    );
    return res.rows[0] ?? null;
  }

  async set(
    userId: string,
    patientId: string,
    encounterId: string,
    source: DocumentationSource,
    recordingDeclined: boolean,
  ): Promise<DocumentationRecord> {
    await this.scope.assertPatientInScope(userId, patientId);
    if (!encounterId) throw new BadRequestException("encounter_id is required");
    const res = await this.pool.query<DocumentationRecord>(
      `INSERT INTO app.encounter_documentation
         (encounter_id, patient_id, source, recording_declined, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (encounter_id)
       DO UPDATE SET source = EXCLUDED.source,
                     recording_declined = EXCLUDED.recording_declined,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = now()
       RETURNING source, recording_declined`,
      [encounterId, patientId, source, recordingDeclined, userId],
    );
    return res.rows[0]!;
  }
}
