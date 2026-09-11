/**
 * LinkageVerdictsService — payer-rulebook verdicts for candidate
 * order→diagnosis pairs (read-only).
 *
 * Governance boundary (see LinkageService): the system deliberately never
 * suggests WHICH diagnosis supports which order — that is clinical
 * reasoning (CLAUDE.md §2). This service adds no suggestions and creates
 * nothing. It answers a purely administrative question the clinician may
 * ask while making their own choice: "if I link this order to this
 * documented diagnosis, what would the payer's necessity rulebook say?"
 * — the same GREEN/YELLOW/RED information the NPHIES badges already show
 * for linked orders, surfaced BEFORE the clinician's tap instead of after.
 *
 * Every pair verdict comes verbatim from services/veritas-graph's
 * validate_order_necessity (the deterministic Cypher lookup over
 * NPHIES_JUSTIFIES edges). Graph unreachable → honest UNAVAILABLE.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

export interface PairVerdict {
  readonly order_id: string;
  readonly condition_id: string;
  /** GREEN | YELLOW | RED | UNAVAILABLE — payer rulebook only, never clinical. */
  readonly status: string;
  readonly pre_auth_required: boolean | null;
}

export interface LinkageVerdicts {
  readonly patient_id: string;
  readonly pairs: readonly PairVerdict[];
  readonly graph_available: boolean;
  readonly disclaimer: string;
}

interface GraphNecessityResponse {
  status?: unknown;
  pre_auth_required?: unknown;
}

const DISCLAIMER =
  "Payer necessity-rulebook lookups for candidate pairs, shown to inform the clinician's own linkage choice. The system does not suggest linkages — the association remains the clinician's. Not a clinical assessment.";

const MAX_ORDERS = 12;
const MAX_CONDITIONS = 12;

@Injectable()
export class LinkageVerdictsService {
  private readonly logger = new Logger(LinkageVerdictsService.name);
  private readonly graphUrl: string;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {
    this.graphUrl = process.env.GRAPH_SERVICE_URL ?? "http://127.0.0.1:5004";
  }

  /**
   * Verdicts for (active unlinked order with a confirmed SBS code) ×
   * (documented condition with a confirmed ICD-10-AM code). Bounded so a
   * wide problem list cannot fan out into an unbounded graph crawl.
   */
  async verdicts(userId: string, patientId: string): Promise<LinkageVerdicts> {
    await this.scope.assertPatientInScope(userId, patientId);

    const orders = await this.pool.query<{ id: string; sbs_code: string }>(
      `SELECT o.id, s.sbs_code
       FROM app.service_request o
       JOIN app.service_request_sbs_coding s ON s.service_request_id = o.id
       WHERE o.patient_id = $1 AND o.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM app.service_request_diagnosis_link l
           WHERE l.service_request_id = o.id
         )
       ORDER BY o.requested_at DESC
       LIMIT $2`,
      [patientId, MAX_ORDERS],
    );

    const conditions = await this.pool.query<{ id: string; icd10_code: string }>(
      `SELECT c.id, i.icd10_code
       FROM hospital.condition c
       JOIN app.condition_icd_coding i ON i.condition_id = c.id
       WHERE c.patient_id = $1 AND c.status = 'active'
       ORDER BY c.onset_date DESC NULLS LAST
       LIMIT $2`,
      [patientId, MAX_CONDITIONS],
    );

    if (orders.rows.length === 0 || conditions.rows.length === 0) {
      return { patient_id: patientId, pairs: [], graph_available: true, disclaimer: DISCLAIMER };
    }

    let graphAvailable = true;
    const pairs: PairVerdict[] = [];
    for (const order of orders.rows) {
      for (const condition of conditions.rows) {
        if (!graphAvailable) {
          pairs.push({
            order_id: order.id,
            condition_id: condition.id,
            status: "UNAVAILABLE",
            pre_auth_required: null,
          });
          continue;
        }
        const verdict = await this.lookup(order.sbs_code, condition.icd10_code);
        if (verdict === null) {
          graphAvailable = false;
          this.logger.warn("linkage_verdicts_graph_unavailable");
          pairs.push({
            order_id: order.id,
            condition_id: condition.id,
            status: "UNAVAILABLE",
            pre_auth_required: null,
          });
          continue;
        }
        pairs.push({
          order_id: order.id,
          condition_id: condition.id,
          status: verdict.status,
          pre_auth_required: verdict.preAuthRequired,
        });
      }
    }

    return { patient_id: patientId, pairs, graph_available: graphAvailable, disclaimer: DISCLAIMER };
  }

  private async lookup(
    sbsCode: string,
    icd10Code: string,
  ): Promise<{ status: string; preAuthRequired: boolean } | null> {
    let response: Response;
    try {
      response = await fetch(`${this.graphUrl}/api/v1/nphies/validate-necessity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icd10_code: icd10Code, service_or_drug_code: sbsCode }),
      });
    } catch (err) {
      this.logger.warn("linkage_verdicts_graph_fetch_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    if (!response.ok) {
      this.logger.warn("linkage_verdicts_graph_error", { status: response.status });
      return null;
    }
    const body = (await response.json()) as GraphNecessityResponse;
    const status = typeof body.status === "string" ? body.status : "";
    if (status !== "GREEN" && status !== "YELLOW" && status !== "RED") return null;
    return { status, preAuthRequired: body.pre_auth_required === true };
  }
}
