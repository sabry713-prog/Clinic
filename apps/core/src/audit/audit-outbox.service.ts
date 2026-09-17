import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
  Inject,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { Pool, PoolClient } from "pg";
import { writeAuditEventInTx, type AuditWriteInput } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";

const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_BATCH_SIZE = 100;

export interface FlushSummary {
  readonly flushed: number;
  readonly failed: number;
  readonly remaining: number;
}

interface OutboxRow {
  id: string;
  payload: AuditWriteInput;
  attempts: number;
}

/**
 * Durable hand-off for audit events (M08).
 *
 * A producer calls `enqueue` instead of writing audit.event directly. If the
 * caller passes its transaction client, the hand-off commits or rolls back with
 * the change it describes -- an erasure cannot be recorded as done while its
 * audit entry is lost in the same crash.
 *
 * `flush` drains the queue: it claims a batch with FOR UPDATE SKIP LOCKED inside
 * one SERIALIZABLE transaction, writes each entry through the shared hash-chain
 * writer, and marks them flushed. The batch commits atomically, so entries are
 * neither lost nor duplicated: a crash mid-flush leaves the rows unflushed and
 * the next tick picks them up.
 *
 * Rows are never deleted. A flushed row is evidence the event landed; an
 * unflushed row is the only way to notice that it did not.
 */
@Injectable()
export class AuditOutboxService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    private readonly config: ConfigService,
    @InjectPinoLogger(AuditOutboxService.name)
    private readonly logger: PinoLogger,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  onModuleInit(): void {
    // Drain anything a previous process left behind before scheduling ticks:
    // rows survive a crash, and that is the whole point of the table.
    void this.flush().catch((err: unknown) => {
      this.logger.error(
        { err, event: "AUDIT_OUTBOX_STARTUP_FLUSH_FAILED" },
        "audit outbox startup flush failed",
      );
    });

    const intervalMs = Number(
      this.config.get<string>("AUDIT_OUTBOX_FLUSH_MS", String(DEFAULT_FLUSH_INTERVAL_MS)),
    );
    this.timer = setInterval(() => {
      void this.flush().catch((err: unknown) => {
        this.logger.error(
          { err, event: "AUDIT_OUTBOX_FLUSH_FAILED" },
          "audit outbox flush failed",
        );
      });
    }, Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_FLUSH_INTERVAL_MS);
    // Don't hold the event loop open on shutdown.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Record an event for delivery. Pass `client` to make it atomic with a
   * transaction the caller already owns.
   */
  async enqueue(
    input: AuditWriteInput,
    client: Pool | PoolClient = this.pool,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO audit.outbox (payload) VALUES ($1::jsonb) RETURNING id`,
      [JSON.stringify(input)],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("audit.outbox insert returned no id");
    return id;
  }

  /** How many entries are still waiting to be written to the audit log. */
  async pendingCount(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit.outbox WHERE flushed_at IS NULL`,
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async flush(limit: number = DEFAULT_BATCH_SIZE): Promise<FlushSummary> {
    // One flusher per process: overlapping ticks would fight over the same rows
    // (SKIP LOCKED would split them, but the accounting gets confusing).
    if (this.flushing) {
      return { flushed: 0, failed: 0, remaining: await this.pendingCount() };
    }
    this.flushing = true;

    const client = await this.pool.connect();
    let flushed = 0;
    let failed = 0;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

      const claimed = await client.query<OutboxRow>(
        `SELECT id, payload, attempts
           FROM audit.outbox
          WHERE flushed_at IS NULL
          ORDER BY created_at ASC
          LIMIT $1
            FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      for (const row of claimed.rows) {
        const written = await writeAuditEventInTx(client, row.payload);
        await client.query(
          `UPDATE audit.outbox SET flushed_at = now(), event_id = $2 WHERE id = $1`,
          [row.id, written.id],
        );
        flushed += 1;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        /* the rollback is best-effort; the rows stay claimed only until the
           connection is released, and unflushed rows are retried next tick */
      });
      failed += 1;

      // Record the failure against the whole batch out-of-band, so it is
      // visible without living only in a log line.
      const message = err instanceof Error ? err.message : String(err);
      await this.pool
        .query(
          `UPDATE audit.outbox
              SET attempts = attempts + 1, last_error = $1
            WHERE flushed_at IS NULL`,
          [message.slice(0, 500)],
        )
        .catch(() => {
          /* if even this fails the database is unreachable; the startup flush
             and the next tick will try again */
        });

      this.logger.error(
        { err, event: "AUDIT_OUTBOX_BATCH_FAILED" },
        "audit outbox batch failed; entries remain queued",
      );
    } finally {
      client.release();
      this.flushing = false;
    }

    const remaining = await this.pendingCount();
    if (flushed > 0) {
      this.logger.info(
        { event: "AUDIT_OUTBOX_FLUSHED", flushed, remaining },
        "audit outbox flushed",
      );
    }
    return { flushed, failed, remaining };
  }
}
