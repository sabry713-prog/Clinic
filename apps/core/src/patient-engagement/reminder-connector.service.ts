/**
 * PatientEngagementConnectorService — dummy/stub appointment-reminder
 * connector. See docs/architecture/patient-engagement-connector.md.
 *
 * Provider pattern mirrors HospitalSysConnectorService / NphiesConnectorService
 * (PATIENT_ENGAGEMENT_CONNECTOR=stub|live): stub simulates a deterministic
 * delivered/failed outcome so the workflow runs without a real SMS/email/
 * WhatsApp provider; live throws honestly -- no network call exists yet.
 *
 * Boundary (CLAUDE.md §2): reminder text is always a FIXED, factual template
 * (date/time/appointment type/location only) -- never a reason-for-visit or
 * any clinical detail, and never model-generated. The appointment and the
 * delivery target are always re-derived server-side from already-confirmed
 * records -- the caller supplies only a reference, never message content or
 * a raw phone/email, which is what stops this endpoint being usable to
 * message arbitrary numbers.
 */
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "crypto";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientScopeService } from "../patient/patient-scope.service";

export type ReminderChannel = "sms" | "email" | "whatsapp";
export type ReminderStatus = "pending" | "delivered" | "failed";

export interface ReminderSendRow {
  readonly id: string;
  readonly patient_id: string;
  readonly appointment_id: string;
  readonly channel: ReminderChannel;
  readonly status: ReminderStatus;
  readonly mode: string;
  readonly template_used: string;
  readonly rendered_message: string;
  readonly simulated_outcome_detail: string | null;
  readonly sent_at: string;
  readonly updated_at: string;
}

interface AppointmentForReminder {
  readonly scheduled_at: string;
  readonly appointment_type: string;
  readonly department_display: string | null;
}

const REMINDER_COLS = `id, patient_id, appointment_id, channel, status, mode, template_used,
  rendered_message, simulated_outcome_detail, sent_at::text AS sent_at, updated_at::text AS updated_at`;

const SIMULATED_FAILURES: readonly string[] = [
  "Simulated: message provider timeout",
  "Simulated: number/address unreachable",
];

// S4.4 — Arabic patient-facing message templates. Same fixed, factual shape
// as the English template (date/time/type/location only — no reason for
// visit, no clinical detail, never model-generated). The date renders in the
// Hijri Umm al-Qura calendar with Arabic-Indic numerals, the calendar Saudi
// patients read natively.
const APPOINTMENT_TYPE_AR: Readonly<Record<string, string>> = {
  follow_up: "متابعة",
  new_patient: "جديد",
  consultation: "استشارة",
  procedure: "إجراء",
};

function hijriDateDisplay(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-arab", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function gregorianDateDisplay(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

@Injectable()
export class PatientEngagementConnectorService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly scope: PatientScopeService,
    private readonly config: ConfigService,
  ) {}

  private mode(): "stub" | "live" {
    return this.config.get<string>("PATIENT_ENGAGEMENT_CONNECTOR") === "live" ? "live" : "stub";
  }

  async send(
    userId: string,
    patientId: string,
    appointmentId: string,
    channel: ReminderChannel,
  ): Promise<ReminderSendRow> {
    await this.scope.assertPatientInScope(userId, patientId);

    const appointment = await this.resolveAppointment(patientId, appointmentId);
    const contactValue = await this.resolveContactValue(patientId, channel);
    const language = await this.resolveContactLanguage(patientId);

    if (this.mode() === "live") {
      throw new BadRequestException({
        error: {
          code: "PATIENT_ENGAGEMENT_LIVE_NOT_CONFIGURED",
          message:
            "Patient Engagement live reminder connector selected but not implemented -- requires a real " +
            "SMS/email/WhatsApp provider integration and a resolved PDPL consent-for-contact posture.",
        },
      });
    }

    const templateKey = `${appointment.appointment_type}:${channel}:${language}`;
    const renderedMessage = this.renderTemplate(appointment, channel, language);
    const outcome = this.simulateDelivery(appointmentId, channel, patientId);

    const res = await this.pool.query<ReminderSendRow>(
      `INSERT INTO app.reminder_send
         (patient_id, appointment_id, channel, status, mode, template_used, rendered_message,
          simulated_outcome_detail, sent_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${REMINDER_COLS}`,
      [
        patientId,
        appointmentId,
        channel,
        outcome.status,
        this.mode(),
        templateKey,
        renderedMessage,
        outcome.detail,
        userId,
      ],
    );
    void contactValue; // proves a confirmed contact exists for this channel; never persisted here
    return res.rows[0]!;
  }

  async list(userId: string, patientId: string): Promise<ReminderSendRow[]> {
    await this.scope.assertPatientInScope(userId, patientId);
    const res = await this.pool.query<ReminderSendRow>(
      `SELECT ${REMINDER_COLS} FROM app.reminder_send
        WHERE patient_id = $1 ORDER BY sent_at DESC LIMIT 100`,
      [patientId],
    );
    return res.rows;
  }

  private async resolveAppointment(patientId: string, appointmentId: string): Promise<AppointmentForReminder> {
    const res = await this.pool.query<AppointmentForReminder>(
      `SELECT scheduled_at::text AS scheduled_at, appointment_type, department_display
         FROM hospital.appointment WHERE id = $1 AND patient_id = $2`,
      [appointmentId, patientId],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundException("No appointment found for this patient to remind about");
    return row;
  }

  private async resolveContactValue(patientId: string, channel: ReminderChannel): Promise<string> {
    const res = await this.pool.query<{ phone: string | null; email: string | null }>(
      `SELECT phone, email FROM app.patient_contact WHERE patient_id = $1`,
      [patientId],
    );
    const row = res.rows[0];
    const value = channel === "email" ? row?.email : row?.phone;
    if (!value) {
      throw new BadRequestException({
        error: {
          code: "PATIENT_CONTACT_NOT_CONFIRMED",
          message: `No confirmed ${channel === "email" ? "email" : "phone number"} on file for this patient`,
        },
      });
    }
    return value;
  }

  /** Contact language for patient-facing templates (S4.4). Defaults to
   * Arabic — the Saudi default — when no preference is recorded. */
  private async resolveContactLanguage(patientId: string): Promise<"ar" | "en"> {
    const res = await this.pool.query<{ language: string | null }>(
      `SELECT language FROM app.patient_contact WHERE patient_id = $1`,
      [patientId],
    );
    return res.rows[0]?.language === "en" ? "en" : "ar";
  }

  // Fixed, factual templates (S4.4: bilingual) -- date/time/type/location
  // only, never a reason for visit or any clinical detail, never
  // model-generated. Arabic renders the date in the Hijri Umm al-Qura
  // calendar; English keeps Gregorian.
  private renderTemplate(
    appointment: AppointmentForReminder,
    channel: ReminderChannel,
    language: "ar" | "en",
  ): string {
    const location = appointment.department_display ? `, ${appointment.department_display}` : "";
    let base: string;
    if (language === "ar") {
      const typeAr = APPOINTMENT_TYPE_AR[appointment.appointment_type] ?? appointment.appointment_type;
      const dateAr = hijriDateDisplay(appointment.scheduled_at);
      base = `تذكير: لديك موعد ${typeAr} بتاريخ ${dateAr}${location}. يُرجى الحضور قبل الموعد بخمس عشرة دقيقة.`;
    } else {
      base = `Reminder: you have a ${appointment.appointment_type} appointment on ${gregorianDateDisplay(appointment.scheduled_at)}${location}. Please arrive 15 minutes early.`;
    }
    return channel === "sms" ? base.slice(0, 320) : base;
  }

  // Deterministic simulated delivery -- same (appointmentId, channel,
  // patientId) always produces the same outcome, matching the
  // deterministic-not-random dev-data convention used throughout this
  // codebase (seed:nphies-claims, HospitalSysConnectorService.simulateOrr).
  private simulateDelivery(
    appointmentId: string,
    channel: ReminderChannel,
    patientId: string,
  ): { status: ReminderStatus; detail: string | null } {
    const hash = createHash("sha256").update(`${appointmentId}:${channel}:${patientId}`).digest();
    const bucket = hash[0]! % 10;
    if (bucket < 1) {
      const detail = SIMULATED_FAILURES[hash[1]! % SIMULATED_FAILURES.length]!;
      return { status: "failed", detail };
    }
    return { status: "delivered", detail: null };
  }
}
