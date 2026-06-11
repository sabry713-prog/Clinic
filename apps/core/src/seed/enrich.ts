/**
 * Enrichment seed for detailed pilot testing.
 *
 * Adds rich, deterministic synthetic data to the 5 in-scope patients
 * (MRN-006 .. MRN-010) on top of the base dev seed:
 *   - Lab series over time (creatinine, hemoglobin, glucose, WBC, Na, K, HbA1c, platelets, CRP)
 *   - Vital signs over the last 3 days (HR, BP, temp, resp rate, SpO2)
 *   - Imaging observations (chest X-ray, abdominal US — factual report text only)
 *   - Conditions, medications (incl. stopped), allergies with reactions
 *   - Clinical documents: admission note, progress notes (incl. within last 12h), orders
 *   - Prior finished admissions
 *
 * All values are synthetic and factual; document text contains no interpretive
 * language (blocklist-safe). Idempotent via ON CONFLICT on (source_system, source_id).
 *
 * Run: pnpm --filter @app/core seed:enrich
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../../.env") });

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

const IN_SCOPE_MRNS = ["MRN-006", "MRN-007", "MRN-008", "MRN-009", "MRN-010"];

const SRC = "dev-seed-enrich";

// ── Lab definitions ──────────────────────────────────────────────────────────

interface LabDef {
  code: string;
  display: string;
  unit: string;
  low: number;
  high: number;
}

const LABS: LabDef[] = [
  { code: "2160-0",  display: "Creatinine", unit: "μmol/L", low: 59,  high: 104 },
  { code: "718-7",   display: "Hemoglobin", unit: "g/dL",   low: 12,  high: 17  },
  { code: "2345-7",  display: "Glucose",    unit: "mg/dL",  low: 70,  high: 110 },
  { code: "6690-2",  display: "WBC",        unit: "10^9/L", low: 4,   high: 11  },
  { code: "2951-2",  display: "Sodium",     unit: "mmol/L", low: 135, high: 145 },
  { code: "2823-3",  display: "Potassium",  unit: "mmol/L", low: 3.5, high: 5.1 },
  { code: "4548-4",  display: "HbA1c",      unit: "%",      low: 4,   high: 5.6 },
  { code: "777-3",   display: "Platelets",  unit: "10^9/L", low: 150, high: 400 },
  { code: "1988-5",  display: "CRP",        unit: "mg/L",   low: 0,   high: 5   },
];

// Vital codes match VITAL_CODES in handoff.service.ts
const VITALS = [
  { code: "8867-4",  display: "Heart rate",       unit: "bpm",    base: 78,   spread: 14 },
  { code: "8310-5",  display: "Body temperature", unit: "°C",     base: 36.9, spread: 0.8 },
  { code: "9279-1",  display: "Respiratory rate", unit: "/min",   base: 16,   spread: 4 },
  { code: "59408-5", display: "SpO2",             unit: "%",      base: 96,   spread: 3 },
];

// Deterministic pseudo-random from a string seed
function seededValue(seed: string, min: number, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = ((h >>> 0) % 10000) / 10000;
  return min + unit * (max - min);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL row_security = off");

    const patientsRes = await client.query<{ id: string; mrn: string }>(
      `SELECT id, mrn FROM hospital.patient WHERE mrn = ANY($1) ORDER BY mrn`,
      [IN_SCOPE_MRNS],
    );
    if (patientsRes.rows.length === 0) {
      throw new Error("No in-scope patients found — run seed:dev first");
    }

    for (const { id: pid, mrn } of patientsRes.rows) {
      // ── Lab series: 6 values per analyte over the last 90 days ────────────
      for (const lab of LABS) {
        for (let i = 0; i < 6; i++) {
          const daysAgo = [90, 60, 30, 14, 3, 0][i]!;
          const v = round1(
            seededValue(`${mrn}-${lab.code}-${i}`, lab.low * 0.9, lab.high * 1.2),
          );
          await client.query(
            `INSERT INTO hospital.observation
               (patient_id, source_system, source_id, category, code_system, code,
                code_display, value_numeric, unit, ref_range_low, ref_range_high,
                ref_range_text, status, effective_at, fhir_resource_json, last_synced_at)
             VALUES ($1,$2,$3,'laboratory','http://loinc.org',$4,$5,$6,$7,$8,$9,$10,
                     'final', now() - $11 * interval '1 day' - interval '6 hours',
                     $12::jsonb, now())
             ON CONFLICT (source_system, source_id) DO NOTHING`,
            [
              pid, SRC, `OBS-${mrn}-${lab.code}-${i}`, lab.code, lab.display,
              v, lab.unit, lab.low, lab.high, `${lab.low}-${lab.high} ${lab.unit}`,
              daysAgo,
              JSON.stringify({ resourceType: "Observation", _synthetic: true }),
            ],
          );
        }
      }

      // ── Vitals: every 8 hours over the last 3 days ─────────────────────────
      for (const vit of VITALS) {
        for (let i = 0; i < 9; i++) {
          const hoursAgo = i * 8;
          const v = round1(
            seededValue(`${mrn}-${vit.code}-${i}`, vit.base - vit.spread / 2, vit.base + vit.spread / 2),
          );
          await client.query(
            `INSERT INTO hospital.observation
               (patient_id, source_system, source_id, category, code_system, code,
                code_display, value_numeric, unit, status, effective_at,
                fhir_resource_json, last_synced_at)
             VALUES ($1,$2,$3,'vital-signs','http://loinc.org',$4,$5,$6,$7,
                     'final', now() - $8 * interval '1 hour', $9::jsonb, now())
             ON CONFLICT (source_system, source_id) DO NOTHING`,
            [
              pid, SRC, `VIT-${mrn}-${vit.code}-${i}`, vit.code, vit.display,
              v, vit.unit, hoursAgo,
              JSON.stringify({ resourceType: "Observation", _synthetic: true }),
            ],
          );
        }
      }
      // Blood pressure as text value (systolic/diastolic)
      for (let i = 0; i < 9; i++) {
        const sys = Math.round(seededValue(`${mrn}-bp-sys-${i}`, 110, 145));
        const dia = Math.round(seededValue(`${mrn}-bp-dia-${i}`, 65, 92));
        await client.query(
          `INSERT INTO hospital.observation
             (patient_id, source_system, source_id, category, code_system, code,
              code_display, value_text, unit, status, effective_at,
              fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,'vital-signs','http://loinc.org','85354-9','Blood pressure',
                   $4,'mmHg','final', now() - $5 * interval '1 hour', $6::jsonb, now())
           ON CONFLICT (source_system, source_id) DO NOTHING`,
          [
            pid, SRC, `VIT-${mrn}-85354-9-${i}`, `${sys}/${dia}`, i * 8,
            JSON.stringify({ resourceType: "Observation", _synthetic: true }),
          ],
        );
      }

      // ── Imaging observations (factual report text only) ────────────────────
      const imaging = [
        { code: "36643-5", display: "Chest X-ray", daysAgo: 2,
          text: "Chest X-ray performed. Report documented by radiology. Lungs and cardiac silhouette described in report dated as per study date." },
        { code: "24982-1", display: "Abdominal ultrasound", daysAgo: 20,
          text: "Abdominal ultrasound performed. Liver, gallbladder, kidneys and spleen described in the radiology report." },
      ];
      for (const img of imaging) {
        await client.query(
          `INSERT INTO hospital.observation
             (patient_id, source_system, source_id, category, code_system, code,
              code_display, value_text, status, effective_at,
              fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,'imaging','http://loinc.org',$4,$5,$6,'final',
                   now() - $7 * interval '1 day', $8::jsonb, now())
           ON CONFLICT (source_system, source_id) DO NOTHING`,
          [
            pid, SRC, `IMG-${mrn}-${img.code}`, img.code, img.display, img.text,
            img.daysAgo,
            JSON.stringify({ resourceType: "Observation", _synthetic: true }),
          ],
        );
      }
    }

    // ── Per-patient clinical profiles ────────────────────────────────────────

    interface Profile {
      mrn: string;
      conditions: Array<{ code: string; display: string; status: string; onsetDaysAgo: number }>;
      medications: Array<{ code: string; display: string; dose: string; route: string; freq: string; status: string; startedDaysAgo: number }>;
      allergies: Array<{ code: string; display: string; reaction: string; severity: string }>;
    }

    const profiles: Profile[] = [
      {
        mrn: "MRN-006",
        conditions: [
          { code: "38341003", display: "Hypertension", status: "active", onsetDaysAgo: 1500 },
          { code: "13644009", display: "Hypercholesterolemia", status: "active", onsetDaysAgo: 900 },
        ],
        medications: [
          { code: "372511001", display: "Amlodipine 5mg", dose: "5 mg", route: "Oral", freq: "Once daily", status: "active", startedDaysAgo: 400 },
          { code: "108600003", display: "Atorvastatin 20mg", dose: "20 mg", route: "Oral", freq: "Once daily at night", status: "active", startedDaysAgo: 300 },
          { code: "7947003", display: "Aspirin 100mg", dose: "100 mg", route: "Oral", freq: "Once daily", status: "stopped", startedDaysAgo: 700 },
        ],
        allergies: [
          { code: "7980", display: "Penicillin", reaction: "Rash", severity: "moderate" },
        ],
      },
      {
        mrn: "MRN-007",
        conditions: [
          { code: "195967001", display: "Asthma", status: "active", onsetDaysAgo: 3000 },
        ],
        medications: [
          { code: "108606002", display: "Salbutamol inhaler 100mcg", dose: "2 puffs", route: "Inhalation", freq: "As needed", status: "active", startedDaysAgo: 200 },
          { code: "108605003", display: "Budesonide inhaler 200mcg", dose: "1 puff", route: "Inhalation", freq: "Twice daily", status: "active", startedDaysAgo: 200 },
        ],
        allergies: [
          { code: "293586001", display: "Ibuprofen", reaction: "Urticaria", severity: "mild" },
        ],
      },
      {
        mrn: "MRN-008",
        conditions: [
          { code: "44054006", display: "Diabetes mellitus type 2", status: "active", onsetDaysAgo: 2000 },
          { code: "709044004", display: "Chronic kidney disease stage 2", status: "active", onsetDaysAgo: 600 },
          { code: "38341003", display: "Hypertension", status: "active", onsetDaysAgo: 1800 },
        ],
        medications: [
          { code: "372567009", display: "Metformin 500mg", dose: "500 mg", route: "Oral", freq: "Twice daily", status: "active", startedDaysAgo: 1500 },
          { code: "386872004", display: "Lisinopril 10mg", dose: "10 mg", route: "Oral", freq: "Once daily", status: "active", startedDaysAgo: 1000 },
          { code: "108600003", display: "Atorvastatin 40mg", dose: "40 mg", route: "Oral", freq: "Once daily at night", status: "active", startedDaysAgo: 500 },
          { code: "325072002", display: "Insulin glargine", dose: "12 units", route: "Subcutaneous", freq: "Once daily at bedtime", status: "active", startedDaysAgo: 90 },
        ],
        allergies: [
          { code: "387467008", display: "Sulfamethoxazole", reaction: "Skin eruption", severity: "moderate" },
          { code: "256349002", display: "Peanut", reaction: "Angioedema", severity: "severe" },
        ],
      },
      {
        mrn: "MRN-009",
        conditions: [
          { code: "70153002", display: "Migraine", status: "active", onsetDaysAgo: 1200 },
          { code: "40930008", display: "Hypothyroidism", status: "active", onsetDaysAgo: 800 },
        ],
        medications: [
          { code: "126202002", display: "Levothyroxine 50mcg", dose: "50 mcg", route: "Oral", freq: "Once daily before breakfast", status: "active", startedDaysAgo: 800 },
          { code: "108406007", display: "Sumatriptan 50mg", dose: "50 mg", route: "Oral", freq: "As needed", status: "active", startedDaysAgo: 400 },
        ],
        allergies: [],
      },
      {
        mrn: "MRN-010",
        conditions: [
          { code: "44054006", display: "Diabetes mellitus type 2", status: "active", onsetDaysAgo: 740 },
          { code: "13644009", display: "Hypercholesterolemia", status: "active", onsetDaysAgo: 400 },
          { code: "49436004", display: "Atrial fibrillation", status: "active", onsetDaysAgo: 150 },
        ],
        medications: [
          { code: "372567009", display: "Metformin 850mg", dose: "850 mg", route: "Oral", freq: "Twice daily", status: "active", startedDaysAgo: 700 },
          { code: "372756006", display: "Warfarin 5mg", dose: "5 mg", route: "Oral", freq: "Once daily", status: "active", startedDaysAgo: 150 },
          { code: "318859000", display: "Bisoprolol 2.5mg", dose: "2.5 mg", route: "Oral", freq: "Once daily", status: "active", startedDaysAgo: 150 },
          { code: "108600003", display: "Atorvastatin 20mg", dose: "20 mg", route: "Oral", freq: "Once daily at night", status: "active", startedDaysAgo: 400 },
        ],
        allergies: [
          { code: "7980", display: "Penicillin", reaction: "Anaphylaxis", severity: "severe" },
        ],
      },
    ];

    for (const profile of profiles) {
      const pidRes = await client.query<{ id: string }>(
        `SELECT id FROM hospital.patient WHERE mrn = $1`,
        [profile.mrn],
      );
      const pid = pidRes.rows[0]?.id;
      if (!pid) continue;

      for (const c of profile.conditions) {
        await client.query(
          `INSERT INTO hospital.condition
             (patient_id, source_system, source_id, code_system, code, code_display,
              status, onset_date, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,'http://snomed.info/sct',$4,$5,$6,
                   (now() - $7 * interval '1 day')::date, $8::jsonb, now())
           ON CONFLICT (source_system, source_id) DO NOTHING`,
          [
            pid, SRC, `COND-${profile.mrn}-${c.code}`, c.code, c.display, c.status,
            c.onsetDaysAgo,
            JSON.stringify({ resourceType: "Condition", _synthetic: true }),
          ],
        );
      }

      for (const m of profile.medications) {
        await client.query(
          `INSERT INTO hospital.medication_request
             (patient_id, source_system, source_id, medication_display, code_system,
              code, dose, route, frequency, status, started_at,
              fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,'http://snomed.info/sct',$5,$6,$7,$8,$9,
                   now() - $10 * interval '1 day', $11::jsonb, now())
           ON CONFLICT (source_system, source_id) DO NOTHING`,
          [
            pid, SRC, `MED-${profile.mrn}-${m.code}`, m.display, m.code,
            m.dose, m.route, m.freq, m.status, m.startedDaysAgo,
            JSON.stringify({ resourceType: "MedicationRequest", _synthetic: true }),
          ],
        );
      }

      for (const a of profile.allergies) {
        await client.query(
          `INSERT INTO hospital.allergy_intolerance
             (patient_id, source_system, source_id, code_system, code, code_display,
              reaction, severity, recorded_at, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,'http://snomed.info/sct',$4,$5,$6,$7,
                   (now() - interval '1 year')::date, $8::jsonb, now())
           ON CONFLICT (source_system, source_id) DO NOTHING`,
          [
            pid, SRC, `ALG-${profile.mrn}-${a.code}`, a.code, a.display,
            a.reaction, a.severity,
            JSON.stringify({ resourceType: "AllergyIntolerance", _synthetic: true }),
          ],
        );
      }

      // ── Documents: admission note, progress notes, nursing note, order ─────
      const documents = [
        {
          id: `DOC-${profile.mrn}-admission`,
          type: "Admission note",
          author: "Dr. Tariq Al-Mansouri (Dev)",
          hoursAgo: 48,
          text:
            "Admission note. Patient admitted to Ward-4A. History obtained and documented. " +
            "Current home medications recorded in the medication list. Baseline laboratory tests " +
            "and chest X-ray ordered on admission. Plan as per admitting team documentation.",
        },
        {
          id: `DOC-${profile.mrn}-progress-1`,
          type: "Progress note",
          author: "Dr. Tariq Al-Mansouri (Dev)",
          hoursAgo: 26,
          text:
            "Progress note, day 1. Patient seen on morning round. Vital signs recorded on the " +
            "observation chart. Medications administered as charted. Laboratory results from this " +
            "morning filed in the record.",
        },
        {
          id: `DOC-${profile.mrn}-progress-2`,
          type: "Progress note",
          author: "Dr. Tariq Al-Mansouri (Dev)",
          hoursAgo: 4,
          text:
            "Progress note, day 2. Patient reviewed on morning round. Overnight observations " +
            "documented by nursing staff. Oral intake documented. Medication chart reviewed and " +
            "continued as written.",
        },
        {
          id: `DOC-${profile.mrn}-nursing`,
          type: "Nursing note",
          author: "RN Aisha (Dev)",
          hoursAgo: 8,
          text:
            "Nursing note. Vital signs taken and recorded per schedule. Patient resting in bed. " +
            "Scheduled medications given as charted. Intake and output recorded.",
        },
        {
          id: `DOC-${profile.mrn}-order`,
          type: "order",
          author: "Dr. Tariq Al-Mansouri (Dev)",
          hoursAgo: 6,
          text: "Laboratory order: CBC, renal profile and CRP requested for tomorrow morning.",
        },
      ];
      for (const d of documents) {
        await client.query(
          `INSERT INTO hospital.document_reference
             (patient_id, source_system, source_id, type, content_text,
              author_display, authored_at, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6, now() - $7 * interval '1 hour', $8::jsonb, now())
           ON CONFLICT (source_system, source_id) DO NOTHING`,
          [
            pid, SRC, d.id, d.type, d.text, d.author, d.hoursAgo,
            JSON.stringify({ resourceType: "DocumentReference", _synthetic: true }),
          ],
        );
      }

      // ── Prior finished admissions ───────────────────────────────────────────
      const priors = [
        { id: `ENC-${profile.mrn}-prior-1`, type: "IMP", startDaysAgo: 400, lengthDays: 4 },
        { id: `ENC-${profile.mrn}-prior-2`, type: "EMER", startDaysAgo: 150, lengthDays: 1 },
      ];
      for (const e of priors) {
        await client.query(
          `INSERT INTO hospital.encounter
             (patient_id, source_system, source_id, encounter_type, status,
              started_at, ended_at, ward, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,'finished',
                   now() - $5 * interval '1 day',
                   now() - $5 * interval '1 day' + $6 * interval '1 day',
                   'Ward-2B', $7::jsonb, now())
           ON CONFLICT (source_system, source_id) DO NOTHING`,
          [
            pid, SRC, e.id, e.type, e.startDaysAgo, e.lengthDays,
            JSON.stringify({ resourceType: "Encounter", _synthetic: true }),
          ],
        );
      }
    }

    await client.query("COMMIT");
    console.log("Enrichment seed completed for:", IN_SCOPE_MRNS.join(", "));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Enrichment seed failed:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
