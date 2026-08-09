/**
 * PatientOtpService — phone + one-time-code identity verification for the
 * AI Receptionist patient self-service flow (docs/architecture/ai-receptionist.md).
 *
 * Unlike every other "simulated outcome" in this codebase, the OTP code
 * itself is genuinely random (crypto.randomInt), never derived
 * deterministically from caller-visible data -- it is a live credential
 * gating a public endpoint, not a reproducible demo outcome. It is hashed
 * with a per-request salt before storage and compared with a constant-time
 * comparison; the plaintext code is never persisted, never audited, and
 * never returned in any API response -- the only place it is observable is
 * a masked structured log line, standing in for a real SMS/email provider
 * that does not exist.
 *
 * requestOtp() always returns the same generic outcome regardless of
 * whether the phone matches a confirmed app.patient_contact row, to avoid
 * turning this into a phone-number enumeration oracle.
 */
import { Injectable, Inject, Logger, BadRequestException } from "@nestjs/common";
import { randomInt, randomBytes, createHash, timingSafeEqual } from "crypto";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { PatientBookingSessionService } from "./patient-booking-session.service";

const OTP_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

const GENERIC_OTP_ERROR = {
  error: { code: "INVALID_OR_EXPIRED_CODE", message: "Invalid or expired code" },
};

@Injectable()
export class PatientOtpService {
  private readonly logger = new Logger(PatientOtpService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly bookingSessions: PatientBookingSessionService,
  ) {}

  /**
   * Returns the matched patientId, or null if the phone had no confirmed
   * contact record -- ONLY for the caller's internal audit-logging decision
   * (write an audit row only for a real match). This return value must
   * never leak into the HTTP response; the controller always responds
   * identically regardless of what's returned here.
   */
  async requestOtp(phone: string): Promise<string | null> {
    const contact = await this.pool.query<{ patient_id: string }>(
      `SELECT patient_id FROM app.patient_contact WHERE phone = $1`,
      [phone],
    );
    const patientId = contact.rows[0]?.patient_id;
    if (!patientId) return null; // generic no-op -- never reveal whether the phone matched

    const code = randomInt(100000, 999999).toString();
    const salt = randomBytes(16).toString("hex");
    const hash = this.hashCode(code, salt);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.pool.query(
      `INSERT INTO app.patient_otp_request (patient_id, phone, otp_hash, otp_salt, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [patientId, phone, hash, salt, expiresAt],
    );

    // Stub delivery -- the only place the plaintext code is ever observable,
    // since no real SMS/email provider exists. Never written to
    // app.patient_otp_request or to the audit log.
    this.logger.log({
      event: "otp_stub_delivered",
      patient_id: patientId,
      phone_last4: phone.slice(-4),
      code,
    });

    return patientId;
  }

  async verifyOtp(phone: string, code: string): Promise<{ sessionToken: string; patientId: string }> {
    const res = await this.pool.query<{
      id: string;
      patient_id: string;
      otp_hash: string;
      otp_salt: string;
      expires_at: string;
      attempts: number;
    }>(
      `SELECT id, patient_id, otp_hash, otp_salt, expires_at::text AS expires_at, attempts
         FROM app.patient_otp_request
        WHERE phone = $1 AND consumed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    const row = res.rows[0];
    if (!row) throw new BadRequestException(GENERIC_OTP_ERROR);
    if (row.attempts >= MAX_ATTEMPTS) throw new BadRequestException(GENERIC_OTP_ERROR);
    if (new Date(row.expires_at) < new Date()) throw new BadRequestException(GENERIC_OTP_ERROR);

    // Increment attempts BEFORE checking the hash so a crash mid-verify
    // can't grant a free retry.
    await this.pool.query(`UPDATE app.patient_otp_request SET attempts = attempts + 1 WHERE id = $1`, [row.id]);

    const candidateHash = this.hashCode(code, row.otp_salt);
    if (!this.constantTimeEquals(candidateHash, row.otp_hash)) {
      throw new BadRequestException(GENERIC_OTP_ERROR);
    }

    await this.pool.query(`UPDATE app.patient_otp_request SET consumed_at = now() WHERE id = $1`, [row.id]);
    const sessionToken = this.bookingSessions.create(row.patient_id);
    return { sessionToken, patientId: row.patient_id };
  }

  private hashCode(code: string, salt: string): string {
    return createHash("sha256").update(`${code}:${salt}`).digest("hex");
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
