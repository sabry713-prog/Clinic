import type { MigrationBuilder } from "node-pg-migrate";

// Hospital system HIS transactional connector (dummy/stub — see
// docs/architecture/his-connector-hospital-sys.md for the assumed interface
// profile, which is UNCONFIRMED with any real hospital's actual IT team).
// Tracks transmission attempts for confirmed orders (app.service_request) and
// refill requests (app.refill_request) toward the hospital's HIS. No FK to
// either source table directly — the source is polymorphic; integrity is
// enforced in HospitalSysConnectorService, same reasoning app.refill_request
// used for its medication_request_id reference.
//
// Cortex.ai performs no interaction/allergy/dose checking anywhere in this
// flow (CLAUDE.md §2) — the receiving HIS is the sole validator. Rejection
// reasons are stored and displayed verbatim, never interpreted or rephrased.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.his_order_transmission (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id            uuid NOT NULL REFERENCES hospital.patient(id),
      source_type           text NOT NULL,
      source_id             uuid NOT NULL,
      idempotency_key       text NOT NULL UNIQUE,
      message_type          text NOT NULL DEFAULT 'ORM_O01',
      status                text NOT NULL DEFAULT 'pending',
      backend_reason_code   text,
      backend_reason_text   text,
      mode                  text NOT NULL,
      transmitted_by        uuid NOT NULL REFERENCES app."user"(id),
      transmitted_at        timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.his_order_transmission (patient_id)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.his_order_transmission`);
}
