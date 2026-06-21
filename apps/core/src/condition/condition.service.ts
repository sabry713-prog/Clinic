import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";
import { suggestCodes, type CodedTerm } from "./snomed-picklist";

export interface AddedCondition {
  readonly id: string;
  readonly code: string;
  readonly code_display: string;
  readonly status: string;
  readonly onset_date: string | null;
}

@Injectable()
export class ConditionService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  /** AI suggests coded terms for the clinician's diagnosis text (they confirm). */
  suggest(query: string): CodedTerm[] {
    return suggestCodes(query);
  }

  /**
   * Add a clinician-authored, clinician-confirmed diagnosis to the problem list.
   * The doctor supplies the final code + display (confirmed from a suggestion or
   * chosen directly). source_system marks it as a clinician entry, not an EHR
   * feed. Non-SaMD: the doctor is the author and decision-maker.
   */
  async add(
    userId: string,
    patientId: string,
    input: { code: string; code_display: string; status?: string; onset_date?: string },
  ): Promise<AddedCondition> {
    await this.scope.assertPatientInScope(userId, patientId);
    const code = (input.code ?? "").trim();
    const display = (input.code_display ?? "").trim();
    if (!code || !display) throw new BadRequestException("code and code_display are required");
    const status = input.status === "resolved" ? "resolved" : "active";

    const res = await this.pool.query<AddedCondition>(
      `INSERT INTO hospital.condition
         (patient_id, source_system, source_id, code_system, code, code_display,
          status, onset_date, fhir_resource_json, last_synced_at)
       VALUES ($1,'clinician-entry',$2,'http://snomed.info/sct',$3,$4,$5,
               $6::date, $7::jsonb, now())
       RETURNING id, code, code_display, status, onset_date::text AS onset_date`,
      [
        patientId,
        `clinician-${uuidv4()}`,
        code,
        display,
        status,
        input.onset_date ?? null,
        JSON.stringify({ resourceType: "Condition", _authoredBy: userId, _clinicianEntry: true }),
      ],
    );
    return res.rows[0]!;
  }
}
