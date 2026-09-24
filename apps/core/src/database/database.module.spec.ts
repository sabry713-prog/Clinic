import { ConfigService } from "@nestjs/config";
import { createPool } from "./database.module";

/**
 * The pool's own 'error' listener covers idle clients only. A client handed out by pool.connect()
 * keeps its own error events, and an unhandled one throws in node:events and kills the process —
 * which is how this API died when Postgres restarted underneath a request ("Error: Connection
 * terminated unexpectedly", emitted on a Client, uncaught, process gone). This pins both guards
 * offline: no database is touched, the listeners are asserted on the pool the factory returns.
 */
describe("createPool — connection-loss guards", () => {
  const config = {
    getOrThrow: (): string => "postgres://user:pass@127.0.0.1:5432/db",
  } as unknown as ConfigService;

  it("listens for idle-connection errors", async () => {
    const pool = createPool(config);
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    await pool.end();
  });

  it("listens for errors on the clients it hands out", async () => {
    const pool = createPool(config);
    // The guard is attached on the pool's 'connect' event, which fires for every client it creates —
    // that is what makes it cover all dozen pool.connect() call sites at once.
    expect(pool.listenerCount("connect")).toBeGreaterThan(0);
    await pool.end();
  });
});
