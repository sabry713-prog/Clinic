/**
 * A sample of order lifecycle, for the ordering step to be demonstrable.
 *
 * One patient gets an echocardiogram order that has been marked completed, so the sequencing
 * rule has something to read and the two states can be seen side by side:
 *   MRN-001  echo present, no result linked  -> "ordered, awaiting result"
 *   others   no echo at all                  -> "not on file"
 *
 * No result is fabricated. An observation and its basedOn link would normally arrive from the
 * HIS, which this prototype does not have -- so the "resulted" state stays unreachable in dev,
 * deliberately, and the wording in the UI says which of the two it is.
 */
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../.env") });

const ECHO_SNOMED = "40701008";

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM hospital.patient WHERE mrn = 'MRN-001' LIMIT 1`,
    );
    const patientId = found.rows[0]?.id;
    if (!patientId) {
      console.log("MRN-001 not present; nothing to seed");
      return;
    }
    const res = await pool.query(
      `INSERT INTO app.service_request
         (patient_id, category, code_system, code, code_display, status, intent,
          source_type, source_excerpt, requested_by)
       SELECT $1,'procedure','http://snomed.info/sct',$2,'Echocardiography','completed','order',
              'dev-seed','Completed before this encounter; recorded so the sequencing rule has a case.', $1
        WHERE NOT EXISTS (
          SELECT 1 FROM app.service_request s WHERE s.patient_id = $1 AND s.code = $2
        )`,
      [patientId, ECHO_SNOMED],
    );
    console.log(`Seeded ${res.rowCount ?? 0} completed echocardiogram order for MRN-001`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
