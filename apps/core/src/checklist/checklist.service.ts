/**
 * ChecklistService — the clinician's checklist decisions for one encounter.
 *
 * Only decisions are stored. Everything else about the checklist is derived: entries come from the
 * note and the transcript, and the ticks that follow from the note are recomputed by the client. That
 * split is deliberate — persisting derivable state would create a second source of truth that could
 * disagree with the note it was derived from.
 */
import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

export type ChecklistState = "done" | "dismissed";

export interface ChecklistDecision {
  readonly item_id: string;
  readonly state: ChecklistState;
  /** Present only for a row the CLINICIAN typed: a catalog row's text lives in the catalogs both
   *  sides already have, and copying it here would give the record two texts to disagree about. */
  readonly label?: string | null;
}

@Injectable()
export class ChecklistService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async list(userId: string, patientId: string, encounterId: string): Promise<readonly ChecklistDecision[]> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<ChecklistDecision>(
      `SELECT item_id, state, label FROM app.encounter_checklist
        WHERE patient_id = $1 AND encounter_id = $2
        ORDER BY item_id`,
      [patientId, encounterId],
    );
    return res.rows;
  }

  /**
   * Set or clear one decision. `state: null` deletes the row: a row means the clinician decided
   * something, so clearing a decision is the absence of a row, not a third state.
   */
  async set(
    userId: string,
    patientId: string,
    encounterId: string,
    itemId: string,
    state: ChecklistState | null,
    label?: string | null,
  ): Promise<void> {
    await this.scope.assertPatientInScope(userId, patientId);
    const item = (itemId ?? "").trim();
    if (!item) throw new BadRequestException("item_id is required");

    if (state === null) {
      await this.pool.query(
        `DELETE FROM app.encounter_checklist WHERE patient_id = $1 AND encounter_id = $2 AND item_id = $3`,
        [patientId, encounterId, item],
      );
      return;
    }

    await this.pool.query(
      `INSERT INTO app.encounter_checklist (patient_id, encounter_id, item_id, state, updated_by, label)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (encounter_id, item_id)
       DO UPDATE SET state = EXCLUDED.state, updated_by = EXCLUDED.updated_by,
                     label = COALESCE(EXCLUDED.label, app.encounter_checklist.label),
                     updated_at = now()`,
      [patientId, encounterId, item, state, userId, label?.trim() ? label.trim() : null],
    );
  }
}
