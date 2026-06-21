/* eslint-disable @typescript-eslint/naming-convention */
import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Phase E6 — grounded document drafting.
 * Draft lifecycle: generated → (edited) → signed → exported.
 * Unsigned drafts cannot be exported (enforced in the service + UI).
 */
export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE app.document_draft (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id          uuid NOT NULL REFERENCES hospital.patient(id),
      document_type       text NOT NULL,            -- discharge_summary | referral_letter | transfer_note | visit_summary
      language            text NOT NULL DEFAULT 'en',
      status              text NOT NULL DEFAULT 'draft',  -- draft | signed
      -- sections_json: [{ key, title, policy: 'assembled_facts'|'clinician_authored_only', text }]
      sections_json       jsonb NOT NULL DEFAULT '[]',
      generated_text      text NOT NULL DEFAULT '',  -- immutable original generation
      edited_text         text,                      -- clinician edits (null until edited)
      provenance_json     jsonb NOT NULL DEFAULT '[]',
      blocklist_triggered boolean NOT NULL DEFAULT false,
      disclaimer          text,
      generated_by        uuid REFERENCES app."user"(id),
      signed_by           uuid REFERENCES app."user"(id),
      signed_at           timestamptz,
      signed_text         text,                      -- frozen text at signature
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX document_draft_patient_idx ON app.document_draft (patient_id, created_at DESC)`);
  pgm.sql(`CREATE INDEX document_draft_status_idx ON app.document_draft (status)`);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`DROP TABLE IF EXISTS app.document_draft`);
}
