/**
 * Dev cover for the seeded cohort.
 *
 * The payer NAMES are real Saudi insurers (public companies, as a real claims desk would see
 * them). The policy numbers, member ids and plan names are SYNTHETIC and marked `synthetic` --
 * nothing here is a payer record, and the grid differs per patient on purpose: the whole point
 * is that cover is not uniform, so a check that ignores it is wrong for some patients.
 */
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

interface Cover {
  readonly mrn: string;
  readonly payer: string;
  readonly policy: string;
  readonly member: string;
  readonly plan: string;
  readonly tier: string;
  readonly klass: string;
}

const COVERS: readonly Cover[] = [
  { mrn: "MRN-001", payer: "Bupa Arabia", policy: "BUPA-DEV-000101", member: "000101", plan: "Bupa Gold", tier: "A", klass: "VIP" },
  { mrn: "MRN-002", payer: "Tawuniya", policy: "TAW-DEV-000202", member: "000202", plan: "Tawuniya Blue", tier: "B", klass: "A" },
  { mrn: "MRN-003", payer: "MedGulf", policy: "MG-DEV-000303", member: "000303", plan: "MedGulf Comprehensive", tier: "A", klass: "A" },
  { mrn: "MRN-004", payer: "Al Rajhi Takaful", policy: "ART-DEV-000404", member: "000404", plan: "Rajhi Care Plus", tier: "B", klass: "B" },
  { mrn: "MRN-005", payer: "Saudi Enaya", policy: "ENA-DEV-000505", member: "000505", plan: "Enaya Standard", tier: "C", klass: "B" },
  { mrn: "MRN-051", payer: "Bupa Arabia", policy: "BUPA-DEV-000551", member: "000551", plan: "Bupa Silver", tier: "B", klass: "A" },
];

export async function seedPatientInsurance(pool: Pool): Promise<number> {
  let written = 0;
  for (const c of COVERS) {
    const res = await pool.query<{ id: string }>(
      `SELECT id FROM hospital.patient WHERE mrn = $1 LIMIT 1`,
      [c.mrn],
    );
    const patientId = res.rows[0]?.id;
    if (!patientId) continue;
    await pool.query(
      `INSERT INTO app.patient_insurance
         (patient_id, payer_name, policy_number, member_id, plan_name, network_tier, class, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'synthetic')
       ON CONFLICT (payer_name, policy_number, member_id) DO NOTHING`,
      [patientId, c.payer, c.policy, c.member, c.plan, c.tier, c.klass],
    );
    written += 1;
  }
  return written;
}

dotenv.config({ path: resolve(__dirname, "../../../.env") });

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const written = await seedPatientInsurance(pool);
    console.log(`Seeded ${written} patient insurance cover rows (synthetic policies, real payer names)`);
  } catch (err) {
    console.error("Patient insurance seed failed:", err);
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
