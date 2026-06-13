/**
 * Symptom-history seed for detailed pilot testing.
 *
 * Adds a 2-year outpatient history to the 5 in-scope patients
 * (MRN-006 .. MRN-010) on top of seed:dev and seed:enrich:
 *   - 12 finished outpatient encounters per patient spread over the last
 *     730 days, rotating across specialty clinics matched to each patient's
 *     clinical profile (e.g. Cardiology, Endocrinology, Pulmonology)
 *   - A clinic visit note per encounter documenting the symptoms the patient
 *     reported at that visit (factual wording only — blocklist-safe)
 *   - A condition row per reported symptom (SNOMED finding codes) with the
 *     visit date as onset; older symptoms are recorded as resolved
 *
 * All values are synthetic and deterministic (seeded from MRN + visit index),
 * so reruns produce identical data. Idempotent via ON CONFLICT on
 * (source_system, source_id).
 *
 * Run: pnpm --filter @app/core seed:symptoms
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../../.env") });

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

const SRC = "dev-seed-symptoms";

// Deterministic pseudo-random from a string seed (same scheme as enrich.ts)
function seededValue(seed: string, min: number, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const unit = ((h >>> 0) % 10000) / 10000;
  return min + unit * (max - min);
}

function pick<T>(seed: string, items: readonly T[]): T {
  return items[Math.floor(seededValue(seed, 0, items.length)) % items.length]!;
}

// ── Symptom vocabulary (SNOMED CT finding codes) ─────────────────────────────

interface Symptom {
  code: string;
  display: string;
}

const SYMPTOMS: Record<string, Symptom> = {
  headache:        { code: "25064002",  display: "Headache" },
  dizziness:       { code: "404640003", display: "Dizziness" },
  chestPain:       { code: "29857009",  display: "Chest pain" },
  palpitations:    { code: "80313002",  display: "Palpitations" },
  dyspnea:         { code: "267036007", display: "Shortness of breath" },
  cough:           { code: "49727002",  display: "Cough" },
  wheezing:        { code: "56018004",  display: "Wheezing" },
  soreThroat:      { code: "162397003", display: "Sore throat" },
  nasalCongestion: { code: "68235000",  display: "Nasal congestion" },
  earPain:         { code: "16001004",  display: "Ear pain" },
  fatigue:         { code: "84229001",  display: "Fatigue" },
  nausea:          { code: "422587007", display: "Nausea" },
  abdominalPain:   { code: "21522001",  display: "Abdominal pain" },
  jointPain:       { code: "57676002",  display: "Joint pain" },
  backPain:        { code: "161891005", display: "Back pain" },
  blurredVision:   { code: "246636008", display: "Blurred vision" },
  eyePain:         { code: "41652007",  display: "Eye pain" },
  paresthesia:     { code: "91019004",  display: "Numbness and tingling" },
  polyuria:        { code: "28442001",  display: "Frequent urination" },
  polydipsia:      { code: "17173007",  display: "Increased thirst" },
  ankleSwelling:   { code: "267038008", display: "Ankle swelling" },
  tremor:          { code: "26079004",  display: "Tremor" },
  insomnia:        { code: "193462001", display: "Insomnia" },
  itching:         { code: "418290006", display: "Itching" },
  sneezing:        { code: "76067001",  display: "Sneezing" },
};

// ── Clinics and the symptoms typically reported there ───────────────────────

interface ClinicMed {
  code: string;
  display: string;
  dose: string;
  route: string;
  freq: string;
}

interface Clinic {
  name: string;
  physician: string;
  symptoms: readonly Symptom[];
  // Medication typically prescribed at this clinic. Linked to the visit
  // encounter when seeded, so "treatment given at <clinic>" is factual.
  medication: ClinicMed;
}

const CLINICS: Record<string, Clinic> = {
  cardiology: {
    name: "Cardiology Clinic",
    physician: "Dr. Salem Al-Harthi (Dev)",
    symptoms: [SYMPTOMS["chestPain"]!, SYMPTOMS["palpitations"]!, SYMPTOMS["dyspnea"]!, SYMPTOMS["ankleSwelling"]!, SYMPTOMS["dizziness"]!],
    medication: { code: "318859000", display: "Bisoprolol 2.5mg", dose: "2.5 mg", route: "Oral", freq: "Once daily" },
  },
  endocrinology: {
    name: "Endocrinology Clinic",
    physician: "Dr. Maha Al-Saif (Dev)",
    symptoms: [SYMPTOMS["fatigue"]!, SYMPTOMS["polydipsia"]!, SYMPTOMS["polyuria"]!, SYMPTOMS["tremor"]!, SYMPTOMS["paresthesia"]!],
    medication: { code: "372567009", display: "Metformin 500mg", dose: "500 mg", route: "Oral", freq: "Twice daily" },
  },
  nephrology: {
    name: "Nephrology Clinic",
    physician: "Dr. Waleed Al-Amri (Dev)",
    symptoms: [SYMPTOMS["ankleSwelling"]!, SYMPTOMS["fatigue"]!, SYMPTOMS["polyuria"]!, SYMPTOMS["nausea"]!],
    medication: { code: "387165009", display: "Sodium bicarbonate 500mg", dose: "500 mg", route: "Oral", freq: "Twice daily" },
  },
  pulmonology: {
    name: "Pulmonology Clinic",
    physician: "Dr. Lama Al-Fadhli (Dev)",
    symptoms: [SYMPTOMS["cough"]!, SYMPTOMS["wheezing"]!, SYMPTOMS["dyspnea"]!],
    medication: { code: "108606002", display: "Salbutamol inhaler 100mcg", dose: "2 puffs", route: "Inhalation", freq: "As needed" },
  },
  ent: {
    name: "ENT Clinic",
    physician: "Dr. Faisal Al-Nasser (Dev)",
    symptoms: [SYMPTOMS["soreThroat"]!, SYMPTOMS["nasalCongestion"]!, SYMPTOMS["earPain"]!, SYMPTOMS["dizziness"]!],
    medication: { code: "395726003", display: "Xylometazoline nasal spray 0.1%", dose: "1 spray", route: "Nasal", freq: "Twice daily" },
  },
  neurology: {
    name: "Neurology Clinic",
    physician: "Dr. Reema Al-Dakhil (Dev)",
    symptoms: [SYMPTOMS["headache"]!, SYMPTOMS["dizziness"]!, SYMPTOMS["paresthesia"]!, SYMPTOMS["blurredVision"]!, SYMPTOMS["tremor"]!],
    medication: { code: "108406007", display: "Sumatriptan 50mg", dose: "50 mg", route: "Oral", freq: "As needed" },
  },
  internalMedicine: {
    name: "Internal Medicine Clinic",
    physician: "Dr. Tariq Al-Mansouri (Dev)",
    symptoms: [SYMPTOMS["fatigue"]!, SYMPTOMS["backPain"]!, SYMPTOMS["jointPain"]!, SYMPTOMS["insomnia"]!, SYMPTOMS["nausea"]!, SYMPTOMS["abdominalPain"]!],
    medication: { code: "387517004", display: "Paracetamol 500mg", dose: "500 mg", route: "Oral", freq: "As needed" },
  },
  ophthalmology: {
    name: "Ophthalmology Clinic",
    physician: "Dr. Huda Al-Mutlaq (Dev)",
    symptoms: [SYMPTOMS["blurredVision"]!, SYMPTOMS["eyePain"]!, SYMPTOMS["headache"]!],
    medication: { code: "421026006", display: "Carmellose eye drops 0.5%", dose: "1 drop", route: "Ophthalmic", freq: "As needed" },
  },
  allergy: {
    name: "Allergy and Immunology Clinic",
    physician: "Dr. Nasser Al-Otaibi (Dev)",
    symptoms: [SYMPTOMS["sneezing"]!, SYMPTOMS["itching"]!, SYMPTOMS["nasalCongestion"]!, SYMPTOMS["wheezing"]!],
    medication: { code: "330698001", display: "Loratadine 10mg", dose: "10 mg", route: "Oral", freq: "Once daily" },
  },
};

// Clinics each patient attends, matched to their seeded conditions
const PATIENT_CLINICS: Record<string, readonly Clinic[]> = {
  // Hypertension + hypercholesterolemia
  "MRN-006": [CLINICS["cardiology"]!, CLINICS["internalMedicine"]!, CLINICS["ophthalmology"]!],
  // Asthma
  "MRN-007": [CLINICS["pulmonology"]!, CLINICS["allergy"]!, CLINICS["ent"]!],
  // Diabetes type 2 + CKD + hypertension
  "MRN-008": [CLINICS["endocrinology"]!, CLINICS["nephrology"]!, CLINICS["cardiology"]!, CLINICS["ophthalmology"]!],
  // Migraine + hypothyroidism
  "MRN-009": [CLINICS["neurology"]!, CLINICS["endocrinology"]!, CLINICS["ent"]!],
  // Diabetes type 2 + atrial fibrillation + hypercholesterolemia
  "MRN-010": [CLINICS["cardiology"]!, CLINICS["endocrinology"]!, CLINICS["internalMedicine"]!],
};

// 12 visits spread over the last 2 years (days ago)
const VISIT_DAYS_AGO = [730, 660, 590, 520, 450, 365, 300, 240, 180, 120, 60, 21] as const;

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL row_security = off");

    const mrns = Object.keys(PATIENT_CLINICS);
    const patientsRes = await client.query<{ id: string; mrn: string }>(
      `SELECT id, mrn FROM hospital.patient WHERE mrn = ANY($1) ORDER BY mrn`,
      [mrns],
    );
    if (patientsRes.rows.length === 0) {
      throw new Error("No in-scope patients found — run seed:dev first");
    }

    let totalVisits = 0;
    let totalSymptoms = 0;
    let totalMeds = 0;

    for (const { id: pid, mrn } of patientsRes.rows) {
      const clinics = PATIENT_CLINICS[mrn]!;
      // Attach each clinic's medication once, at the patient's first visit
      // to that clinic, so it is linked to a real clinic encounter.
      const clinicMedSeeded = new Set<string>();

      for (let v = 0; v < VISIT_DAYS_AGO.length; v++) {
        const daysAgo = VISIT_DAYS_AGO[v]!;
        const clinic = clinics[v % clinics.length]!;
        const encSourceId = `ENC-${mrn}-clinic-${v}`;

        // Symptoms reported at this visit: 1-3 from the clinic's set
        const count = 1 + (Math.floor(seededValue(`${mrn}-symcount-${v}`, 0, 3)) % 3);
        const reported: Symptom[] = [];
        for (let s = 0; s < count; s++) {
          const sym = pick(`${mrn}-sym-${v}-${s}`, clinic.symptoms);
          if (!reported.some((r) => r.code === sym.code)) reported.push(sym);
        }
        const durations = reported.map((sym) =>
          Math.round(seededValue(`${mrn}-dur-${v}-${sym.code}`, 1, 14)),
        );

        // ── Outpatient encounter at the clinic ─────────────────────────────
        const encRes = await client.query<{ id: string }>(
          `INSERT INTO hospital.encounter
             (patient_id, source_system, source_id, encounter_type, status,
              started_at, ended_at, ward, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,'AMB','finished',
                   now() - $4 * interval '1 day',
                   now() - $4 * interval '1 day' + interval '40 minutes',
                   $5, $6::jsonb, now())
           ON CONFLICT (source_system, source_id) DO UPDATE
             SET last_synced_at = now()
           RETURNING id`,
          [
            pid, SRC, encSourceId, daysAgo, clinic.name,
            JSON.stringify({ resourceType: "Encounter", id: encSourceId, _synthetic: true }),
          ],
        );
        const encounterId = encRes.rows[0]?.id ?? null;
        totalVisits++;

        // ── Clinic visit note documenting reported symptoms ────────────────
        const symptomSentence = reported
          .map((sym, i) => `${sym.display.toLowerCase()} for ${durations[i]} day(s)`)
          .join(", ");
        const noteText =
          `${clinic.name} visit. Patient reported the following symptoms: ${symptomSentence}. ` +
          `Symptom history recorded in this note. Examination performed and findings documented. ` +
          `Follow-up arranged per clinic schedule.`;

        await client.query(
          `INSERT INTO hospital.document_reference
             (patient_id, encounter_id, source_system, source_id, type, content_text,
              author_display, authored_at, fhir_resource_json, last_synced_at)
           VALUES ($1,$2,$3,$4,'Clinic visit note',$5,$6,
                   now() - $7 * interval '1 day' + interval '30 minutes',
                   $8::jsonb, now())
           ON CONFLICT (source_system, source_id) DO NOTHING`,
          [
            pid, encounterId, SRC, `DOC-${mrn}-clinic-${v}`, noteText,
            clinic.physician, daysAgo,
            JSON.stringify({ resourceType: "DocumentReference", _synthetic: true }),
          ],
        );

        // ── One condition row per reported symptom ─────────────────────────
        for (const sym of reported) {
          // Symptoms reported within the last 90 days are still recorded
          // as active; older ones as resolved.
          const status = daysAgo <= 90 ? "active" : "resolved";
          await client.query(
            `INSERT INTO hospital.condition
               (patient_id, source_system, source_id, code_system, code,
                code_display, status, onset_date, fhir_resource_json, last_synced_at)
             VALUES ($1,$2,$3,'http://snomed.info/sct',$4,$5,$6,
                     (now() - $7 * interval '1 day')::date, $8::jsonb, now())
             ON CONFLICT (source_system, source_id) DO NOTHING`,
            [
              pid, SRC, `COND-${mrn}-sym-${v}-${sym.code}`, sym.code,
              `${sym.display} (reported at ${clinic.name})`, status, daysAgo,
              JSON.stringify({ resourceType: "Condition", _synthetic: true }),
            ],
          );
          totalSymptoms++;
        }

        // ── Medication prescribed at this clinic (once per clinic) ─────────
        if (encounterId && !clinicMedSeeded.has(clinic.name)) {
          clinicMedSeeded.add(clinic.name);
          const med = clinic.medication;
          await client.query(
            `INSERT INTO hospital.medication_request
               (patient_id, encounter_id, source_system, source_id,
                medication_display, code_system, code, dose, route, frequency,
                status, started_at, prescriber_display,
                fhir_resource_json, last_synced_at)
             VALUES ($1,$2,$3,$4,$5,'http://snomed.info/sct',$6,$7,$8,$9,
                     'active', now() - $10 * interval '1 day', $11,
                     $12::jsonb, now())
             ON CONFLICT (source_system, source_id) DO NOTHING`,
            [
              pid, encounterId, SRC, `MED-${mrn}-clinic-${med.code}`,
              med.display, med.code, med.dose, med.route, med.freq,
              daysAgo, clinic.physician,
              JSON.stringify({ resourceType: "MedicationRequest", _synthetic: true }),
            ],
          );
          totalMeds++;
        }
      }
    }

    await client.query("COMMIT");
    console.log(`Symptom-history seed completed for: ${mrns.join(", ")}`);
    console.log(`Visits: ${totalVisits}, symptom records: ${totalSymptoms}, clinic medications: ${totalMeds}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Symptom-history seed failed:", err);
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
