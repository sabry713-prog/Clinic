import type { MigrationBuilder } from "node-pg-migrate";

// Documented indication for a medication order: the condition the prescriber
// recorded the medication as being for. Nullable — only reproduced where the
// source documents it; never inferred. Mirrors FHIR MedicationRequest.reasonCode.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE hospital.medication_request
    ADD COLUMN IF NOT EXISTS indication_code text,
    ADD COLUMN IF NOT EXISTS indication_display text
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE hospital.medication_request
    DROP COLUMN IF EXISTS indication_code,
    DROP COLUMN IF EXISTS indication_display
  `);
}
