import type { MigrationBuilder } from "node-pg-migrate";

// Link a result to the order that produced it: Observation.basedOn -> ServiceRequest.
//
// Without this link the system cannot tell "this order was placed" from "this order has been
// reported", so a sequencing rule phrased as "do not request X until you have seen Y's result"
// has nothing to read. The link is the FHIR-standard one rather than a bespoke column, so an
// observation that arrives from the HIS in production carries it without translation.
//
// Deliberately a plain uuid, not a foreign key across schemas: hospital.* is the mirrored
// clinical record and app.service_request is ours. The direction of truth runs HIS -> mirror, and
// a hard FK would make the mirror refuse a row the source already considers valid.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE hospital.observation ADD COLUMN IF NOT EXISTS based_on uuid`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS observation_based_on_idx ON hospital.observation (based_on)`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP INDEX IF EXISTS observation_based_on_idx`);
  pgm.sql(`ALTER TABLE hospital.observation DROP COLUMN IF EXISTS based_on`);
}
