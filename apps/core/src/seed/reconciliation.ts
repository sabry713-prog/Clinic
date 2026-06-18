/**
 * E1 reconciliation seed.
 *
 * Gives one in-scope patient (MRN-006) two medication source feeds — an "ehr"
 * list and a "pharmacy" list — with deliberate, factual discrepancies so the
 * medication reconciliation view has something to show:
 *   - a medication documented in EHR but not pharmacy
 *   - a medication documented in pharmacy but not EHR
 *   - a medication in both with different documented dose strings
 *
 * Synthetic data only. Idempotent via ON CONFLICT (source_system, source_id).
 *
 * Run: pnpm --filter @app/core seed:reconciliation
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../../.env") });

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

const TARGET_MRN = "MRN-006";

interface Med {
  source: "ehr" | "pharmacy";
  code: string;
  display: string;
  dose: string;
  route: string;
  freq: string;
}

// Reconcilable pair of feeds with three kinds of difference.
const MEDS: Med[] = [
  // In both, dose agrees
  { source: "ehr", code: "860975", display: "Metformin", dose: "500 mg", route: "Oral", freq: "Twice daily" },
  { source: "pharmacy", code: "860975", display: "Metformin", dose: "500 mg", route: "Oral", freq: "Twice daily" },
  // In both, DOSE DIFFERS (5 mg EHR vs 10 mg pharmacy)
  { source: "ehr", code: "197361", display: "Amlodipine", dose: "5 mg", route: "Oral", freq: "Once daily" },
  { source: "pharmacy", code: "197361", display: "Amlodipine", dose: "10 mg", route: "Oral", freq: "Once daily" },
  // Only in EHR
  { source: "ehr", code: "617314", display: "Atorvastatin", dose: "20 mg", route: "Oral", freq: "Once daily at night" },
  // Only in pharmacy
  { source: "pharmacy", code: "855288", display: "Warfarin", dose: "5 mg", route: "Oral", freq: "Once daily" },
];

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL row_security = off");

    const pidRes = await client.query<{ id: string }>(
      `SELECT id FROM hospital.patient WHERE mrn = $1`,
      [TARGET_MRN],
    );
    const pid = pidRes.rows[0]?.id;
    if (!pid) throw new Error(`Patient ${TARGET_MRN} not found — run seed:dev first`);

    // MRN-006 is the dedicated reconciliation demo patient: clear ALL prior
    // medications so the view shows a clean EHR-vs-pharmacy comparison.
    await client.query(
      `DELETE FROM hospital.medication_request WHERE patient_id = $1`,
      [pid],
    );

    let n = 0;
    for (const m of MEDS) {
      const startedDaysAgo = m.source === "ehr" ? 30 : 28; // pharmacy slightly later
      await client.query(
        `INSERT INTO hospital.medication_request
           (patient_id, source_system, source_id, medication_display, code_system,
            code, dose, route, frequency, status, started_at,
            fhir_resource_json, last_synced_at)
         VALUES ($1,$2,$3,$4,'http://www.nlm.nih.gov/research/umls/rxnorm',
                 $5,$6,$7,$8,'active', now() - $9 * interval '1 day', $10::jsonb, now())
         ON CONFLICT (source_system, source_id) DO NOTHING`,
        [
          pid,
          m.source,
          `${m.source}-${TARGET_MRN}-${m.code}`,
          m.display,
          m.code,
          m.dose,
          m.route,
          m.freq,
          startedDaysAgo,
          JSON.stringify({ resourceType: "MedicationRequest", _synthetic: true, feed: m.source }),
        ],
      );
      n++;
    }

    await client.query("COMMIT");
    console.log(`Reconciliation seed: ${n} medications across ehr/pharmacy for ${TARGET_MRN}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Reconciliation seed failed:", err);
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
