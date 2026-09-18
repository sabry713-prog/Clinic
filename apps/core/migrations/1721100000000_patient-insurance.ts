import type { MigrationBuilder } from "node-pg-migrate";

// Patient insurance cover — the payer, the plan (the "grid" the reception desk asks about), and
// the membership that identifies the beneficiary to that payer.
//
// Why a table and not columns on app.patient: cover changes over time and a patient can hold
// more than one policy (primary + supplementary). What a claim is checked against is the cover
// in force on the encounter date, so the rows are date-ranged rather than a single current value.
//
// `source` distinguishes coverage loaded from a payer/eligibility feed from cover entered by
// staff in dev. It is the same discipline as the eligibility table's `mode`, so synthetic cover
// can never be mistaken for a payer's answer.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.patient_insurance (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id     uuid NOT NULL,
      payer_name     text NOT NULL,
      payer_id       text,                        -- NPHIES payer identifier when known
      policy_number  text NOT NULL,
      member_id      text NOT NULL,
      plan_name      text,                        -- the "grid": e.g. Bupa Gold, Tawuniya Blue
      network_tier   text,                        -- in-network tier, when the payer publishes one
      class          text,                        -- e.g. VIP | A | B -- class of cover
      effective_from date NOT NULL DEFAULT DATE '1900-01-01',
      effective_to   date,
      source         text NOT NULL DEFAULT 'staff-entry',   -- staff-entry | payer-feed | synthetic
      created_at     timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.patient_insurance (patient_id, effective_from DESC)`);
  pgm.sql(`CREATE UNIQUE INDEX ON app.patient_insurance (payer_name, policy_number, member_id)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.patient_insurance`);
}
