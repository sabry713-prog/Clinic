import type { MigrationBuilder } from "node-pg-migrate";

// Enriches the diagnosis/procedure compatibility table into a fuller
// NPHIES clinical-mapping reference: internal pairing code (icd10am_code +
// sbs_code, unchanged) plus ACHI code, NPHIES service type, an optional
// allowed-secondary-diagnosis list, and minimum-data-set (MDS) evidence
// requirements (requires_vitals, requires_note_types).
//
// The MDS columns are DETERMINISTIC presence flags only: "does a
// vital-signs observation / a document of this type exist for the
// encounter this order came from" — never a read of clinical note
// content or a judgment about what the content means (CLAUDE.md §2).
// requires_note_types values must match hospital.document_reference.type
// verbatim (a structured field already populated by ingestion) — there is
// no free-text scanning of content_text anywhere in this feature.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE app.diagnosis_procedure_compat RENAME TO nphies_clinical_mapping`);

  pgm.sql(`
    ALTER TABLE app.nphies_clinical_mapping
      ADD COLUMN IF NOT EXISTS achi_code text,
      ADD COLUMN IF NOT EXISTS nphies_service_type text
        CHECK (nphies_service_type IN ('institutional','professional','pharmacy','oral','vision')),
      ADD COLUMN IF NOT EXISTS allowed_secondary_icd10am text[],
      ADD COLUMN IF NOT EXISTS requires_vitals boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS requires_note_types text[],
      ADD COLUMN IF NOT EXISTS notes text
  `);

  // Backfill: dev rows use the same code for achi_code as sbs_code
  // (illustrative only — production loads the real ACHI catalog, which is
  // a distinct code set from SBS billing codes).
  pgm.sql(`
    UPDATE app.nphies_clinical_mapping
    SET achi_code = sbs_code, nphies_service_type = 'institutional'
    WHERE achi_code IS NULL
  `);

  // Illustrative MDS requirements on a few existing rows, to give the new
  // completeness check (R11) real signal in dev without inventing new
  // pairing data.
  pgm.sql(`
    UPDATE app.nphies_clinical_mapping
    SET requires_vitals = true
    WHERE (icd10am_code, sbs_code) IN (
      ('R07.4', '11700-00-10'), -- chest pain -> ECG
      ('R07.4', '58500-00-10'), -- chest pain -> chest X-ray
      ('R06.0', '58500-00-10')  -- dyspnoea -> chest X-ray
    )
  `);
  pgm.sql(`
    UPDATE app.nphies_clinical_mapping
    SET requires_note_types = ARRAY['Admission note']
    WHERE (icd10am_code, sbs_code) = ('R07.4', '58500-00-10')
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE app.nphies_clinical_mapping
      DROP COLUMN IF EXISTS notes,
      DROP COLUMN IF EXISTS requires_note_types,
      DROP COLUMN IF EXISTS requires_vitals,
      DROP COLUMN IF EXISTS allowed_secondary_icd10am,
      DROP COLUMN IF EXISTS nphies_service_type,
      DROP COLUMN IF EXISTS achi_code
  `);
  pgm.sql(`ALTER TABLE app.nphies_clinical_mapping RENAME TO diagnosis_procedure_compat`);
}
