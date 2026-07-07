/**
 * SbsCodingService — order-code → SBS coding with clinician confirmation.
 *
 * Mirrors IcdCodingService: suggestions are DETERMINISTIC lookups against
 * app.order_sbs_map (no model call); nothing persists at suggest time;
 * only an explicit clinician confirmation writes to
 * app.service_request_sbs_coding, and the confirmed code must equal the
 * reference-map suggestion. The order itself was already clinician-
 * confirmed via the service-request flow — this maps its billing
 * vocabulary only (CLAUDE.md §2).
 */

import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { PatientScopeService } from "../patient/patient-scope.service";

export interface OrderCoding {
  readonly service_request_id: string;
  readonly order_display: string;
  readonly order_code: string | null;
  readonly category: string;
  readonly requested_at: string;
  readonly confirmed: {
    readonly sbs_code: string;
    readonly sbs_display: string;
    readonly confirmed_at: string;
  } | null;
  readonly suggestion: {
    readonly sbs_code: string;
    readonly sbs_display: string;
  } | null;
}

export interface OrderCodingStatus {
  readonly patient_id: string;
  readonly orders: readonly OrderCoding[];
  readonly disclaimer: string;
}

const DISCLAIMER =
  "Deterministic vocabulary mapping of clinician-confirmed orders for claim coding. Suggestions come from a reference table; codes are stored only after clinician confirmation. Not a clinical assessment.";

@Injectable()
export class SbsCodingService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async status(userId: string, patientId: string): Promise<OrderCodingStatus> {
    await this.scope.assertPatientInScope(userId, patientId);

    const rows = await this.pool.query<{
      service_request_id: string;
      order_display: string;
      order_code: string | null;
      category: string;
      requested_at: string;
      confirmed_code: string | null;
      confirmed_display: string | null;
      confirmed_at: string | null;
      suggested_code: string | null;
      suggested_display: string | null;
    }>(
      `SELECT sr.id AS service_request_id,
              sr.code_display AS order_display,
              sr.code AS order_code,
              sr.category,
              sr.requested_at::text AS requested_at,
              sc.sbs_code AS confirmed_code,
              sc.sbs_display AS confirmed_display,
              sc.confirmed_at::text AS confirmed_at,
              m.sbs_code AS suggested_code,
              m.sbs_display AS suggested_display
       FROM app.service_request sr
       LEFT JOIN app.service_request_sbs_coding sc ON sc.service_request_id = sr.id
       LEFT JOIN app.order_sbs_map m ON m.order_code = sr.code
       WHERE sr.patient_id = $1 AND sr.status = 'active'
       ORDER BY sr.requested_at DESC`,
      [patientId],
    );

    return {
      patient_id: patientId,
      orders: rows.rows.map((r) => ({
        service_request_id: r.service_request_id,
        order_display: r.order_display,
        order_code: r.order_code,
        category: r.category,
        requested_at: r.requested_at,
        confirmed:
          r.confirmed_code !== null && r.confirmed_display !== null && r.confirmed_at !== null
            ? {
                sbs_code: r.confirmed_code,
                sbs_display: r.confirmed_display,
                confirmed_at: r.confirmed_at,
              }
            : null,
        suggestion:
          r.suggested_code !== null && r.suggested_display !== null
            ? { sbs_code: r.suggested_code, sbs_display: r.suggested_display }
            : null,
      })),
      disclaimer: DISCLAIMER,
    };
  }

  async confirm(userId: string, patientId: string, serviceRequestId: string): Promise<OrderCoding> {
    await this.scope.assertPatientInScope(userId, patientId);

    const order = await this.pool.query<{
      id: string;
      code: string | null;
      code_display: string;
      category: string;
      requested_at: string;
      sbs_code: string | null;
      sbs_display: string | null;
    }>(
      `SELECT sr.id, sr.code, sr.code_display, sr.category,
              sr.requested_at::text AS requested_at,
              m.sbs_code, m.sbs_display
       FROM app.service_request sr
       LEFT JOIN app.order_sbs_map m ON m.order_code = sr.code
       WHERE sr.id = $1 AND sr.patient_id = $2 AND sr.status = 'active'`,
      [serviceRequestId, patientId],
    );
    const o = order.rows[0];
    if (!o) {
      throw new BadRequestException({
        error: { code: "ORDER_NOT_FOUND", message: "Active service request not found for this patient" },
      });
    }
    if (o.sbs_code === null || o.sbs_display === null) {
      throw new BadRequestException({
        error: {
          code: "NO_MAPPING_AVAILABLE",
          message: "No SBS mapping exists for this order's code",
        },
      });
    }

    const inserted = await this.pool.query<{ confirmed_at: string }>(
      `INSERT INTO app.service_request_sbs_coding
         (service_request_id, patient_id, order_code, sbs_code, sbs_display, confirmed_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (service_request_id) DO UPDATE
         SET sbs_code = EXCLUDED.sbs_code,
             sbs_display = EXCLUDED.sbs_display,
             confirmed_by = EXCLUDED.confirmed_by,
             confirmed_at = now()
       RETURNING confirmed_at::text AS confirmed_at`,
      [serviceRequestId, patientId, o.code, o.sbs_code, o.sbs_display, userId],
    );

    return {
      service_request_id: serviceRequestId,
      order_display: o.code_display,
      order_code: o.code,
      category: o.category,
      requested_at: o.requested_at,
      confirmed: {
        sbs_code: o.sbs_code,
        sbs_display: o.sbs_display,
        confirmed_at: inserted.rows[0]?.confirmed_at ?? new Date().toISOString(),
      },
      suggestion: { sbs_code: o.sbs_code, sbs_display: o.sbs_display },
    };
  }

  async unconfirm(userId: string, patientId: string, serviceRequestId: string): Promise<void> {
    await this.scope.assertPatientInScope(userId, patientId);
    await this.pool.query(
      `DELETE FROM app.service_request_sbs_coding
       WHERE service_request_id = $1 AND patient_id = $2`,
      [serviceRequestId, patientId],
    );
  }
}
