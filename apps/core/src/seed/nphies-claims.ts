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
 * Each claim also carries a diagnosis_codes/procedure_codes pair drawn
 * from the existing ICD-10-AM/SBS vocabulary. Rejection likelihood is
 * biased by whether that pair appears in app.nphies_clinical_mapping
 * (valid pairing -> mostly accepted; unlisted pairing -> mostly
 * rejected), so the historical-pattern check has real, internally
 * consistent signal to report -- a plain retrospective count over past
 * outcomes, not a prediction (see nphies/rejection-risk.service.ts).
 * (This table was app.diagnosis_procedure_compat until migration
 * 1719400000000_nphies-clinical-mapping renamed and extended it --
 * icd10am_code/sbs_code are unchanged, only the table name moved.)
 *
 * Rejection codes here are illustrative dev-only labels, not real NPHIES
 * codes -- see docs/api/08-nphies.md for the live connector's real
 * status/rejection handling once it exists. Each reason also carries a
 * `category` (eligibility / coding / necessity / documentation) purely for
 * this script's own weighting below -- `app.nphies_claim.rejection_codes`
 * stores only the code strings (see admin.controller.ts's rejection
 * analytics query, which aggregates on the raw code), so this category never
 * leaves this file.
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

// Illustrative dev-only rejection reasons (not real NPHIES vocabulary),
// spread across the four categories a real payer rejection would fall
// into: eligibility, coding, necessity, documentation.
type RejectionCategory = "eligibility" | "coding" | "necessity" | "documentation";

const REJECTION_REASONS: ReadonlyArray<{
  code: string;
  display: string;
  category: RejectionCategory;
}> = [
  { code: "DEV-ELIG-01", display: "Eligibility not verified before submission", category: "eligibility" },
  { code: "DEV-COD-02", display: "Diagnosis code missing or unmapped", category: "coding" },
  { code: "DEV-COD-03", display: "Service code missing or unmapped", category: "coding" },
  { code: "DEV-LINK-04", display: "Claim item not linked to a diagnosis", category: "documentation" },
  { code: "DEV-DUP-05", display: "Duplicate claim for this encounter", category: "documentation" },
  { code: "DEV-AUTH-06", display: "Prior authorization required", category: "necessity" },
  { code: "DEV-NEC-07", display: "Service not supported as medically necessary for the stated diagnosis", category: "necessity" },
  { code: "DEV-DOC-08", display: "Supporting clinical documentation not attached", category: "documentation" },
] as const;
const REJECTION_CATEGORY_BY_CODE = new Map(REJECTION_REASONS.map((r) => [r.code, r.category]));

// Reasons that plausibly follow from a payer not recognising the
// diagnosis/procedure pairing (coding + linkage), vs. reasons unrelated to
// pairing at all (eligibility, duplicates, necessity/pre-auth, missing docs).
const PAIRING_REJECTION_REASONS = ["DEV-COD-02", "DEV-COD-03", "DEV-LINK-04"] as const;
const OTHER_REJECTION_REASONS = ["DEV-ELIG-01", "DEV-DUP-05", "DEV-AUTH-06", "DEV-NEC-07", "DEV-DOC-08"] as const;

// Every category is a plausible outcome, but at only ~60 claims and a fixed
// seed, leaving representation purely to chance can (and did, on the first
// pass of this script) roll a zero for one category. Rather than re-rolling
// the seed until the categories happen to line up, the first claim for each
// patient is a deterministic showcase of one category (cycled across the 5
// patients), guaranteeing every category has a real example -- the
// remaining 55 claims are still fully probabilistic.
const CATEGORY_ORDER: readonly RejectionCategory[] = ["eligibility", "coding", "necessity", "documentation"];
const REASON_CODES_BY_CATEGORY: Record<RejectionCategory, readonly string[]> = {
  eligibility: REJECTION_REASONS.filter((r) => r.category === "eligibility").map((r) => r.code),
  coding: REJECTION_REASONS.filter((r) => r.category === "coding").map((r) => r.code),
  necessity: REJECTION_REASONS.filter((r) => r.category === "necessity").map((r) => r.code),
  documentation: REJECTION_REASONS.filter((r) => r.category === "documentation").map((r) => r.code),
};

function pick<T>(arr: readonly T[]): T {
  const item = arr[Math.floor(rng() * arr.length)];
  if (item === undefined) throw new Error("pick() called on empty array");
  return item;
}

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

    const icdCodes = await client.query<{ icd10am_code: string }>(
      `SELECT DISTINCT icd10am_code FROM app.snomed_icd10am_map`,
    );
    const sbsCodes = await client.query<{ sbs_code: string }>(
      `SELECT DISTINCT sbs_code FROM app.order_sbs_map`,
    );
    const compat = await client.query<{ icd10am_code: string; sbs_code: string }>(
      `SELECT icd10am_code, sbs_code FROM app.nphies_clinical_mapping`,
    );
    const compatSet = new Set(compat.rows.map((r) => `${r.icd10am_code}|${r.sbs_code}`));
    const icdList = icdCodes.rows.map((r) => r.icd10am_code);
    const sbsList = sbsCodes.rows.map((r) => r.sbs_code);
    const compatPairs = compat.rows;
    if (icdList.length === 0 || sbsList.length === 0 || compatPairs.length === 0) {
      throw new Error("ICD-10-AM / SBS / compatibility reference data not found -- run migrations first");
    }

    let inserted = 0;
    let rejected = 0;
    const CLAIMS_PER_PATIENT = 12;
    const DAYS_SPAN = 90;
    const categoryTally: Record<RejectionCategory, number> = {
      eligibility: 0,
      coding: 0,
      necessity: 0,
      documentation: 0,
    };

    for (const [patientIndex, patient] of patients.rows.entries()) {
      for (let i = 0; i < CLAIMS_PER_PATIENT; i++) {
        const daysAgo = Math.floor(rng() * DAYS_SPAN);
        // Half the time draw a known-valid pairing, half the time draw two
        // independent codes (usually landing outside the compat table,
        // since it's small relative to the full code space) -- this keeps
        // both buckets populated with real examples for the historical
        // check to report on, instead of both codes being pure noise.
        let diagnosisCode: string;
        let procedureCode: string;
        if (rng() < 0.5) {
          const validPair = pick(compatPairs);
          diagnosisCode = validPair.icd10am_code;
          procedureCode = validPair.sbs_code;
        } else {
          diagnosisCode = pick(icdList);
          procedureCode = pick(sbsList);
        }
        const isValidPairing = compatSet.has(`${diagnosisCode}|${procedureCode}`);

        // This patient's first claim showcases one category outright (see
        // CATEGORY_ORDER above); every other claim is fully probabilistic,
        // biased by pairing validity -- internally consistent with the
        // compatibility check, not independent noise.
        const showcaseCategory = i === 0 ? CATEGORY_ORDER[patientIndex % CATEGORY_ORDER.length] : undefined;
        const rejectionChance = isValidPairing ? 0.12 : 0.55;
        const isRejected = showcaseCategory !== undefined || rng() < rejectionChance;
        const status = isRejected ? "rejected" : "accepted";

        const rejectionCodes: string[] = [];
        if (isRejected) {
          if (showcaseCategory !== undefined) {
            rejectionCodes.push(pick(REASON_CODES_BY_CATEGORY[showcaseCategory]));
          } else {
            // If the pairing is invalid, the rejection is plausibly a
            // coding/linkage reason; otherwise pick from the other reasons.
            const pool_ = isValidPairing ? OTHER_REJECTION_REASONS : PAIRING_REJECTION_REASONS;
            rejectionCodes.push(pick(pool_));
          }
          if (rng() < 0.25) {
            const second = pick(REJECTION_REASONS).code;
            if (!rejectionCodes.includes(second)) rejectionCodes.push(second);
          }
          for (const code of rejectionCodes) {
            const category = REJECTION_CATEGORY_BY_CODE.get(code);
            if (category) categoryTally[category]++;
          }
        }

        const bundle = {
          resourceType: "Claim",
          status: "active",
          patient: { reference: `Patient/${patient.mrn}` },
          diagnosis: [{ sequence: 1, diagnosisCodeableConcept: { coding: [{ code: diagnosisCode }] } }],
          item: [{ sequence: 1, diagnosisSequence: [1], productOrService: { coding: [{ code: procedureCode }] } }],
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
             (patient_id, bundle_json, status, rejection_codes, diagnosis_codes, procedure_codes,
              response_json, mode, submitted_by, submitted_at)
           VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7::jsonb, 'stub', $8, now() - ($9 || ' days')::interval)`,
          [
            patient.id,
            JSON.stringify(bundle),
            status,
            rejectionCodes,
            [diagnosisCode],
            [procedureCode],
            JSON.stringify(response),
            submittedBy,
            String(daysAgo),
          ],
        );
        inserted++;
        if (isRejected) rejected++;
      }
    }

    // ─── Claim-simulator demo artifacts (E3) ──────────────────────────────
    // The seeded batch's patients have documented conditions but no clinician
    // coding/linkage, so "check before you send" would never exercise the
    // necessity lookup. These rows are the same rows the confirm/link
    // endpoints write, representing clinicians who already did that work:
    //   1. every mappable active condition gets its reference-map ICD-10-AM
    //      confirmation;
    //   2. three patients get one coded, linked order each, chosen so the
    //      NPHIES_JUSTIFIES graph returns GREEN twice (documented rule, no
    //      pre-auth) and RED once (no documented rule -- the flagged, at-risk
    //      case the coder queue exists for).
    // Fully deterministic and idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.
    await client.query(
      `INSERT INTO app.condition_icd_coding
         (condition_id, patient_id, snomed_code, icd10am_code, icd10am_display, confirmed_by)
       SELECT c.id, c.patient_id, c.code, m.icd10am_code, m.icd10am_display, $1
       FROM hospital.condition c
       JOIN app.snomed_icd10am_map m ON m.snomed_code = c.code
       WHERE c.patient_id = ANY($2::uuid[]) AND c.status = 'active'
       ON CONFLICT (condition_id) DO NOTHING`,
      [submittedBy, patients.rows.map((p) => p.id)],
    );

    const SIMULATOR_CASES: ReadonlyArray<{
      mrn: string;
      conditionSnomed: string;
      orderId: string;
      orderCode: string;
      category: string;
      sbsCode: string;
    }> = [
      // I10 (hypertension) -> ECG: documented rule, no pre-auth -> GREEN.
      { mrn: "MRN-006", conditionSnomed: "38341003", orderId: "00000000-0000-4000-8000-0000000000b1", orderCode: "29303009", category: "procedure", sbsCode: "11700-00-10" },
      // E11.9 (T2DM) -> HbA1c: documented rule, no pre-auth -> GREEN.
      { mrn: "MRN-008", conditionSnomed: "44054006", orderId: "00000000-0000-4000-8000-0000000000b2", orderCode: "43396009", category: "laboratory", sbsCode: "66551-00-10" },
      // E11.9 (T2DM) -> lumbar MRI: NO documented rule -> RED (conservative
      // pre-auth default) -- the at-risk finding for the coder review queue.
      { mrn: "MRN-007", conditionSnomed: "44054006", orderId: "00000000-0000-4000-8000-0000000000b3", orderCode: "113091000", category: "imaging", sbsCode: "63001-00-10" },
    ];

    for (const demoCase of SIMULATOR_CASES) {
      const patient = patients.rows.find((p) => p.mrn === demoCase.mrn);
      if (!patient) continue;
      const condition = await client.query<{ id: string }>(
        `SELECT id FROM hospital.condition
         WHERE patient_id = $1 AND code = $2 AND status = 'active'
         ORDER BY onset_date NULLS LAST, id LIMIT 1`,
        [patient.id, demoCase.conditionSnomed],
      );
      const conditionId = condition.rows[0]?.id;
      if (!conditionId) continue;
      const sbsRow = await client.query<{ sbs_display: string }>(
        `SELECT sbs_display FROM app.order_sbs_map WHERE sbs_code = $1`,
        [demoCase.sbsCode],
      );
      const sbsDisplay = sbsRow.rows[0]?.sbs_display ?? demoCase.sbsCode;

      await client.query(
        `INSERT INTO app.service_request
           (id, patient_id, category, code_system, code, code_display, status, intent, requested_by, requested_at)
         VALUES ($1, $2, $3, 'http://snomed.info/sct', $4, $5, 'active', 'order', $6, now() - interval '2 days')
         ON CONFLICT (id) DO NOTHING`,
        [demoCase.orderId, patient.id, demoCase.category, demoCase.orderCode, sbsDisplay, submittedBy],
      );
      await client.query(
        `INSERT INTO app.service_request_sbs_coding
           (service_request_id, patient_id, order_code, sbs_code, sbs_display, confirmed_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (service_request_id) DO NOTHING`,
        [demoCase.orderId, patient.id, demoCase.orderCode, demoCase.sbsCode, sbsDisplay, submittedBy],
      );
      await client.query(
        `INSERT INTO app.service_request_diagnosis_link
           (service_request_id, condition_id, patient_id, linked_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (service_request_id, condition_id) DO NOTHING`,
        [demoCase.orderId, conditionId, patient.id, submittedBy],
      );
    }

    await client.query("COMMIT");
    console.log(`Seeded ${inserted} historical NPHIES claims (${rejected} rejected, ${inserted - rejected} accepted)`);
    console.log(
      `Rejection reasons by category: eligibility=${categoryTally.eligibility}, ` +
        `coding=${categoryTally.coding}, necessity=${categoryTally.necessity}, ` +
        `documentation=${categoryTally.documentation}`,
    );
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
