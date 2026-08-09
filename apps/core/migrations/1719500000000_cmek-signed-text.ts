import type { MigrationBuilder } from "node-pg-migrate";

// Customer-managed encryption keys (CMEK) — see apps/core/src/security/.
// signed_text_key_id records which key wraps the DEK protecting this row's
// signed_text (now an opaque envelope-encrypted blob for newly-signed
// drafts). NULL means "legacy/unencrypted plaintext" — existing signed
// drafts are left untouched; nothing is force-migrated or re-encrypted.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE app.document_draft ADD COLUMN IF NOT EXISTS signed_text_key_id text`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE app.document_draft DROP COLUMN IF EXISTS signed_text_key_id`);
}
