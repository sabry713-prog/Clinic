import type { MigrationBuilder } from "node-pg-migrate";

// S4.4 localisation quick wins:
//
// 1. app.patient_contact.language — the language patient-facing messages
//    (reminders) render in. Defaults to 'ar' (Saudi default); seeded/updated
//    by staff when confirming contact details. Template rendering picks the
//    Arabic or English variant from this value.
//
// 2. app.provider_availability.clinician_gender — supports the patient-facing
//    clinician-gender scheduling preference: availability rows declare the
//    gender of the clinician serving those slots (NULL = unspecified/not
//    declared), and the booking availability query can filter on it. This is
//    pure administrative scheduling metadata (like the display name), never
//    clinical content (CLAUDE.md §2).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE app.patient_contact
    ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'ar'
  `);
  pgm.sql(`
    ALTER TABLE app.provider_availability
    ADD COLUMN IF NOT EXISTS clinician_gender text
      CHECK (clinician_gender IN ('male', 'female'))
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE app.provider_availability DROP COLUMN IF EXISTS clinician_gender`);
  pgm.sql(`ALTER TABLE app.patient_contact DROP COLUMN IF EXISTS language`);
}
