import type { MigrationBuilder } from "node-pg-migrate";

// M07 (readiness assessment): the DSR service could not run at all. Checked
// against the live database, four things it depends on were missing, so every
// request threw before it ever reached the anonymizer:
//
//   * app.dsr_request had no `subject_id_hash` column. The service stores the
//     SHA-256 of the external subject id and resolves the patient by hashing
//     their identifiers -- the raw subject id is deliberately never kept.
//   * it had no `reason` column, which both INSERTs write.
//   * `digest()` did not exist: pgcrypto was never enabled.
//   * completed_at / result_note were absent (added by 1720300000000).
//
// The three vestigial columns this supersedes (subject_id, fulfilled_at, notes)
// are written and read by nothing. Two columns for one concept is how the drift
// started, and an unused raw-identifier column is a standing invitation to
// store the identifier the design exists to avoid. The table is empty (0 rows),
// so dropping them loses nothing.
export async function up(pgm: MigrationBuilder): Promise<void> {
  // The erasure path resolves the patient with digest(..., 'sha256').
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  pgm.sql(`
    ALTER TABLE app.dsr_request
      ADD COLUMN IF NOT EXISTS subject_id_hash TEXT,
      ADD COLUMN IF NOT EXISTS reason TEXT
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS dsr_request_subject_hash_idx
    ON app.dsr_request (subject_id_hash)
  `);

  pgm.sql(`DROP INDEX IF EXISTS app.dsr_request_subject_idx`);

  pgm.sql(`
    ALTER TABLE app.dsr_request
      DROP COLUMN IF EXISTS subject_id,
      DROP COLUMN IF EXISTS fulfilled_at,
      DROP COLUMN IF EXISTS notes
  `);

  // A data-subject request is always filed against a subject; now that the
  // column exists, say so in the schema instead of trusting every caller.
  pgm.sql(`ALTER TABLE app.dsr_request ALTER COLUMN subject_id_hash SET NOT NULL`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE app.dsr_request
      ADD COLUMN IF NOT EXISTS subject_id TEXT,
      ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS notes TEXT
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS dsr_request_subject_idx ON app.dsr_request (subject_id)`);
  pgm.sql(`
    ALTER TABLE app.dsr_request
      DROP COLUMN IF EXISTS subject_id_hash,
      DROP COLUMN IF EXISTS reason
  `);
  pgm.sql(`DROP INDEX IF EXISTS app.dsr_request_subject_hash_idx`);
}
