/**
 * Load test: Narrative generation endpoint
 * NFR: 20 concurrent users → P95 ≤ 8 s
 *
 * Uses synthetic patient IDs — no PHI.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { getToken, authHeaders } from "./lib/auth.js";
import { NARRATIVE_THRESHOLDS } from "./lib/thresholds.js";

const SYNTHETIC_PATIENT_IDS = Array.from(
  { length: 10 },
  (_, i) => `synthetic-patient-${String(i + 1).padStart(4, "0")}`,
);

export const options = {
  stages: [
    { duration: "1m", target: 20 },
    { duration: "5m", target: 20 },
    { duration: "30s", target: 0 },
  ],
  thresholds: NARRATIVE_THRESHOLDS,
};

export function setup() {
  return { token: getToken() };
}

export default function (data) {
  const baseUrl = __ENV.BASE_URL || "http://localhost:4000";
  const patientId =
    SYNTHETIC_PATIENT_IDS[Math.floor(Math.random() * SYNTHETIC_PATIENT_IDS.length)];

  const res = http.post(
    `${baseUrl}/api/v1/patients/${patientId}/narrative`,
    JSON.stringify({}),
    { headers: authHeaders(data.token) },
  );

  check(res, {
    "status 200 or 404": (r) => r.status === 200 || r.status === 404,
  });

  sleep(2);
}
