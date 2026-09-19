// Read-only check that the condition provenance columns exist (migration 1721500000000).
// Uses the app's own connection string from .env; the value is never printed.
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const cols = await pool.query(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema='hospital' AND table_name='condition'
      AND column_name IN ('encounter_id','draft_id') ORDER BY column_name`,
);
const idx = await pool.query(
  `SELECT indexname FROM pg_indexes WHERE schemaname='hospital' AND indexname='condition_encounter_idx'`,
);
console.log("columns:", cols.rows.map((r) => r.column_name).join(", ") || "(none)");
console.log("index:", idx.rows[0]?.indexname ?? "(none)");
await pool.end();
