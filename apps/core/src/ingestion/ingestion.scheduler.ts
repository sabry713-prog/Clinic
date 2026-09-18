import { Injectable, Logger, Inject, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Pool, PoolClient } from "pg";
import { PG_POOL } from "../database/database.module";
import { IngestionService } from "./ingestion.service";

/**
 * Scheduled ingestion runner.
 *
 * M01: the interval used to be guarded only by an in-process boolean, so with the
 * production chart's 3 replicas every pod ran the same ingestion on the same
 * schedule -- three concurrent sweeps of the same source, racing on the same rows.
 *
 * The guard is now a PostgreSQL advisory lock: the first replica to take it runs
 * the sweep, the others log that they skipped. A session-scoped advisory lock is
 * released when its connection closes, so a pod that dies mid-sweep does not leave
 * the schedule wedged -- which is the reason this is a lock and not a row someone
 * has to clean up.
 *
 * INGESTION_INTERVAL_MS overrides the 15-minute default, so the behaviour can be
 * exercised instead of assumed.
 */

/** Stable, arbitrary: identifies this lock among the database's other users. */
const INGESTION_LOCK_KEY = 815_023;

@Injectable()
export class IngestionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionScheduler.name);
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly ingestionService: IngestionService,
    @Inject(PG_POOL) private readonly pool: Pool,
    config: ConfigService,
  ) {
    const configured = Number(config.get<string>("INGESTION_INTERVAL_MS"));
    this.intervalMs = Number.isFinite(configured) && configured > 0 ? configured : 15 * 60 * 1_000;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    this.logger.log({
      event: "ingestion_scheduler_started",
      interval_ms: this.intervalMs,
      lock_key: INGESTION_LOCK_KEY,
    });
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One scheduled attempt. Exposed for tests and for an on-demand trigger. */
  async tick(): Promise<"ran" | "skipped_running" | "skipped_locked" | "failed"> {
    if (this.running) {
      this.logger.warn({ event: "ingestion_skipped_still_running" });
      return "skipped_running";
    }
    this.running = true;

    let client: PoolClient | null = null;
    let lockHeld = false;
    try {
      client = await this.pool.connect();

      // Session-scoped, and held on this connection for the whole sweep.
      const acquired = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [INGESTION_LOCK_KEY],
      );
      if (acquired.rows[0]?.locked !== true) {
        this.logger.log({
          event: "ingestion_skipped_lock_held",
          lock_key: INGESTION_LOCK_KEY,
          interval_ms: this.intervalMs,
        });
        return "skipped_locked";
      }
      lockHeld = true;

      try {
        await this.ingestionService.runIngestion();
        return "ran";
      } finally {
        // Released explicitly so the next tick (or another replica) is not
        // blocked until the connection happens to close.
        await client.query("SELECT pg_advisory_unlock($1)", [INGESTION_LOCK_KEY]).catch(() => {
          /* the lock goes with the connection; releasing is a courtesy */
        });
        lockHeld = false;
      }
    } catch (err) {
      this.logger.error({
        event: "ingestion_schedule_error",
        err: err instanceof Error ? err.message : String(err),
      });
      return "failed";
    } finally {
      if (client !== null && lockHeld) {
        await this.pool
          .query("SELECT pg_advisory_unlock($1)", [INGESTION_LOCK_KEY])
          .catch(() => undefined);
      }
      client?.release();
      this.running = false;
    }
  }
}
