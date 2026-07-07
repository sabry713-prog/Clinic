import type { MigrationBuilder } from "node-pg-migrate";

// NPHIES SBS (Saudi Billing System) coding for service requests — mirrors
// the ICD-10-AM pattern from 1718800000000.
//
// app.order_sbs_map — reference vocabulary: deterministic order-code →
// SBS-code lookups, keyed by the extraction catalog's SNOMED/LOINC codes.
// The SBS codes seeded here are DEV PLACEHOLDERS in SBS format; production
// loads the licensed SBS catalog into this same table.
//
// app.service_request_sbs_coding — clinician-CONFIRMED SBS codes for
// orders. Suggestions are computed at read time from the map; only an
// explicit confirmation writes a row (billing vocabulary for an order the
// clinician already documented and confirmed — CLAUDE.md §2).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.order_sbs_map (
      order_code   text PRIMARY KEY,
      sbs_code     text NOT NULL,
      sbs_display  text NOT NULL
    )
  `);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.service_request_sbs_coding (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      service_request_id  uuid NOT NULL UNIQUE REFERENCES app.service_request(id) ON DELETE CASCADE,
      patient_id          uuid NOT NULL,
      order_code          text,
      sbs_code            text NOT NULL,
      sbs_display         text NOT NULL,
      confirmed_by        uuid NOT NULL REFERENCES app."user"(id),
      confirmed_at        timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE INDEX ON app.service_request_sbs_coding (patient_id)`);

  pgm.sql(`
    INSERT INTO app.order_sbs_map (order_code, sbs_code, sbs_display) VALUES
      ('399208008', '58500-00-10', 'Radiographic examination of chest'),
      ('363680008', '58503-00-10', 'Radiographic examination, other site'),
      ('16310003',  '55036-00-10', 'Ultrasound examination'),
      ('77477000',  '56001-00-10', 'Computed tomography scan'),
      ('113091000', '63001-00-10', 'Magnetic resonance imaging'),
      ('29303009',  '11700-00-10', 'Twelve-lead electrocardiography'),
      ('40701008',  '55113-00-10', 'Transthoracic echocardiography'),
      ('73761001',  '32090-00-10', 'Fibreoptic colonoscopy'),
      ('44441009',  '32076-00-10', 'Flexible sigmoidoscopy'),
      ('1919006',   '30473-00-10', 'Panendoscopy to duodenum'),
      ('423827005', '30473-01-10', 'Endoscopic examination'),
      ('86273004',  '30071-00-10', 'Biopsy of tissue'),
      ('18501008',  '11712-00-10', 'Cardiac exercise stress test'),
      ('86184003',  '11709-00-10', 'Ambulatory ECG (Holter) monitoring'),
      ('23426006',  '11506-00-10', 'Spirometry'),
      ('54550000',  '11000-00-10', 'Electroencephalography'),
      ('312681000', '12306-00-10', 'Bone densitometry (DEXA)'),
      ('71651007',  '59300-00-10', 'Mammography'),
      ('26604007',  '65070-00-10', 'Full blood examination'),
      ('302181000', '66500-00-10', 'Urea, electrolytes and creatinine'),
      ('1988-5',    '66756-00-10', 'C-reactive protein quantitation'),
      ('26958001',  '66512-00-10', 'Liver function tests'),
      ('16298000',  '66536-00-10', 'Lipid profile'),
      ('43396009',  '66551-00-10', 'Glycosylated haemoglobin (HbA1c)'),
      ('27171005',  '66819-00-10', 'Urine examination (urinalysis)'),
      ('31013004',  '66716-00-10', 'Thyroid function tests'),
      ('9293002',   '65120-00-10', 'Coagulation profile'),
      ('117010004', '69333-00-10', 'Blood culture'),
      ('104435004', '65096-00-10', 'Faecal occult blood test'),
      ('6598-7',    '66512-01-10', 'Troponin quantitation'),
      ('108252007', '65070-01-10', 'Baseline laboratory panel')
    ON CONFLICT (order_code) DO NOTHING
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.service_request_sbs_coding`);
  pgm.sql(`DROP TABLE IF EXISTS app.order_sbs_map`);
}
