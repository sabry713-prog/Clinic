import type { MigrationBuilder } from "node-pg-migrate";

/**
 * M05 — keep the attending clinician the source system sent.
 *
 * `mapEncounter` has been extracting `attending_fhir_ref` (the FHIR reference of
 * the practitioner recorded on the encounter, e.g. `Practitioner/1234`) since the
 * mapper was written, and the upsert has been dropping it, because the column did
 * not exist. The raw payload survives in `fhir_resource_json`, so the data was
 * recoverable but not queryable -- "who saw this patient" had no answer from the
 * record, and the graph's encounter provider came out null for everything
 * ingested (5 of 6,220 encounters carry an attending_user_id).
 *
 * Text, not a foreign key: the reference points into the source system's
 * practitioner space, and most of those practitioners have no local account. A
 * FK would reject the honest case of a clinician who exists upstream only.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE hospital.encounter
      ADD COLUMN IF NOT EXISTS attending_fhir_ref text
  `);
  pgm.sql(`
    COMMENT ON COLUMN hospital.encounter.attending_fhir_ref IS
      'Source-system reference of the attending practitioner (from the FHIR payload). Text on purpose: it points at the upstream practitioner space, not at app."user".'
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE hospital.encounter DROP COLUMN IF EXISTS attending_fhir_ref`);
}
