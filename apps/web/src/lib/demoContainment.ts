/**
 * Demo containment (readiness assessment C03/C04).
 *
 * When DEMO_CONTAINMENT is true (the specialist-demo build), two
 * restrictions activate:
 *
 * C03 — Q&A is restricted to validated question patterns. The QA
 * retrieval path uses heuristic source-linking; unrestricted questions
 * can produce answers with citations that share vocabulary but don't
 * entail the claim. In the demo, only questions matching the validated
 * pattern set are allowed; anything else receives an honest "outside
 * the demonstrated scope" message.
 *
 * C04 — clinical prose agent paths (Consultant differential, Pharmacist
 * dose recommendations) are disabled. Only administrative checks and
 * the Scribe's formatting-only SOAP generation remain.
 *
 * This is a client-side convenience gate; the backend enforcement is
 * unchanged (the same classifier, refusal rules, and blocklist apply
 * in every mode). The flag prevents the demo from wandering into
 * unvalidated territory, not a security control.
 */

const CONTAINMENT_KEY = "DEMO_CONTAINMENT";

/** Read the containment flag (from the Vite env at build time). */
export function isDemoContainmentEnabled(): boolean {
  try {
    return import.meta.env["DEMO_CONTAINMENT"] === "true";
  } catch {
    return false;
  }
}

/** C03: validated question patterns for the demo. A question matching
 * any of these is allowed through the QA pipeline; anything else gets
 * an honest scope message. Patterns are deliberately broad enough for
 * natural clinical questions, narrow enough to stay within what the
 * retrieval + synthesis path handles well. */
const VALIDATED_QA_PATTERNS: readonly RegExp[] = [
  /creatini?ne|kidney function|renal/i,
  /blood pressure|hypertension/i,
  /diabet|HbA1c|glucose|A1C/i,
  /medication|medicines|prescription|drug/i,
  /allerg/i,
  /diagnos|condition|problem list/i,
  /last visit|previous encounter|recent lab/i,
  /weight|height|BMI/i,
  /hemoglobin|WBC|CBC|white blood|blood count/i,
  /cholesterol|lipid/i,
  /when was|what was the last|show me the/i,
  /dose|dosage|mg\b/i,
  /interaction|side effect|adverse/i,
  /claim|coverage|eligib/i,
];

/** C03: check whether a question is within the demonstrated scope. */
export function isQuestionInDemoScope(question: string): boolean {
  if (!isDemoContainmentEnabled()) return true;
  return VALIDATED_QA_PATTERNS.some((p) => p.test(question));
}

/** The honest message shown when a question is outside demo scope. */
export const DEMO_SCOPE_MESSAGE =
  "This question is outside the demonstrated scope for this session. The Q&A system retrieves and cites documented facts; during this demo, only clinically grounded factual questions about the patient's record are available. Book a pilot to explore the full range.";

/** C04: whether clinical prose agent actions are available. */
export function areClinicalProsePathsEnabled(): boolean {
  return !isDemoContainmentEnabled();
}
