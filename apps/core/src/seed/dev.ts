/**
 * Development seed for Slice 1.
 *
 * Seeds:
 *   - 1 dev tenant (already seeded in migration)
 *   - 1 dev physician user
 *   - 50 synthetic patients (no real PHI -- obviously fake names)
 *   - Encounters linking 5 patients to dev physician (in scope)
 *   - 1 patient explicitly NOT linked (out-of-scope for E2E test)
 *   - Observations, conditions, and medications for each patient
 *
 * Run: pnpm --filter @app/core seed:dev
 */

import { createHash } from "node:crypto";
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../../.env") });

const pool = new Pool({
  connectionString: process.env["DATABASE_URL"],
});

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

// Dev physician user -- linked to Keycloak dev realm user
const DEV_PHYSICIAN_EXTERNAL_SUBJECT = "00000000-0000-0000-0000-000000000010";
const DEV_PHYSICIAN_DISPLAY_NAME = "Dr. Tariq Al-Mansouri (Dev)";

// Synthetic patient data -- no real PHI
const FAKE_PATIENTS: Array<{
  givenName: string;
  familyName: string;
  dob: string;
  sex: string;
  mrn: string;
}> = [
  { givenName: "Faris", familyName: "Fakename-Al-Otaibi", dob: "1975-03-15", sex: "male", mrn: "MRN-001" },
  { givenName: "Nora", familyName: "Fakename-Al-Zahrani", dob: "1982-07-22", sex: "female", mrn: "MRN-002" },
  { givenName: "Khalid", familyName: "Fakename-Al-Harbi", dob: "1968-11-08", sex: "male", mrn: "MRN-003" },
  { givenName: "Reem", familyName: "Fakename-Al-Qahtani", dob: "1990-05-30", sex: "female", mrn: "MRN-004" },
  { givenName: "Saad", familyName: "Fakename-Al-Ghamdi", dob: "1955-09-12", sex: "male", mrn: "MRN-005" },
  // In-scope patients (will have encounters with dev physician)
  { givenName: "Omar", familyName: "Fakename-Al-Dossary", dob: "1978-01-20", sex: "male", mrn: "MRN-006" },
  { givenName: "Hana", familyName: "Fakename-Al-Shehri", dob: "1985-06-14", sex: "female", mrn: "MRN-007" },
  { givenName: "Yousef", familyName: "Fakename-Al-Mutairi", dob: "1970-12-03", sex: "male", mrn: "MRN-008" },
  { givenName: "Sara", familyName: "Fakename-Al-Anazi", dob: "1993-04-17", sex: "female", mrn: "MRN-009" },
  { givenName: "Ahmad", familyName: "Fakename-Al-Bishi", dob: "1962-08-25", sex: "male", mrn: "MRN-010" },
  // Out-of-scope patient (index 10, MRN-011) -- NOT linked to dev physician
  { givenName: "Layla", familyName: "Fakename-Al-Subaie", dob: "1988-02-09", sex: "female", mrn: "MRN-011" },
  // Remaining patients
  { givenName: "Mansour", familyName: "Fakename-Al-Johani", dob: "1972-10-16", sex: "male", mrn: "MRN-012" },
  { givenName: "Abeer", familyName: "Fakename-Al-Rashidi", dob: "1980-07-07", sex: "female", mrn: "MRN-013" },
  { givenName: "Turki", familyName: "Fakename-Al-Hamdan", dob: "1965-03-28", sex: "male", mrn: "MRN-014" },
  { givenName: "Hessa", familyName: "Fakename-Al-Otaibi", dob: "1995-09-19", sex: "female", mrn: "MRN-015" },
  { givenName: "Fahad", familyName: "Fakename-Al-Shahrani", dob: "1958-12-11", sex: "male", mrn: "MRN-016" },
  { givenName: "Mona", familyName: "Fakename-Al-Maliki", dob: "1987-04-23", sex: "female", mrn: "MRN-017" },
  { givenName: "Sultan", familyName: "Fakename-Al-Dawsari", dob: "1976-06-05", sex: "male", mrn: "MRN-018" },
  { givenName: "Dalal", familyName: "Fakename-Al-Ruwaili", dob: "1991-01-31", sex: "female", mrn: "MRN-019" },
  { givenName: "Bandar", familyName: "Fakename-Al-Shammari", dob: "1969-11-27", sex: "male", mrn: "MRN-020" },
  { givenName: "Ghada", familyName: "Fakename-Al-Azmi", dob: "1983-03-06", sex: "female", mrn: "MRN-021" },
  { givenName: "Nawaf", familyName: "Fakename-Al-Balawi", dob: "1974-07-14", sex: "male", mrn: "MRN-022" },
  { givenName: "Rawan", familyName: "Fakename-Al-Subhi", dob: "1998-10-02", sex: "female", mrn: "MRN-023" },
  { givenName: "Faisal", familyName: "Fakename-Al-Shahri", dob: "1961-05-18", sex: "male", mrn: "MRN-024" },
  { givenName: "Wafa", familyName: "Fakename-Al-Hajri", dob: "1979-09-09", sex: "female", mrn: "MRN-025" },
  { givenName: "Sattam", familyName: "Fakename-Al-Enezi", dob: "1971-02-24", sex: "male", mrn: "MRN-026" },
  { givenName: "Lujain", familyName: "Fakename-Al-Harthy", dob: "1996-08-13", sex: "female", mrn: "MRN-027" },
  { givenName: "Majed", familyName: "Fakename-Al-Zubaidi", dob: "1964-04-07", sex: "male", mrn: "MRN-028" },
  { givenName: "Arwa", familyName: "Fakename-Al-Aqeel", dob: "1989-12-29", sex: "female", mrn: "MRN-029" },
  { givenName: "Waleed", familyName: "Fakename-Al-Saqer", dob: "1977-06-21", sex: "male", mrn: "MRN-030" },
  { givenName: "Hind", familyName: "Fakename-Al-Thubaiti", dob: "1984-11-15", sex: "female", mrn: "MRN-031" },
  { givenName: "Muteb", familyName: "Fakename-Al-Muzaini", dob: "1967-03-03", sex: "male", mrn: "MRN-032" },
  { givenName: "Fadwa", familyName: "Fakename-Al-Barqi", dob: "1992-07-26", sex: "female", mrn: "MRN-033" },
  { givenName: "Nayef", familyName: "Fakename-Al-Osaimi", dob: "1973-10-10", sex: "male", mrn: "MRN-034" },
  { givenName: "Rana", familyName: "Fakename-Al-Qurashi", dob: "1986-01-05", sex: "female", mrn: "MRN-035" },
  { givenName: "Saleh", familyName: "Fakename-Al-Asmari", dob: "1956-05-19", sex: "male", mrn: "MRN-036" },
  { givenName: "Manal", familyName: "Fakename-Al-Wahbi", dob: "1981-09-23", sex: "female", mrn: "MRN-037" },
  { givenName: "Hamad", familyName: "Fakename-Al-Sulami", dob: "1970-02-17", sex: "male", mrn: "MRN-038" },
  { givenName: "Dina", familyName: "Fakename-Al-Maghrabi", dob: "1994-06-08", sex: "female", mrn: "MRN-039" },
  { givenName: "Yazeed", familyName: "Fakename-Al-Mukhtar", dob: "1963-11-30", sex: "male", mrn: "MRN-040" },
  { givenName: "Shahd", familyName: "Fakename-Al-Rabiei", dob: "1997-04-12", sex: "female", mrn: "MRN-041" },
  { givenName: "Tawfiq", familyName: "Fakename-Al-Gahtani", dob: "1966-08-04", sex: "male", mrn: "MRN-042" },
  { givenName: "Amal", familyName: "Fakename-Al-Hazmi", dob: "1975-12-22", sex: "female", mrn: "MRN-043" },
  { givenName: "Abdulaziz", familyName: "Fakename-Al-Shaikh", dob: "1959-07-16", sex: "male", mrn: "MRN-044" },
  { givenName: "Lina", familyName: "Fakename-Al-Tamimi", dob: "1988-03-11", sex: "female", mrn: "MRN-045" },
  { givenName: "Ibrahim", familyName: "Fakename-Al-Yami", dob: "1972-10-25", sex: "male", mrn: "MRN-046" },
  { givenName: "Bushra", familyName: "Fakename-Al-Nahari", dob: "1983-05-07", sex: "female", mrn: "MRN-047" },
  { givenName: "Mishal", familyName: "Fakename-Al-Mousa", dob: "1961-01-19", sex: "male", mrn: "MRN-048" },
  { givenName: "Noura", familyName: "Fakename-Al-Rashdi", dob: "1990-09-01", sex: "female", mrn: "MRN-049" },
  { givenName: "Sami", familyName: "Fakename-Al-Qahtani", dob: "1968-06-28", sex: "male", mrn: "MRN-050" },
];

// Indices 5-9 (MRN-006 through MRN-010) are in-scope for dev physician
const IN_SCOPE_INDICES = [5, 6, 7, 8, 9];
// Index 10 (MRN-011) is explicitly out-of-scope
const OUT_OF_SCOPE_INDEX = 10;

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Bypass RLS for seeding
    await client.query("SET LOCAL row_security = off");

    // ── Dev physician user ──────────────────────────────────────────────────

    const userResult = await client.query<{ id: string }>(
      `INSERT INTO app."user"
         (tenant_id, external_subject, email, display_name, preferred_language)
       VALUES ($1, $2, $3, $4, 'ar')
       ON CONFLICT (tenant_id, external_subject) DO UPDATE
         SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [TENANT_ID, DEV_PHYSICIAN_EXTERNAL_SUBJECT, "dev-physician@dev.hospital.local", DEV_PHYSICIAN_DISPLAY_NAME],
    );

    const physicianDbId = userResult.rows[0]?.id;
    if (!physicianDbId) throw new Error("Failed to insert dev physician");

    // Role
    await client.query(
      `INSERT INTO app.user_role (user_id, role)
       VALUES ($1, 'physician')
       ON CONFLICT DO NOTHING`,
      [physicianDbId],
    );

    console.log(`Dev physician ID: ${physicianDbId}`);

    // ── Patients ────────────────────────────────────────────────────────────

    const patientIds: string[] = [];

    for (const p of FAKE_PATIENTS) {
      const displayName = `${p.givenName} ${p.familyName}`;
      // Synthetic national ID hash (obviously fake)
      const fakeNiHash = createHash("sha256")
        .update(`FAKE-NI-${p.mrn}`, "utf8")
        .digest("hex");

      const result = await client.query<{ id: string }>(
        `INSERT INTO hospital.patient
           (source_system, source_id, mrn, national_id_hash, display_name,
            family_name, given_name, date_of_birth, sex, preferred_language,
            fhir_resource_json, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ar',$10::jsonb, now())
         ON CONFLICT (source_system, source_id) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               updated_at = now()
         RETURNING id`,
        [
          "dev-seed",
          p.mrn,
          p.mrn,
          fakeNiHash,
          displayName,
          p.familyName,
          p.givenName,
          p.dob,
          p.sex,
          JSON.stringify({ resourceType: "Patient", id: p.mrn, _synthetic: true }),
        ],
      );

      const pid = result.rows[0]?.id;
      if (!pid) throw new Error(`Failed to insert patient ${p.mrn}`);
      patientIds.push(pid);
    }

    console.log(`Seeded ${patientIds.length} patients`);

    // ── Encounters -- in-scope patients ─────────────────────────────────────

    for (const idx of IN_SCOPE_INDICES) {
      const patientId = patientIds[idx];
      if (!patientId) continue;

      const encId = `ENC-DEV-${FAKE_PATIENTS[idx]!.mrn}`;
      await client.query(
        `INSERT INTO hospital.encounter
           (patient_id, source_system, source_id, encounter_type, status,
            started_at, ward, attending_user_id, fhir_resource_json, last_synced_at)
         VALUES ($1,'dev-seed',$2,'IMP','in-progress',
                 now() - interval '2 days','Ward-4A',$3,
                 $4::jsonb, now())
         ON CONFLICT (source_system, source_id) DO UPDATE
           SET status = 'in-progress', attending_user_id = EXCLUDED.attending_user_id`,
        [
          patientId,
          encId,
          physicianDbId,
          JSON.stringify({ resourceType: "Encounter", id: encId, _synthetic: true }),
        ],
      );
    }

    console.log(`Seeded ${IN_SCOPE_INDICES.length} in-scope encounters`);

    // Out-of-scope patient: no encounter with dev physician
    const outOfScopePatient = patientIds[OUT_OF_SCOPE_INDEX];
    console.log(`Out-of-scope patient ID: ${outOfScopePatient ?? "not found"}`);

    // ── Observations ────────────────────────────────────────────────────────

    const labCodes = [
      { code: "2160-0", display: "Creatinine", unit: "μmol/L", low: 59, high: 104 },
      { code: "718-7",  display: "Hemoglobin", unit: "g/dL",   low: 12, high: 17  },
      { code: "2345-7", display: "Glucose",    unit: "mg/dL",  low: 70, high: 110 },
      { code: "6690-2", display: "WBC",        unit: "10^9/L", low: 4,  high: 11  },
    ];

    for (const pid of patientIds) {
      for (const lab of labCodes) {
        const rawValue = lab.low + Math.random() * (lab.high * 1.3 - lab.low);
        const value = Math.round(rawValue * 10) / 10;

        await client.query(
          `INSERT INTO hospital.observation
             (patient_id, source_system, source_id, category, code_system, code,
              code_display, value_numeric, unit, ref_range_low, ref_range_high,
              ref_range_text, status, effective_at, fhir_resource_json, last_synced_at)
           VALUES ($1,'dev-seed',$2,'laboratory','http://loinc.org',$3,$4,
                   $5,$6,$7,$8,$9,'final',
                   now() - (random()*30)::integer * interval '1 day',
                   $10::jsonb, now())
           ON CONFLICT (source_system, source_id) DO NOTHING`,
          [
            pid,
            `OBS-${pid}-${lab.code}`,
            lab.code,
            lab.display,
            value,
            lab.unit,
            lab.low,
            lab.high,
            `${lab.low}-${lab.high} ${lab.unit}`,
            JSON.stringify({ resourceType: "Observation", _synthetic: true }),
          ],
        );
      }
    }

    // ── Conditions ──────────────────────────────────────────────────────────

    const conditions = [
      { code: "44054006", display: "Diabetes mellitus type 2", status: "active" },
      { code: "38341003", display: "Hypertension",             status: "active" },
    ];

    for (const pid of patientIds.filter((_, i) => i % 3 === 0)) {
      const cond = conditions[Math.floor(Math.random() * conditions.length)]!;
      await client.query(
        `INSERT INTO hospital.condition
           (patient_id, source_system, source_id, code_system, code,
            code_display, status, onset_date, fhir_resource_json, last_synced_at)
         VALUES ($1,'dev-seed',$2,'http://snomed.info/sct',$3,$4,$5,
                 (now() - (random()*1000)::integer * interval '1 day')::date,
                 $6::jsonb, now())
         ON CONFLICT (source_system, source_id) DO NOTHING`,
        [
          pid,
          `COND-${pid}-${cond.code}`,
          cond.code,
          cond.display,
          cond.status,
          JSON.stringify({ resourceType: "Condition", _synthetic: true }),
        ],
      );
    }

    // ── Medications ─────────────────────────────────────────────────────────

    const medications = [
      { display: "Metformin 500mg", code: "372567009", status: "active", dose: "500 mg", route: "Oral", freq: "Twice daily" },
      { display: "Amlodipine 5mg",  code: "372511001", status: "active", dose: "5 mg",   route: "Oral", freq: "Once daily" },
      { display: "Aspirin 100mg",   code: "7947003",   status: "active", dose: "100 mg", route: "Oral", freq: "Once daily" },
    ];

    for (const pid of patientIds.filter((_, i) => i % 2 === 0)) {
      const med = medications[Math.floor(Math.random() * medications.length)]!;
      await client.query(
        `INSERT INTO hospital.medication_request
           (patient_id, source_system, source_id, medication_display, code_system,
            code, dose, route, frequency, status, started_at,
            fhir_resource_json, last_synced_at)
         VALUES ($1,'dev-seed',$2,$3,'http://snomed.info/sct',$4,$5,$6,$7,$8,
                 now() - interval '30 days', $9::jsonb, now())
         ON CONFLICT (source_system, source_id) DO NOTHING`,
        [
          pid,
          `MED-${pid}-${med.code}`,
          med.display,
          med.code,
          med.dose,
          med.route,
          med.freq,
          med.status,
          JSON.stringify({ resourceType: "MedicationRequest", _synthetic: true }),
        ],
      );
    }

    // ── Allergies ───────────────────────────────────────────────────────────

    for (const pid of patientIds.filter((_, i) => i % 4 === 0)) {
      await client.query(
        `INSERT INTO hospital.allergy_intolerance
           (patient_id, source_system, source_id, code_system, code,
            code_display, reaction, recorded_at, fhir_resource_json, last_synced_at)
         VALUES ($1,'dev-seed',$2,'http://www.nlm.nih.gov/research/umls/rxnorm',
                 '7980','Penicillin','Rash',
                 (now() - interval '2 years')::date,
                 $3::jsonb, now())
         ON CONFLICT (source_system, source_id) DO NOTHING`,
        [
          pid,
          `ALLERGY-${pid}-penicillin`,
          JSON.stringify({ resourceType: "AllergyIntolerance", _synthetic: true }),
        ],
      );
    }

    await client.query("COMMIT");
    console.log("Seed completed successfully");
    console.log(`Dev physician external_subject: ${DEV_PHYSICIAN_EXTERNAL_SUBJECT}`);
    console.log(`In-scope patients: MRN-006 through MRN-010`);
    console.log(`Out-of-scope patient: MRN-011`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
