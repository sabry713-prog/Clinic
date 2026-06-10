# 01 — Database Schema (PostgreSQL 16+)

## Conventions

- Snake_case table and column names
- All IDs are UUID v7 (time-ordered, sortable)
- All timestamps are `timestamptz`
- Soft delete via `deleted_at` column where applicable
- Every table has `created_at`, `updated_at`
- Row-level security (RLS) enforced on patient-data tables
- `pgvector` extension for embeddings
- JSONB for FHIR resource bodies (we retain full FHIR JSON alongside flattened columns)

## Schemas

```sql
CREATE SCHEMA app;        -- application tables
CREATE SCHEMA hospital;   -- ingested hospital data (FHIR mirror)
CREATE SCHEMA audit;      -- audit log
```

## app schema

### app.tenant
```sql
CREATE TABLE app.tenant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  region          text NOT NULL DEFAULT 'sa',
  config_json     jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

In MVP, one row. Future multi-tenant deployments add rows.

### app.user
```sql
CREATE TABLE app.user (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES app.tenant(id),
  external_subject         text NOT NULL,    -- OIDC sub
  email                    text,
  display_name             text NOT NULL,
  preferred_language       text NOT NULL DEFAULT 'ar',
  disabled_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_subject)
);

CREATE TABLE app.user_role (
  user_id  uuid NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  role     text NOT NULL CHECK (role IN ('physician','pharmacist','nurse','hospital_admin','sysadmin')),
  PRIMARY KEY (user_id, role)
);
```

### app.patient_scope (cached resolved scope per user)
```sql
CREATE TABLE app.patient_scope (
  user_id    uuid NOT NULL REFERENCES app.user(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL,                       -- references hospital.patient(id)
  source     text NOT NULL,                       -- 'care_team' | 'ward' | 'break_glass'
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, patient_id)
);

CREATE INDEX ON app.patient_scope (user_id, expires_at);
```

### app.qa_conversation
```sql
CREATE TABLE app.qa_conversation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app.user(id),
  patient_id  uuid NOT NULL,                       -- hospital.patient(id)
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
```

### app.qa_interaction
```sql
CREATE TABLE app.qa_interaction (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id         uuid REFERENCES app.qa_conversation(id),
  user_id                 uuid NOT NULL REFERENCES app.user(id),
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
);

CREATE INDEX ON app.qa_interaction (patient_id, created_at DESC);
CREATE INDEX ON app.qa_interaction (user_id, created_at DESC);
CREATE INDEX ON app.qa_interaction (classification, refusal_category);
```

### app.narrative_output
```sql
CREATE TABLE app.narrative_output (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id              uuid NOT NULL,
  generated_by_user_id    uuid REFERENCES app.user(id),
  scope                   text NOT NULL,
  language                text NOT NULL,
  text                    text,
  fallback                boolean NOT NULL DEFAULT false,
  provenance_json         jsonb NOT NULL DEFAULT '[]',
  model_version           text,
  prompt_template_version text,
  blocklist_retries       integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON app.narrative_output (patient_id, created_at DESC);
```

### app.identity_quarantine
```sql
CREATE TABLE app.identity_quarantine (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_a_id  uuid NOT NULL,    -- proposed match A
  candidate_b_id  uuid NOT NULL,    -- proposed match B
  confidence      numeric(5,4) NOT NULL,
  features_json   jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','merged','kept_separate','duplicate')),
  resolved_by     uuid REFERENCES app.user(id),
  resolved_at     timestamptz,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### app.dsr_request (Data Subject Request)
```sql
CREATE TABLE app.dsr_request (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL CHECK (type IN ('access','erase','rectify')),
  subject_id      text NOT NULL,       -- National ID hash
  requested_at    timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'received',
  due_at          timestamptz NOT NULL,
  fulfilled_at    timestamptz,
  notes           text
);
```

## hospital schema (FHIR mirror)

```sql
CREATE TABLE hospital.patient (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system       text NOT NULL,
  source_id           text NOT NULL,
  mrn                 text,
  national_id_hash    text,            -- SHA-256 of national ID; raw never stored
  display_name        text,
  family_name         text,
  given_name          text,
  date_of_birth       date,
  sex                 text,
  preferred_language  text,
  weight_kg           numeric,
  height_cm           numeric,
  fhir_resource_json  jsonb NOT NULL,
  last_synced_at      timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_id)
);

CREATE INDEX ON hospital.patient (national_id_hash);
CREATE INDEX ON hospital.patient (mrn);
```

```sql
CREATE TABLE hospital.encounter (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES hospital.patient(id),
  source_system       text NOT NULL,
  source_id           text NOT NULL,
  encounter_type      text,
  status              text,
  started_at          timestamptz,
  ended_at            timestamptz,
  ward                text,
  bed                 text,
  attending_user_id   uuid,
  fhir_resource_json  jsonb NOT NULL,
  last_synced_at      timestamptz NOT NULL,
  UNIQUE (source_system, source_id)
);

CREATE INDEX ON hospital.encounter (patient_id, started_at DESC);
CREATE INDEX ON hospital.encounter (ward, status) WHERE status = 'in-progress';
```

```sql
CREATE TABLE hospital.observation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES hospital.patient(id),
  encounter_id        uuid REFERENCES hospital.encounter(id),
  source_system       text NOT NULL,
  source_id           text NOT NULL,
  category            text,                -- 'laboratory', 'vital-signs', etc.
  code_system         text,
  code                text,
  code_display        text,
  value_numeric       numeric,
  value_text          text,
  unit                text,
  ref_range_low       numeric,
  ref_range_high      numeric,
  ref_range_text      text,                -- when range is non-numeric
  status              text,
  effective_at        timestamptz,
  fhir_resource_json  jsonb NOT NULL,
  last_synced_at      timestamptz NOT NULL,
  UNIQUE (source_system, source_id)
);

CREATE INDEX ON hospital.observation (patient_id, effective_at DESC);
CREATE INDEX ON hospital.observation (patient_id, code, effective_at DESC);
CREATE INDEX ON hospital.observation (patient_id, category, effective_at DESC);
```

```sql
CREATE TABLE hospital.allergy_intolerance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES hospital.patient(id),
  source_system       text NOT NULL,
  source_id           text NOT NULL,
  code_system         text,
  code                text,
  code_display        text,
  reaction            text,
  severity            text,
  recorded_at         date,
  fhir_resource_json  jsonb NOT NULL,
  last_synced_at      timestamptz NOT NULL,
  UNIQUE (source_system, source_id)
);

CREATE INDEX ON hospital.allergy_intolerance (patient_id);
```

```sql
CREATE TABLE hospital.condition (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES hospital.patient(id),
  source_system       text NOT NULL,
  source_id           text NOT NULL,
  code_system         text,
  code                text,
  code_display        text,
  status              text,
  onset_date          date,
  fhir_resource_json  jsonb NOT NULL,
  last_synced_at      timestamptz NOT NULL,
  UNIQUE (source_system, source_id)
);

CREATE INDEX ON hospital.condition (patient_id, status);
```

```sql
CREATE TABLE hospital.medication_request (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES hospital.patient(id),
  encounter_id        uuid REFERENCES hospital.encounter(id),
  source_system       text NOT NULL,
  source_id           text NOT NULL,
  medication_display  text,
  code_system         text,
  code                text,
  dose                text,
  route               text,
  frequency           text,
  status              text,
  prescriber_display  text,
  started_at          timestamptz,
  ended_at            timestamptz,
  fhir_resource_json  jsonb NOT NULL,
  last_synced_at      timestamptz NOT NULL,
  UNIQUE (source_system, source_id)
);

CREATE INDEX ON hospital.medication_request (patient_id, status);
```

```sql
CREATE TABLE hospital.document_reference (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES hospital.patient(id),
  encounter_id        uuid REFERENCES hospital.encounter(id),
  source_system       text NOT NULL,
  source_id           text NOT NULL,
  type                text,
  authored_at         timestamptz,
  author_display      text,
  content_url         text,
  content_text        text,                -- inline text if available
  fhir_resource_json  jsonb NOT NULL,
  last_synced_at      timestamptz NOT NULL,
  UNIQUE (source_system, source_id)
);

CREATE INDEX ON hospital.document_reference (patient_id, authored_at DESC);
```

```sql
CREATE TABLE hospital.retrieval_chunk (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES hospital.patient(id),
  source_type     text NOT NULL,   -- 'Observation', 'MedicationRequest', etc.
  source_id       uuid NOT NULL,
  content_text    text NOT NULL,
  content_lang    text NOT NULL,
  embedding       vector(1024),    -- dimension depends on chosen embedding model
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON hospital.retrieval_chunk (patient_id);
CREATE INDEX ON hospital.retrieval_chunk USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON hospital.retrieval_chunk USING gin (to_tsvector('simple', content_text));
```

## audit schema

```sql
CREATE TABLE audit.event (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts                  timestamptz NOT NULL DEFAULT now(),
  actor_id            uuid,
  actor_role          text,
  action              text NOT NULL,
  target_type         text,
  target_id           uuid,
  outcome             text NOT NULL,
  metadata_json       jsonb NOT NULL DEFAULT '{}',
  request_id          text,
  hash_prev           text,
  hash_self           text NOT NULL
);

CREATE INDEX ON audit.event (ts DESC);
CREATE INDEX ON audit.event (actor_id, ts DESC);
CREATE INDEX ON audit.event (target_type, target_id, ts DESC);
CREATE INDEX ON audit.event (action, ts DESC);

-- Prevent updates and deletes
CREATE OR REPLACE FUNCTION audit.prevent_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit.event rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE OR DELETE ON audit.event
  FOR EACH ROW EXECUTE FUNCTION audit.prevent_modification();
```

## Row-level security (RLS)

Enable on every table containing patient data. The application connects with a per-request role that has scope-bounded SELECT.

```sql
ALTER TABLE hospital.patient ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_scope_select ON hospital.patient
  FOR SELECT
  USING (
    id IN (
      SELECT patient_id FROM app.patient_scope
      WHERE user_id = current_setting('app.current_user_id')::uuid
        AND expires_at > now()
    )
  );
```

Apply equivalent policies to encounter, observation, condition, medication_request, allergy_intolerance, document_reference, retrieval_chunk.

## Indexes summary

Beyond the explicit indexes above:
- All FK columns: indexed
- `created_at DESC` indexes where pagination is common
- Composite indexes for hot query patterns

## Migrations

- Use `node-pg-migrate` (TypeScript) for app + hospital schemas
- Use `alembic` (Python) for any retrieval-side schema if separated
- Migrations run as part of CI/CD before service deployment
- Backward-compatible only; no destructive migrations in MVP without explicit review
