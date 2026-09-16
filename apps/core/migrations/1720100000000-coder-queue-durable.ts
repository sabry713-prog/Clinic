import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * M09 (readiness assessment): durable coder-queue workflow state.
 * The queue was in-memory — restart lost all claim/resolve state.
 * This table persists it with the same stable identity scheme
 * (patient + order + reason) so re-syncs map onto the same rows.
 */
export class CoderQueueDurable1720100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app.coder_queue_item (
        item_id TEXT PRIMARY KEY,
        patient_id UUID NOT NULL,
        mrn TEXT,
        order_id TEXT,
        icd10_code TEXT,
        sbs_code TEXT,
        reason TEXT NOT NULL,
        detail TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'in_review', 'resolved')),
        claimed_by UUID,
        resolved_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS coder_queue_item_status_idx
      ON app.coder_queue_item (status, updated_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS coder_queue_item_patient_idx
      ON app.coder_queue_item (patient_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS app.coder_queue_item`);
  }
}
