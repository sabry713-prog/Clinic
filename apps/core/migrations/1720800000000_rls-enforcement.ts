import type { MigrationBuilder } from "node-pg-migrate";

/**
 * M04 — make the row-level-security model enforceable, without switching it on.
 *
 * The audit said "owner roles bypass policies". Checked against the live
 * database, the situation was worse and simpler: the application connects as
 * `app`, which is the *container bootstrap superuser* (`rolsuper = t`,
 * `rolbypassrls = t`). A superuser bypasses row-level security unconditionally --
 * `FORCE ROW LEVEL SECURITY` does not change that -- so the ten hospital.*
 * policies have never evaluated once, and `app.current_user_id`, which every one
 * of them reads, is never set by any code path in the repository.
 *
 * Three things are true at the same time and each alone would defeat the policy:
 *
 *   1. the runtime role is a superuser (unconditional bypass);
 *   2. `relforcerowsecurity` is false, so even a plain owner would bypass;
 *   3. the session setting the policy filters on is never populated -- so if the
 *      policy *were* enforced today, every read of hospital.* would return zero
 *      rows. See the integration spec for what that means in practice.
 *
 * This migration does the part that is behaviour-neutral for the current
 * deployment and necessary for enforcement anyway:
 *
 *   - creates `app_runtime`, a NOLOGIN, NOSUPERUSER, NOBYPASSRLS role, granted to
 *     the owner so a runner can `SET ROLE app_runtime` per connection;
 *   - grants it least privilege: SELECT on the ingested record (hospital.*),
 *     read/write on the application tables and the audit trail. It deliberately
 *     gets no INSERT/UPDATE/DELETE on hospital.* -- those tables hold the
 *     hospital's record of record and are written by ingestion, not by a
 *     clinician's browser session;
 *   - turns ON `FORCE ROW LEVEL SECURITY` for the nine tables that both carry a
 *     patient-scope policy and have RLS enabled, so the policies bind for the
 *     owner too, and not only for a future non-owner.
 *
 * None of this changes what any query returns today: the application still
 * connects as a superuser, which ignores all of it. Switching the application
 * onto `app_runtime` is a separate, deliberate change with a visible
 * consequence (see the spec and the audit): the patient_scope rows are all
 * expired, so an enforced read returns nothing until scopes are re-seeded.
 */

const POLICY_TABLES = [
  "hospital.allergy_intolerance",
  "hospital.condition",
  "hospital.document_reference",
  "hospital.encounter",
  "hospital.medication_request",
  "hospital.observation",
  "hospital.patient",
  "hospital.procedure",
  "hospital.retrieval_chunk",
  // NOTE: hospital.appointment is deliberately absent. It is a patient-linked
  // table whose RLS is *disabled* and which carries no policy at all, so FORCE
  // alone would be a no-op there (FORCE only matters once ENABLE is set).
  // Scoping it needs an INSERT policy as well, because appointments are booked
  // -- that is part of switching enforcement on, not of preparing for it.
] as const;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // The role is cluster-scoped, so it may already exist from a previous run or
  // from another database in the same cluster.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END
    $$;
  `);

  // The owner must be able to hand a connection to the runtime role; without
  // membership, SET ROLE fails and enforcement is unreachable.
  pgm.sql(`GRANT app_runtime TO app;`);

  // Schema access.
  pgm.sql(`GRANT USAGE ON SCHEMA hospital, app, audit TO app_runtime;`);

  // Least privilege: the ingested record is read-only to a clinical session, and
  // the application/audit tables are where a session actually writes.
  pgm.sql(`GRANT SELECT ON ALL TABLES IN SCHEMA hospital TO app_runtime;`);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;`);
  pgm.sql(`GRANT SELECT, INSERT ON audit.event TO app_runtime;`);
  pgm.sql(`GRANT SELECT, INSERT, UPDATE ON audit.outbox TO app_runtime;`);
  pgm.sql(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO app_runtime;`);
  pgm.sql(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA hospital TO app_runtime;`);

  // Tables created later must not silently fall outside the role's grants.
  pgm.sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;`);
  pgm.sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA hospital GRANT SELECT ON TABLES TO app_runtime;`);
  pgm.sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE ON SEQUENCES TO app_runtime;`);

  // Policies must bind for the table owner too. This is inert while the runtime
  // role is a superuser -- which is the point: it is ready, not switched on.
  for (const table of POLICY_TABLES) {
    pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
  }

  pgm.sql(`
    COMMENT ON ROLE app_runtime IS
      'Least-privilege runtime role (M04): non-owner, subject to the patient-scope policies. The application must SET ROLE to it and set app.current_user_id before reads of hospital.* become scoped.'
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  for (const table of POLICY_TABLES) {
    pgm.sql(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;`);
  }
  pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA hospital FROM app_runtime;`);
  pgm.sql(`REVOKE ALL ON ALL TABLES IN SCHEMA app FROM app_runtime;`);
  pgm.sql(`REVOKE ALL ON SCHEMA hospital, app, audit FROM app_runtime;`);
  pgm.sql(`REVOKE app_runtime FROM app;`);
  // The role itself is cluster-scoped and may hold grants in other databases, so
  // it is left in place rather than dropped here.
}
