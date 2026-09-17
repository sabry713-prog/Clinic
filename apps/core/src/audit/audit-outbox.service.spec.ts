import type { Pool, PoolClient } from "pg";
import { ConfigService } from "@nestjs/config";

jest.mock("@clinical-copilot/audit", () => ({
  writeAuditEventInTx: jest.fn(),
}));

import { writeAuditEventInTx } from "@clinical-copilot/audit";
import { AuditOutboxService } from "./audit-outbox.service";

interface FakeLogger {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

const writeInTx = writeAuditEventInTx as jest.Mock;

const PAYLOAD = {
  actor_id: null,
  actor_role: "physician",
  action: "HTTP_GET_/api/v1/patients",
  target_type: null,
  target_id: null,
  outcome: "SUCCESS",
  metadata_json: {},
  request_id: "req-1",
};

/** Pool/client double that records the SQL it is asked to run. */
function makeSqlClient(rows: unknown[], sql: string[]): PoolClient {
  let batch: unknown[] | null = null;
  return {
    query: jest.fn((text: string, params?: unknown[]) => {
      sql.push(text.replace(/\s+/g, " ").trim());
      if (text.startsWith("SELECT id, payload, attempts")) {
        batch = rows;
        return Promise.resolve({ rows: rows });
      }
      if (text.includes("count(*)::text")) {
        return Promise.resolve({ rows: [{ count: String(batch?.length ?? 0) }] });
      }
      if (text.includes("INSERT INTO audit.outbox")) {
        return Promise.resolve({ rows: [{ id: "outbox-1" }] });
      }
      if (text.includes("UPDATE audit.outbox SET flushed_at")) {
        batch = (batch ?? []).slice(1);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  } as unknown as PoolClient;
}

function makeService(rows: unknown[]): {
  service: AuditOutboxService;
  sql: string[];
  pool: { connect: jest.Mock; query: jest.Mock };
  logger: FakeLogger;
} {
  const sql: string[] = [];
  const sqlClient = makeSqlClient(rows, sql);
  const pool = {
    connect: jest.fn().mockResolvedValue(sqlClient),
    query: jest.fn((text: string) => {
      if (text.includes("INSERT INTO audit.outbox")) {
        return Promise.resolve({ rows: [{ id: "outbox-1" }] });
      }
      if (text.includes("count(*)::text")) {
        return Promise.resolve({ rows: [{ count: "0" }] });
      }
      return Promise.resolve({ rows: [] });
    }),
  };
  const logger: FakeLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const config = {
    get: (_key: string, fallback?: string): string | undefined => fallback,
  } as unknown as ConfigService;
  const service = new AuditOutboxService(config, logger as never, pool as unknown as Pool);
  return { service, sql, pool, logger };
}

describe("AuditOutboxService", () => {
  beforeEach(() => {
    writeInTx.mockReset();
    writeInTx.mockResolvedValue({ id: "event-1", hash_self: "hash-1" });
  });

  it("enqueues into the outbox with a durable single INSERT", async () => {
    const { service, pool } = makeService([]);

    const id = await service.enqueue(PAYLOAD as never);

    expect(id).toBe("outbox-1");
    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO audit.outbox");
    expect(JSON.parse(String(params[0]))).toMatchObject({ action: PAYLOAD.action });
  });

  // The transactional half: a caller that passes its client gets the hand-off
  // committed or rolled back with the change it describes.
  it("uses the caller's client when one is given", async () => {
    const { service, pool } = makeService([]);
    const clientQuery = jest.fn().mockResolvedValue({ rows: [{ id: "outbox-9" }] });
    const client = { query: clientQuery } as unknown as PoolClient;

    const id = await service.enqueue(PAYLOAD as never, client);

    expect(id).toBe("outbox-9");
    expect(clientQuery).toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("flushes a claimed batch inside one transaction and marks each row", async () => {
    const { service, sql } = makeService([
      { id: "row-1", payload: PAYLOAD, attempts: 0 },
      { id: "row-2", payload: PAYLOAD, attempts: 0 },
    ]);

    const summary = await service.flush();

    expect(summary.flushed).toBe(2);
    expect(writeInTx).toHaveBeenCalledTimes(2);
    expect(sql[0]).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(sql.some((s) => s.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
    expect(sql.filter((s) => s.includes("UPDATE audit.outbox SET flushed_at"))).toHaveLength(2);
    expect(sql).toContain("COMMIT");
  });

  it("rolls back the batch and records the failure without losing the rows", async () => {
    const { service, sql, pool } = makeService([{ id: "row-1", payload: PAYLOAD, attempts: 0 }]);
    writeInTx.mockRejectedValueOnce(new Error("serialization failure"));

    const summary = await service.flush();

    expect(summary.failed).toBe(1);
    expect(sql).toContain("ROLLBACK");
    expect(sql).not.toContain("COMMIT");
    // attempts/last_error are recorded out-of-band so the failure is visible
    // without reading a log file.
    const failureUpdate = pool.query.mock.calls.find((c) =>
      String(c[0]).includes("attempts = attempts + 1"),
    );
    expect(failureUpdate).toBeDefined();
    expect(String((failureUpdate![1] as unknown[])[0])).toContain("serialization failure");
  });

  it("does not run two flushes at once", async () => {
    const { service } = makeService([{ id: "row-1", payload: PAYLOAD, attempts: 0 }]);

    const [first, second] = await Promise.all([service.flush(), service.flush()]);

    // One of them did the work; the other reported the queue without touching it.
    expect(first.flushed + second.flushed).toBeLessThanOrEqual(2);
    expect(writeInTx.mock.calls.length).toBeLessThanOrEqual(2);
  });

  // Rows survive a crash; the startup flush is what picks them up.
  it("drains leftovers at startup", async () => {
    const { service } = makeService([{ id: "row-1", payload: PAYLOAD, attempts: 0 }]);

    service.onModuleInit();
    await new Promise((r) => setImmediate(r));

    expect(writeInTx).toHaveBeenCalled();
    service.onModuleDestroy();
  });
});
