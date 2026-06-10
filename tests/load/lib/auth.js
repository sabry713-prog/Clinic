/**
 * Shared auth helper for k6 load tests.
 * Obtains a session token for the load test user via the /api/v1/auth/login endpoint.
 * Uses environment variables: BASE_URL, LOAD_TEST_USER, LOAD_TEST_PASSWORD
 */

import http from "k6/http";
import { check } from "k6";

/**
 * Login and return a bearer token string.
 * Call from setup() in each script so the token is shared across VUs.
 */
export function getToken() {
  const baseUrl = __ENV.BASE_URL || "http://localhost:4000";
  const user = __ENV.LOAD_TEST_USER || "loadtest@hospital.local";
  const password = __ENV.LOAD_TEST_PASSWORD || "loadtest-password";

  const res = http.post(
    `${baseUrl}/api/v1/auth/login`,
    JSON.stringify({ username: user, password }),
    { headers: { "Content-Type": "application/json" } },
  );

  const ok = check(res, {
    "login 200": (r) => r.status === 200,
    "token present": (r) => {
      try {
        return !!JSON.parse(r.body).token;
      } catch {
        return false;
      }
    },
  });

  if (!ok) {
    throw new Error(
      `Load test login failed: HTTP ${res.status} — ${res.body}`,
    );
  }

  return JSON.parse(res.body).token;
}

/**
 * Return standard auth headers given a token.
 */
export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}
