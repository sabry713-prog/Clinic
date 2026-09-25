/**
 * Spelling assistance for the diagnosis suggester: when the clinician's
 * wording matches no picklist term, the closest terms from the SAME
 * curated vocabulary are offered (edit-distance, deterministic). These
 * tests pin: typos resolve, unrelated text does not, and exact matching
 * is unchanged.
 */

import { suggestCodes, suggestSpellings } from "./snomed-picklist";

describe("suggestSpellings — deterministic spelling assist", () => {
  it("recovers common misspellings to the closest vocabulary term", () => {
    expect(suggestSpellings("diabetis")).toEqual(
      expect.arrayContaining([expect.objectContaining({ code_display: expect.stringMatching(/Diabetes/i) })]),
    );
    expect(suggestSpellings("hypertention")).toEqual(
      expect.arrayContaining([expect.objectContaining({ code_display: "Hypertension" })]),
    );
    expect(suggestSpellings("abodominal pain")).toEqual(
      expect.arrayContaining([expect.objectContaining({ code_display: "Abdominal pain" })]),
    );
  });

  it("offers nothing for unrelated or very short text", () => {
    expect(suggestSpellings("xyzzyq")).toEqual([]);
    expect(suggestSpellings("ab")).toEqual([]);
  });

  it("never returns more terms than requested", () => {
    expect(suggestSpellings("diabetis", 1).length).toBeLessThanOrEqual(1);
  });
});

describe("suggestCodes — exact matching unchanged", () => {
  it("still matches correct terms directly", () => {
    const hits = suggestCodes("abdominal pain");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.code_display).toBe("Abdominal pain");
  });

  it("still returns nothing for unmatched wording (no guessing)", () => {
    // Was "intestinal obstruction", which returned [] only because the vocabulary lacked the term.
    // That term now exists -- verified against SNOMED CT 81060008 -- so the guard needs wording that
    // is genuinely outside the picklist; otherwise it would fail the moment the vocabulary grew,
    // which is exactly what happened.
    expect(suggestCodes("discussed diet and exercise")).toEqual([]);
  });
});

describe("suggestCodes — a reported case", () => {
  // Reported from a live test: the assessment "patient with previous urinary tract infection"
  // produced "Acute upper respiratory infection" as a second suggestion, because the two share
  // the word "infection"; and the plan's "kidney ultrasound" added "Chronic kidney disease".
  it("does not propose a respiratory infection for a urinary complaint", () => {
    const labels = suggestCodes("patient with previous urinary tract infection").map((t) => t.code_display);
    expect(labels).toContain("Urinary tract infection");
    expect(labels).not.toContain("Acute upper respiratory infection");
    expect(labels).not.toContain("Chronic kidney disease");
  });

  it("still proposes short symptom terms and single-word diagnoses", () => {
    expect(suggestCodes("patient has cough and fever").map((t) => t.code_display)).toEqual(
      expect.arrayContaining(["Cough", "Fever"]),
    );
    expect(suggestCodes("diabetes").map((t) => t.code_display)).toContain("Diabetes mellitus");
  });
});

describe("suggestCodes — vocabulary the clinician actually writes", () => {
  it("finds intestinal obstruction from a note that shares no word with the display", () => {
    // Reported from the running app: this assessment produced "Urinary tract infection" (a stale
    // note) and, once that was fixed, nothing at all -- "Intestinal obstruction" shares no word
    // with "blockage in his small intestine".
    const out = suggestCodes("blockage in his small intestine");
    expect(out.map((t) => t.code)).toContain("81060008");
  });

  it("finds constipation, which the clinician names outright", () => {
    const out = suggestCodes("severe constipation for more than 10 days");
    expect(out.map((t) => t.code)).toContain("14760008");
  });

  it("finds the common presentations a dictated note actually uses", () => {
    // Words a clinician types, against codes quoted from published HL7 value sets.
    const codes = suggestCodes("vomiting and diarrhoea with burning on urination", 8).map((t) => t.code);
    expect(codes).toContain("422400008"); // Vomiting
    expect(codes).toContain("62315008"); // Diarrhea
    expect(codes).toContain("49650001"); // Dysuria
  });

  it("still proposes nothing for a note with no clinical term", () => {
    expect(suggestCodes("review in one week").length).toBe(0);
  });
});
