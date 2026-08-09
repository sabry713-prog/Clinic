import type { MigrationBuilder } from "node-pg-migrate";

// Pharmacy operational tasks — refill request workflow (gray-area per the
// competitive assessment: "Administrative only (refill workflows,
// reconciliation). Any interaction/dose checking crosses into SaMD.").
//
// This table tracks REQUEST STATUS ONLY. It never stores a changed dose,
// route, or frequency — refilling always re-confirms the existing
// hospital.medication_request row verbatim. Status values are purely
// administrative (requested -> routed -> filled | denied, or requested ->
// cancelled); nothing here is ordered or gated by clinical severity.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.refill_request (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id            uuid NOT NULL REFERENCES hospital.patient(id),
      medication_request_id uuid NOT NULL REFERENCES hospital.medication_request(id),
      medication_display    text NOT NULL,
      status                text NOT NULL DEFAULT 'requested',
      requested_by          uuid NOT NULL REFERENCES app."user"(id),
      requested_at          timestamptz NOT NULL DEFAULT now(),
      pharmacy_note         text,
      updated_by            uuid REFERENCES app."user"(id),
      updated_at            timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.refill_request (patient_id, status)`);
  pgm.sql(`
    CREATE INDEX ON app.refill_request (status)
    WHERE status IN ('requested', 'routed')
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.refill_request`);
}
