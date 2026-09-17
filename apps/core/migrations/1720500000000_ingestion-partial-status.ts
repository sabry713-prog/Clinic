import type { MigrationBuilder } from "node-pg-migrate";

// M05 (readiness assessment): add 'partial' to the ingestion_run status CHECK so
// a run with resource-fetch failures is distinguishable from a clean
// completion, instead of being reported as "completed".
//
// Converted from a TypeORM-style migration that this repo's runner cannot
// execute (node-pg-migrate expects `pgm.sql` in `up`/`down` exports). SQL
// unchanged; filename convention and timestamp uniqueness fixed.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE app.ingestion_run
      DROP CONSTRAINT IF EXISTS ingestion_run_status_check
  `);
  pgm.sql(`
    ALTER TABLE app.ingestion_run
      ADD CONSTRAINT ingestion_run_status_check
      CHECK (status IN ('running', 'completed', 'partial', 'failed'))
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE app.ingestion_run
      DROP CONSTRAINT IF EXISTS ingestion_run_status_check
  `);
  pgm.sql(`
    ALTER TABLE app.ingestion_run
      ADD CONSTRAINT ingestion_run_status_check
      CHECK (status IN ('running', 'completed', 'failed'))
  `);
}
