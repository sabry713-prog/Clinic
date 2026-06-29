import type { MigrationBuilder } from "node-pg-migrate";

// hospital.procedure — documented procedures and interventions (operations,
// cardiac catheterization, stent placement, endoscopy, etc.). Factual record
// of what was performed; mirrors the FHIR Procedure resource.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS hospital.procedure (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         uuid NOT NULL,
      encounter_id       uuid,
      source_system      text NOT NULL,
      source_id          text NOT NULL,
      code_system        text,
      code               text,
      code_display       text,
      status             text,
      performed_at       timestamptz,
      performer_display  text,
      note               text,
      fhir_resource_json jsonb NOT NULL DEFAULT '{}',
      last_synced_at     timestamptz NOT NULL DEFAULT now(),
      created_at         timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_system, source_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.procedure (patient_id, performed_at DESC)`);

  // Row-level security mirroring the other hospital tables.
  pgm.sql(`ALTER TABLE hospital.procedure ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY hospital_procedure_scope_select ON hospital.procedure
      FOR SELECT
      USING (
        patient_id IN (
          SELECT patient_id FROM app.patient_scope
          WHERE user_id = current_setting('app.current_user_id', true)::uuid
            AND expires_at > now()
        )
      )
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS hospital.procedure`);
}
