/**
 * Sliding-window rate limiting for the AI Receptionist's public OTP endpoints.
 *
 * Two independent windows, because these endpoints are unauthenticated: phone-keyed
 * (an attacker rotating IPs still hits it) and IP-keyed (an attacker rotating phone
 * numbers still hits it).
 *
 * M01: the windows live in the shared store now. They used to be a module-level
 * `Map`, which under the production chart's 3 replicas meant each pod kept its own
 * count -- so an attacker effectively had 3x every limit, and which pod answered
 * decided whether a request was refused. The check-then-record pair is issued
 * against the store, where pruning and counting happen atomically.
 *
 * Note: main.ts has no `trust proxy` configured, so req.ip may be unreliable behind
 * a real reverse proxy in production -- a deployment prerequisite, not solved here.
 */

import type { SharedStore } from "../redis/redis.module";

const WINDOW_MS = 15 * 60_000;
const OTP_REQUEST_PHONE_LIMIT = 3;
const OTP_REQUEST_IP_LIMIT = 10;
const OTP_VERIFY_PHONE_LIMIT = 5;

const requestPhoneKey = (phone: string): string => `otp-req:phone:${phone}`;
const requestIpKey = (ip: string): string => `otp-req:ip:${ip}`;
const verifyPhoneKey = (phone: string): string => `otp-verify:phone:${phone}`;

/**
 * Checks both windows before recording either, so a request rejected on one
 * dimension (e.g. the IP limit) does not still consume a slot on the other
 * (the phone limit).
 */
export async function checkOtpRequestRateLimit(
  store: SharedStore,
  phone: string,
  ip: string,
): Promise<boolean> {
  const now = Date.now();
  const [phoneCount, ipCount] = await Promise.all([
    store.windowPeek(requestPhoneKey(phone), now, WINDOW_MS),
    store.windowPeek(requestIpKey(ip), now, WINDOW_MS),
  ]);

  if (phoneCount >= OTP_REQUEST_PHONE_LIMIT || ipCount >= OTP_REQUEST_IP_LIMIT) {
    return false;
  }

  await Promise.all([
    store.windowAdd(requestPhoneKey(phone), now, WINDOW_MS),
    store.windowAdd(requestIpKey(ip), now, WINDOW_MS),
  ]);
  return true;
}

export async function checkOtpVerifyRateLimit(
  store: SharedStore,
  phone: string,
): Promise<boolean> {
  const now = Date.now();
  const count = await store.windowPeek(verifyPhoneKey(phone), now, WINDOW_MS);
  if (count >= OTP_VERIFY_PHONE_LIMIT) return false;

  await store.windowAdd(verifyPhoneKey(phone), now, WINDOW_MS);
  return true;
}
