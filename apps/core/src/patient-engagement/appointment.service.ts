/**
 * AppointmentService — Patient Engagement (reminders/intake), administrative
 * scheduling only. See docs/architecture/patient-engagement-connector.md.
 *
 * hospital.appointment is intentionally minimal: schedule() performs no
 * conflict/double-booking check. This is the seam a future AI Receptionist/
 * Scheduling feature is expected to extend with real booking logic, not
 * replace. Status transitions are purely administrative (scheduled ->
 * completed | cancelled | no_show) -- never gated by clinical content.
 */
import { Injectable, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "no_show";

export interface AppointmentRow {
  readonly id: string;
  readonly patient_id: string;
  readonly scheduled_at: string;
  readonly appointment_type: string;
  readonly status: AppointmentStatus;
  readonly department_display: string | null;
  readonly clinician_display: string | null;
  readonly created_by: string | null;
  readonly updated_at: string;
}

export interface AppointmentQueueRow extends AppointmentRow {
  readonly patient_mrn: string | null;
  readonly patient_display_name: string | null;
}

const ALLOWED_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

const APPOINTMENT_COLS = `id, patient_id, scheduled_at::text AS scheduled_at, appointment_type, status,
  department_display, clinician_display, created_by, updated_at::text AS updated_at`;

@Injectable()
export class AppointmentService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async schedule(
    userId: string,
    patientId: string,
    scheduledAt: string,
    appointmentType: string,
    departmentDisplay: string | null,
    clinicianDisplay: string | null,
  ): Promise<AppointmentRow> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<AppointmentRow>(
      `INSERT INTO hospital.appointment
         (patient_id, scheduled_at, appointment_type, status, department_display, clinician_display, created_by)
       VALUES ($1, $2, $3, 'scheduled', $4, $5, $6)
       RETURNING ${APPOINTMENT_COLS}`,
      [patientId, scheduledAt, appointmentType, departmentDisplay, clinicianDisplay, userId],
    );
    return res.rows[0]!;
  }

  /**
   * Patient self-service booking path for the AI Receptionist flow
   * (docs/architecture/ai-receptionist.md) -- deliberately separate from
   * schedule() (the staff path): no PatientScopeService check (a patient
   * booking their own appointment isn't a staff member with a care-team
   * scope), and created_by is NULL since there is no app.user row to
   * attribute the booking to. Slot validity and race-safe conflict
   * detection are the CALLER's responsibility (AvailabilityService) -- this
   * method only performs the insert.
   */
  async scheduleSelfService(
    patientId: string,
    scheduledAt: string,
    appointmentType: string,
    departmentDisplay: string | null,
    clinicianDisplay: string | null,
  ): Promise<AppointmentRow> {
    const res = await this.pool.query<AppointmentRow>(
      `INSERT INTO hospital.appointment
         (patient_id, scheduled_at, appointment_type, status, department_display, clinician_display,
          created_by, booked_via)
       VALUES ($1, $2, $3, 'scheduled', $4, $5, NULL, 'patient_self_service')
       RETURNING ${APPOINTMENT_COLS}`,
      [patientId, scheduledAt, appointmentType, departmentDisplay, clinicianDisplay],
    );
    return res.rows[0]!;
  }

  async list(userId: string, patientId: string): Promise<AppointmentRow[]> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<AppointmentRow>(
      `SELECT ${APPOINTMENT_COLS} FROM hospital.appointment
        WHERE patient_id = $1 ORDER BY scheduled_at DESC LIMIT 100`,
      [patientId],
    );
    return res.rows;
  }

  /**
   * Patient self-service "my appointments" list -- patientId comes from the
   * caller's already-verified booking session (never a client-supplied
   * param), so no additional scope check is needed here, same reasoning as
   * scheduleSelfService().
   */
  async listOwn(patientId: string): Promise<AppointmentRow[]> {
    const res = await this.pool.query<AppointmentRow>(
      `SELECT ${APPOINTMENT_COLS} FROM hospital.appointment
        WHERE patient_id = $1 ORDER BY scheduled_at DESC LIMIT 100`,
      [patientId],
    );
    return res.rows;
  }

  async updateStatus(userId: string, appointmentId: string, newStatus: AppointmentStatus): Promise<AppointmentRow> {
    const existing = await this.getById(appointmentId);
    await this.scope.assertPatientInScope(userId, existing.patient_id);
    if (!ALLOWED_TRANSITIONS[existing.status].includes(newStatus)) {
      throw new BadRequestException(
        `Cannot move an appointment from "${existing.status}" to "${newStatus}"`,
      );
    }
    const res = await this.pool.query<AppointmentRow>(
      `UPDATE hospital.appointment
          SET status = $2, updated_by = $3, updated_at = now()
        WHERE id = $1
        RETURNING ${APPOINTMENT_COLS}`,
      [appointmentId, newStatus, userId],
    );
    return res.rows[0]!;
  }

  /**
   * Self-service cancel for the AI Receptionist patient-booking flow
   * (docs/architecture/ai-receptionist.md) -- deliberately NOT the same code
   * path as updateStatus(): a patient has no app.user row, so updated_by
   * (FK to app."user") must be NULL here, and a patient may only ever
   * cancel their own appointment, never mark it completed/no_show (those
   * remain staff-only administrative facts). Ownership is verified against
   * the CALLER-SUPPLIED patientId (which the controller derives from the
   * verified booking session, never a client-editable param) -- a mismatch
   * throws NotFoundException (404, not 403) so a tampering caller can't use
   * the response to confirm a given appointment id exists.
   */
  async selfServiceCancel(appointmentId: string, patientId: string): Promise<AppointmentRow> {
    const existing = await this.getById(appointmentId);
    if (existing.patient_id !== patientId) {
      throw new NotFoundException("Appointment not found");
    }
    if (!ALLOWED_TRANSITIONS[existing.status].includes("cancelled")) {
      throw new BadRequestException(`Cannot cancel an appointment in status "${existing.status}"`);
    }
    const res = await this.pool.query<AppointmentRow>(
      `UPDATE hospital.appointment
          SET status = 'cancelled', updated_by = NULL, updated_at = now()
        WHERE id = $1
        RETURNING ${APPOINTMENT_COLS}`,
      [appointmentId],
    );
    return res.rows[0]!;
  }

  /**
   * Front-desk queue -- cross-patient by design (same reasoning as the
   * pharmacist refill queue / NPHIES rejection-analytics precedent:
   * administrative aggregation, never clinical content). Only identity,
   * schedule, and status -- no diagnosis, no reason-for-visit, no clinical
   * context of any kind.
   */
  async queue(date?: string): Promise<AppointmentQueueRow[]> {
    const res = await this.pool.query<AppointmentQueueRow>(
      `SELECT a.id, a.patient_id, a.scheduled_at::text AS scheduled_at, a.appointment_type, a.status,
              a.department_display, a.clinician_display, a.created_by, a.updated_at::text AS updated_at,
              p.mrn AS patient_mrn, p.display_name AS patient_display_name
         FROM hospital.appointment a
         JOIN hospital.patient p ON p.id = a.patient_id
        WHERE a.status = 'scheduled'
          AND ($1::date IS NULL OR a.scheduled_at::date = $1::date)
        ORDER BY a.scheduled_at ASC`,
      [date ?? null],
    );
    return res.rows;
  }

  private async getById(appointmentId: string): Promise<AppointmentRow> {
    const res = await this.pool.query<AppointmentRow>(
      `SELECT ${APPOINTMENT_COLS} FROM hospital.appointment WHERE id = $1`,
      [appointmentId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundException("Appointment not found");
    return row;
  }
}
