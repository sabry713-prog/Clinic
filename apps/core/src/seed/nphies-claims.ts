/**
 * Historical NPHIES claim seed — synthetic development data only.
 *
 * The stub connector (see nphies/connector.service.ts) always returns
 * "accepted" for newly submitted claims, so without this script the
 * rejection-analytics dashboard would have nothing to show. This inserts
 * a spread of historical claims directly into app.nphies_claim with a
 * realistic accepted/rejected mix, using deterministic randomness so the
 * dashboard looks the same on every machine.
 *
 * Rejection codes here are illustrative dev-only labels, not real NPHIES
 * codes -- see docs/api/08-nphies.md for the live connector's real
 * status/rejection handling once it exists.
 *
 * Run: pnpm --filter @app/core seed:nphies-claims
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../../.env") });

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });

// Same deterministic PRNG as seed/dev.ts, seeded independently so this
// script's output doesn't depend on run order relative to the other seeds.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(919191);

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const DEV_ADMIN_EXTERNAL_SUBJECT = "00000000-0000-0000-0000-000000000012";

// Illustrative dev-only rejection reasons (not real NPHIES vocabulary).
const REJECTION_REASONS = [
  { code: "DEV-ELIG-01", display: "Eligibility not verified before submission" },
  { code: "DEV-COD-02", display: "Diagnosis code missing or unmapped" },
  { code: "DEV-COD-03", display: "Service code missing or unmapped" },
  { code: "DEV-LINK-04", display: "Claim item not linked to a diagnosis" },
  { code: "DEV-DUP-05", display: "Duplicate claim for this encounter" },
  { code: "DEV-AUTH-06", display: "Prior authorization required" },
] as const;

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL row_security = off");

    const admin = await client.query<{ id: string }>(
      `SELECT id FROM app."user" WHERE tenant_id = $1 AND external_subject = $2`,
      [TENANT_ID, DEV_ADMIN_EXTERNAL_SUBJECT],
    );
    const submittedBy = admin.rows[0]?.id;
    if (!submittedBy) {
      throw new Error("Dev admin user not found -- run seed:dev first");
    }

    const patients = await client.query<{ id: string; mrn: string }>(
      `SELECT id, mrn FROM hospital.patient WHERE mrn IN ('MRN-006','MRN-007','MRN-008','MRN-009','MRN-010')`,
    );
    if (patients.rows.length === 0) {
      throw new Error("In-scope patients not found -- run seed:dev first");
    }

    let inserted = 0;
    let rejected = 0;
    const CLAIMS_PER_PATIENT = 12;
    const DAYS_SPAN = 90;

    for (const patient of patients.rows) {
      for (let i = 0; i < CLAIMS_PER_PATIENT; i++) {
        const daysAgo = Math.floor(rng() * DAYS_SPAN);
        const isRejected = rng() < 0.3; // ~30% rejection rate, illustrative
        const status = isRejected ? "rejected" : "accepted";

        const rejectionCodes: string[] = [];
        if (isRejected) {
          const numReasons = rng() < 0.75 ? 1 : 2;
          const shuffled = [...REJECTION_REASONS].sort(() => rng() - 0.5);
          for (let r = 0; r < numReasons; r++) {
            const reason = shuffled[r];
            if (reason) rejectionCodes.push(reason.code);
          }
        }

        const bundle = {
          resourceType: "Claim",
          status: "active",
          patient: { reference: `Patient/${patient.mrn}` },
          item: [{ sequence: 1 }],
        };
        const response = isRejected
          ? {
              resourceType: "ClaimResponse",
              outcome: "error",
              disposition: "Stub connector -- synthetic historical rejection (dev seed).",
            }
          : {
              resourceType: "ClaimResponse",
              outcome: "complete",
              disposition: "Stub connector -- synthetic historical acceptance (dev seed).",
            };

        await client.query(
          `INSERT INTO app.nphies_claim
             (patient_id, bundle_json, status, rejection_codes, response_json, mode, submitted_by, submitted_at)
           VALUES ($1, $2::jsonb, $3, $4, $5::jsonb, 'stub', $6, now() - ($7 || ' days')::interval)`,
          [
            patient.id,
            JSON.stringify(bundle),
            status,
            rejectionCodes,
            JSON.stringify(response),
            submittedBy,
            String(daysAgo),
          ],
        );
        inserted++;
        if (isRejected) rejected++;
      }
    }

    await client.query("COMMIT");
    console.log(`Seeded ${inserted} historical NPHIES claims (${rejected} rejected, ${inserted - rejected} accepted)`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("NPHIES claim seed failed:", err);
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
