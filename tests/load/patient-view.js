/**
 * Load test: Patient View endpoint
 * NFR: 50 concurrent users, ramp 0→50 over 1 min, sustain 5 min → P95 ≤ 2 s
 *
 * Uses synthetic patient IDs — no PHI.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { getToken, authHeaders } from "./lib/auth.js";
import { PATIENT_VIEW_THRESHOLDS } from "./lib/thresholds.js";

// Synthetic patient IDs generated at test authoring time — no real PHI
const SYNTHETIC_PATIENT_IDS = Array.from(
  { length: 20 },
  (_, i) => `synthetic-patient-${String(i + 1).padStart(4, "0")}`,
);

export const options = {
  stages: [
    { duration: "1m", target: 50 }, // ramp up to 50 VUs
    { duration: "5m", target: 50 }, // sustain
    { duration: "30s", target: 0 }, // ramp down
  ],
  thresholds: PATIENT_VIEW_THRESHOLDS,
};

export function setup() {
  return { token: getToken() };
}

export default function (data) {
  const baseUrl = __ENV.BASE_URL || "http://localhost:4000";
  const patientId =
    SYNTHETIC_PATIENT_IDS[Math.floor(Math.random() * SYNTHETIC_PATIENT_IDS.length)];

  const res = http.get(
    `${baseUrl}/api/v1/patients/${patientId}`,
    { headers: authHeaders(data.token) },
  );

  check(res, {
    "status 200 or 404": (r) => r.status === 200 || r.status === 404,
  });

  sleep(1);
}
