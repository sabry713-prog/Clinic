import type { MigrationBuilder } from "node-pg-migrate";

// NPHIES rejection-risk checks — two DETERMINISTIC, non-interpretive layers
// on top of doctor-authored, doctor-confirmed diagnoses and orders:
//
// 1. app.diagnosis_procedure_compat — a reference table of known-valid
//    ICD-10-AM + SBS pairings (payer-published compatibility rules in
//    production; illustrative dev rows here). Checking whether a
//    clinician's own confirmed pairing appears in this table is a
//    set-membership lookup, not a clinical-necessity judgment — the
//    system never decides whether a procedure is "clinically justified"
//    by a diagnosis (CLAUDE.md §2); it only reports whether the payer's
//    published rules recognise the combination.
//
// 2. diagnosis_codes / procedure_codes on app.nphies_claim — lets the
//    rejection-analytics history be queried by code, so "how often has
//    this exact code shown up on a rejected claim before" is a plain
//    retrospective count over past outcomes, not a prediction.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.diagnosis_procedure_compat (
      icd10am_code text NOT NULL,
      sbs_code      text NOT NULL,
      PRIMARY KEY (icd10am_code, sbs_code)
    )
  `);

  pgm.sql(`ALTER TABLE app.nphies_claim ADD COLUMN IF NOT EXISTS diagnosis_codes text[] NOT NULL DEFAULT '{}'`);
  pgm.sql(`ALTER TABLE app.nphies_claim ADD COLUMN IF NOT EXISTS procedure_codes text[] NOT NULL DEFAULT '{}'`);
  pgm.sql(`CREATE INDEX ON app.nphies_claim USING gin (diagnosis_codes)`);
  pgm.sql(`CREATE INDEX ON app.nphies_claim USING gin (procedure_codes)`);

  // Illustrative dev compatibility pairs, drawn from the existing seed
  // vocabulary (app.snomed_icd10am_map / app.order_sbs_map). Production
  // loads the payer's published pairing rules into this same table.
  pgm.sql(`
    INSERT INTO app.diagnosis_procedure_compat (icd10am_code, sbs_code) VALUES
      ('I48.9', '11700-00-10'), -- atrial fibrillation -> ECG
      ('I48.9', '11709-00-10'), -- atrial fibrillation -> Holter
      ('I48.9', '55113-00-10'), -- atrial fibrillation -> echocardiography
      ('I10',   '55113-00-10'), -- hypertension -> echocardiography
      ('I10',   '66500-00-10'), -- hypertension -> renal profile
      ('E11.9', '66551-00-10'), -- diabetes -> HbA1c
      ('E11.9', '66500-00-10'), -- diabetes -> renal profile
      ('E11.9', '66819-00-10'), -- diabetes -> urinalysis
      ('E78.0', '66536-00-10'), -- hypercholesterolaemia -> lipid profile
      ('N18.2', '66500-00-10'), -- CKD -> renal profile
      ('N18.2', '66819-00-10'), -- CKD -> urinalysis
      ('J45.9', '11506-00-10'), -- asthma -> spirometry
      ('R07.4', '11700-00-10'), -- chest pain -> ECG
      ('R07.4', '58500-00-10'), -- chest pain -> chest X-ray
      ('R06.0', '58500-00-10'), -- dyspnoea -> chest X-ray
      ('R06.0', '11506-00-10'), -- dyspnoea -> spirometry
      ('R10.4', '55036-00-10'), -- abdominal pain -> ultrasound
      ('R51',   '11000-00-10'), -- headache -> EEG
      ('R35',   '66551-00-10')  -- polyuria -> HbA1c
    ON CONFLICT DO NOTHING
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE app.nphies_claim DROP COLUMN IF EXISTS procedure_codes`);
  pgm.sql(`ALTER TABLE app.nphies_claim DROP COLUMN IF EXISTS diagnosis_codes`);
  pgm.sql(`DROP TABLE IF EXISTS app.diagnosis_procedure_compat`);
}
