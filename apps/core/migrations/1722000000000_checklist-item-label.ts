import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Stores the text of a checklist row the clinician wrote themselves.
 *
 * app.encounter_checklist keys every decision by item_id, which works while every row comes from a
 * catalog the client and the server both hold. A row the clinician types has no catalog id, so
 * without a label the decision would be remembered as an id nobody can render -- their own item would
 * vanish on the next page load, which is the one thing they added it to prevent.
 *
 * Nullable: every existing row is a catalog row and needs no label.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.addColumns({ schema: "app", name: "encounter_checklist" }, {
    label: { type: "text" },
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropColumns({ schema: "app", name: "encounter_checklist" }, ["label"]);
};
