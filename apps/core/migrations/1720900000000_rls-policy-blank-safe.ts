import type { MigrationBuilder } from "node-pg-migrate";

/**
 * M04 follow-up — a blank session setting must scope to nothing, not error.
 *
 * Every hospital.* policy reads its session user as
 * `current_setting('app.current_user_id', true)::uuid`. Unset, that is NULL and
 * the policy matches no rows, which is the intended "see nothing" behaviour. Set
 * to an empty string -- which a connection pool that clears state with
 * `set_config('app.current_user_id', '', …)` produces, and any caller that
 * normalises a missing user to '' rather than NULL will produce -- the `::uuid`
 * cast raises `invalid input syntax for type uuid: ""` and the query fails
 * outright.
 *
 * That difference matters the moment enforcement is switched on: a blank setting
 * would turn every read of hospital.* into a 500 instead of an empty result, and
 * would do it only in the configuration nobody tests. `nullif(…, '')` makes a
 * blank setting mean the same thing as an unset one.
 */

const POLICIES: ReadonlyArray<{ table: string; policy: string; scopeColumn: string }> = [
  { table: "hospital.patient", policy: "patient_scope_select", scopeColumn: "id" },
  { table: "hospital.allergy_intolerance", policy: "hospital_allergy_intolerance_scope_select", scopeColumn: "patient_id" },
  { table: "hospital.condition", policy: "hospital_condition_scope_select", scopeColumn: "patient_id" },
  { table: "hospital.document_reference", policy: "hospital_document_reference_scope_select", scopeColumn: "patient_id" },
  { table: "hospital.encounter", policy: "hospital_encounter_scope_select", scopeColumn: "patient_id" },
  { table: "hospital.medication_request", policy: "hospital_medication_request_scope_select", scopeColumn: "patient_id" },
  { table: "hospital.observation", policy: "hospital_observation_scope_select", scopeColumn: "patient_id" },
  { table: "hospital.procedure", policy: "hospital_procedure_scope_select", scopeColumn: "patient_id" },
  { table: "hospital.retrieval_chunk", policy: "hospital_retrieval_chunk_scope_select", scopeColumn: "patient_id" },
  // hospital.appointment has no policy to alter (see 1720800000000).
];

const condition = (scopeColumn: string): string => `
  ${scopeColumn} IN (
    SELECT patient_scope.patient_id
      FROM app.patient_scope
     WHERE patient_scope.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
       AND patient_scope.expires_at > now()
  )
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  for (const { table, policy, scopeColumn } of POLICIES) {
    pgm.sql(`ALTER POLICY ${policy} ON ${table} USING (${condition(scopeColumn)})`);
  }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  for (const { table, policy, scopeColumn } of POLICIES) {
    pgm.sql(`ALTER POLICY ${policy} ON ${table} USING (${condition(scopeColumn).replace("nullif(current_setting('app.current_user_id', true), '')::uuid", "current_setting('app.current_user_id', true)::uuid")})`);
  }
}
