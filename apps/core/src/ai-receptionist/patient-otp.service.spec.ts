/**
 * Unit tests for PatientOtpService — the ONE place in this codebase where a
 * "dummy" mechanism must be genuinely secure (public, unauthenticated
 * endpoint). Covers: anti-enumeration (matched vs unmatched phone), attempt
 * cap, hash/salt verification, and expiry.
 */
import { Logger, BadRequestException } from "@nestjs/common";
import { PatientOtpService } from "./patient-otp.service";
import { PatientBookingSessionService } from "./patient-booking-session.service";
import type { Pool, QueryResult } from "pg";

const PATIENT_ID = "patient-001";
const PHONE = "+966500000000";

function makeStatefulPool(matchPhone: boolean) {
  const rows: Record<string, unknown>[] = [];
  const query = jest.fn((sql: string, params?: unknown[]) => {
    if (sql.includes("FROM app.patient_contact")) {
      return Promise.resolve({ rows: matchPhone ? [{ patient_id: PATIENT_ID }] : [] } as unknown as QueryResult);
    }
    if (sql.includes("INSERT INTO app.patient_otp_request")) {
      const [patientId, phone, otpHash, otpSalt, expiresAt] = params!;
      const row = {
        id: `otp-${rows.length + 1}`,
        patient_id: patientId,
        phone,
        otp_hash: otpHash,
        otp_salt: otpSalt,
        expires_at: (expiresAt as Date).toISOString(),
        attempts: 0,
        consumed_at: null as string | null,
        created_at: new Date().toISOString(),
      };
      rows.push(row);
      return Promise.resolve({ rows: [row] } as unknown as QueryResult);
    }
    if (sql.includes("SELECT id, patient_id, otp_hash, otp_salt")) {
      const phone = params![0] as string;
      const candidates = rows.filter((r) => r["phone"] === phone && !r["consumed_at"]);
      candidates.sort((a, b) => String(b["created_at"]).localeCompare(String(a["created_at"])));
      const row = candidates[0];
      return Promise.resolve({ rows: row ? [row] : [] } as unknown as QueryResult);
    }
    if (sql.includes("SET attempts = attempts + 1")) {
      const id = params![0] as string;
      const row = rows.find((r) => r["id"] === id);
      if (row) row["attempts"] = (row["attempts"] as number) + 1;
      return Promise.resolve({ rows: [] } as unknown as QueryResult);
    }
    if (sql.includes("SET consumed_at = now()")) {
      const id = params![0] as string;
      const row = rows.find((r) => r["id"] === id);
      if (row) row["consumed_at"] = new Date().toISOString();
      return Promise.resolve({ rows: [] } as unknown as QueryResult);
    }
    return Promise.resolve({ rows: [] } as unknown as QueryResult);
  });
  return { query, rows } as unknown as Pool & { rows: Record<string, unknown>[] };
}

function makeBookingSessions(): PatientBookingSessionService {
  return { create: jest.fn().mockReturnValue("session-token-1") } as unknown as PatientBookingSessionService;
}

async function requestAndCaptureCode(pool: Pool): Promise<string> {
  const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  const svc = new PatientOtpService(pool, makeBookingSessions());
  await svc.requestOtp(PHONE);
  const call = logSpy.mock.calls.find(([arg]) => (arg as { event?: string })?.event === "otp_stub_delivered");
  logSpy.mockRestore();
  return (call![0] as { code: string }).code;
}

describe("PatientOtpService.requestOtp — anti-enumeration", () => {
  it("inserts a row and returns the patientId for a matched phone", async () => {
    const pool = makeStatefulPool(true);
    const svc = new PatientOtpService(pool, makeBookingSessions());
    const patientId = await svc.requestOtp(PHONE);
    expect(patientId).toBe(PATIENT_ID);
    expect(pool.rows).toHaveLength(1);
  });

  it("returns null and inserts nothing for an unmatched phone (never reveals mismatch)", async () => {
    const pool = makeStatefulPool(false);
    const svc = new PatientOtpService(pool, makeBookingSessions());
    const patientId = await svc.requestOtp(PHONE);
    expect(patientId).toBeNull();
    expect(pool.rows).toHaveLength(0);
  });
});

describe("PatientOtpService.verifyOtp", () => {
  it("verifies the correct code and issues a session token", async () => {
    const pool = makeStatefulPool(true);
    const code = await requestAndCaptureCode(pool);
    const bookingSessions = makeBookingSessions();
    const svc = new PatientOtpService(pool, bookingSessions);
    const result = await svc.verifyOtp(PHONE, code);
    expect(result.patientId).toBe(PATIENT_ID);
    expect(bookingSessions.create).toHaveBeenCalledWith(PATIENT_ID);
  });

  it("rejects an incorrect code and increments attempts", async () => {
    const pool = makeStatefulPool(true);
    const code = await requestAndCaptureCode(pool);
    const wrongCode = code === "000000" ? "111111" : "000000";
    const svc = new PatientOtpService(pool, makeBookingSessions());
    await expect(svc.verifyOtp(PHONE, wrongCode)).rejects.toThrow(BadRequestException);
    expect(pool.rows[0]!["attempts"]).toBe(1);
  });

  it("rejects once the attempt cap is reached, even with the correct code", async () => {
    const pool = makeStatefulPool(true);
    const code = await requestAndCaptureCode(pool);
    const wrongCode = code === "000000" ? "111111" : "000000";
    const svc = new PatientOtpService(pool, makeBookingSessions());
    for (let i = 0; i < 5; i++) {
      await expect(svc.verifyOtp(PHONE, wrongCode)).rejects.toThrow(BadRequestException);
    }
    await expect(svc.verifyOtp(PHONE, code)).rejects.toThrow(BadRequestException);
  });

  it("rejects an expired code even when correct", async () => {
    const pool = makeStatefulPool(true);
    const code = await requestAndCaptureCode(pool);
    pool.rows[0]!["expires_at"] = new Date(Date.now() - 1000).toISOString();
    const svc = new PatientOtpService(pool, makeBookingSessions());
    await expect(svc.verifyOtp(PHONE, code)).rejects.toThrow(BadRequestException);
  });

  it("rejects when no OTP request exists for the phone", async () => {
    const pool = makeStatefulPool(true);
    const svc = new PatientOtpService(pool, makeBookingSessions());
    await expect(svc.verifyOtp(PHONE, "123456")).rejects.toThrow(BadRequestException);
  });
});
