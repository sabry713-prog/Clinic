/**
 * Shared threshold definitions matching NFR performance budgets from docs/architecture/03-deployment.md
 * and docs/ops/02-observability.md.
 *
 * Import the relevant threshold set into each test script.
 */

/** Patient view: P95 ≤ 2 000 ms */
export const PATIENT_VIEW_THRESHOLDS = {
  http_req_duration: ["p(95)<2000"],
  http_req_failed: ["rate<0.01"],
};

/** Q&A allowed: P95 ≤ 7 000 ms */
export const QA_ALLOWED_THRESHOLDS = {
  http_req_duration: ["p(95)<7000"],
  http_req_failed: ["rate<0.01"],
};

/** Q&A refused (classifier-only path): P95 ≤ 1 000 ms */
export const QA_REFUSED_THRESHOLDS = {
  http_req_duration: ["p(95)<1000"],
  http_req_failed: ["rate<0.01"],
};

/** Narrative: P95 ≤ 8 000 ms */
export const NARRATIVE_THRESHOLDS = {
  http_req_duration: ["p(95)<8000"],
  http_req_failed: ["rate<0.01"],
};

/** Ward handoff (20 patients): P95 ≤ 60 000 ms */
export const WARD_HANDOFF_THRESHOLDS = {
  http_req_duration: ["p(95)<60000"],
  http_req_failed: ["rate<0.01"],
};
