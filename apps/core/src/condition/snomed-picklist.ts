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


/**
 * Suggest candidate coded terms for free-text diagnosis input.
 *
 * Two rules carry the weight, both learned from a reported note ("patient with previous urinary
 * tract infection" + a plan of "kidney enzymes and urine culture and kidney ultrasound"):
 *
 * 1. Whole words, not substrings. A shared word inside a longer word is not evidence.
 * 2. One shared word is not evidence either. Scoring used to be "how many query words appear
 *    anywhere in the display", so the single word "infection" proposed "Acute upper respiratory
 *    infection" for a urinary complaint. A candidate now has to share at least two words with
 *    the query, or half of the display's words, or be a one-word term that matched.
 *
 * Ranking is the proportion of the display's words the query covers, so the closest term sorts
 * first. The clinician still confirms: this only decides what is offered.
 */
const STOP = new Set(["the", "a", "an", "of", "with", "and", "patient", "has", "history", "for", "on", "in"]);

function significantWords(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export function suggestCodes(query: string, limit = 5): CodedTerm[] {
  const q = query.toLowerCase();
  const qWords = new Set(significantWords(query));
  if (qWords.size === 0) return [];
  const scored = SNOMED_PICKLIST.map((term) => {
    const display = term.code_display.toLowerCase();
    const head = display.split(" (")[0]!;
    const words = significantWords(display);
    const matched = words.filter((w) => qWords.has(w)).length;
    const coverage = words.length === 0 ? 0 : matched / words.length;
    const qualifies = matched >= 2 || coverage >= 0.5 || (words.length === 1 && matched === 1);
    let score = coverage * 10 + matched;
    if (q.includes(head)) score += 5;
    return { term, score, qualifies };
  }).filter((s) => s.qualifies && s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.term);
}

/** Levenshtein edit distance — deterministic, no dependencies. */
function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Spelling assistance for the diagnosis entry box: when the clinician's text
 * matches no picklist term, offer the closest terms from the SAME curated
 * vocabulary by edit distance. This corrects spelling only — it never
 * introduces new terms or codes, and the clinician still picks and confirms.
 */
export function suggestSpellings(query: string, limit = 3): CodedTerm[] {
  const q = normalize(query);
  if (q.length < 4) return [];
  const scored: { term: CodedTerm; d: number }[] = [];
  for (const term of SNOMED_PICKLIST) {
    const d = normalize(term.code_display);
    // distance of the whole query vs the whole term, and vs its best token
    const whole = editDistance(q, d);
    let bestToken = Number.POSITIVE_INFINITY;
    for (const t of d.split(" ")) {
      if (Math.abs(t.length - q.length) > 3) continue;
      bestToken = Math.min(bestToken, editDistance(q, t));
    }
    const distance = Math.min(whole, bestToken);
    // normalized threshold: allow ~40% edits for short words, tighter for long
    if (distance / Math.max(q.length, 3) <= 0.4) scored.push({ term, d: distance });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, limit).map((x) => x.term);
}