import { Module, Global, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";

export const PG_POOL = "PG_POOL";

/**
 * Database pool with connection-loss resilience.
 *
 * Node's pg Pool emits an 'error' event when an idle connection is killed
 * by the server (Docker restart, failover). Without a listener, that error
 * propagates as an uncaught exception and kills the whole process — the
 * API crashes mid-demo when infrastructure restarts. The listener below
 * logs and lets the pool recycle the dead connection; subsequent queries
 * get a fresh one. This is the documented pg pattern for production use.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
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
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
