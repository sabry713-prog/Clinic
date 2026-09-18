/**
 * M01 — the ingestion schedule is guarded by a database advisory lock.
 *
 * Only one replica may sweep the source at a time. The lock is session-scoped, so
 * a pod that dies mid-sweep releases it by disconnecting rather than leaving the
 * schedule wedged behind a row nobody cleans up.
 */
import { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";

import { IngestionScheduler } from "./ingestion.scheduler";
import type { IngestionService } from "./ingestion.service";

interface FakeClient {
  query: jest.Mock;
  release: jest.Mock;
}

function makeScheduler(options: {
  lockAcquired?: boolean;
  runRejects?: Error;
  intervalMs?: number;
}): {
  scheduler: IngestionScheduler;
  service: { runIngestion: jest.Mock };
  client: FakeClient;
  sql: string[];
} {
  const sql: string[] = [];
  const client: FakeClient = {
    query: jest.fn((text: string) => {
      sql.push(text.replace(/\s+/g, " ").trim());
      if (text.includes("pg_try_advisory_lock")) {
        return Promise.resolve({ rows: [{ locked: options.lockAcquired !== false }] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn().mockResolvedValue(client), query: jest.fn() } as unknown as Pool;
  const service = {
    runIngestion:
      options.runRejects !== undefined
        ? jest.fn().mockRejectedValue(options.runRejects)
        : jest.fn().mockResolvedValue({ run_id: "r1" }),
  } as unknown as { runIngestion: jest.Mock };
  const config = {
    get: (key: string): string | undefined =>
      key === "INGESTION_INTERVAL_MS" ? String(options.intervalMs ?? 0) : undefined,
  } as unknown as ConfigService;

  return {
    scheduler: new IngestionScheduler(service as unknown as IngestionService, pool, config),
    service,
    client,
    sql,
  };
}

describe("IngestionScheduler — one sweep at a time (M01)", () => {
  it("runs the ingestion when it takes the lock, and releases it", async () => {
    const { scheduler, service, client, sql } = makeScheduler({ lockAcquired: true });

    await expect(scheduler.tick()).resolves.toBe("ran");

    expect(service.runIngestion).toHaveBeenCalledTimes(1);
    expect(sql.some((s) => s.includes("pg_try_advisory_lock"))).toBe(true);
    expect(sql.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  // The point of the change: a second replica must not sweep the same source.
  it("does not run the ingestion when another replica holds the lock", async () => {
    const { scheduler, service, sql } = makeScheduler({ lockAcquired: false });

    await expect(scheduler.tick()).resolves.toBe("skipped_locked");

    expect(service.runIngestion).not.toHaveBeenCalled();
    // and it does not try to release a lock it never held
    expect(sql.some((s) => s.includes("pg_advisory_unlock"))).toBe(false);
  });

  it("releases the lock even when the sweep fails", async () => {
    const { scheduler, client, sql } = makeScheduler({
      lockAcquired: true,
      runRejects: new Error("upstream down"),
    });

    await expect(scheduler.tick()).resolves.toBe("failed");

    expect(sql.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it("uses the configured interval, and defaults to fifteen minutes", () => {
    const { scheduler } = makeScheduler({ intervalMs: 10_000 });
    // the configured value is what the timer was given
    expect((scheduler as unknown as { intervalMs: number }).intervalMs).toBe(10_000);

    const { scheduler: fallback } = makeScheduler({ intervalMs: 0 });
    expect((fallback as unknown as { intervalMs: number }).intervalMs).toBe(15 * 60 * 1_000);
  });
});
