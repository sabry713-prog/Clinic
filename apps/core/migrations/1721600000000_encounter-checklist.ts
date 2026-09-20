import type { MigrationBuilder } from "node-pg-migrate";

// The clinician's checklist decisions, per encounter.
//
// Most of the checklist is derivable: entries are suggested from the note and the transcript, and the
// ticks that come from the note rebuild themselves now that the note persists (item 2). What is NOT
// derivable is the clinician's own decisions — ticking an item the derivation did not catch, and
// dismissing a suggestion as not applicable to this visit. Those lived in a ref inside the browser
// provider, so a refresh silently discarded them and the same suggestion came back at the next
// encounter too, where it may not even apply.
//
// encounter_id is the key rather than the patient: a dismissal is about this visit, not about the
// patient forever. (app.document_draft lacks that column and is noted separately — there, "the
// encounter's note" still means "the newest note for the patient".)
//
// `state` is a small closed set, and deleting the row is the way to clear a decision — a row means the
// clinician decided something, so an absence is meaningful and should not be encoded as a third value.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.encounter_checklist (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id     uuid NOT NULL,
      encounter_id   uuid NOT NULL,
      item_id        text NOT NULL,
      state          text NOT NULL CHECK (state IN ('done', 'dismissed')),
      updated_by     uuid NOT NULL,
      updated_at     timestamptz NOT NULL DEFAULT now(),
      UNIQUE (encounter_id, item_id)
    )
  `);
  pgm.sql(`CREATE INDEX IF NOT EXISTS encounter_checklist_patient_idx ON app.encounter_checklist (patient_id)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS app.encounter_checklist_patient_idx`);
  pgm.sql(`DROP TABLE IF EXISTS app.encounter_checklist`);
}
