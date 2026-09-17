import type { MigrationBuilder } from "node-pg-migrate";

/**
 * audit.outbox -- the durable hand-off between "an auditable thing happened" and
 * "the audit row exists".
 *
 * Writing the audit row from a response-finish handler cannot be transactional
 * with the request it describes (the response is already sent), and a failed
 * write was only logged: the event was gone. Critical changes had the same
 * problem in a worse form -- an erasure whose audit write failed left the change
 * in place with no proof it happened.
 *
 * Producers INSERT into this table (optionally inside their own transaction, so
 * the hand-off is atomic with the change), and a flusher drains it into
 * audit.event with the hash chain, retrying until it lands. Rows are kept after
 * flushing rather than deleted: the outbox is part of the trail, and a row that
 * never flushed is exactly what an operator needs to find.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE audit.outbox (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at  timestamptz NOT NULL DEFAULT now(),
      payload     jsonb NOT NULL,
      attempts    integer NOT NULL DEFAULT 0,
      last_error  text,
      flushed_at  timestamptz,
      event_id    uuid
    )
  `);

  // The flusher only ever scans for unflushed rows, oldest first.
  pgm.sql(`
    CREATE INDEX ON audit.outbox (created_at) WHERE flushed_at IS NULL
  `);

  pgm.sql(`
    COMMENT ON TABLE audit.outbox IS
      'Durable hand-off for audit events. Producers insert; AuditOutboxService flushes into audit.event. Rows are retained after flushing for reconciliation.'
  `);
  pgm.sql(`
    COMMENT ON COLUMN audit.outbox.event_id IS
      'audit.event row this outbox entry produced, once flushed. NULL means not yet written.'
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS audit.outbox`);
}
