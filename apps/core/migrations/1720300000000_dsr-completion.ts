import type { MigrationBuilder } from "node-pg-migrate";

// M07 (readiness assessment): the DSR service expects columns absent from the
// initial schema — completed_at and result_note on dsr_request, plus an index
// for pending-request processing.
//
// Converted from a TypeORM-style migration (`MigrationInterface`/`QueryRunner`)
// that this repo's runner cannot execute: `migrate:dev` uses node-pg-migrate,
// which loads raw SQL via `pgm.sql` and requires `up`/`down` function exports.
// The SQL is unchanged; only the wrapper and the filename convention (`_`
// after the timestamp) were fixed, and the timestamp was made unique —
// 1720000000000 was already taken by localization-gender-prefs.
//
// KNOWN REMAINING GAP (tracked in docs/reports/HANDOVER_VERIFICATION_AUDIT.md
// §B8): dsr.service.ts also queries `subject_id_hash`, which this migration
// does not add, so DSR erasure is still not end-to-end functional.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE app.dsr_request
      ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS result_note TEXT
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS dsr_request_type_status_idx
    ON app.dsr_request (type, status)
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS app.dsr_request_type_status_idx`);
  pgm.sql(`
    ALTER TABLE app.dsr_request
      DROP COLUMN IF EXISTS completed_at,
      DROP COLUMN IF EXISTS result_note
  `);
}
