import type { MigrationBuilder } from "node-pg-migrate";

// Tie a clinician-entered diagnosis to the encounter — and the note — it was made in.
//
// The problem list is patient-level, which is correct clinically, but it left the system unable to
// answer "what was this visit for?" from the record: hospital.condition carried the patient, the
// code and the author, never the encounter. The same shape as Observation.basedOn, fixed the same
// way, and for the same reason: the outcome existed, its link to what produced it did not.
//
// Plain uuids, not foreign keys across schemas — hospital.* is the mirrored clinical record and
// app.encounter is ours, so the mirror must not refuse a row the source already considers valid.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE hospital.condition ADD COLUMN IF NOT EXISTS encounter_id uuid`);
  pgm.sql(`ALTER TABLE hospital.condition ADD COLUMN IF NOT EXISTS draft_id uuid`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS condition_encounter_idx ON hospital.condition (encounter_id)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS condition_encounter_idx`);
  pgm.sql(`ALTER TABLE hospital.condition DROP COLUMN IF EXISTS draft_id`);
  pgm.sql(`ALTER TABLE hospital.condition DROP COLUMN IF EXISTS encounter_id`);
}
