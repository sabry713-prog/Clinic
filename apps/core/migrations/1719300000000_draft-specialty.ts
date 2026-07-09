/* eslint-disable @typescript-eslint/naming-convention */
import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Specialty templates (competitive-assessment backlog item): records which
 * specialty section-template was used to generate a draft, for audit/
 * traceability. Generation logic itself lives entirely in draft.service.ts
 * (deterministic section-title overrides + an added Allergies section) --
 * this column is purely a record of what was selected.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE app.document_draft
      ADD COLUMN specialty text NOT NULL DEFAULT 'general'
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`ALTER TABLE app.document_draft DROP COLUMN IF EXISTS specialty`);
}
