/**
 * M04 — proof that the patient-scope policies actually bind, run against a real
 * database.
 *
 * The policies have never evaluated once: the application connects as the
 * container bootstrap superuser, which bypasses row-level security
 * unconditionally. Reading the policy text proves nothing, so this spec puts a
 * session into the least-privilege runtime role (`app_runtime`, created by
 * 1720800000000_rls-enforcement) and exercises the policies for real.
 *
 * Opt in with RLS_INTEGRATION=1 and a DATABASE_URL. Without them the suite skips,
 * so a CI box with no database stays green. Everything runs inside transactions
 * that are rolled back, so the database is left untouched.
 *
 * What it establishes:
 *   - a superuser/owner session reads hospital.* unscoped (the documented bypass);
 *   - `app_runtime` reads nothing without `app.current_user_id` set;
 *   - an EXPIRED scope row grants nothing -- which is the state the seeded data is
 *     in today, and the reason enforcement cannot simply be switched on;
 *   - an unexpired scope row grants exactly that patient, and nothing else;
 *   - the runtime role cannot write to the hospital's record of record;
 *   - application tables are unaffected (they carry no policy).
 */
import { Client } from "pg";

const ENABLED = process.env.RLS_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const describeRls = ENABLED ? describe : describe.skip;

interface Row {
  [key: string]: unknown;
}

async function withTransaction<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

const count = async (client: Client, sql: string): Promise<number> => {
  const res = await client.query<{ n: string }>(sql);
  return Number(res.rows[0]?.n ?? "-1");
};

describeRls("RLS patient-scope enforcement (M04)", () => {
  // A user and one scoped patient, taken from whatever the database holds.
  let userId: string;
  let patientId: string;

  beforeAll(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const user = await client.query<Row>(
        `SELECT id::text FROM app."user" ORDER BY created_at LIMIT 1`,
      );
      const patient = await client.query<Row>(
        `SELECT id::text FROM hospital.patient WHERE mrn LIKE 'MRN-%' ORDER BY mrn LIMIT 1`,
      );
      userId = String(user.rows[0]?.id ?? "");
      patientId = String(patient.rows[0]?.id ?? "");
    } finally {
      await client.end();
    }
    expect(userId).not.toBe("");
    expect(patientId).not.toBe("");
  });

  it("the role exists and cannot bypass RLS", async () => {
    await withTransaction(async (client) => {
      const res = await client.query<Row>(
        `SELECT rolsuper::text AS super, rolbypassrls::text AS bypass
           FROM pg_roles WHERE rolname = 'app_runtime'`,
      );
      expect(res.rows[0]).toEqual({ super: "false", bypass: "false" });
    });
  });

  it("the owner session reads the whole record (the bypass, stated explicitly)", async () => {
    await withTransaction(async (client) => {
      const total = await count(client, "SELECT count(*)::text AS n FROM hospital.patient");
      expect(total).toBeGreaterThan(0);
    });
  });

  // If this ever returns the full count, enforcement has been switched off again.
  it("the runtime role reads nothing without a session user", async () => {
    await withTransaction(async (client) => {
      await client.query("SET LOCAL ROLE app_runtime");
      const total = await count(client, "SELECT count(*)::text AS n FROM hospital.patient");
      expect(total).toBe(0);
    });
  });

  it("an expired scope grants nothing", async () => {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO app.patient_scope (user_id, patient_id, source, expires_at)
         VALUES ($1, $2, 'rls-spec', now() - interval '1 day')`,
        [userId, patientId],
      );
      await client.query("SET LOCAL ROLE app_runtime");
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      const total = await count(client, "SELECT count(*)::text AS n FROM hospital.patient");
      expect(total).toBe(0);
    });
  });

  it("an unexpired scope grants exactly that patient and nothing else", async () => {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO app.patient_scope (user_id, patient_id, source, expires_at)
         VALUES ($1, $2, 'rls-spec', now() + interval '1 day')`,
        [userId, patientId],
      );
      await client.query("SET LOCAL ROLE app_runtime");
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);

      const visible = await client.query<Row>(
        "SELECT id::text AS id FROM hospital.patient",
      );
      expect(visible.rows.map((r) => r.id)).toEqual([patientId]);

      // and the related tables are scoped by the same rule
      const encounters = await count(
        client,
        `SELECT count(*)::text AS n FROM hospital.encounter WHERE patient_id <> '${patientId}'`,
      );
      expect(encounters).toBe(0);
    });
  });

  it("clearing the session user scopes the same connection back to nothing", async () => {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO app.patient_scope (user_id, patient_id, source, expires_at)
         VALUES ($1, $2, 'rls-spec', now() + interval '1 day')`,
        [userId, patientId],
      );
      await client.query("SET LOCAL ROLE app_runtime");
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
      expect(await count(client, "SELECT count(*)::text AS n FROM hospital.patient")).toBe(1);

      await client.query("SELECT set_config('app.current_user_id', '', true)");
      expect(await count(client, "SELECT count(*)::text AS n FROM hospital.patient")).toBe(0);
    });
  });

  it("the runtime role cannot write the hospital's record of record", async () => {
    await withTransaction(async (client) => {
      await client.query("SET LOCAL ROLE app_runtime");
      await expect(
        client.query("INSERT INTO hospital.patient (display_name) VALUES ('nope')"),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it("application tables are unaffected -- they carry no policy", async () => {
    await withTransaction(async (client) => {
      await client.query("SET LOCAL ROLE app_runtime");
      const total = await count(client, "SELECT count(*)::text AS n FROM app.patient_scope");
      expect(total).toBeGreaterThan(0);
    });
  });
});
