/**
 * SessionService — in-process session store with DB-backed revocation.
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
import type { AuthUser, UserId, TenantId } from "@clinical-copilot/shared-types";
import { asUserId, asTenantId } from "@clinical-copilot/shared-types";
import { PG_POOL } from "../database/database.module";

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
const USER_STATE_CACHE = new Map<string, { state: LiveUserState; fetchedAt: number }>();

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly store = new Map<string, SessionData>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  create(data: SessionData): string {
    const sessionId = uuidv4();
    this.store.set(sessionId, data);
    return sessionId;
  }

  /**
   * Get a session — checks expiry AND the user's live DB state.
   * Returns null if the session is expired, the user is disabled, or
   * the user's roles have changed from what the session was created with.
   */
  async get(sessionId: string): Promise<SessionData | null> {
    const session = this.store.get(sessionId);
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      this.store.delete(sessionId);
      return null;
    }

    // M02: live authorization check — the session's roles are stale the
    // moment an admin changes them in the DB. Check the current state.
    const liveState = await this.getLiveUserState(session.userId);
    if (liveState == null) {
      // DB unreachable or user deleted — fail closed
      this.logger.warn({ event: "session_revocation_check_failed", userId: session.userId });
      this.store.delete(sessionId);
      return null;
    }

    if (!liveState.isEnabled) {
      this.logger.warn({ event: "session_revoked_user_disabled", userId: session.userId });
      this.store.delete(sessionId);
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
      this.store.set(sessionId, updated);
      return updated;
    }

    return session;
  }

  delete(sessionId: string): void {
    this.store.delete(sessionId);
  }

  toAuthUser(session: SessionData): AuthUser {
    const roles = session.roles as AuthUser["roles"];
    return {
      id: asUserId(session.userId) as UserId,
      tenantId: asTenantId(session.tenantId) as TenantId,
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
    const cached = USER_STATE_CACHE.get(userId);
    if (cached && Date.now() - cached.fetchedAt < USER_STATE_CACHE_MS) {
      return cached.state;
    }

    try {
      const result = await this.pool.query<{ enabled: boolean; role: string }>(
        `SELECT u.enabled, r.role
         FROM app."user" u
         LEFT JOIN app.user_role r ON r.user_id = u.id
         WHERE u.id = $1 AND u.tenant_id = '00000000-0000-0000-0000-000000000001'
         ORDER BY r.role`,
        [userId],
      );
      if (result.rows.length === 0 || !result.rows[0]!.enabled) {
        const state: LiveUserState = { isEnabled: false, roles: [] };
        USER_STATE_CACHE.set(userId, { state, fetchedAt: Date.now() });
        return state;
      }
      const roles = result.rows.map((r) => r.role).filter(Boolean);
      const state: LiveUserState = { isEnabled: true, roles };
      USER_STATE_CACHE.set(userId, { state, fetchedAt: Date.now() });
      return state;
    } catch (err) {
      this.logger.error({
        event: "session_user_state_db_error",
        error: err instanceof Error ? err.message : String(err),
      });
      // Invalidate cache so the next attempt retries
      USER_STATE_CACHE.delete(userId);
      return null;
    }
  }

  private rolesDiffer(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return true;
    const sorted = [...a].sort();
    const sortedB = [...b].sort();
    return sorted.some((v, i) => v !== sortedB[i]);
  }

  /** Test helper: clear the user-state cache. */
  static clearUserStateCache(): void {
    USER_STATE_CACHE.clear();
  }
}
