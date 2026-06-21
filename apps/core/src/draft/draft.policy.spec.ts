/**
 * E6 section-policy validator (exit-gate test).
 * Proves clinician-authored-only sections may contain ONLY the empty sentinel
 * or text that is a verbatim substring of the clinician's authored source —
 * the model can never introduce new content into Assessment/Plan etc.
 */
import { isClinicianAuthoredOnly } from "./draft.service";

const SOURCE =
  "Progress note, day 2. Patient reviewed on morning round. Overnight observations documented by nursing staff. Oral intake documented.";

describe("isClinicianAuthoredOnly", () => {
  it("accepts a verbatim substring of the authored source", () => {
    expect(isClinicianAuthoredOnly("Patient reviewed on morning round.", SOURCE)).toBe(true);
  });

  it("accepts the full authored note", () => {
    expect(isClinicianAuthoredOnly(SOURCE, SOURCE)).toBe(true);
  });

  it("is whitespace/case tolerant", () => {
    expect(isClinicianAuthoredOnly("  patient   REVIEWED on morning round.  ", SOURCE)).toBe(true);
  });

  it("accepts the EN empty sentinel", () => {
    expect(isClinicianAuthoredOnly("(No documented assessment to reproduce.)", "")).toBe(true);
  });

  it("accepts the AR empty sentinel", () => {
    expect(isClinicianAuthoredOnly("(لا يوجد assessment موثق لإعادة إنتاجه.)", "")).toBe(true);
  });

  it("REJECTS model-introduced clinical content not in the source", () => {
    expect(
      isClinicianAuthoredOnly("Assessment: likely sepsis, recommend antibiotics.", SOURCE),
    ).toBe(false);
  });

  it("REJECTS partially-fabricated text", () => {
    expect(
      isClinicianAuthoredOnly("Patient reviewed on morning round and is improving.", SOURCE),
    ).toBe(false);
  });
});
