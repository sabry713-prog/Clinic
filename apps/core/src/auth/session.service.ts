/**
 * SessionService — sessions in a shared store, with DB-backed revocation.
 *
 * M01/M09: sessions used to live in a `Map` inside the API process. The
 * production chart runs 3 replicas, so a session created by one pod was unknown
 * to the other two: the user was logged out at random depending on which replica
 * answered the next request. Session data now lives in Redis (REDIS_URL), which
 * every replica reads, and the same store holds the short-lived live-authorization
 * cache so that a disabled user is rejected everywhere, not just on the pod that
 * noticed.
 *
 * M02 (readiness assessment): role/disable updates must revoke active
 * sessions. The session cookie lives 8 hours, but the user's actual
 * enabled/roles state in Postgres can change at any moment. This service
 * now checks the user's current status from the database on every
 * `get()` call — a disabled user, a user with changed roles, or a user
 * removed from the tenant is rejected immediately, not at session expiry.
 *
 * Fail-closed: if the DB is unreachable, the session is rejected (better
 * to force re-login than to serve a request with stale authorization).
 */

import { Injectable, Inject, Logger } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import type { Pool } from "pg";
import type { AuthUser } from "@clinical-copilot/shared-types";
import { asUserId, asTenantId } from "@clinical-copilot/shared-types";
import { PG_POOL } from "../database/database.module";
import { REDIS_CLIENT, type SharedStore } from "../redis/redis.module";

export interface SessionData {
  readonly userId: string;
  readonly tenantId: string;
  readonly externalSubject: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly preferredLanguage: "ar" | "en";
  readonly roles: readonly string[];
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date;
}

/** Live user state from the DB — checked on every authenticated request. */
interface LiveUserState {
  readonly isEnabled: boolean;
  readonly roles: readonly string[];
}

/** Cache duration for the DB user-state check (avoids a query per request). */
const USER_STATE_CACHE_MS = 5_000;

/** Key namespace, so the store can be inspected without guessing. */
const SESSION_KEY = (sessionId: string): string => `session:${sessionId}`;
const USER_STATE_KEY = (userId: string): string => `userstate:${userId}`;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: SharedStore,
  ) {}

  /**
   * Store a session. The entry expires on its own (Redis TTL), so a crashed
   * process cannot leave sessions behind indefinitely.
   */
  async create(data: SessionData): Promise<string> {
    const sessionId = uuidv4();
    const ttlMs = data.expiresAt.getTime() - Date.now();
    if (ttlMs <= 0) {
      // An already-expired session is a caller bug; refusing is better than
      // writing a key that vanishes on the next read.
      throw new Error("SessionService.create called with an already-expired session");
    }
    await this.redis.set(SESSION_KEY(sessionId), JSON.stringify(data), "PX", ttlMs);
    return sessionId;
  }

  /**
   * Get a session — checks expiry AND the user's live DB state.
   * Returns null if the session is expired, the user is disabled, or
   * the user's roles have changed from what the session was created with.
   */
  async get(sessionId: string): Promise<SessionData | null> {
    let session: SessionData | null = null;
    try {
      const raw = await this.redis.get(SESSION_KEY(sessionId));
      if (raw !== null) {
        // JSON carries dates as strings; expiresAt has to come back as a Date or
        // every comparison below silently compares a string to a Date.
        const parsed = JSON.parse(raw) as Omit<SessionData, "expiresAt"> & { expiresAt: string };
        session = { ...parsed, expiresAt: new Date(parsed.expiresAt) };
      }
    } catch (err) {
      // A store that cannot be read is treated as "no session": forcing a
      // re-login is the safe direction, and it is what the DB-unreachable path
      // already does below.
      this.logger.warn({
        event: "session_store_unavailable",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    if (!session) return null;
    if (session.expiresAt < new Date()) {
      await this.redis.del(SESSION_KEY(sessionId)).catch(() => undefined);
      return null;
    }

    // M02: live authorization check — the session's roles are stale the
    // moment an admin changes them in the DB. Check the current state.
    const liveState = await this.getLiveUserState(session.userId);
    if (liveState == null) {
      // DB unreachable or user deleted — fail closed
      this.logger.warn({ event: "session_revocation_check_failed", userId: session.userId });
      await this.redis.del(SESSION_KEY(sessionId)).catch(() => undefined);
      return null;
    }

    if (!liveState.isEnabled) {
      this.logger.warn({ event: "session_revoked_user_disabled", userId: session.userId });
      // Deleting from the shared store is what makes the revocation immediate on
      // every replica, not only on the one that handled the request.
      await this.redis.del(SESSION_KEY(sessionId)).catch(() => undefined);
      return null;
    }

    // Role drift: if the DB roles differ from the session's snapshot,
    // update the session to match the authoritative source.
    if (this.rolesDiffer(session.roles, liveState.roles)) {
      this.logger.warn({
        event: "session_roles_updated",
        userId: session.userId,
        oldRoles: session.roles,
        newRoles: liveState.roles,
      });
      const updated: SessionData = { ...session, roles: liveState.roles };
      // KEEPTTL: refreshing the payload must not extend the session's life.
      await this.redis
        .set(SESSION_KEY(sessionId), JSON.stringify(updated), "KEEPTTL")
        .catch(() => undefined);
      return updated;
    }

    return session;
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(SESSION_KEY(sessionId));
  }

  toAuthUser(session: SessionData): AuthUser {
    const roles = session.roles as AuthUser["roles"];
    return {
      id: asUserId(session.userId),
      tenantId: asTenantId(session.tenantId),
      externalSubject: session.externalSubject,
      displayName: session.displayName,
      email: session.email,
      preferredLanguage: session.preferredLanguage,
      roles,
      permissions: [],
    };
  }

  /** Fetch the user's current enabled/roles from Postgres, with a short
   * cache to avoid querying on every single request. Returns null when
   * the DB is unreachable (fail-closed) or the user no longer exists. */
  private async getLiveUserState(userId: string): Promise<LiveUserState | null> {
    try {
      const cached = await this.redis.get(USER_STATE_KEY(userId));
      if (cached !== null) return JSON.parse(cached) as LiveUserState;
    } catch {
      // fall through to the database: an unreadable cache is not an authorization
      // decision
    }

    try {
      // M02 fix: app."user" has no `enabled` column — disablement is modelled
      // as `disabled_at`. Selecting a phantom column made this query throw on
      // every request, the catch below fails closed, and the SPA saw a 401 on
      // /auth/me forever: the login page appeared to accept credentials and
      // then bounced straight back to itself.
      const result = await this.pool.query<{ enabled: boolean; role: string }>(
        `SELECT (u.disabled_at IS NULL) AS enabled, r.role
         FROM app."user" u
         LEFT JOIN app.user_role r ON r.user_id = u.id
         WHERE u.id = $1 AND u.tenant_id = '00000000-0000-0000-0000-000000000001'
         ORDER BY r.role`,
        [userId],
      );
      if (result.rows.length === 0 || !result.rows[0]!.enabled) {
        const state: LiveUserState = { isEnabled: false, roles: [] };
        await this.cacheUserState(userId, state);
        return state;
      }
      const roles = result.rows.map((r) => r.role).filter(Boolean);
      const state: LiveUserState = { isEnabled: true, roles };
      await this.cacheUserState(userId, state);
      return state;
    } catch (err) {
      this.logger.error({
        event: "session_user_state_db_error",
        error: err instanceof Error ? err.message : String(err),
      });
      // Invalidate the cache so the next attempt retries
      await this.redis.del(USER_STATE_KEY(userId)).catch(() => undefined);
      return null;
    }
  }

  /** Cache the user's live state briefly, in the shared store so that every
   * replica sees a disabled user within the same window. */
  private async cacheUserState(userId: string, state: LiveUserState): Promise<void> {
    await this.redis
      .set(USER_STATE_KEY(userId), JSON.stringify(state), "PX", USER_STATE_CACHE_MS)
      .catch(() => undefined);
  }

  private rolesDiffer(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return true;
    const sorted = [...a].sort();
    const sortedB = [...b].sort();
    return sorted.some((v, i) => v !== sortedB[i]);
  }


}
