import { Global, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

/**
 * M01/M09 — the shared store.
 *
 * Sessions, the live-authorization cache and (later) OIDC pending states, OTP
 * rate limits and the NPHIES status broker all need to be visible to more than
 * one process. The production chart asks for 3 replicas, so anything held in a
 * `Map` inside the API is per-pod: a user is logged out at random depending on
 * which replica answers, and a status written by one pod is invisible to the
 * next request.
 *
 * REDIS_URL selects the store. Two deliberate behaviours:
 *
 *   - In production-like environments it is REQUIRED. The module refuses to
 *     start without it, because falling back to per-process state there is the
 *     bug this exists to fix, and it would fail silently -- a user simply gets
 *     logged out at random and nobody sees an error.
 *   - In development it falls back to an in-process store with a warning, so a
 *     laptop without the Redis container still runs. The warning names what is
 *     lost, so the fallback cannot be mistaken for the real thing.
 */
export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

/** The subset of the Redis API the application uses. */
export interface SharedStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/** Development fallback: a store that only this process can see. */
export class InProcessStore implements SharedStore {
  private readonly entries = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<unknown> {
    this.entries.set(key, value);
    return Promise.resolve("OK");
  }

  del(key: string): Promise<unknown> {
    return Promise.resolve(this.entries.delete(key) ? 1 : 0);
  }
}

const PRODUCTION_LIKE = new Set(["production", "prod", "staging"]);

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SharedStore => {
        const logger = new Logger("SharedStore");
        const url = config.get<string>("REDIS_URL");
        const env = (config.get<string>("NODE_ENV") ?? "development").toLowerCase();

        if (!url) {
          if (PRODUCTION_LIKE.has(env)) {
            throw new Error(
              "REDIS_URL is required outside development. Without a shared store, sessions " +
                "and rate limits live in one process: with more than one replica users are " +
                "logged out at random and statuses vanish. Set REDIS_URL (e.g. " +
                "redis://cc-redis:6379) or run a single replica deliberately.",
            );
          }
          logger.warn(
            "REDIS_URL is not set: using an in-process store. Sessions, the live-authorization " +
              "cache and rate limits will NOT be shared between processes -- run a single " +
              "instance, or set REDIS_URL (docker compose -f docker-compose.dev.yml up -d redis).",
          );
          return new InProcessStore();
        }

        const client = new Redis(url, {
          // Fail fast enough that a request does not hang behind a dead store:
          // callers treat a store error as "no session" and force a re-login,
          // which is the fail-closed behaviour the session path already had for
          // the database.
          maxRetriesPerRequest: 2,
          enableOfflineQueue: true,
        });

        // Never log the URL with credentials in it.
        const redacted = url.replace(/\/\/[^@]*@/, "//***@");
        client.on("connect", () => logger.log(`shared store: connected to ${redacted}`));
        client.on("error", (err: Error) => {
          logger.error(`shared store error: ${err.message}`);
        });

        return client as unknown as SharedStore;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
