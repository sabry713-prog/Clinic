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

  // dsr_request was already created in initial-schema migration — add missing indexes only
  pgm.sql(`CREATE INDEX IF NOT EXISTS dsr_request_subject_idx ON app.dsr_request (subject_id)`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS dsr_request_status_idx ON app.dsr_request (status, due_at)`);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`DROP TABLE IF EXISTS app.dsr_request`);
  pgm.sql(`DROP TABLE IF EXISTS app.handoff_output`);
}
