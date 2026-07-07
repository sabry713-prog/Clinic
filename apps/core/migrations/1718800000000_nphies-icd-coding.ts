import type { MigrationBuilder } from "node-pg-migrate";

// NPHIES ICD-10-AM coding support.
//
// app.snomed_icd10am_map — reference vocabulary: deterministic SNOMED CT →
// ICD-10-AM lookups. Pure terminology data (no patient data). In production
// this is loaded from licensed mapping tables; the rows seeded here cover
// the dev-seed vocabulary so the suggest→confirm flow works end to end.
//
// app.condition_icd_coding — doctor-CONFIRMED ICD-10-AM codes for documented
// conditions. Suggestions are computed at read time from the map and are
// never persisted: only an explicit clinician confirmation writes a row.
// This is billing/claim coding for an already-documented diagnosis — the
// system never diagnoses (CLAUDE.md §2); it maps vocabulary.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.snomed_icd10am_map (
      snomed_code      text PRIMARY KEY,
      icd10am_code     text NOT NULL,
      icd10am_display  text NOT NULL
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.condition_icd_coding (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      condition_id     uuid NOT NULL UNIQUE REFERENCES hospital.condition(id) ON DELETE CASCADE,
      patient_id       uuid NOT NULL,
      snomed_code      text,
      icd10am_code     text NOT NULL,
      icd10am_display  text NOT NULL,
      confirmed_by     uuid NOT NULL REFERENCES app."user"(id),
      confirmed_at     timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.condition_icd_coding (patient_id)`);

  // Reference rows for the dev-seed SNOMED vocabulary (ICD-10-AM).
  pgm.sql(`
    INSERT INTO app.snomed_icd10am_map (snomed_code, icd10am_code, icd10am_display) VALUES
      ('44054006',  'E11.9',  'Type 2 diabetes mellitus without complication'),
      ('38341003',  'I10',    'Essential (primary) hypertension'),
      ('49436004',  'I48.9',  'Atrial fibrillation and atrial flutter, unspecified'),
      ('13644009',  'E78.0',  'Pure hypercholesterolaemia'),
      ('195967001', 'J45.9',  'Asthma, unspecified'),
      ('40930008',  'E03.9',  'Hypothyroidism, unspecified'),
      ('70153002',  'G43.9',  'Migraine, unspecified'),
      ('709044004', 'N18.2',  'Chronic kidney disease, stage 2'),
      ('25064002',  'R51',    'Headache'),
      ('404640003', 'R42',    'Dizziness and giddiness'),
      ('29857009',  'R07.4',  'Chest pain, unspecified'),
      ('80313002',  'R00.2',  'Palpitations'),
      ('267036007', 'R06.0',  'Dyspnoea'),
      ('49727002',  'R05',    'Cough'),
      ('56018004',  'R06.2',  'Wheezing'),
      ('162397003', 'R07.0',  'Pain in throat'),
      ('68235000',  'R09.81', 'Nasal congestion'),
      ('16001004',  'H92.0',  'Otalgia'),
      ('84229001',  'R53',    'Malaise and fatigue'),
      ('422587007', 'R11',    'Nausea and vomiting'),
      ('21522001',  'R10.4',  'Other and unspecified abdominal pain'),
      ('57676002',  'M25.5',  'Pain in joint'),
      ('161891005', 'M54.9',  'Dorsalgia, unspecified'),
      ('246636008', 'H53.8',  'Other visual disturbances'),
      ('41652007',  'H57.1',  'Ocular pain'),
      ('91019004',  'R20.2',  'Paraesthesia of skin'),
      ('28442001',  'R35',    'Polyuria'),
      ('17173007',  'R63.1',  'Polydipsia'),
      ('26079004',  'R63.4',  'Abnormal weight loss'),
      ('76067001',  'R25.1',  'Tremor, unspecified'),
      ('418290006', 'L29.9',  'Pruritus, unspecified'),
      ('193462001', 'G47.0',  'Disorders of initiating and maintaining sleep [insomnias]'),
      ('267038008', 'R60.0',  'Localized oedema')
    ON CONFLICT (snomed_code) DO NOTHING
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.condition_icd_coding`);
  pgm.sql(`DROP TABLE IF EXISTS app.snomed_icd10am_map`);
}
