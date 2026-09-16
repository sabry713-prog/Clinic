import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * M05 (readiness assessment): add 'partial' to the ingestion_run status
 * CHECK so a run with resource-fetch failures is distinguishable from a
 * clean completion.
 */
export class IngestionPartialStatus1720200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE app.ingestion_run
        DROP CONSTRAINT IF EXISTS ingestion_run_status_check
    `);
    await queryRunner.query(`
      ALTER TABLE app.ingestion_run
        ADD CONSTRAINT ingestion_run_status_check
        CHECK (status IN ('running', 'completed', 'partial', 'failed'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE app.ingestion_run
        DROP CONSTRAINT IF EXISTS ingestion_run_status_check
    `);
    await queryRunner.query(`
      ALTER TABLE app.ingestion_run
        ADD CONSTRAINT ingestion_run_status_check
        CHECK (status IN ('running', 'completed', 'failed'))
    `);
  }
}
