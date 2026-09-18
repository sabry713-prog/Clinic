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
  /**
   * How many events are inside the trailing window, WITHOUT recording one.
   * Paired with `windowAdd` so a caller can check two dimensions and only
   * consume a slot when both pass -- which is what the OTP limiter needs.
   */
  windowPeek(key: string, nowMs: number, windowMs: number): Promise<number>;
  /** Record an event in the trailing window. */
  windowAdd(key: string, nowMs: number, windowMs: number): Promise<number>;
}

const WINDOW_PRUNE_INTERVAL_MS = 60_000;

/** Development fallback: a store that only this process can see. */
export class InProcessStore implements SharedStore {
  private readonly entries = new Map<string, string>();
  private readonly windows = new Map<string, number[]>();
  private lastPrune = Date.now();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<unknown> {
    this.entries.set(key, value);
    return Promise.resolve("OK");
  }

  del(key: string): Promise<unknown> {
    this.entries.delete(key);
    return Promise.resolve(this.windows.delete(key) ? 1 : 0);
  }

  private pruneWindows(nowMs: number): void {
    // without a TTL to lean on, the fallback has to sweep its own keys or it
    // grows for the life of the process
    if (nowMs - this.lastPrune < WINDOW_PRUNE_INTERVAL_MS) return;
    this.lastPrune = nowMs;
    for (const [key, times] of this.windows) {
      if (times.every((ts) => nowMs - ts > WINDOW_PRUNE_INTERVAL_MS)) this.windows.delete(key);
    }
  }

  windowPeek(key: string, nowMs: number, windowMs: number): Promise<number> {
    this.pruneWindows(nowMs);
    const fresh = (this.windows.get(key) ?? []).filter((ts) => nowMs - ts < windowMs);
    this.windows.set(key, fresh);
    return Promise.resolve(fresh.length);
  }

  windowAdd(key: string, nowMs: number, windowMs: number): Promise<number> {
    const fresh = (this.windows.get(key) ?? []).filter((ts) => nowMs - ts < windowMs);
    fresh.push(nowMs);
    this.windows.set(key, fresh);
    return Promise.resolve(fresh.length);
  }
}

/**
 * Sliding-window operations, run atomically inside the store.
 *
 * Pruning, counting and expiry happen in one round trip so two replicas cannot
 * interleave a read-modify-write and each let the other's attempts through --
 * which is the whole point of moving the limiter off the process.
 */
const WINDOW_PEEK_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
  return redis.call('ZCARD', KEYS[1])
`;

const WINDOW_ADD_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
  redis.call('PEXPIRE', KEYS[1], ARGV[4])
  return redis.call('ZCARD', KEYS[1])
`;

class RedisSharedStore implements SharedStore {
  constructor(private readonly client: Redis) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  set(key: string, value: string, ...args: unknown[]): Promise<unknown> {
    // the caller passes Redis' own option words ("PX", 60000 / "KEEPTTL")
    return (this.client.set as (...a: unknown[]) => Promise<unknown>)(key, value, ...args);
  }

  del(key: string): Promise<unknown> {
    return this.client.del(key);
  }

  async windowPeek(key: string, nowMs: number, windowMs: number): Promise<number> {
    const result = await this.client.eval(
      WINDOW_PEEK_SCRIPT, 1, key, String(nowMs - windowMs),
    );
    return Number(result);
  }

  async windowAdd(key: string, nowMs: number, windowMs: number): Promise<number> {
    const result = await this.client.eval(
      WINDOW_ADD_SCRIPT, 1, key,
      String(nowMs - windowMs),
      String(nowMs),
      `${nowMs}-${Math.random()}`,
      String(windowMs),
    );
    return Number(result);
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

        return new RedisSharedStore(client);
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
