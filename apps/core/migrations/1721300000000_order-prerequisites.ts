import type { MigrationBuilder } from "node-pg-migrate";

// Sequencing rules between orders: "do not request X until Y is on record".
//
// Raised from clinical review of the ordering step: an MRI must not be requested before the
// echocardiogram it follows from has been seen. That is a rule about SEQUENCE, which the
// pre-authorization matrix cannot express -- it answers "is this diagnosis acceptable for this
// service", not "is this the right next step".
//
// What this can and cannot decide, stated plainly because the difference matters:
//   * It CAN decide whether an order of the required kind exists on this patient's record.
//   * It CANNOT decide whether that order's RESULT has come back. No row in this schema ever
//     leaves `active`, and hospital.observation carries no link to the request that produced it
//     (FHIR's Observation.basedOn). Until both exist, a rule phrased as "until you see the
//     result" would report "no result on file" forever -- a false signal.
// So the rule is recorded and reported as what is on record, and the result-dependent form is
// deferred with that trigger: add order lifecycle + basedOn, then tighten the wording.
//
// `source` names who stated the rule, the same discipline as the coverage rows.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app.order_prerequisite (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_code          text NOT NULL,          -- SNOMED code of the order being requested
      order_display       text NOT NULL,
      requires_code       text NOT NULL,          -- SNOMED code of the order that must precede it
      requires_display    text NOT NULL,
      rationale           text NOT NULL,
      source              text NOT NULL,          -- who stated the rule
      created_at          timestamptz NOT NULL DEFAULT now()
    )
  `);
  pgm.sql(`CREATE UNIQUE INDEX ON app.order_prerequisite (order_code, requires_code)`);
  pgm.sql(`
    INSERT INTO app.order_prerequisite
      (order_code, order_display, requires_code, requires_display, rationale, source)
    VALUES
      ('113091000', 'MRI', '40701008', 'Echocardiography',
       'Advanced cardiac imaging follows the echocardiogram, not the other way round: a new patient should not be sent for MRI before the ECHO it is meant to follow is on record.',
       'clinical review (order sequencing), recorded as a sequencing rule only -- see the migration note on result-dependent wording')
    ON CONFLICT (order_code, requires_code) DO NOTHING
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS app.order_prerequisite`);
}
