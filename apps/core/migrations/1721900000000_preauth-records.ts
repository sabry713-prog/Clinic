import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Records pre-authorization requests.
 *
 * Nothing persisted them: the request went to the NPHIES engine and its queued result was returned
 * to the caller, so the core could tell that a payer requires pre-authorization but never whether it
 * had been obtained. That made the submission gate a signal instead of a gate -- it could warn, not
 * prevent -- while an unresolved pre-auth is a rejection the product exists to stop.
 *
 * Shape mirrors app.nphies_eligibility_check (status + mode + a jsonb response + who and when), so
 * the two NPHIES-side record types read the same way rather than each inventing its own vocabulary.
 * `expired` is a real state, not decoration: pre-authorizations lapse, and a gate that cannot name
 * that would wave through a claim resting on an authorization that no longer stands.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable(
    { schema: "app", name: "nphies_preauth" },
    {
      id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
      patient_id: { type: "uuid", notNull: true, references: "hospital.patient(id)", onDelete: "CASCADE" },
      encounter_id: { type: "uuid", references: "hospital.encounter(id)", onDelete: "SET NULL" },
      service_code: { type: "text", notNull: true },
      service_display: { type: "text" },
      diagnosis_icd10: { type: "text" },
      status: { type: "text", notNull: true, default: "queued" },
      mode: { type: "text", notNull: true, default: "stub" },
      engine_reference: { type: "text" },
      response_json: { type: "jsonb", notNull: true, default: "{}" },
      submitted_by: { type: "uuid" },
      submitted_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      decided_at: { type: "timestamptz" },
    },
  );
  pgm.addConstraint({ schema: "app", name: "nphies_preauth" }, "nphies_preauth_status_check", {
    check: "status IN ('queued','submitted','approved','rejected','expired')",
  });
  pgm.createIndex({ schema: "app", name: "nphies_preauth" }, ["patient_id", "service_code"], {
    name: "nphies_preauth_patient_service_idx",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable({ schema: "app", name: "nphies_preauth" });
};
