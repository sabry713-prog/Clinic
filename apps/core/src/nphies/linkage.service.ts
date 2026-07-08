/**
 * LinkageService — order → diagnosis linkage capture for claims.
 *
 * NPHIES claims require each item to reference a supporting diagnosis.
 * This service records the CLINICIAN'S OWN association between an order
 * they confirmed and a condition they documented. There are deliberately
 * NO system suggestions here: deciding which diagnosis supports which
 * order is clinical reasoning, which this product never performs
 * (CLAUDE.md §2). The service lists documented facts and stores explicit
 * clinician choices — nothing else.
 */

import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { PatientScopeService } from "../patient/patient-scope.service";

export interface LinkedDiagnosis {
  readonly condition_id: string;
  readonly condition_display: string | null;
  readonly linked_at: string;
}

export interface OrderLinkage {
  readonly service_request_id: string;
  readonly order_display: string;
  readonly category: string;
  readonly requested_at: string;
  readonly linked: readonly LinkedDiagnosis[];
}

export interface LinkageStatus {
  readonly patient_id: string;
  readonly orders: readonly OrderLinkage[];
  readonly available_conditions: readonly {
    readonly condition_id: string;
    readonly condition_display: string | null;
    readonly onset_date: string | null;
  }[];
  readonly disclaimer: string;
}

const DISCLAIMER =
  "Records the clinician's own association between a confirmed order and a documented diagnosis, as required on NPHIES claim items. The system does not suggest linkages. Not a clinical assessment.";

@Injectable()
export class LinkageService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async status(userId: string, patientId: string): Promise<LinkageStatus> {
    await this.scope.assertPatientInScope(userId, patientId);

    const orders = await this.pool.query<{
      service_request_id: string;
      order_display: string;
      category: string;
      requested_at: string;
    }>(
      `SELECT id AS service_request_id, code_display AS order_display,
              category, requested_at::text AS requested_at
       FROM app.service_request
       WHERE patient_id = $1 AND status = 'active'
       ORDER BY requested_at DESC`,
      [patientId],
    );

    const links = await this.pool.query<{
      service_request_id: string;
      condition_id: string;
      condition_display: string | null;
      linked_at: string;
    }>(
      `SELECT l.service_request_id, l.condition_id,
              c.code_display AS condition_display, l.linked_at::text AS linked_at
       FROM app.service_request_diagnosis_link l
       JOIN hospital.condition c ON c.id = l.condition_id
       WHERE l.patient_id = $1
       ORDER BY l.linked_at`,
      [patientId],
    );

    const conditions = await this.pool.query<{
      condition_id: string;
      condition_display: string | null;
      onset_date: string | null;
    }>(
      `SELECT id AS condition_id, code_display AS condition_display,
              onset_date::text AS onset_date
       FROM hospital.condition
       WHERE patient_id = $1 AND status = 'active'
       ORDER BY onset_date DESC NULLS LAST, code_display`,
      [patientId],
    );

    const byOrder = new Map<string, LinkedDiagnosis[]>();
    for (const l of links.rows) {
      const list = byOrder.get(l.service_request_id) ?? [];
      list.push({
        condition_id: l.condition_id,
        condition_display: l.condition_display,
        linked_at: l.linked_at,
      });
      byOrder.set(l.service_request_id, list);
    }

    return {
      patient_id: patientId,
      orders: orders.rows.map((o) => ({
        ...o,
        linked: byOrder.get(o.service_request_id) ?? [],
      })),
      available_conditions: conditions.rows,
      disclaimer: DISCLAIMER,
    };
  }

  async link(
    userId: string,
    patientId: string,
    serviceRequestId: string,
    conditionId: string,
  ): Promise<void> {
    await this.scope.assertPatientInScope(userId, patientId);

    // Both sides must belong to this patient and be active.
    const order = await this.pool.query(
      `SELECT 1 FROM app.service_request
       WHERE id = $1 AND patient_id = $2 AND status = 'active'`,
      [serviceRequestId, patientId],
    );
    if (order.rowCount === 0) {
      throw new BadRequestException({
        error: { code: "ORDER_NOT_FOUND", message: "Active service request not found for this patient" },
      });
    }
    const condition = await this.pool.query(
      `SELECT 1 FROM hospital.condition
       WHERE id = $1 AND patient_id = $2 AND status = 'active'`,
      [conditionId, patientId],
    );
    if (condition.rowCount === 0) {
      throw new BadRequestException({
        error: { code: "CONDITION_NOT_FOUND", message: "Active condition not found for this patient" },
      });
    }

    await this.pool.query(
      `INSERT INTO app.service_request_diagnosis_link
         (service_request_id, condition_id, patient_id, linked_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (service_request_id, condition_id) DO NOTHING`,
      [serviceRequestId, conditionId, patientId, userId],
    );
  }

  async unlink(
    userId: string,
    patientId: string,
    serviceRequestId: string,
    conditionId: string,
  ): Promise<void> {
    await this.scope.assertPatientInScope(userId, patientId);
    await this.pool.query(
      `DELETE FROM app.service_request_diagnosis_link
       WHERE service_request_id = $1 AND condition_id = $2 AND patient_id = $3`,
      [serviceRequestId, conditionId, patientId],
    );
  }
}
