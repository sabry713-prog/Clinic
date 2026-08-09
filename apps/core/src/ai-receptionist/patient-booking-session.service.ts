/**
 * In-process session store for the AI Receptionist patient self-service
 * booking flow -- direct structural mirror of auth/session.service.ts's
 * in-memory staff session store, with the same accepted limitation (lost on
 * restart, single-process only). That tradeoff is acceptable here: losing a
 * booking session just means a cheap re-verify via OTP, and no PHI lives in
 * the token itself, only a patientId reference.
 *
 * Deliberately a completely separate store from SessionService -- a booking
 * session is a different, much more restricted principal than a staff
 * session and must never be confused with or merged into it.
 */
import { Injectable } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";

const SESSION_TTL_MS = 25 * 60_000;

interface BookingSessionData {
  readonly patientId: string;
  readonly expiresAt: Date;
}

@Injectable()
export class PatientBookingSessionService {
  private readonly store = new Map<string, BookingSessionData>();

  create(patientId: string): string {
    const token = uuidv4();
    this.store.set(token, { patientId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
    return token;
  }

  get(token: string): string | null {
    const session = this.store.get(token);
    if (!session) return null;
    if (session.expiresAt < new Date()) {
      this.store.delete(token);
      return null;
    }
    return session.patientId;
  }

  delete(token: string): void {
    this.store.delete(token);
  }
}
