/**
 * NphiesConnectorService — claim assembly + payer transactions.
 *
 * Provider pattern mirrors the model providers: NPHIES_CONNECTOR=stub
 * returns canned payer responses so the full claim workflow runs without
 * NPHIES onboarding; =live is wired when CCHI registration, sandbox
 * credentials, and certificates exist. Every persisted row records its
 * mode so stub data can never be mistaken for a real payer response.
 *
 * Claim assembly is a deterministic aggregation of clinician-confirmed
 * artifacts only: confirmed ICD-10-AM codes, confirmed SBS codes, and
 * clinician-captured diagnosis links. Anything unconfirmed is a blocker,
 * not a guess (CLAUDE.md §2 — no clinical judgment anywhere).
 */

import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { PatientScopeService } from "../patient/patient-scope.service";

export interface ClaimDraft {
  readonly patient_id: string;
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly bundle: Record<string, unknown> | null;
  readonly disclaimer: string;
}

export interface EligibilityResult {
  readonly id: string;
  readonly status: string;
  readonly mode: string;
  readonly checked_at: string;
  readonly detail: string;
}

export interface ClaimRecord {
  readonly id: string;
  readonly status: string;
  readonly rejection_codes: readonly string[];
  readonly mode: string;
  readonly submitted_at: string;
  readonly item_count: number;
}

const DISCLAIMER =
  "Claim assembly aggregates clinician-confirmed codes and linkages only. Stub connector responses are canned development data, not payer decisions.";

@Injectable()
export class NphiesConnectorService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
    private readonly config: ConfigService,
  ) {}

  private mode(): "stub" | "live" {
    return this.config.get<string>("NPHIES_CONNECTOR") === "live" ? "live" : "stub";
  }

  private assertConfigured(): void {
    if (this.mode() === "live") {
      throw new BadRequestException({
        error: {
          code: "NPHIES_LIVE_NOT_CONFIGURED",
          message:
            "NPHIES live connector selected but not implemented — requires CCHI onboarding, sandbox credentials, and certificates.",
        },
      });
    }
  }

  async assembleClaimDraft(userId: string, patientId: string): Promise<ClaimDraft> {
    await this.scope.assertPatientInScope(userId, patientId);
    const blockers: string[] = [];

    const patient = await this.pool.query<{
      mrn: string | null;
      national_id_hash: string | null;
      date_of_birth: string | null;
      sex: string | null;
      display_name: string | null;
    }>(
      `SELECT mrn, national_id_hash, date_of_birth, sex, display_name
       FROM hospital.patient WHERE id = $1`,
      [patientId],
    );
    const p = patient.rows[0];
    if (!p?.mrn || !p.date_of_birth || !p.sex || !p.national_id_hash) {
      blockers.push("Patient identity fields incomplete (MRN, DOB, sex, national ID required).");
    }

    const enc = await this.pool.query<{ id: string; source_id: string }>(
      `SELECT id, source_id FROM hospital.encounter
       WHERE patient_id = $1 ORDER BY started_at DESC NULLS LAST LIMIT 1`,
      [patientId],
    );
    if (enc.rows.length === 0) blockers.push("No encounter on record to attach the claim to.");

    // Diagnoses: only clinician-confirmed ICD-10-AM codes enter the claim.
    const diagnoses = await this.pool.query<{
      condition_id: string;
      icd10am_code: string;
      icd10am_display: string;
    }>(
      `SELECT cc.condition_id, cc.icd10am_code, cc.icd10am_display
       FROM app.condition_icd_coding cc
       JOIN hospital.condition c ON c.id = cc.condition_id
       WHERE cc.patient_id = $1 AND c.status = 'active'`,
      [patientId],
    );
    if (diagnoses.rows.length === 0) {
      blockers.push("No active condition has a clinician-confirmed ICD-10-AM code.");
    }

    // Items: active orders with confirmed SBS codes and diagnosis links.
    const items = await this.pool.query<{
      service_request_id: string;
      order_display: string;
      sbs_code: string | null;
      sbs_display: string | null;
      linked_condition_ids: string[] | null;
    }>(
      `SELECT sr.id AS service_request_id,
              sr.code_display AS order_display,
              sc.sbs_code, sc.sbs_display,
              array_agg(l.condition_id) FILTER (WHERE l.condition_id IS NOT NULL) AS linked_condition_ids
       FROM app.service_request sr
       LEFT JOIN app.service_request_sbs_coding sc ON sc.service_request_id = sr.id
       LEFT JOIN app.service_request_diagnosis_link l ON l.service_request_id = sr.id
       WHERE sr.patient_id = $1 AND sr.status = 'active'
       GROUP BY sr.id, sr.code_display, sc.sbs_code, sc.sbs_display`,
      [patientId],
    );
    if (items.rows.length === 0) {
      blockers.push("No active service requests — nothing to bill on this claim.");
    }
    for (const it of items.rows) {
      if (!it.sbs_code) blockers.push(`Order "${it.order_display}" has no clinician-confirmed SBS code.`);
      if (!it.linked_condition_ids || it.linked_condition_ids.length === 0) {
        blockers.push(`Order "${it.order_display}" is not linked to a documented diagnosis.`);
      }
    }

    const ready = blockers.length === 0;
    const diagnosisIndex = new Map(diagnoses.rows.map((d, i) => [d.condition_id, i + 1]));

    const bundle: Record<string, unknown> | null = ready
      ? {
          resourceType: "Claim",
          status: "draft",
          type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/claim-type", code: "professional" }] },
          use: "claim",
          patient: {
            reference: `Patient/${p?.mrn ?? patientId}`,
            display: p?.display_name ?? undefined,
          },
          encounter: enc.rows[0] ? { reference: `Encounter/${enc.rows[0].source_id}` } : undefined,
          diagnosis: diagnoses.rows.map((d, i) => ({
            sequence: i + 1,
            diagnosisCodeableConcept: {
              coding: [
                {
                  system: "http://hl7.org/fhir/sid/icd-10-am",
                  code: d.icd10am_code,
                  display: d.icd10am_display,
                },
              ],
            },
          })),
          item: items.rows.map((it, i) => ({
            sequence: i + 1,
            diagnosisSequence: (it.linked_condition_ids ?? [])
              .map((cid) => diagnosisIndex.get(cid))
              .filter((n): n is number => n !== undefined),
            productOrService: {
              coding: [
                {
                  system: "http://nphies.sa/terminology/CodeSystem/sbs",
                  code: it.sbs_code,
                  display: it.sbs_display,
                },
              ],
            },
          })),
        }
      : null;

    return { patient_id: patientId, ready, blockers, bundle, disclaimer: DISCLAIMER };
  }

  async checkEligibility(userId: string, patientId: string): Promise<EligibilityResult> {
    await this.scope.assertPatientInScope(userId, patientId);
    this.assertConfigured();

    // Stub: canned "eligible" response, clearly marked.
    const response = {
      resourceType: "CoverageEligibilityResponse",
      outcome: "complete",
      disposition: "Stub connector — canned development response, not a payer decision.",
      insurance: [{ inforce: true }],
    };
    const row = await this.pool.query<{ id: string; checked_at: string }>(
      `INSERT INTO app.nphies_eligibility_check
         (patient_id, status, response_json, mode, checked_by)
       VALUES ($1, 'eligible', $2::jsonb, $3, $4)
       RETURNING id, checked_at::text AS checked_at`,
      [patientId, JSON.stringify(response), this.mode(), userId],
    );

    return {
      id: row.rows[0]?.id ?? "",
      status: "eligible",
      mode: this.mode(),
      checked_at: row.rows[0]?.checked_at ?? new Date().toISOString(),
      detail: "Stub connector returned a canned eligible response (development only).",
    };
  }

  async submitClaim(userId: string, patientId: string): Promise<ClaimRecord> {
    await this.scope.assertPatientInScope(userId, patientId);
    this.assertConfigured();

    const draft = await this.assembleClaimDraft(userId, patientId);
    if (!draft.ready || draft.bundle === null) {
      throw new BadRequestException({
        error: {
          code: "CLAIM_NOT_READY",
          message: "Claim cannot be submitted — resolve the blockers first.",
          details: { blockers: draft.blockers },
        },
      });
    }

    const response = {
      resourceType: "ClaimResponse",
      outcome: "complete",
      disposition: "Stub connector — canned acceptance, not a payer decision.",
    };
    const itemCount = Array.isArray(draft.bundle["item"]) ? (draft.bundle["item"] as unknown[]).length : 0;
    const row = await this.pool.query<{ id: string; submitted_at: string }>(
      `INSERT INTO app.nphies_claim
         (patient_id, bundle_json, status, response_json, mode, submitted_by)
       VALUES ($1, $2::jsonb, 'accepted', $3::jsonb, $4, $5)
       RETURNING id, submitted_at::text AS submitted_at`,
      [patientId, JSON.stringify(draft.bundle), JSON.stringify(response), this.mode(), userId],
    );

    return {
      id: row.rows[0]?.id ?? "",
      status: "accepted",
      rejection_codes: [],
      mode: this.mode(),
      submitted_at: row.rows[0]?.submitted_at ?? new Date().toISOString(),
      item_count: itemCount,
    };
  }

  async listClaims(userId: string, patientId: string): Promise<readonly ClaimRecord[]> {
    await this.scope.assertPatientInScope(userId, patientId);
    const rows = await this.pool.query<{
      id: string;
      status: string;
      rejection_codes: string[];
      mode: string;
      submitted_at: string;
      item_count: string;
    }>(
      `SELECT id, status, rejection_codes, mode, submitted_at::text AS submitted_at,
              jsonb_array_length(COALESCE(bundle_json->'item', '[]'::jsonb))::text AS item_count
       FROM app.nphies_claim
       WHERE patient_id = $1
       ORDER BY submitted_at DESC
       LIMIT 20`,
      [patientId],
    );
    return rows.rows.map((r) => ({
      id: r.id,
      status: r.status,
      rejection_codes: r.rejection_codes,
      mode: r.mode,
      submitted_at: r.submitted_at,
      item_count: Number(r.item_count),
    }));
  }
}
