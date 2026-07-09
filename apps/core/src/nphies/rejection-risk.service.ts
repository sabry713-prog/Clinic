/**
 * RejectionRiskService — "will this get rejected?" checks for a patient's
 * pending claim items, modeled directly on how Sully.ai's AI Medical
 * Coder describes its own validation step: "validates code pairs against
 * payer-specific edits" and "predictive denial scoring" based on past
 * claim outcomes (https://www.sully.ai/blog/medical-billing-automation).
 *
 * Both checks here are DETERMINISTIC over doctor-confirmed codes and
 * historical claim outcomes — neither one interprets clinical data,
 * suggests a diagnosis, or judges medical necessity (CLAUDE.md §2):
 *
 * 1. Pairing compatibility — set-membership lookup against
 *    app.diagnosis_procedure_compat (payer-published pairing rules in
 *    production). "Is this combination in the known-valid table?" is a
 *    lookup, not a clinical-appropriateness judgment.
 * 2. Historical rejection frequency — a plain retrospective count: "how
 *    often has this exact code appeared on a rejected claim before?"
 *    Reports the past, states no expectation about the future, and
 *    never recommends changing the diagnosis or procedure.
 */

import { Inject, Injectable } from "@nestjs/common";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { PatientScopeService } from "../patient/patient-scope.service";

export interface PairingCheck {
  readonly condition_id: string;
  readonly condition_display: string | null;
  readonly icd10am_code: string;
  readonly service_request_id: string;
  readonly order_display: string;
  readonly sbs_code: string;
  readonly known_valid_pairing: boolean;
}

export interface CodeRejectionHistory {
  readonly code: string;
  readonly code_type: "diagnosis" | "procedure";
  readonly total_claims: number;
  readonly rejected_claims: number;
  readonly rejection_rate: number;
  readonly common_rejection_codes: readonly string[];
}

export interface RejectionRiskReport {
  readonly patient_id: string;
  readonly pairings: readonly PairingCheck[];
  readonly history: readonly CodeRejectionHistory[];
  readonly disclaimer: string;
}

const DISCLAIMER =
  "Deterministic checks over doctor-confirmed codes only: whether the diagnosis+procedure pairing appears in the known compatibility table, and how often each code has appeared on a rejected claim historically. Retrospective counts, not a prediction, and not a clinical judgment about necessity or diagnosis.";

@Injectable()
export class RejectionRiskService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async evaluate(userId: string, patientId: string): Promise<RejectionRiskReport> {
    await this.scope.assertPatientInScope(userId, patientId);

    // Every currently-linked (confirmed diagnosis, confirmed order) pair
    // for this patient's active items.
    const pairings = await this.pool.query<{
      condition_id: string;
      condition_display: string | null;
      icd10am_code: string;
      service_request_id: string;
      order_display: string;
      sbs_code: string;
      known_valid_pairing: boolean;
    }>(
      `SELECT c.id AS condition_id, c.code_display AS condition_display,
              cc.icd10am_code,
              sr.id AS service_request_id, sr.code_display AS order_display,
              sc.sbs_code,
              (compat.icd10am_code IS NOT NULL) AS known_valid_pairing
       FROM app.service_request_diagnosis_link l
       JOIN hospital.condition c ON c.id = l.condition_id
       JOIN app.condition_icd_coding cc ON cc.condition_id = c.id
       JOIN app.service_request sr ON sr.id = l.service_request_id
       JOIN app.service_request_sbs_coding sc ON sc.service_request_id = sr.id
       LEFT JOIN app.diagnosis_procedure_compat compat
         ON compat.icd10am_code = cc.icd10am_code AND compat.sbs_code = sc.sbs_code
       WHERE l.patient_id = $1 AND c.status = 'active' AND sr.status = 'active'`,
      [patientId],
    );

    const diagnosisCodes = [...new Set(pairings.rows.map((r) => r.icd10am_code))];
    const procedureCodes = [...new Set(pairings.rows.map((r) => r.sbs_code))];

    const history: CodeRejectionHistory[] = [];
    for (const code of diagnosisCodes) {
      history.push(await this.historyForCode(code, "diagnosis"));
    }
    for (const code of procedureCodes) {
      history.push(await this.historyForCode(code, "procedure"));
    }

    return {
      patient_id: patientId,
      pairings: pairings.rows,
      history,
      disclaimer: DISCLAIMER,
    };
  }

  private async historyForCode(
    code: string,
    codeType: "diagnosis" | "procedure",
  ): Promise<CodeRejectionHistory> {
    const column = codeType === "diagnosis" ? "diagnosis_codes" : "procedure_codes";
    const totals = await this.pool.query<{ total: string; rejected: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE status = 'rejected')::text AS rejected
       FROM app.nphies_claim WHERE $1 = ANY(${column})`,
      [code],
    );
    const reasons = await this.pool.query<{ reason: string }>(
      `SELECT unnest(rejection_codes) AS reason
       FROM app.nphies_claim WHERE $1 = ANY(${column}) AND status = 'rejected'`,
      [code],
    );
    const reasonCounts = new Map<string, number>();
    for (const r of reasons.rows) reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
    const commonReasons = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([reason]) => reason);

    const total = Number(totals.rows[0]?.total ?? 0);
    const rejected = Number(totals.rows[0]?.rejected ?? 0);

    return {
      code,
      code_type: codeType,
      total_claims: total,
      rejected_claims: rejected,
      rejection_rate: total > 0 ? Math.round((rejected / total) * 1000) / 1000 : 0,
      common_rejection_codes: commonReasons,
    };
  }
}
