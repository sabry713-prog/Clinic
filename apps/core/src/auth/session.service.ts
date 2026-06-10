/**
 * In-process session store for Slice 0.
 * In production this would be backed by PostgreSQL (app.session table).
 */
import { Injectable } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import type { AuthUser, UserId, TenantId } from "@clinical-copilot/shared-types";
import { asUserId, asTenantId } from "@clinical-copilot/shared-types";

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

@Injectable()
export class SessionService {
  // Simple in-memory map — replace with DB in Slice 1
  private readonly store = new Map<string, SessionData>();

  create(data: SessionData): string {
    const sessionId = uuidv4();
    this.store.set(sessionId, data);
    return sessionId;
  }

  get(sessionId: string): SessionData | null {
    const session = this.store.get(sessionId);
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      this.store.delete(sessionId);
      return null;
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
}
