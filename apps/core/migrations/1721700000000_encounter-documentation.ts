import type { MigrationBuilder } from "node-pg-migrate";

// How the encounter's note was captured — and whether the patient declined to be recorded.
//
// Raised in review: the SOAP can come from the ambient recording, or the clinician can write it by
// hand, "as some patients might refuse the recording procedure". Both paths already work and save
// (the authored path skips the transcript-containment gate, because with no recording there is no
// transcript to be a substring of). What was missing is the RECORD of which happened: the note simply
// had no transcript behind it, and nothing could tell a hand-written note from a failed capture.
//
// It lives in app.* rather than hospital.* deliberately — hospital.encounter is the mirrored clinical
// record, and "the patient declined" is our fact about the encounter, not a fact the HIS gave us.
//
// `source` records the mechanism (ambient capture vs written by hand); `recording_declined` records
// the patient's reason. They are separate because a clinician may simply prefer typing on a patient
// who was happy to be recorded, and conflating the two would put a refusal in the record that never
// happened.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.encounter_documentation (
      encounter_id         uuid PRIMARY KEY,
      patient_id           uuid NOT NULL,
      source               text NOT NULL CHECK (source IN ('ambient', 'manual')),
      recording_declined   boolean NOT NULL DEFAULT false,
      updated_by           uuid NOT NULL,
      updated_at           timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS encounter_documentation_patient_idx ON app.encounter_documentation (patient_id)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS app.encounter_documentation_patient_idx`);
  pgm.sql(`DROP TABLE IF EXISTS app.encounter_documentation`);
}
