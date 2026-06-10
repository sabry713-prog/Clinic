/**
 * Load test: Q&A refused (interpretive) questions — classifier-only path
 * NFR: 30 concurrent users → P95 ≤ 1 s
 *
 * These questions should be blocked at the classifier level without any LLM call.
 * Uses synthetic patient IDs — no PHI.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { getToken, authHeaders } from "./lib/auth.js";
import { QA_REFUSED_THRESHOLDS } from "./lib/thresholds.js";

const SYNTHETIC_PATIENT_IDS = Array.from(
  { length: 10 },
  (_, i) => `synthetic-patient-${String(i + 1).padStart(4, "0")}`,
);

// Interpretive questions that must be refused by classifier without LLM call
const REFUSED_QUESTIONS = [
  "Is the kidney function getting worse?",
  "Is this sepsis?",
  "What should I give for his pain?",
  "Is metformin safe in CKD stage 4?",
  "How sick is this patient?",
  "What is the prognosis?",
  "Does the patient need a nephrology referral?",
  "Is this lab value abnormal?",
  "Should we increase the dose?",
  "What is the risk of deterioration?",
];

export const options = {
  stages: [
    { duration: "30s", target: 30 },
    { duration: "5m", target: 30 },
    { duration: "30s", target: 0 },
  ],
  thresholds: QA_REFUSED_THRESHOLDS,
};

export function setup() {
  return { token: getToken() };
}

export default function (data) {
  const baseUrl = __ENV.BASE_URL || "http://localhost:4000";
  const patientId =
    SYNTHETIC_PATIENT_IDS[Math.floor(Math.random() * SYNTHETIC_PATIENT_IDS.length)];
  const question =
    REFUSED_QUESTIONS[Math.floor(Math.random() * REFUSED_QUESTIONS.length)];

  const res = http.post(
    `${baseUrl}/api/v1/patients/${patientId}/qa`,
    JSON.stringify({ question }),
    { headers: authHeaders(data.token) },
  );

  check(res, {
    "status 200": (r) => r.status === 200,
    "label REFUSED": (r) => {
      try {
        return JSON.parse(r.body).classification === "REFUSED";
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
