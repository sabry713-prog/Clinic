import type { MigrationBuilder } from "node-pg-migrate";

// Patient Engagement (reminders / intake) — dummy/stub. See
// docs/architecture/patient-engagement-connector.md. Cortex.ai performs no
// diagnosis/interaction/risk content anywhere here (CLAUDE.md §2): reminder
// text is a fixed factual template (date/time/type/location only), and
// intake's free-text reason-for-visit is captured and displayed verbatim,
// never fed into any extraction/classification pipeline.
export async function up(pgm: MigrationBuilder): Promise<void> {
  // hospital.appointment is a deliberate exception to this schema's usual
  // convention: every other hospital.* table is a FHIR-ingestion mirror
  // (source_system/source_id/fhir_resource_json/last_synced_at). This one is
  // staff-authored inside Cortex.ai directly -- there is no appointment feed
  // to ingest yet. Do not "fix" this into an ingestion shape; a future
  // AI Receptionist/Scheduling feature is expected to extend this table with
  // real booking logic, not replace it.
  pgm.sql(`
    CREATE TABLE hospital.appointment (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         uuid NOT NULL REFERENCES hospital.patient(id),
      scheduled_at       timestamptz NOT NULL,
      appointment_type   text NOT NULL,
      status             text NOT NULL DEFAULT 'scheduled',
      department_display text,
      clinician_display  text,
      created_by         uuid NOT NULL REFERENCES app."user"(id),
      updated_by         uuid REFERENCES app."user"(id),
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.appointment (patient_id, scheduled_at DESC)`);
  pgm.sql(`CREATE INDEX ON hospital.appointment (status, scheduled_at)`);

  // app.patient_contact (not new columns on hospital.patient): hospital.patient
  // is overwritten by the FHIR ingestion sync, so a nurse-confirmed phone
  // number living there could be silently clobbered by a stale/missing
  // telecom field on the next sync. Keeping it in app.* keeps staff-entered
  // contact data outside the ingestion blast radius.
  pgm.sql(`
    CREATE TABLE app.patient_contact (
      patient_id        uuid PRIMARY KEY REFERENCES hospital.patient(id),
      phone              text,
      email              text,
      preferred_channel  text,
      confirmed_by       uuid NOT NULL REFERENCES app."user"(id),
      confirmed_at       timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE TABLE app.reminder_send (
      id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id                uuid NOT NULL REFERENCES hospital.patient(id),
      appointment_id            uuid NOT NULL REFERENCES hospital.appointment(id),
      channel                   text NOT NULL,
      status                    text NOT NULL DEFAULT 'pending',
      mode                      text NOT NULL,
      template_used             text NOT NULL,
      rendered_message          text NOT NULL,
      simulated_outcome_detail  text,
      sent_by                   uuid NOT NULL REFERENCES app."user"(id),
      sent_at                   timestamptz NOT NULL DEFAULT now(),
      updated_at                timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.reminder_send (patient_id, sent_at DESC)`);
  pgm.sql(`CREATE INDEX ON app.reminder_send (appointment_id)`);

  // Insert-only, no update endpoint -- each check-in produces a new immutable
  // row, same discipline as source_excerpt elsewhere in this codebase never
  // being edited after creation.
  pgm.sql(`
    CREATE TABLE app.intake_record (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id             uuid NOT NULL REFERENCES hospital.patient(id),
      appointment_id         uuid REFERENCES hospital.appointment(id),
      contact_confirmed      boolean NOT NULL DEFAULT false,
      contact_phone          text,
      contact_email          text,
      preferred_channel      text,
      reason_for_visit_text  text,
      captured_by            uuid NOT NULL REFERENCES app."user"(id),
      captured_at            timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.intake_record (patient_id, captured_at DESC)`);
  pgm.sql(`CREATE INDEX ON app.intake_record (appointment_id)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.intake_record`);
  pgm.sql(`DROP TABLE IF EXISTS app.reminder_send`);
  pgm.sql(`DROP TABLE IF EXISTS app.patient_contact`);
  pgm.sql(`DROP TABLE IF EXISTS hospital.appointment`);
}
