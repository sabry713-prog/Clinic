import type { MigrationBuilder } from "node-pg-migrate";

// NPHIES diagnosis linkage — each claim item (order) must reference a
// supporting diagnosis. This table CAPTURES the clinician's own
// association between an order they confirmed and a condition they
// documented. There are deliberately no system suggestions for linkage:
// deciding which diagnosis supports which order is clinical reasoning,
// which this product never performs (CLAUDE.md §2). The system only
// records the clinician's explicit choice.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.service_request_diagnosis_link (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      service_request_id  uuid NOT NULL REFERENCES app.service_request(id) ON DELETE CASCADE,
      condition_id        uuid NOT NULL REFERENCES hospital.condition(id) ON DELETE CASCADE,
      patient_id          uuid NOT NULL,
      linked_by           uuid NOT NULL REFERENCES app."user"(id),
      linked_at           timestamptz NOT NULL DEFAULT now(),
      UNIQUE (service_request_id, condition_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON app.service_request_diagnosis_link (patient_id)`);
  pgm.sql(`CREATE INDEX ON app.service_request_diagnosis_link (service_request_id)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.service_request_diagnosis_link`);
}
