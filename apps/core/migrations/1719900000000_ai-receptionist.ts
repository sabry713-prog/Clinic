import type { MigrationBuilder } from "node-pg-migrate";

// AI Receptionist / Scheduling — patient self-service booking. See
// docs/architecture/ai-receptionist.md. Unlike other dummy/stub connectors in
// this codebase, the IDENTITY-VERIFICATION mechanism here (OTP) is genuinely
// real -- this is a public, unauthenticated surface. The appointment-booking
// BUSINESS LOGIC stays simple/dummy (no real SMS provider), but OTP secrecy,
// rate limiting, and race-safe slot booking are real security properties.
//
// No interaction/allergy/dose/triage content anywhere (CLAUDE.md §2):
// department/appointment-type matching is catalog-term-only, never inferred
// from symptom text; slots are always chronological, never urgency-ordered.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.patient_otp_request (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id   uuid NOT NULL REFERENCES hospital.patient(id),
      phone        text NOT NULL,
      otp_hash     text NOT NULL,
      otp_salt     text NOT NULL,
      expires_at   timestamptz NOT NULL,
      attempts     int NOT NULL DEFAULT 0,
      consumed_at  timestamptz,
      created_at   timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.patient_otp_request (phone, created_at DESC)`);
  pgm.sql(`CREATE INDEX ON app.patient_otp_request (patient_id, created_at DESC)`);

  pgm.sql(`
    CREATE TABLE app.provider_availability (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      department_display     text NOT NULL,
      clinician_display      text,
      day_of_week            smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time             time NOT NULL,
      end_time               time NOT NULL,
      slot_duration_minutes  int NOT NULL CHECK (slot_duration_minutes > 0),
      active                 boolean NOT NULL DEFAULT true,
      created_by             uuid NOT NULL REFERENCES app."user"(id),
      created_at             timestamptz NOT NULL DEFAULT now(),
      updated_at             timestamptz NOT NULL DEFAULT now(),
      CHECK (end_time > start_time)
    )
  `);
  pgm.sql(`
    CREATE INDEX ON app.provider_availability (department_display, clinician_display, day_of_week)
    WHERE active
  `);

  // booked_via: traceability only, never used for access control or clinical
  // decisions. Existing rows backfill to 'staff' automatically via DEFAULT.
  pgm.sql(`
    ALTER TABLE hospital.appointment
      ADD COLUMN booked_via text NOT NULL DEFAULT 'staff'
  `);
  pgm.sql(`
    ALTER TABLE hospital.appointment
      ADD CONSTRAINT appointment_booked_via_check CHECK (booked_via IN ('staff', 'patient_self_service'))
  `);

  // A patient-initiated booking has no app.user row to attribute -- relax
  // created_by to nullable so patient_self_service rows can store NULL.
  // AppointmentService.schedule() (staff path) always still passes a real
  // staff userId; only the new patient-self-service insert path leaves this
  // NULL.
  pgm.sql(`ALTER TABLE hospital.appointment ALTER COLUMN created_by DROP NOT NULL`);

  // The actual race-safety guarantee for slot booking -- not just an
  // application-level "is it still free" check (which only prevents showing
  // a stale slot, not a true concurrent double-book). COALESCE(...,'') is
  // deliberate: without it, two NULL clinician_display rows would not
  // collide in a Postgres unique index (NULL <> NULL), letting two patients
  // double-book the same department-level slot.
  pgm.sql(`
    CREATE UNIQUE INDEX appointment_slot_uniqueness
      ON hospital.appointment (department_display, COALESCE(clinician_display, ''), scheduled_at)
      WHERE status = 'scheduled'
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS appointment_slot_uniqueness`);
  pgm.sql(`ALTER TABLE hospital.appointment DROP CONSTRAINT IF EXISTS appointment_booked_via_check`);
  pgm.sql(`ALTER TABLE hospital.appointment DROP COLUMN IF EXISTS booked_via`);
  pgm.sql(`DROP TABLE IF EXISTS app.provider_availability`);
  pgm.sql(`DROP TABLE IF EXISTS app.patient_otp_request`);
}
