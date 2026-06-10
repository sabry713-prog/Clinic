/**
 * Deterministic weighted identity reconciliation.
 *
 * Scores two candidate patient rows and decides:
 *   score ≥ 95  → auto-merge (same patient)
 *   70 ≤ score < 95 → quarantine for human review
 *   score < 70  → separate patients
 *
 * Special rule: national_id_hash mismatch + everything else matching → quarantine.
 */

export interface ReconcilablePatient {
  readonly id: string; // UUID from hospital.patient
  readonly national_id_hash: string | null;
  readonly mrn: string | null;
  readonly source_system: string;
  readonly date_of_birth: string | null;
  readonly family_name: string | null;
  readonly given_name: string | null;
  readonly sex: string | null;
}

export type ReconciliationDecision = "merge" | "quarantine" | "separate";

export interface ReconciliationResult {
  readonly decision: ReconciliationDecision;
  readonly score: number;
  readonly features: ReconciliationFeatures;
}

export interface ReconciliationFeatures {
  readonly national_id_hash_match: boolean;
  readonly national_id_hash_mismatch: boolean; // both present but differ
  readonly mrn_same_source_match: boolean;
  readonly dob_match: boolean;
  readonly name_similarity: number; // 0–1
  readonly sex_match: boolean;
}

// Feature weights
const W_NATIONAL_ID_MATCH = 60;
const W_MRN_SAME_SOURCE = 25;
const W_DOB_MATCH = 8;
const W_NAME_SIM_ABOVE_09 = 5;
const W_SEX_MATCH = 2;

/**
 * Simple Jaro-Winkler-ish similarity for names.
 * Uses normalised longest-common-subsequence as a lightweight approximation.
 */
function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const na = a.toLowerCase().replace(/\s+/g, " ").trim();
  const nb = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (na === nb) return 1.0;

  // LCS length
  const la = na.length;
  const lb = nb.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () =>
    new Array(lb + 1).fill(0) as number[],
  );

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      if (na[i - 1] === nb[j - 1]) {
        dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j] ?? 0, dp[i]![j - 1] ?? 0);
      }
    }
  }

  const lcs = dp[la]![lb] ?? 0;
  return (2 * lcs) / (la + lb);
}

function fullName(patient: ReconcilablePatient): string {
  const parts = [patient.given_name, patient.family_name].filter(Boolean);
  return parts.join(" ");
}

export function scoreReconciliation(
  a: ReconcilablePatient,
  b: ReconcilablePatient,
): ReconciliationResult {
  const features: ReconciliationFeatures = computeFeatures(a, b);

  let score = 0;

  if (features.national_id_hash_match) {
    score += W_NATIONAL_ID_MATCH;
  }

  if (features.mrn_same_source_match) {
    score += W_MRN_SAME_SOURCE;
  }

  if (features.dob_match) {
    score += W_DOB_MATCH;
  }

  if (features.name_similarity > 0.9) {
    score += W_NAME_SIM_ABOVE_09;
  }

  if (features.sex_match) {
    score += W_SEX_MATCH;
  }

  // Special rule: national ID mismatch → force quarantine regardless of score
  if (features.national_id_hash_mismatch && score >= 95) {
    return { decision: "quarantine", score, features };
  }

  let decision: ReconciliationDecision;
  if (score >= 95) {
    decision = "merge";
  } else if (score >= 70) {
    decision = "quarantine";
  } else {
    decision = "separate";
  }

  return { decision, score, features };
}

function computeFeatures(
  a: ReconcilablePatient,
  b: ReconcilablePatient,
): ReconciliationFeatures {
  // National ID
  const bothHaveNid =
    a.national_id_hash !== null && b.national_id_hash !== null;
  const national_id_hash_match =
    bothHaveNid && a.national_id_hash === b.national_id_hash;
  const national_id_hash_mismatch =
    bothHaveNid && a.national_id_hash !== b.national_id_hash;

  // MRN: only relevant if same source system
  const mrn_same_source_match =
    a.source_system === b.source_system &&
    a.mrn !== null &&
    b.mrn !== null &&
    a.mrn === b.mrn;

  // DOB
  const dob_match =
    a.date_of_birth !== null &&
    b.date_of_birth !== null &&
    a.date_of_birth === b.date_of_birth;

  // Name similarity
  const nameA = fullName(a);
  const nameB = fullName(b);
  const name_similarity =
    nameA.length > 0 && nameB.length > 0
      ? nameSimilarity(nameA, nameB)
      : 0;

  // Sex
  const sex_match =
    a.sex !== null && b.sex !== null && a.sex === b.sex;

  return {
    national_id_hash_match,
    national_id_hash_mismatch,
    mrn_same_source_match,
    dob_match,
    name_similarity,
    sex_match,
  };
}
