/**
 * In-memory sliding-window rate limiter for the AI Receptionist's public OTP
 * endpoints (mirrors the pattern in qa-proxy.controller.ts). Two independent
 * windows since these endpoints are public and unauthenticated: phone-keyed
 * (an attacker rotating IPs still hits this) and IP-keyed (an attacker
 * rotating phone numbers still hits this). Replace with a shared store
 * (Redis) if apps/core ever runs multi-instance -- same limitation already
 * accepted for session.service.ts's in-memory staff sessions.
 *
 * Note: main.ts has no `trust proxy` configured, so req.ip may be unreliable
 * behind a real reverse proxy in production -- a deployment prerequisite,
 * not solved here.
 */

const windows = new Map<string, number[]>();

const WINDOW_MS = 15 * 60_000;
const OTP_REQUEST_PHONE_LIMIT = 3;
const OTP_REQUEST_IP_LIMIT = 10;
const OTP_VERIFY_PHONE_LIMIT = 5;

function windowCount(key: string): number[] {
  const now = Date.now();
  const w = (windows.get(key) ?? []).filter((ts) => now - ts < WINDOW_MS);
  windows.set(key, w);
  return w;
}

function record(key: string): void {
  const w = windows.get(key) ?? [];
  w.push(Date.now());
  windows.set(key, w);
}

// Checks both windows before recording either, so a request rejected on one
// dimension (e.g. IP limit) doesn't still consume a slot on the other
// (phone limit).
export function checkOtpRequestRateLimit(phone: string, ip: string): boolean {
  const phoneWindow = windowCount(`otp-req:phone:${phone}`);
  const ipWindow = windowCount(`otp-req:ip:${ip}`);
  if (phoneWindow.length >= OTP_REQUEST_PHONE_LIMIT || ipWindow.length >= OTP_REQUEST_IP_LIMIT) {
    return false;
  }
  record(`otp-req:phone:${phone}`);
  record(`otp-req:ip:${ip}`);
  return true;
}

export function checkOtpVerifyRateLimit(phone: string): boolean {
  const phoneWindow = windowCount(`otp-verify:phone:${phone}`);
  if (phoneWindow.length >= OTP_VERIFY_PHONE_LIMIT) return false;
  record(`otp-verify:phone:${phone}`);
  return true;
}
