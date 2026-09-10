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
    expect(suggestCodes("intestinal obstruction")).toEqual([]);
  });
});
