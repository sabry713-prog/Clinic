import type { MigrationBuilder } from "node-pg-migrate";

// NPHIES connector persistence — eligibility checks and submitted claims.
//
// Both tables record CONNECTOR TRANSACTIONS (administrative/billing), not
// clinical content. `mode` records whether the row came from the stub
// connector (dev) or the live NPHIES endpoint, so stub data can never be
// mistaken for a real payer response.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.nphies_eligibility_check (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id     uuid NOT NULL,
      status         text NOT NULL,              -- eligible | not_eligible | error
      response_json  jsonb NOT NULL DEFAULT '{}',
      mode           text NOT NULL,              -- stub | live
      checked_by     uuid NOT NULL REFERENCES app."user"(id),
      checked_at     timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.nphies_eligibility_check (patient_id, checked_at DESC)`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.nphies_claim (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id       uuid NOT NULL,
      bundle_json      jsonb NOT NULL,
      status           text NOT NULL DEFAULT 'submitted',  -- submitted | accepted | rejected | error
      rejection_codes  text[] NOT NULL DEFAULT '{}',
      response_json    jsonb NOT NULL DEFAULT '{}',
      mode             text NOT NULL,                      -- stub | live
      submitted_by     uuid NOT NULL REFERENCES app."user"(id),
      submitted_at     timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.nphies_claim (patient_id, submitted_at DESC)`);
  pgm.sql(`CREATE INDEX ON app.nphies_claim (status, submitted_at DESC)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.nphies_claim`);
  pgm.sql(`DROP TABLE IF EXISTS app.nphies_eligibility_check`);
}
