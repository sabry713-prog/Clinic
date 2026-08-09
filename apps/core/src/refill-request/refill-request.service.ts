/**
 * RefillRequestService — pharmacy operational tasks (gray-area per the
 * competitive assessment: "Administrative only (refill workflows,
 * reconciliation). Any interaction/dose checking crosses into SaMD.").
 *
 * This service tracks REQUEST STATUS ONLY. create() re-confirms an EXISTING,
 * already-active hospital.medication_request row verbatim — it never lets
 * anyone set or change a dose/route/frequency, and there is no interaction
 * or dose-appropriateness check anywhere here. Status transitions are purely
 * administrative (requested -> routed -> filled | denied, or requested ->
 * cancelled). The pharmacist queue is ordered FIFO by request time only,
 * never by clinical urgency — same rule PatientService.reconcileMedications()
 * already follows.
 */
import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

export type RefillStatus = "requested" | "routed" | "filled" | "denied" | "cancelled";

export interface RefillRequestRow {
  readonly id: string;
  readonly patient_id: string;
  readonly medication_request_id: string;
  readonly medication_display: string;
  readonly status: RefillStatus;
  readonly requested_by: string;
  readonly requested_at: string;
  readonly pharmacy_note: string | null;
  readonly updated_at: string;
}

export interface RefillQueueRow extends RefillRequestRow {
  readonly patient_mrn: string | null;
  readonly patient_display_name: string | null;
}

// requested -> routed -> filled|denied ; requested -> cancelled. Nothing else.
const ALLOWED_TRANSITIONS: Record<RefillStatus, readonly RefillStatus[]> = {
  requested: ["routed", "cancelled"],
  routed: ["filled", "denied"],
  filled: [],
  denied: [],
  cancelled: [],
};

const REFILL_COLS = `id, patient_id, medication_request_id, medication_display, status,
  requested_by, requested_at::text AS requested_at, pharmacy_note, updated_at::text AS updated_at`;

@Injectable()
export class RefillRequestService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async create(userId: string, patientId: string, medicationRequestId: string): Promise<RefillRequestRow> {
    await this.scope.assertPatientInScope(userId, patientId);

    // The only check here is factual presence/status — not a clinical
    // judgment about whether refilling is appropriate.
    const med = await this.pool.query<{ medication_display: string | null }>(
      `SELECT medication_display FROM hospital.medication_request
        WHERE id = $1 AND patient_id = $2 AND status = 'active'`,
      [medicationRequestId, patientId],
    );
    const row = med.rows[0];
    if (!row) {
      throw new BadRequestException("No active documented medication found for this request");
    }

    const res = await this.pool.query<RefillRequestRow>(
      `INSERT INTO app.refill_request
         (patient_id, medication_request_id, medication_display, status, requested_by)
       VALUES ($1, $2, $3, 'requested', $4)
       RETURNING ${REFILL_COLS}`,
      [patientId, medicationRequestId, row.medication_display ?? "Unnamed medication", userId],
    );
    return res.rows[0]!;
  }

  async list(userId: string, patientId: string): Promise<RefillRequestRow[]> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<RefillRequestRow>(
      `SELECT ${REFILL_COLS} FROM app.refill_request
        WHERE patient_id = $1 ORDER BY requested_at DESC LIMIT 100`,
      [patientId],
    );
    return res.rows;
  }

  async cancel(userId: string, refillRequestId: string): Promise<RefillRequestRow> {
    const existing = await this.getById(refillRequestId);
    await this.scope.assertPatientInScope(userId, existing.patient_id);
    if (existing.requested_by !== userId) {
      throw new ForbiddenException("Only the original requester can cancel a refill request");
    }
    if (existing.status !== "requested") {
      throw new BadRequestException(`Cannot cancel a request in status "${existing.status}"`);
    }
    return this.transition(refillRequestId, "cancelled", userId, null);
  }

  /**
   * Pharmacist queue — cross-patient by design (mirrors the NPHIES
   * rejection-analytics precedent: administrative aggregation, never
   * clinical content). Only identity, medication name, status, and
   * timestamps — no diagnosis, no labs, no clinical context of any kind.
   */
  async queue(): Promise<RefillQueueRow[]> {
    const res = await this.pool.query<RefillQueueRow>(
      `SELECT r.id, r.patient_id, r.medication_request_id, r.medication_display, r.status,
              r.requested_by, r.requested_at::text AS requested_at, r.pharmacy_note,
              r.updated_at::text AS updated_at,
              p.mrn AS patient_mrn, p.display_name AS patient_display_name
         FROM app.refill_request r
         JOIN hospital.patient p ON p.id = r.patient_id
        WHERE r.status IN ('requested', 'routed')
        ORDER BY r.requested_at ASC`,
    );
    return res.rows;
  }

  async updateStatus(
    userId: string,
    refillRequestId: string,
    newStatus: RefillStatus,
    pharmacyNote?: string,
  ): Promise<RefillRequestRow> {
    const existing = await this.getById(refillRequestId);
    if (!ALLOWED_TRANSITIONS[existing.status].includes(newStatus)) {
      throw new BadRequestException(
        `Cannot move a refill request from "${existing.status}" to "${newStatus}"`,
      );
    }
    return this.transition(refillRequestId, newStatus, userId, pharmacyNote ?? null);
  }

  private async getById(refillRequestId: string): Promise<RefillRequestRow> {
    const res = await this.pool.query<RefillRequestRow>(
      `SELECT ${REFILL_COLS} FROM app.refill_request WHERE id = $1`,
      [refillRequestId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundException("Refill request not found");
    return row;
  }

  private async transition(
    refillRequestId: string,
    newStatus: RefillStatus,
    userId: string,
    pharmacyNote: string | null,
  ): Promise<RefillRequestRow> {
    const res = await this.pool.query<RefillRequestRow>(
      `UPDATE app.refill_request
          SET status = $2, pharmacy_note = COALESCE($3, pharmacy_note), updated_by = $4, updated_at = now()
        WHERE id = $1
        RETURNING ${REFILL_COLS}`,
      [refillRequestId, newStatus, pharmacyNote, userId],
    );
    return res.rows[0]!;
  }
}
