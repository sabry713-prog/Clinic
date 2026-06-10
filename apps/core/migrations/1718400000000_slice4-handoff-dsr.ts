import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  // handoff_output table
  pgm.sql(`
    CREATE TABLE app.handoff_output (
      id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id              uuid NOT NULL,
      ward_id                 text,
      generated_by_user_id    uuid REFERENCES app."user"(id),
      scope                   text NOT NULL,
      language                text NOT NULL,
      text                    text,
      sections_json           jsonb NOT NULL DEFAULT '{}',
      provenance_json         jsonb NOT NULL DEFAULT '[]',
      blocklist_retries       integer NOT NULL DEFAULT 0,
      disclaimer              text,
      created_at              timestamptz NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`CREATE INDEX ON app.handoff_output (patient_id, created_at DESC)`);
  pgm.sql(`CREATE INDEX ON app.handoff_output (ward_id, created_at DESC)`);

  // dsr_request table
  pgm.sql(`
    CREATE TABLE app.dsr_request (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      subject_id_hash    text NOT NULL,
      type               text NOT NULL CHECK (type IN ('access', 'erase')),
      status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
      reason             text NOT NULL,
      requested_by_ip    text,
      due_at             timestamptz,
      completed_at       timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`CREATE INDEX ON app.dsr_request (subject_id_hash)`);
  pgm.sql(`CREATE INDEX ON app.dsr_request (status, due_at)`);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`DROP TABLE IF EXISTS app.dsr_request`);
  pgm.sql(`DROP TABLE IF EXISTS app.handoff_output`);
}
