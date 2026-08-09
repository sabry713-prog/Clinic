/**
 * IntakeService — staff-assisted check-in intake capture. See
 * docs/architecture/patient-engagement-connector.md.
 *
 * capture() is insert-only -- there is no update endpoint, same immutability
 * discipline as source_excerpt elsewhere in this codebase never being edited
 * after creation. reason_for_visit_text is trimmed of surrounding whitespace
 * ONLY -- never summarized, classified, or fed into any extraction pipeline
 * (deliberately kept separate from ServiceRequestService's ad-hoc quick-entry
 * text handling, to avoid this drifting toward triage-adjacent behavior).
 */
import { Injectable, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

const REASON_MAX_LENGTH = 2000;

export interface PatientContactRow {
  readonly patient_id: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly preferred_channel: string | null;
  readonly confirmed_at: string;
}

export interface IntakeRecordRow {
  readonly id: string;
  readonly patient_id: string;
  readonly appointment_id: string | null;
  readonly contact_confirmed: boolean;
  readonly contact_phone: string | null;
  readonly contact_email: string | null;
  readonly preferred_channel: string | null;
  readonly reason_for_visit_text: string | null;
  readonly captured_by: string;
  readonly captured_at: string;
}

const CONTACT_COLS = `patient_id, phone, email, preferred_channel, confirmed_at::text AS confirmed_at`;
const INTAKE_COLS = `id, patient_id, appointment_id, contact_confirmed, contact_phone, contact_email,
  preferred_channel, reason_for_visit_text, captured_by, captured_at::text AS captured_at`;

export interface CaptureIntakeInput {
  readonly appointmentId: string | null;
  readonly contactConfirmed: boolean;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly preferredChannel: string | null;
  readonly reasonForVisitText: string | null;
}

@Injectable()
export class IntakeService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
  ) {}

  async getContact(userId: string, patientId: string): Promise<PatientContactRow | null> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<PatientContactRow>(
      `SELECT ${CONTACT_COLS} FROM app.patient_contact WHERE patient_id = $1`,
      [patientId],
    );
    return res.rows[0] ?? null;
  }

  async capture(userId: string, patientId: string, input: CaptureIntakeInput): Promise<IntakeRecordRow> {
    await this.scope.assertPatientInScope(userId, patientId);

    const reasonText = input.reasonForVisitText?.trim().slice(0, REASON_MAX_LENGTH) || null;

    const res = await this.pool.query<IntakeRecordRow>(
      `INSERT INTO app.intake_record
         (patient_id, appointment_id, contact_confirmed, contact_phone, contact_email,
          preferred_channel, reason_for_visit_text, captured_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${INTAKE_COLS}`,
      [
        patientId,
        input.appointmentId,
        input.contactConfirmed,
        input.contactPhone,
        input.contactEmail,
        input.preferredChannel,
        reasonText,
        userId,
      ],
    );

    // Only touch app.patient_contact if contact fields were actually supplied
    // -- an intake capture that only records a reason-for-visit shouldn't
    // silently blank out a previously-confirmed phone/email.
    if (input.contactPhone || input.contactEmail || input.preferredChannel) {
      await this.pool.query(
        `INSERT INTO app.patient_contact (patient_id, phone, email, preferred_channel, confirmed_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (patient_id) DO UPDATE SET
           phone = EXCLUDED.phone,
           email = EXCLUDED.email,
           preferred_channel = EXCLUDED.preferred_channel,
           confirmed_by = EXCLUDED.confirmed_by,
           confirmed_at = now(),
           updated_at = now()`,
        [patientId, input.contactPhone, input.contactEmail, input.preferredChannel, userId],
      );
    }

    return res.rows[0]!;
  }

  async list(userId: string, patientId: string): Promise<IntakeRecordRow[]> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<IntakeRecordRow>(
      `SELECT ${INTAKE_COLS} FROM app.intake_record
        WHERE patient_id = $1 ORDER BY captured_at DESC LIMIT 100`,
      [patientId],
    );
    return res.rows;
  }
}
