import { Module, Global, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";

export const PG_POOL = "PG_POOL";

/**
 * Database pool with connection-loss resilience.
 *
 * Two guards, because the pool has two kinds of connection and only one of them is covered by the
 * obvious listener:
 *
 * 1. Idle connections. Node's pg Pool emits 'error' when an idle connection is killed by the server
 *    (Docker restart, failover). Without a listener that error propagates as an uncaught exception
 *    and kills the whole process.
 *
 * 2. Checked-out connections. A client handed out by pool.connect() keeps its OWN error events, and
 *    the pool-level listener above does not cover them. An unhandled 'error' on such a client throws
 *    inside node:events and takes the process down regardless. That is exactly how this API died
 *    when Postgres restarted underneath a request — "Error: Connection terminated unexpectedly",
 *    emitted on a Client, uncaught, process gone. There are a dozen pool.connect() call sites, so
 *    the listener is attached here, where every client the pool hands out passes through, rather
 *    than relying on each call site to remember.
 *
 * Exported as a function so the guards can be asserted directly: a listener attached inside a
 * factory closure is a listener no test can see.
 */
export function createPool(config: ConfigService): Pool {
  const logger = new Logger("PgPool");
  const pool = new Pool({
    connectionString: config.getOrThrow<string>("DATABASE_URL"),
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", (err: Error) => {
    logger.warn(`pg_pool_connection_error: ${err.message}`);
  });
  pool.on("connect", (client) => {
    client.on("error", (err: Error) => {
      logger.warn(`pg_client_connection_error: ${err.message}`);
    });
  });
  return pool;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => createPool(config),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
