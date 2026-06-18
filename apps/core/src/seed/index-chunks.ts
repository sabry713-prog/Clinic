/**
 * E2 record-search indexer (text-only).
 *
 * Populates hospital.retrieval_chunk with verbatim text from the record so the
 * full-text search endpoint has content. Embeddings are left NULL — dev/Stage-1
 * search uses Postgres full-text (the existing GIN tsvector index); vector
 * search is wired separately once the on-prem embedder is provisioned.
 *
 * Indexes the in-scope patients (MRN-006..010). Idempotent via the table's
 * unique key (patient_id, source_type, source_id, chunk_index, language).
 *
 * Run: pnpm --filter @app/core seed:index
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../../../.env") });

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
const IN_SCOPE_MRNS = ["MRN-006", "MRN-007", "MRN-008", "MRN-009", "MRN-010"];

interface Chunk {
  source_type: string;
  source_id: string;
  content_text: string;
  language: string;
}

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL row_security = off");

    const patients = await client.query<{ id: string; mrn: string }>(
      `SELECT id, mrn FROM hospital.patient WHERE mrn = ANY($1)`,
      [IN_SCOPE_MRNS],
    );

    let total = 0;
    for (const { id: pid } of patients.rows) {
      const chunks: Chunk[] = [];

      const conds = await client.query(
        `SELECT id, code_display, code, status, onset_date::text FROM hospital.condition WHERE patient_id=$1`,
        [pid],
      );
      for (const r of conds.rows) {
        chunks.push({
          source_type: "condition", source_id: r.id, language: "en",
          content_text: `Condition: ${r.code_display ?? r.code ?? "Unknown"} (status: ${r.status ?? "unknown"}${r.onset_date ? `, onset: ${r.onset_date}` : ""}).`,
        });
      }

      const obs = await client.query(
        `SELECT id, category, code_display, value_numeric, value_text, unit,
                ref_range_low, ref_range_high, ref_range_text, effective_at::text
           FROM hospital.observation WHERE patient_id=$1`,
        [pid],
      );
      for (const r of obs.rows) {
        const val = r.value_numeric !== null ? `${r.value_numeric}${r.unit ? " " + r.unit : ""}` : (r.value_text ?? "");
        const ref = r.ref_range_low !== null && r.ref_range_high !== null
          ? ` (ref: ${r.ref_range_low}-${r.ref_range_high}${r.unit ? " " + r.unit : ""})`
          : r.ref_range_text ? ` (ref: ${r.ref_range_text})` : "";
        chunks.push({
          source_type: "observation", source_id: r.id, language: "en",
          content_text: `${r.category ?? "Lab"}: ${r.code_display ?? "Observation"} = ${val}${ref} (recorded: ${r.effective_at ?? "unknown"}).`,
        });
      }

      const meds = await client.query(
        `SELECT id, medication_display, dose, route, frequency, status, started_at::text FROM hospital.medication_request WHERE patient_id=$1`,
        [pid],
      );
      for (const r of meds.rows) {
        chunks.push({
          source_type: "medication", source_id: r.id, language: "en",
          content_text: `Medication: ${r.medication_display ?? "Unknown"} ${[r.dose, r.route, r.frequency].filter(Boolean).join(" ")} (status: ${r.status ?? "unknown"}).`,
        });
      }

      const algs = await client.query(
        `SELECT id, code_display, reaction, recorded_at::text FROM hospital.allergy_intolerance WHERE patient_id=$1`,
        [pid],
      );
      for (const r of algs.rows) {
        chunks.push({
          source_type: "allergy", source_id: r.id, language: "en",
          content_text: `Allergy: ${r.code_display ?? "Unknown"} reaction: ${r.reaction ?? "unspecified"} (recorded: ${r.recorded_at ?? "unknown"}).`,
        });
      }

      const docs = await client.query(
        `SELECT id, type, content_text, author_display, authored_at::text FROM hospital.document_reference WHERE patient_id=$1`,
        [pid],
      );
      for (const r of docs.rows) {
        if (!r.content_text) continue;
        chunks.push({
          source_type: "document", source_id: r.id, language: "en",
          content_text: `${r.type ?? "Note"}${r.author_display ? ` by ${r.author_display}` : ""} (${r.authored_at ?? "unknown"}): ${r.content_text}`,
        });
      }

      for (const c of chunks) {
        await client.query(
          `INSERT INTO hospital.retrieval_chunk
             (patient_id, source_type, source_id, content_text, content_lang, language, chunk_index)
           VALUES ($1,$2,$3,$4,$5,$5,0)
           ON CONFLICT (patient_id, source_type, source_id, chunk_index, language)
             DO UPDATE SET content_text = EXCLUDED.content_text, updated_at = now()`,
          [pid, c.source_type, c.source_id, c.content_text, c.language],
        );
        total++;
      }
    }

    await client.query("COMMIT");
    console.log(`Indexed ${total} chunks across ${patients.rows.length} patients (text-only).`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Indexer seed failed:", err);
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
