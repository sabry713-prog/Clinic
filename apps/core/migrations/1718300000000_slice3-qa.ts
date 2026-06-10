import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  // qa_conversation and qa_interaction already exist from initial migration (1718000000000_initial-schema.ts)
  // Only add the rate_limit table for Slice 3

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.rate_limit (
      user_id      uuid NOT NULL REFERENCES app."user"(id),
      endpoint     text NOT NULL,
      window_start timestamptz NOT NULL,
      count        integer NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, endpoint, window_start)
    )
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS rate_limit_user_endpoint_window_idx
      ON app.rate_limit (user_id, endpoint, window_start)
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`DROP INDEX IF EXISTS app.rate_limit_user_endpoint_window_idx`);
  pgm.sql(`DROP TABLE IF EXISTS app.rate_limit`);
}
