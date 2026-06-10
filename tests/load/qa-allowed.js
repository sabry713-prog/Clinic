/**
 * Load test: Q&A allowed (factual) questions
 * NFR: 30 concurrent users → P95 ≤ 7 s
 *
 * Uses synthetic patient IDs and pre-approved factual questions — no PHI.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { getToken, authHeaders } from "./lib/auth.js";
import { QA_ALLOWED_THRESHOLDS } from "./lib/thresholds.js";

const SYNTHETIC_PATIENT_IDS = Array.from(
  { length: 10 },
  (_, i) => `synthetic-patient-${String(i + 1).padStart(4, "0")}`,
);

// Factual questions guaranteed to pass the classifier (ALLOWED)
const ALLOWED_QUESTIONS = [
  "What was the last creatinine value?",
  "When was the patient admitted?",
  "List the active medications.",
  "What is the admitting diagnosis?",
  "What was the last blood pressure reading?",
  "What allergies does the patient have?",
  "Show me the most recent CBC results.",
  "What procedures were performed during this admission?",
  "What is the patient's date of birth?",
  "Has the patient had surgery before?",
];

export const options = {
  stages: [
    { duration: "1m", target: 30 },
    { duration: "5m", target: 30 },
    { duration: "30s", target: 0 },
  ],
  thresholds: QA_ALLOWED_THRESHOLDS,
};

export function setup() {
  return { token: getToken() };
}

export default function (data) {
  const baseUrl = __ENV.BASE_URL || "http://localhost:4000";
  const patientId =
    SYNTHETIC_PATIENT_IDS[Math.floor(Math.random() * SYNTHETIC_PATIENT_IDS.length)];
  const question =
    ALLOWED_QUESTIONS[Math.floor(Math.random() * ALLOWED_QUESTIONS.length)];

  const res = http.post(
    `${baseUrl}/api/v1/patients/${patientId}/qa`,
    JSON.stringify({ question }),
    { headers: authHeaders(data.token) },
  );

  check(res, {
    "status 200": (r) => r.status === 200,
    "label ALLOWED": (r) => {
      try {
        return JSON.parse(r.body).classification === "ALLOWED";
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
