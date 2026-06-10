/**
 * Load test: Ward handoff report
 * NFR: 5 concurrent users, 20 patients per ward → P95 ≤ 60 s
 *
 * Uses synthetic ward IDs — no PHI.
 */

import http from "k6/http";
import { check } from "k6";
import { getToken, authHeaders } from "./lib/auth.js";
import { WARD_HANDOFF_THRESHOLDS } from "./lib/thresholds.js";

// Synthetic ward identifiers — no real identifiers
const SYNTHETIC_WARD_IDS = [
  "synthetic-ward-0001",
  "synthetic-ward-0002",
  "synthetic-ward-0003",
];

export const options = {
  stages: [
    { duration: "30s", target: 5 },
    { duration: "10m", target: 5 },
    { duration: "30s", target: 0 },
  ],
  thresholds: WARD_HANDOFF_THRESHOLDS,
};

export function setup() {
  return { token: getToken() };
}

export default function (data) {
  const baseUrl = __ENV.BASE_URL || "http://localhost:4000";
  const wardId =
    SYNTHETIC_WARD_IDS[Math.floor(Math.random() * SYNTHETIC_WARD_IDS.length)];

  // Request handoff for a ward (20 patients per ward, per NFR)
  const res = http.post(
    `${baseUrl}/api/v1/handoff`,
    JSON.stringify({ ward_id: wardId, patient_limit: 20 }),
    { headers: authHeaders(data.token) },
  );

  check(res, {
    "status 200 or 404": (r) => r.status === 200 || r.status === 404,
  });
  // No sleep — handoff is an infrequent, high-latency operation
}
