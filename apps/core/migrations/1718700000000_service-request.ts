import type { MigrationBuilder } from "node-pg-migrate";

// app.service_request — structured service orders (labs, imaging, procedures)
// created by a clinician CONFIRMING a request the clinician already documented
// in a note/order. The system extracts candidates verbatim from documented
// text; it never decides or recommends a service (that would be SaMD). Each
// row keeps the verbatim source excerpt + source document for provenance.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.service_request (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id         uuid NOT NULL,
      category           text NOT NULL,         -- laboratory | imaging | procedure | other
      code_system        text,
      code               text,
      code_display       text NOT NULL,
      status             text NOT NULL DEFAULT 'active',  -- active | completed | revoked
      intent             text NOT NULL DEFAULT 'order',
      source_document_id uuid,                  -- note/draft it was extracted from
      source_type        text,                  -- document_reference | document_draft
      source_excerpt     text,                  -- verbatim documented request text
      requested_at       timestamptz NOT NULL DEFAULT now(),
      requested_by       uuid,                  -- clinician who confirmed
      fhir_resource_json jsonb NOT NULL DEFAULT '{}',
      created_at         timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.service_request (patient_id, requested_at DESC)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.service_request`);
}
