import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Indexing run tracking
  pgm.sql(`
    CREATE TABLE app.indexing_run (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id     uuid NOT NULL,
      started_at     timestamptz NOT NULL DEFAULT now(),
      completed_at   timestamptz,
      chunks_upserted integer,
      status         text NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running','completed','failed')),
      error_text     text,
      created_at     timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.indexing_run (patient_id, started_at DESC)`);

  // Add updated_at to retrieval_chunk for cache invalidation
  pgm.sql(`
    ALTER TABLE hospital.retrieval_chunk
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
  `);

  // Add unique constraint to support ON CONFLICT upserts in indexer.py
  pgm.sql(`
    ALTER TABLE hospital.retrieval_chunk
    ADD CONSTRAINT retrieval_chunk_unique_key
      UNIQUE (patient_id, source_type, source_id, chunk_index, language)
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.indexing_run`);
  pgm.sql(`
    ALTER TABLE hospital.retrieval_chunk
    DROP CONSTRAINT IF EXISTS retrieval_chunk_unique_key
  `);
  pgm.sql(`
    ALTER TABLE hospital.retrieval_chunk
    DROP COLUMN IF EXISTS updated_at
  `);
}
