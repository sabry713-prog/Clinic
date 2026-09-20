import type { MigrationBuilder } from "node-pg-migrate";

// Tie a draft to the encounter it documents.
//
// Without it "this encounter's note" could only mean "the newest encounter_note for the patient" — a
// rule stage 1 and stage 2 both relied on, and which silently breaks on the first day with two
// encounters: stage 2 reads the assessment from the other visit's note and analyses the wrong text.
// Same shape and same reasoning as the condition link and the checklist key, applied to the note.
//
// Nullable, because rows written before this existed have no encounter and must keep working: the
// readers fall back to the newest note for the patient when the column is empty.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE app.document_draft ADD COLUMN IF NOT EXISTS encounter_id uuid`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS document_draft_encounter_idx ON app.document_draft (encounter_id)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS document_draft_encounter_idx`);
  pgm.sql(`ALTER TABLE app.document_draft DROP COLUMN IF EXISTS encounter_id`);
}
