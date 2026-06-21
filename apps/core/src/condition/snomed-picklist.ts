/**
 * Curated SNOMED CT picklist for clinician problem-list entry.
 *
 * This is a pilot stand-in for a full SNOMED CT terminology service. The
 * "suggest" function matches the clinician's diagnosis text to candidate coded
 * terms — the AI SUGGESTS, the clinician CONFIRMS or picks another. The AI never
 * decides the diagnosis or the final code.
 */

export interface CodedTerm {
  readonly code: string;
  readonly code_display: string;
}

export const SNOMED_PICKLIST: readonly CodedTerm[] = [
  { code: "44054006", code_display: "Diabetes mellitus type 2" },
  { code: "46635009", code_display: "Diabetes mellitus type 1" },
  { code: "38341003", code_display: "Hypertension" },
  { code: "13644009", code_display: "Hypercholesterolemia" },
  { code: "195967001", code_display: "Asthma" },
  { code: "13645005", code_display: "Chronic obstructive pulmonary disease" },
  { code: "49436004", code_display: "Atrial fibrillation" },
  { code: "53741008", code_display: "Coronary arteriosclerosis" },
  { code: "42343007", code_display: "Congestive heart failure" },
  { code: "709044004", code_display: "Chronic kidney disease" },
  { code: "40930008", code_display: "Hypothyroidism" },
  { code: "34486009", code_display: "Hyperthyroidism" },
  { code: "70153002", code_display: "Migraine" },
  { code: "25064002", code_display: "Headache" },
  { code: "404640003", code_display: "Dizziness" },
  { code: "386661006", code_display: "Fever" },
  { code: "49727002", code_display: "Cough" },
  { code: "267036007", code_display: "Dyspnea (shortness of breath)" },
  { code: "29857009", code_display: "Chest pain" },
  { code: "21522001", code_display: "Abdominal pain" },
  { code: "161891005", code_display: "Backache" },
  { code: "57676002", code_display: "Joint pain (arthralgia)" },
  { code: "422587007", code_display: "Nausea" },
  { code: "84229001", code_display: "Fatigue" },
  { code: "62315008", code_display: "Diarrhea" },
  { code: "195662009", code_display: "Acute upper respiratory infection" },
  { code: "233604007", code_display: "Pneumonia" },
  { code: "68566005", code_display: "Urinary tract infection" },
  { code: "91302008", code_display: "Sepsis" },
  { code: "230690007", code_display: "Cerebrovascular accident (stroke)" },
  { code: "22298006", code_display: "Myocardial infarction" },
  { code: "271737000", code_display: "Anemia" },
  { code: "73211009", code_display: "Diabetes mellitus" },
  { code: "396275006", code_display: "Osteoarthritis" },
  { code: "69896004", code_display: "Rheumatoid arthritis" },
  { code: "35489007", code_display: "Depressive disorder" },
  { code: "197480006", code_display: "Anxiety disorder" },
  { code: "82271004", code_display: "Injury of head" },
  { code: "162059005", code_display: "Insomnia" },
  { code: "248595008", code_display: "Allergic rhinitis" },
];

const STOP = new Set(["the", "a", "an", "of", "with", "and", "patient", "has", "history"]);

/** Suggest candidate coded terms for free-text diagnosis input (token overlap). */
export function suggestCodes(query: string, limit = 5): CodedTerm[] {
  const q = query.toLowerCase();
  const qTokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));
  if (qTokens.length === 0) return [];
  const scored = SNOMED_PICKLIST.map((term) => {
    const d = term.code_display.toLowerCase();
    let score = 0;
    for (const t of qTokens) if (d.includes(t)) score += 1;
    // Boost when the whole display name appears in the query (exact-ish match).
    if (q.includes(d.split(" (")[0]!.toLowerCase())) score += 2;
    return { term, score };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.term);
}
