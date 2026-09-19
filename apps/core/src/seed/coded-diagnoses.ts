/**
 * Code the diagnoses that are already on file.
 *
 * The ordering step's payer check reads CODED diagnoses (app.condition_icd_coding), not the
 * narrative ones, because a claim is judged on codes. Five of the seeded cohort carried
 * documented conditions with no coding, so their orders showed "not checkable" -- correct, but
 * it makes the demo inconsistent depending on which patient is opened.
 *
 * Nothing is invented here. Each row is produced by taking a condition that already exists on the
 * patient's record and looking its SNOMED code up in the repository's own app.snomed_icd10am_map.
 * A condition the map does not cover is left uncoded and counted in the report, because a guessed
 * ICD code would be the same class of error as a guessed SBS code.
 */
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../../.env") });

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Same as the other seeds: these tables are under row-level security, and the seed writes on
    // behalf of the whole cohort, not one session's scope.
    await client.query("SET LOCAL row_security = off");
    const who = await client.query<{ id: string }>(
      `SELECT id FROM app."user" ORDER BY created_at LIMIT 1`,
    );
    const confirmedBy = who.rows[0]?.id;
    if (!confirmedBy) {
      console.log("No user to attribute the coding to; nothing seeded");
      return;
    }

    const coded = await client.query(
      `INSERT INTO app.condition_icd_coding
         (condition_id, patient_id, snomed_code, icd10am_code, icd10am_display, confirmed_by)
       SELECT c.id, c.patient_id, c.code, m.icd10am_code, m.icd10am_display, $1
         FROM hospital.condition c
         JOIN hospital.patient p ON p.id = c.patient_id
         JOIN app.snomed_icd10am_map m ON m.snomed_code = c.code
        WHERE p.mrn ~ '^MRN-[0-9]{3}$'
          AND NOT EXISTS (SELECT 1 FROM app.condition_icd_coding x WHERE x.condition_id = c.id)`,
      [confirmedBy],
    );

    const uncoded = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM hospital.condition c
         JOIN hospital.patient p ON p.id = c.patient_id
        WHERE p.mrn ~ '^MRN-[0-9]{3}$'
          AND NOT EXISTS (SELECT 1 FROM app.snomed_icd10am_map m WHERE m.snomed_code = c.code)`,
    );

    console.log(`Coded ${coded.rowCount ?? 0} diagnosis(es) from the repository's own SNOMED->ICD map`);
    console.log(`Left uncoded: ${uncoded.rows[0]?.n ?? 0} condition(s) the map does not cover`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
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
