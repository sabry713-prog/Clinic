/**
 * ClaimReadinessService — deterministic NPHIES clean-claim checks.
 *
 * Every check is a pure completeness/consistency rule over data the
 * clinician already documented: identity fields, encounter context, coded
 * diagnoses, coded orders, coded medications, and connector status. There
 * is deliberately NO model call and NO clinical judgment anywhere in this
 * service — a check can only say "a required administrative field is
 * missing", never anything about the patient's condition (CLAUDE.md §2).
 *
 * NPHIES background: claims are FHIR R4 submissions requiring ICD-10-AM
 * diagnosis codes, SBS (Saudi Billing System) service codes, and
 * diagnosis-to-item linkage. Most rejections are administrative — missing
 * or unmapped codes, absent eligibility checks, identity mismatches.
 */

import { Inject, Injectable } from "@nestjs/common";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { PatientScopeService } from "../patient/patient-scope.service";

export type CheckStatus = "pass" | "warning" | "fail";

export interface ReadinessCheck {
  readonly id: string;
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export interface ClaimReadiness {
  readonly patient_id: string;
  readonly generated_at: string;
  readonly overall: "ready" | "issues" | "blocked";
  readonly checks: readonly ReadinessCheck[];
  readonly disclaimer: string;
}

@Injectable()
export class ClaimReadinessService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async evaluate(userId: string, patientId: string): Promise<ClaimReadiness> {
    await this.scope.assertPatientInScope(userId, patientId);

    const checks: ReadinessCheck[] = [];

    // R1 — patient identity fields required on every NPHIES claim.
    const patient = await this.pool.query<{
      mrn: string | null;
      date_of_birth: string | null;
      sex: string | null;
      national_id_hash: string | null;
    }>(
      `SELECT mrn, date_of_birth, sex, national_id_hash
       FROM hospital.patient WHERE id = $1`,
      [patientId],
    );
    const p = patient.rows[0];
    const missingIdentity = [
      !p?.mrn && "MRN",
      !p?.date_of_birth && "date of birth",
      !p?.sex && "sex",
      !p?.national_id_hash && "national ID",
    ].filter((x): x is string => Boolean(x));
    checks.push({
      id: "identity_complete",
      label: "Patient identity fields",
      status: missingIdentity.length === 0 ? "pass" : "fail",
      detail:
        missingIdentity.length === 0
          ? "MRN, date of birth, sex, and national ID are on file."
          : `Missing: ${missingIdentity.join(", ")}.`,
    });

    // R2 — encounter context (claims are tied to an encounter).
    const enc = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM hospital.encounter WHERE patient_id = $1`,
      [patientId],
    );
    const encounterCount = Number(enc.rows[0]?.n ?? "0");
    checks.push({
      id: "encounter_present",
      label: "Encounter documented",
      status: encounterCount > 0 ? "pass" : "fail",
      detail:
        encounterCount > 0
          ? `${encounterCount} encounter(s) on record to attach the claim to.`
          : "No encounter on record — an NPHIES claim must reference an encounter.",
    });

    // R3/R4 — documented diagnoses and their coding.
    const cond = await this.pool.query<{ total: string; coded: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE code IS NOT NULL AND code_system IS NOT NULL)::text AS coded
       FROM hospital.condition
       WHERE patient_id = $1 AND status = 'active'`,
      [patientId],
    );
    const condTotal = Number(cond.rows[0]?.total ?? "0");
    const condCoded = Number(cond.rows[0]?.coded ?? "0");
    checks.push({
      id: "diagnosis_documented",
      label: "Active diagnosis documented",
      status: condTotal > 0 ? "pass" : "fail",
      detail:
        condTotal > 0
          ? `${condTotal} active documented condition(s).`
          : "No active documented condition — a claim needs at least one diagnosis.",
    });
    if (condTotal > 0) {
      checks.push({
        id: "diagnosis_coded",
        label: "Diagnoses carry codes",
        status: condCoded === condTotal ? "pass" : "warning",
        detail:
          condCoded === condTotal
            ? "All active conditions have a code."
            : `${condTotal - condCoded} of ${condTotal} active condition(s) have no code.`,
      });
      // R5 — ICD-10-AM coverage. NPHIES claims require ICD-10-AM codes;
      // conditions are documented in SNOMED CT and mapped via the
      // clinician-confirmed coding flow. This counts confirmations — an
      // administrative fact, not a judgment about the patient.
      const icd = await this.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n
         FROM app.condition_icd_coding cc
         JOIN hospital.condition c ON c.id = cc.condition_id
         WHERE cc.patient_id = $1 AND c.status = 'active'`,
        [patientId],
      );
      const icdConfirmed = Number(icd.rows[0]?.n ?? "0");
      checks.push({
        id: "icd10am_mapping",
        label: "ICD-10-AM coding confirmed",
        status: icdConfirmed >= condTotal ? "pass" : "warning",
        detail:
          icdConfirmed >= condTotal
            ? `All ${condTotal} active condition(s) have a clinician-confirmed ICD-10-AM code.`
            : `${icdConfirmed} of ${condTotal} active condition(s) have a clinician-confirmed ICD-10-AM code. Confirm the remaining codes in the coding panel before submission.`,
      });
    }

    // R6/R7 — orders (claim items) and diagnosis linkage.
    const orders = await this.pool.query<{ total: string; coded: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE code IS NOT NULL)::text AS coded
       FROM app.service_request
       WHERE patient_id = $1 AND status = 'active'`,
      [patientId],
    );
    const ordTotal = Number(orders.rows[0]?.total ?? "0");
    const ordCoded = Number(orders.rows[0]?.coded ?? "0");
    if (ordTotal === 0) {
      checks.push({
        id: "orders_present",
        label: "Claimable orders",
        status: "warning",
        detail: "No active service requests — nothing to bill on this claim yet.",
      });
    } else {
      checks.push({
        id: "orders_coded",
        label: "Orders carry codes",
        status: ordCoded === ordTotal ? "pass" : "warning",
        detail:
          ordCoded === ordTotal
            ? `All ${ordTotal} active order(s) carry a code.`
            : `${ordTotal - ordCoded} of ${ordTotal} active order(s) have no code — NPHIES claim items require SBS codes.`,
      });
      // SBS coverage — counts clinician confirmations, mirroring the
      // ICD-10-AM check. Administrative fact only.
      const sbs = await this.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n
         FROM app.service_request_sbs_coding sc
         JOIN app.service_request sr ON sr.id = sc.service_request_id
         WHERE sc.patient_id = $1 AND sr.status = 'active'`,
        [patientId],
      );
      const sbsConfirmed = Number(sbs.rows[0]?.n ?? "0");
      checks.push({
        id: "sbs_coding_confirmed",
        label: "SBS coding confirmed",
        status: sbsConfirmed >= ordTotal ? "pass" : "warning",
        detail:
          sbsConfirmed >= ordTotal
            ? `All ${ordTotal} active order(s) have a clinician-confirmed SBS code.`
            : `${sbsConfirmed} of ${ordTotal} active order(s) have a clinician-confirmed SBS code. Confirm the remaining codes in the coding panel before submission.`,
      });
      // Linkage coverage — counts orders with at least one clinician-
      // captured diagnosis link. Administrative fact only; the system
      // never suggests which diagnosis supports an order.
      const linked = await this.pool.query<{ n: string }>(
        `SELECT count(DISTINCT l.service_request_id)::text AS n
         FROM app.service_request_diagnosis_link l
         JOIN app.service_request sr ON sr.id = l.service_request_id
         WHERE l.patient_id = $1 AND sr.status = 'active'`,
        [patientId],
      );
      const linkedCount = Number(linked.rows[0]?.n ?? "0");
      checks.push({
        id: "order_diagnosis_linkage",
        label: "Order-to-diagnosis linkage",
        status: linkedCount >= ordTotal ? "pass" : "warning",
        detail:
          linkedCount >= ordTotal
            ? `All ${ordTotal} active order(s) are linked to a documented diagnosis.`
            : `${linkedCount} of ${ordTotal} active order(s) are linked to a documented diagnosis. NPHIES requires each claim item to reference a supporting diagnosis — link the remaining orders in the coding panel.`,
      });
    }

    // R8 — medications coding (only relevant if active prescriptions exist).
    const meds = await this.pool.query<{ total: string; coded: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE code IS NOT NULL)::text AS coded
       FROM hospital.medication_request
       WHERE patient_id = $1 AND status = 'active'`,
      [patientId],
    );
    const medTotal = Number(meds.rows[0]?.total ?? "0");
    const medCoded = Number(meds.rows[0]?.coded ?? "0");
    if (medTotal > 0) {
      checks.push({
        id: "medications_coded",
        label: "Medications carry codes",
        status: medCoded === medTotal ? "pass" : "warning",
        detail:
          medCoded === medTotal
            ? `All ${medTotal} active medication(s) carry a code.`
            : `${medTotal - medCoded} of ${medTotal} active medication(s) have no code.`,
      });
    }

    // R9 — eligibility. Reports the most recent connector check honestly,
    // including whether it came from the stub connector.
    const elig = await this.pool.query<{ status: string; mode: string; checked_at: string }>(
      `SELECT status, mode, checked_at::text AS checked_at
       FROM app.nphies_eligibility_check
       WHERE patient_id = $1 AND checked_at > now() - interval '7 days'
       ORDER BY checked_at DESC LIMIT 1`,
      [patientId],
    );
    const lastElig = elig.rows[0];
    checks.push({
      id: "eligibility_checked",
      label: "NPHIES eligibility check",
      status: lastElig && lastElig.status === "eligible" ? "pass" : "warning",
      detail: lastElig
        ? `Last check: ${lastElig.status} (${lastElig.checked_at.slice(0, 10)}, ${lastElig.mode} connector${lastElig.mode === "stub" ? " — development response, not a payer decision" : ""}).`
        : "Not checked in the last 7 days. Run the eligibility check before claim submission.",
    });

    const overall: ClaimReadiness["overall"] = checks.some((c) => c.status === "fail")
      ? "blocked"
      : checks.some((c) => c.status === "warning")
        ? "issues"
        : "ready";

    return {
      patient_id: patientId,
      generated_at: new Date().toISOString(),
      overall,
      checks,
      disclaimer:
        "Administrative claim-completeness checks only. Not a clinical assessment and not billing advice.",
    };
  }
}
