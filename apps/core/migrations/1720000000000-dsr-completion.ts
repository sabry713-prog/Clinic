import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * M07 (readiness assessment): DSR service expects columns absent from
 * the initial schema — completed_at and result_note on dsr_request,
 * plus an index for pending-request processing.
 */
export class DsrCompletion1720000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE app.dsr_request
        ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS result_note TEXT
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS dsr_request_type_status_idx
      ON app.dsr_request (type, status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS app.dsr_request_type_status_idx`);
    await queryRunner.query(`
      ALTER TABLE app.dsr_request
        DROP COLUMN IF EXISTS completed_at,
        DROP COLUMN IF EXISTS result_note
    `);
  }
}
