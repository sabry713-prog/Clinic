/**
 * ClaimSimulatorService — "check before you send" across the seeded claim
 * batch (E3).
 *
 * A deterministic, read-only batch simulation: for every patient in the
 * seeded claim batch it re-runs the EXACT same checks the per-patient panel
 * uses (ClaimReadinessService — reused, not reimplemented) and resolves an
 * order-necessity verdict for every clinician-coded, clinician-linked order
 * via services/veritas-graph's validate_order_necessity (same Cypher lookup
 * the NSCRE engine uses). Nothing is submitted anywhere — no payer contact,
 * no writes.
 *
 * Determinism: patients are ordered by MRN, orders by id, and every input is
 * seeded reference data, so repeated runs on the same data produce identical
 * verdicts. Only `generated_at` moves.
 *
 * Non-SaMD boundary (CLAUDE.md §2): every verdict here is administrative —
 * "is the billing paperwork complete and does a documented necessity rule
 * exist for this code pair" — never a statement about the patient's
 * condition or the clinical appropriateness of an order.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { ClaimReadinessService } from "../nphies/claim-readiness.service";

export type NecessityStatus = "GREEN" | "YELLOW" | "RED" | "UNAVAILABLE";
export type SimulatorVerdict = "send" | "fix_before_send" | "do_not_send";

/**
 * Verbatim evidence chain from the graph's validate_order_necessity — the
 * cutaway UI displays exactly this object (steps + rendered + the Cypher
 * constants the engine executed). Passed through unmodified so what the
 * clinician sees cannot drift from what the graph produced.
 */
export interface NecessityEvidenceChain {
  readonly steps: readonly { readonly node_type: string; readonly properties: Record<string, unknown> }[];
  readonly rendered: string;
  readonly cypher?: readonly string[];
}

export interface SimulatorOrderNecessity {
  readonly order_id: string;
  readonly order_display: string;
  readonly icd10_code: string;
  readonly sbs_code: string;
  readonly status: NecessityStatus;
  readonly pre_auth_required: boolean | null;
  readonly suggested_codes: readonly { readonly icd10: string; readonly description: string }[];
  readonly evidence_chain?: NecessityEvidenceChain;
}

export interface SimulatorPatientVerdict {
  readonly patient_id: string;
  readonly mrn: string | null;
  readonly display_name: string | null;
  readonly historical_claims: number;
  readonly historical_rejections: number;
  readonly readiness_overall: "ready" | "issues" | "blocked";
  readonly failed_checks: readonly string[];
  readonly warning_checks: readonly string[];
  readonly necessity: readonly SimulatorOrderNecessity[];
  readonly verdict: SimulatorVerdict;
}

export interface ClaimSimulationReport {
  readonly generated_at: string;
  readonly graph_available: boolean;
  readonly patients: readonly SimulatorPatientVerdict[];
  readonly summary: {
    readonly patients_checked: number;
    readonly send: number;
    readonly fix_before_send: number;
    readonly do_not_send: number;
    readonly orders_checked: number;
    readonly orders_green: number;
    readonly orders_yellow: number;
    readonly orders_red: number;
    readonly orders_unavailable: number;
    readonly claims_flagged: number;
    readonly estimated_sar_at_risk: number;
    readonly average_claim_value_sar: number;
  };
  readonly disclaimer: string;
}

interface GraphNecessityResponse {
  readonly status?: unknown;
  readonly pre_auth_required?: unknown;
  readonly suggested_codes?: unknown;
  readonly evidence_chain?: unknown;
}

/**
 * Same illustrative average the rejection-cost dashboard (Phase S1) uses:
 * flagged-claim count x this constant estimates SAR at risk. Not settlement
 * data — a planning aid for RCM triage only.
 */
export const AVERAGE_CLAIM_VALUE_SAR = 2_500;

const NECESSITY_STATUSES: readonly NecessityStatus[] = ["GREEN", "YELLOW", "RED"];

function isNecessityStatus(value: unknown): value is NecessityStatus {
  return typeof value === "string" && (NECESSITY_STATUSES as readonly string[]).includes(value);
}

interface ParsedNecessity {
  readonly status: NecessityStatus;
  readonly pre_auth_required: boolean | null;
  readonly suggested_codes: readonly { readonly icd10: string; readonly description: string }[];
  readonly evidence_chain?: NecessityEvidenceChain;
}

function isEvidenceChain(value: unknown): value is NecessityEvidenceChain {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { steps?: unknown; rendered?: unknown };
  return Array.isArray(candidate.steps) && typeof candidate.rendered === "string";
}

function parseGraphResponse(body: GraphNecessityResponse): ParsedNecessity {
  const rawStatus = body.status;
  const status = isNecessityStatus(rawStatus) ? rawStatus : "UNAVAILABLE";
  const suggested = Array.isArray(body.suggested_codes)
    ? body.suggested_codes
        .filter(
          (s): s is { icd10: string; description: string } =>
            typeof s === "object" && s !== null && typeof (s as { icd10?: unknown }).icd10 === "string",
        )
        .map((s) => ({ icd10: s.icd10, description: String(s.description) }))
    : [];
  return {
    status,
    pre_auth_required: typeof body.pre_auth_required === "boolean" ? body.pre_auth_required : null,
    suggested_codes: suggested,
    // Pass-through only when the graph actually sent a well-formed chain —
    // never synthesized here. The cutaway's correctness claim is that it
    // displays the graph's own object, verbatim.
    ...(isEvidenceChain(body.evidence_chain) ? { evidence_chain: body.evidence_chain } : {}),
  };
}

@Injectable()
export class ClaimSimulatorService {
  private readonly logger = new Logger(ClaimSimulatorService.name);
  private readonly graphUrl: string;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly readiness: ClaimReadinessService,
  ) {
    this.graphUrl = process.env.GRAPH_SERVICE_URL ?? "http://127.0.0.1:5004";
  }

  /**
   * Run the batch simulation over the seeded claim batch. Read-only.
   * If the graph service is unreachable, necessity verdicts report
   * UNAVAILABLE (honestly, never guessed) and the rest of the report still
   * computes.
   */
  async simulateBatch(userId: string): Promise<ClaimSimulationReport> {
    const batch = await this.pool.query<{
      id: string;
      mrn: string | null;
      display_name: string | null;
      claims: string;
      rejections: string;
    }>(
      `SELECT p.id, p.mrn, p.display_name,
              count(c.id)::text AS claims,
              count(*) FILTER (WHERE c.status = 'rejected')::text AS rejections
       FROM hospital.patient p
       JOIN app.nphies_claim c ON c.patient_id = p.id
       GROUP BY p.id, p.mrn, p.display_name
       ORDER BY p.mrn`,
    );

    let graphAvailable = true;
    const patients: SimulatorPatientVerdict[] = [];
    for (const row of batch.rows) {
      // Reuses the per-patient panel's exact deterministic checks. The
      // per-patient scope assertion is skipped here because this surface is
      // already role-gated (hospital_admin/sysadmin) by the controller --
      // the same shape as AdminController's rejection-analytics, which also
      // aggregates across patients without per-patient scope asserts.
      const readiness = await this.readiness.evaluate(userId, row.id, { assertScope: false });
      const failedChecks = readiness.checks.filter((c) => c.status === "fail").map((c) => c.id);
      const warningChecks = readiness.checks.filter((c) => c.status === "warning").map((c) => c.id);

      const pairs = await this.codedLinkedPairs(row.id);
      const necessity: SimulatorOrderNecessity[] = [];
      for (const pair of pairs) {
        if (!graphAvailable) {
          necessity.push({ ...pair, status: "UNAVAILABLE", pre_auth_required: null, suggested_codes: [] });
          continue;
        }
        const verdict = await this.lookupNecessity(pair.icd10_code, pair.sbs_code);
        if (verdict === null) {
          graphAvailable = false;
          this.logger.warn("claim_simulator_graph_unavailable");
          necessity.push({ ...pair, status: "UNAVAILABLE", pre_auth_required: null, suggested_codes: [] });
          continue;
        }
        necessity.push({ ...pair, ...verdict });
      }

      patients.push({
        patient_id: row.id,
        mrn: row.mrn,
        display_name: row.display_name,
        historical_claims: Number(row.claims),
        historical_rejections: Number(row.rejections),
        readiness_overall: readiness.overall,
        failed_checks: failedChecks,
        warning_checks: warningChecks,
        necessity,
        verdict: deriveVerdict(readiness.overall, necessity),
      });
    }

    const ordersAll = patients.flatMap((p) => p.necessity);
    const flagged = patients.filter((p) => p.verdict !== "send");
    return {
      generated_at: new Date().toISOString(),
      graph_available: graphAvailable,
      patients,
      summary: {
        patients_checked: patients.length,
        send: patients.filter((p) => p.verdict === "send").length,
        fix_before_send: patients.filter((p) => p.verdict === "fix_before_send").length,
        do_not_send: patients.filter((p) => p.verdict === "do_not_send").length,
        orders_checked: ordersAll.length,
        orders_green: ordersAll.filter((o) => o.status === "GREEN").length,
        orders_yellow: ordersAll.filter((o) => o.status === "YELLOW").length,
        orders_red: ordersAll.filter((o) => o.status === "RED").length,
        orders_unavailable: ordersAll.filter((o) => o.status === "UNAVAILABLE").length,
        claims_flagged: flagged.length,
        estimated_sar_at_risk: flagged.length * AVERAGE_CLAIM_VALUE_SAR,
        average_claim_value_sar: AVERAGE_CLAIM_VALUE_SAR,
      },
      disclaimer:
        "Administrative claim-integrity simulation only — completeness checks and documented " +
        "necessity-rule lookups. Not a clinical assessment, not billing advice, and not a payer " +
        "decision. No claim is submitted by this check.",
    };
  }

  /** Unique clinician-coded + clinician-linked (order, icd10, sbs) triples,
   * ordered for deterministic output. Same join shape as the readiness
   * service's pairing check. */
  private async codedLinkedPairs(
    patientId: string,
  ): Promise<readonly { order_id: string; order_display: string; icd10_code: string; sbs_code: string }[]> {
    const rows = await this.pool.query<{
      order_id: string;
      order_display: string | null;
      icd10_code: string;
      sbs_code: string;
    }>(
      `SELECT DISTINCT sr.id AS order_id, sr.code_display AS order_display,
              cc.icd10am_code AS icd10_code, sc.sbs_code
       FROM app.service_request_diagnosis_link l
       JOIN app.service_request sr ON sr.id = l.service_request_id
       JOIN app.condition_icd_coding cc ON cc.condition_id = l.condition_id
       JOIN app.service_request_sbs_coding sc ON sc.service_request_id = sr.id
       WHERE l.patient_id = $1 AND sr.status = 'active'
       ORDER BY order_id`,
      [patientId],
    );
    return rows.rows.map((r) => ({
      order_id: r.order_id,
      order_display: r.order_display ?? "",
      icd10_code: r.icd10_code,
      sbs_code: r.sbs_code,
    }));
  }

  /** One deterministic necessity lookup against services/veritas-graph.
   * Returns null when the graph is unreachable or errors — the caller marks
   * the order UNAVAILABLE rather than guessing. */
  private async lookupNecessity(
    icd10Code: string,
    sbsCode: string,
  ): Promise<ParsedNecessity | null> {
    let response: Response;
    try {
      response = await fetch(`${this.graphUrl}/api/v1/nphies/validate-necessity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icd10_code: icd10Code, service_or_drug_code: sbsCode }),
      });
    } catch (err) {
      this.logger.warn("claim_simulator_graph_fetch_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!response.ok) {
      this.logger.warn("claim_simulator_graph_error", { status: response.status });
      return null;
    }
    return parseGraphResponse((await response.json()) as GraphNecessityResponse);
  }
}

/** Deterministic verdict derivation. Administrative only: "blocked" paperwork
 * or a code pair with no documented necessity rule means do not send yet;
 * warnings or a pre-auth-required rule mean fix/queue pre-auth first. */
function deriveVerdict(
  readinessOverall: "ready" | "issues" | "blocked",
  necessity: readonly SimulatorOrderNecessity[],
): SimulatorVerdict {
  if (readinessOverall === "blocked") return "do_not_send";
  if (necessity.some((o) => o.status === "RED")) return "do_not_send";
  if (readinessOverall === "issues") return "fix_before_send";
  if (necessity.some((o) => o.status === "YELLOW")) return "fix_before_send";
  return "send";
}
