import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Extensions
  pgm.createExtension("vector", { ifNotExists: true });
  pgm.createExtension("uuid-ossp", { ifNotExists: true });

  // Schemas
  pgm.sql('CREATE SCHEMA IF NOT EXISTS app');
  pgm.sql('CREATE SCHEMA IF NOT EXISTS hospital');
  pgm.sql('CREATE SCHEMA IF NOT EXISTS audit');

  // ─── app schema ──────────────────────────────────────────────────────────────

  pgm.sql(`
    CREATE TABLE app.tenant (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL,
      region      text NOT NULL DEFAULT 'sa',
      config_json jsonb NOT NULL DEFAULT '{}',
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE TABLE app."user" (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id          uuid NOT NULL REFERENCES app.tenant(id),
      external_subject   text NOT NULL,
      email              text,
      display_name       text NOT NULL,
      preferred_language text NOT NULL DEFAULT 'ar',
      disabled_at        timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, external_subject)
    )
  `);

  pgm.sql(`
    CREATE TABLE app.user_role (
      user_id uuid NOT NULL REFERENCES app."user"(id) ON DELETE CASCADE,
      role    text NOT NULL CHECK (role IN ('physician','pharmacist','nurse','hospital_admin','sysadmin')),
      PRIMARY KEY (user_id, role)
    )
  `);

  pgm.sql(`
    CREATE TABLE app.patient_scope (
      user_id    uuid NOT NULL REFERENCES app."user"(id) ON DELETE CASCADE,
      patient_id uuid NOT NULL,
      source     text NOT NULL,
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (user_id, patient_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON app.patient_scope (user_id, expires_at)`);

  pgm.sql(`
    CREATE TABLE app.qa_conversation (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid NOT NULL REFERENCES app."user"(id),
      patient_id uuid NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),
      ended_at   timestamptz
    )
  `);

  pgm.sql(`
    CREATE TABLE app.qa_interaction (
      id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id         uuid REFERENCES app.qa_conversation(id),
      user_id                 uuid NOT NULL REFERENCES app."user"(id),
      patient_id              uuid NOT NULL,
      question_text           text NOT NULL,
      question_language       text NOT NULL,
      classification          text NOT NULL CHECK (classification IN ('ALLOWED','REFUSED')),
      classifier_confidence   numeric(5,4) NOT NULL,
      refusal_category        text,
      rule_matches            text[],
      answer_text             text,
      sources_json            jsonb NOT NULL DEFAULT '[]',
      model_version           text,
      prompt_template_version text,
      latency_ms              integer NOT NULL,
      blocklist_retries       integer NOT NULL DEFAULT 0,
      created_at              timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.qa_interaction (patient_id, created_at DESC)`);
  pgm.sql(`CREATE INDEX ON app.qa_interaction (user_id, created_at DESC)`);
  pgm.sql(`CREATE INDEX ON app.qa_interaction (classification, refusal_category)`);

  pgm.sql(`
    CREATE TABLE app.narrative_output (
      id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id              uuid NOT NULL,
      generated_by_user_id    uuid REFERENCES app."user"(id),
      scope                   text NOT NULL,
      language                text NOT NULL,
      text                    text,
      fallback                boolean NOT NULL DEFAULT false,
      provenance_json         jsonb NOT NULL DEFAULT '[]',
      model_version           text,
      prompt_template_version text,
      blocklist_retries       integer NOT NULL DEFAULT 0,
      created_at              timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.narrative_output (patient_id, created_at DESC)`);

  pgm.sql(`
    CREATE TABLE app.identity_quarantine (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      candidate_a_id uuid NOT NULL,
      candidate_b_id uuid NOT NULL,
      confidence     numeric(5,4) NOT NULL,
      features_json  jsonb NOT NULL,
      status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','merged','kept_separate','duplicate')),
      resolved_by    uuid REFERENCES app."user"(id),
      resolved_at    timestamptz,
      reason         text,
      created_at     timestamptz NOT NULL DEFAULT now()
    )
  `);

  pgm.sql(`
    CREATE TABLE app.dsr_request (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type         text NOT NULL CHECK (type IN ('access','erase','rectify')),
      subject_id   text NOT NULL,
      requested_at timestamptz NOT NULL DEFAULT now(),
      status       text NOT NULL DEFAULT 'received',
      due_at       timestamptz NOT NULL,
      fulfilled_at timestamptz,
      notes        text
    )
  `);

  // ─── hospital schema ──────────────────────────────────────────────────────────

  pgm.sql(`
    CREATE TABLE hospital.patient (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_system      text NOT NULL,
      source_id          text NOT NULL,
      mrn                text,
      national_id_hash   text,
      display_name       text,
      family_name        text,
      given_name         text,
      date_of_birth      date,
      sex                text,
      preferred_language text,
      weight_kg          numeric,
      height_cm          numeric,
      fhir_resource_json jsonb NOT NULL,
      last_synced_at     timestamptz NOT NULL,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      UNIQUE (source_system, source_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.patient (national_id_hash)`);
  pgm.sql(`CREATE INDEX ON hospital.patient (mrn)`);

  pgm.sql(`
    CREATE TABLE hospital.encounter (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         uuid NOT NULL REFERENCES hospital.patient(id),
      source_system      text NOT NULL,
      source_id          text NOT NULL,
      encounter_type     text,
      status             text,
      started_at         timestamptz,
      ended_at           timestamptz,
      ward               text,
      bed                text,
      attending_user_id  uuid,
      fhir_resource_json jsonb NOT NULL,
      last_synced_at     timestamptz NOT NULL,
      UNIQUE (source_system, source_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.encounter (patient_id, started_at DESC)`);
  pgm.sql(`CREATE INDEX ON hospital.encounter (ward, status) WHERE status = 'in-progress'`);

  pgm.sql(`
    CREATE TABLE hospital.observation (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         uuid NOT NULL REFERENCES hospital.patient(id),
      encounter_id       uuid REFERENCES hospital.encounter(id),
      source_system      text NOT NULL,
      source_id          text NOT NULL,
      category           text,
      code_system        text,
      code               text,
      code_display       text,
      value_numeric      numeric,
      value_text         text,
      unit               text,
      ref_range_low      numeric,
      ref_range_high     numeric,
      ref_range_text     text,
      status             text,
      effective_at       timestamptz,
      fhir_resource_json jsonb NOT NULL,
      last_synced_at     timestamptz NOT NULL,
      UNIQUE (source_system, source_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.observation (patient_id, effective_at DESC)`);
  pgm.sql(`CREATE INDEX ON hospital.observation (patient_id, code, effective_at DESC)`);
  pgm.sql(`CREATE INDEX ON hospital.observation (patient_id, category, effective_at DESC)`);

  pgm.sql(`
    CREATE TABLE hospital.allergy_intolerance (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         uuid NOT NULL REFERENCES hospital.patient(id),
      source_system      text NOT NULL,
      source_id          text NOT NULL,
      code_system        text,
      code               text,
      code_display       text,
      reaction           text,
      severity           text,
      recorded_at        date,
      fhir_resource_json jsonb NOT NULL,
      last_synced_at     timestamptz NOT NULL,
      UNIQUE (source_system, source_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.allergy_intolerance (patient_id)`);

  pgm.sql(`
    CREATE TABLE hospital.condition (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         uuid NOT NULL REFERENCES hospital.patient(id),
      source_system      text NOT NULL,
      source_id          text NOT NULL,
      code_system        text,
      code               text,
      code_display       text,
      status             text,
      onset_date         date,
      fhir_resource_json jsonb NOT NULL,
      last_synced_at     timestamptz NOT NULL,
      UNIQUE (source_system, source_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.condition (patient_id, status)`);

  pgm.sql(`
    CREATE TABLE hospital.medication_request (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         uuid NOT NULL REFERENCES hospital.patient(id),
      encounter_id       uuid REFERENCES hospital.encounter(id),
      source_system      text NOT NULL,
      source_id          text NOT NULL,
      medication_display text,
      code_system        text,
      code               text,
      dose               text,
      route              text,
      frequency          text,
      status             text,
      prescriber_display text,
      started_at         timestamptz,
      ended_at           timestamptz,
      fhir_resource_json jsonb NOT NULL,
      last_synced_at     timestamptz NOT NULL,
      UNIQUE (source_system, source_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.medication_request (patient_id, status)`);

  pgm.sql(`
    CREATE TABLE hospital.document_reference (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         uuid NOT NULL REFERENCES hospital.patient(id),
      encounter_id       uuid REFERENCES hospital.encounter(id),
      source_system      text NOT NULL,
      source_id          text NOT NULL,
      type               text,
      authored_at        timestamptz,
      author_display     text,
      content_url        text,
      content_text       text,
      fhir_resource_json jsonb NOT NULL,
      last_synced_at     timestamptz NOT NULL,
      UNIQUE (source_system, source_id)
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.document_reference (patient_id, authored_at DESC)`);

  pgm.sql(`
    CREATE TABLE hospital.retrieval_chunk (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id   uuid NOT NULL REFERENCES hospital.patient(id),
      source_type  text NOT NULL,
      source_id    uuid NOT NULL,
      content_text text NOT NULL,
      content_lang text NOT NULL,
      embedding    vector(1024),
      created_at   timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON hospital.retrieval_chunk (patient_id)`);
  pgm.sql(`CREATE INDEX ON hospital.retrieval_chunk USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`);
  pgm.sql(`CREATE INDEX ON hospital.retrieval_chunk USING gin (to_tsvector('simple', content_text))`);

  // ─── audit schema ─────────────────────────────────────────────────────────────

  pgm.sql(`
    CREATE TABLE audit.event (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ts            timestamptz NOT NULL DEFAULT now(),
      actor_id      uuid,
      actor_role    text,
      action        text NOT NULL,
      target_type   text,
      target_id     uuid,
      outcome       text NOT NULL,
      metadata_json jsonb NOT NULL DEFAULT '{}',
      request_id    text,
      hash_prev     text,
      hash_self     text NOT NULL
    )
  `);

  pgm.sql(`CREATE INDEX ON audit.event (ts DESC)`);
  pgm.sql(`CREATE INDEX ON audit.event (actor_id, ts DESC)`);
  pgm.sql(`CREATE INDEX ON audit.event (target_type, target_id, ts DESC)`);
  pgm.sql(`CREATE INDEX ON audit.event (action, ts DESC)`);

  // Immutability trigger
  pgm.sql(`
    CREATE OR REPLACE FUNCTION audit.prevent_modification() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit.event rows are immutable';
    END;
    $$ LANGUAGE plpgsql
  `);

  pgm.sql(`
    CREATE TRIGGER audit_event_no_update
      BEFORE UPDATE OR DELETE ON audit.event
      FOR EACH ROW EXECUTE FUNCTION audit.prevent_modification()
  `);

  // ─── Row-level security ───────────────────────────────────────────────────────

  pgm.sql(`ALTER TABLE hospital.patient ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY patient_scope_select ON hospital.patient
      FOR SELECT
      USING (
        id IN (
          SELECT patient_id FROM app.patient_scope
          WHERE user_id = current_setting('app.current_user_id', true)::uuid
            AND expires_at > now()
        )
      )
  `);

  // Apply RLS to all patient-data tables
  const patientDataTables = [
    "hospital.encounter",
    "hospital.observation",
    "hospital.condition",
    "hospital.medication_request",
    "hospital.allergy_intolerance",
    "hospital.document_reference",
    "hospital.retrieval_chunk",
  ];

  for (const table of patientDataTables) {
    pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    const policyName = `${table.replace(".", "_")}_scope_select`;
    pgm.sql(`
      CREATE POLICY ${policyName} ON ${table}
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

  // ─── Seed: dev tenant ─────────────────────────────────────────────────────────

  pgm.sql(`
    INSERT INTO app.tenant (id, name, region)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Dev Hospital', 'sa')
    ON CONFLICT DO NOTHING
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP SCHEMA IF EXISTS audit CASCADE`);
  pgm.sql(`DROP SCHEMA IF EXISTS hospital CASCADE`);
  pgm.sql(`DROP SCHEMA IF EXISTS app CASCADE`);
}
