import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // ingestion_run tracks each scheduled or manual ingestion job
  pgm.sql(`
    CREATE TABLE app.ingestion_run (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      started_at         timestamptz NOT NULL DEFAULT now(),
      completed_at       timestamptz,
      source_system      text NOT NULL,
      patients_processed integer NOT NULL DEFAULT 0,
      resources_upserted integer NOT NULL DEFAULT 0,
      quarantine_created integer NOT NULL DEFAULT 0,
      errors_json        jsonb NOT NULL DEFAULT '[]',
      status             text NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running','completed','failed')),
      created_at         timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.ingestion_run (started_at DESC)`);
  pgm.sql(`CREATE INDEX ON app.ingestion_run (status, started_at DESC)`);

  // GIN index on display_name for fast text search in patient list
  pgm.sql(
    `CREATE INDEX hospital_patient_display_name_gin
     ON hospital.patient
     USING gin (to_tsvector('simple', coalesce(display_name, '')))`,
  );

  // Additional index for case-insensitive prefix search (used by ILIKE queries)
  pgm.sql(
    `CREATE INDEX hospital_patient_display_name_lower
     ON hospital.patient (lower(display_name) text_pattern_ops)`,
  );

  // Index for MRN fast lookup
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS hospital_patient_mrn_idx
     ON hospital.patient (mrn)`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.ingestion_run`);
  pgm.sql(`DROP INDEX IF EXISTS hospital_patient_display_name_gin`);
  pgm.sql(`DROP INDEX IF EXISTS hospital_patient_display_name_lower`);
}
