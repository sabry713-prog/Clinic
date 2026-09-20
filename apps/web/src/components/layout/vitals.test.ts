/**
 * Nurse-recorded vitals → Objective section.
 *
 * The values below mirror the real rows in the seeded record for MRN-009
 * (BP panel carrying "134/69" in value_text, HR/Temp/SpO2/RR as numerics), so
 * the tests exercise the shape the database actually returns.
 */

import { describe, it, expect } from "vitest";
import { formatNurseVitals, mergeObjective } from "./vitals";
import type { ObservationItem } from "../../lib/api";

type RawObservation = Omit<Partial<ObservationItem>, "value_numeric"> & {
  // The wire really carries NUMERIC as a string (see toNumber in vitals.ts), so
  // the fixtures keep that shape and are cast, rather than the tests asserting a
  // friendlier type than the API delivers.
  readonly value_numeric?: number | string | null;
};

function obs(partial: RawObservation): ObservationItem {
  return {
    id: partial.id ?? "o-1",
    category: partial.category ?? "vital-signs",
    code: partial.code ?? null,
    code_display: partial.code_display ?? null,
    value_numeric: (partial.value_numeric ?? null) as unknown as number | null,
    value_text: partial.value_text ?? null,
    unit: partial.unit ?? null,
    ref_range_low: partial.ref_range_low ?? null,
    ref_range_high: partial.ref_range_high ?? null,
    ref_range_text: partial.ref_range_text ?? null,
    effective_at: partial.effective_at ?? "2026-08-13T09:00:00Z",
  };
}

// Newest first, exactly as GET /patients/:id/observations returns them.
const MRN_009_ROWS: ObservationItem[] = [
  obs({ id: "bp-new", code: "85354-9", code_display: "Blood pressure", value_text: "134/69", unit: "mmHg", effective_at: "2026-08-13T09:00:00Z" }),
  obs({ id: "hr-new", code: "8867-4", code_display: "Heart rate", value_numeric: "72.4", unit: "bpm", effective_at: "2026-08-13T09:00:00Z" }),
  obs({ id: "temp-new", code: "8310-5", code_display: "Body temperature", value_numeric: "37.1", unit: "°C", effective_at: "2026-08-13T09:00:00Z" }),
  obs({ id: "rr-new", code: "9279-1", code_display: "Respiratory rate", value_numeric: "14.6", unit: "/min", effective_at: "2026-08-13T09:00:00Z" }),
  obs({ id: "spo2-new", code: "59408-5", code_display: "SpO2", value_numeric: "95.3", unit: "%", effective_at: "2026-08-13T09:00:00Z" }),
  obs({ id: "hr-old", code: "8867-4", code_display: "Heart rate", value_numeric: "83.1", unit: "bpm", effective_at: "2026-08-13T08:00:00Z" }),
];

describe("formatNurseVitals", () => {
  it("renders the patient's own recorded vitals in ward-round order", () => {
    const vitals = formatNurseVitals(MRN_009_ROWS);
    expect(vitals).not.toBeNull();
    expect(vitals!.text).toBe("BP 134/69, HR 72, SpO2 95%, Temp 37.1°C, RR 15/min.");
  });

  it("keeps the newest reading per code", () => {
    const vitals = formatNurseVitals(MRN_009_ROWS);
    expect(vitals!.text).toContain("HR 72");
    expect(vitals!.text).not.toContain("83");
  });

  it("reports when the nurse took the measurements", () => {
    expect(formatNurseVitals(MRN_009_ROWS)!.recordedAt).toBe("2026-08-13T09:00:00Z");
  });

  it("falls back to systolic/diastolic components when the panel has no text", () => {
    const vitals = formatNurseVitals([
      obs({ code: "8480-6", code_display: "Systolic blood pressure", value_numeric: 148 }),
      obs({ code: "8462-4", code_display: "Diastolic blood pressure", value_numeric: 92 }),
    ]);
    expect(vitals!.text).toBe("BP 148/92.");
  });

  it("accepts the numeric values the API actually sends (strings, not numbers)", () => {
    // Regression: node-postgres returns NUMERIC as a string, so `"72.4".toFixed()`
    // used to throw in the browser while every mock-based test still passed.
    const vitals = formatNurseVitals(MRN_009_ROWS);
    expect(vitals!.text).toContain("HR 72");
    expect(vitals!.text).toContain("SpO2 95%");
    expect(vitals!.text).toContain("Temp 37.1°C");
  });

  it("ignores a value it cannot parse instead of rendering NaN", () => {
    const vitals = formatNurseVitals([
      obs({ code: "8867-4", code_display: "Heart rate", value_numeric: "not-a-number" }),
      obs({ code: "8310-5", code_display: "Body temperature", value_numeric: "37.1" }),
    ]);
    expect(vitals!.text).toBe("Temp 37.1°C.");
  });

  it("omits vitals the record does not hold rather than inventing them", async () => {
    const vitals = formatNurseVitals([
      obs({ code: "8867-4", code_display: "Heart rate", value_numeric: 78 }),
    ]);
    expect(vitals!.text).toBe("HR 78.");
    expect(vitals!.text).not.toMatch(/BP|SpO2/);
  });

  it("returns null when there is nothing usable", () => {
    expect(formatNurseVitals([])).toBeNull();
    expect(formatNurseVitals([obs({ code: "29463-7", value_numeric: 70 })])).toBeNull();
  });
});

describe("mergeObjective", () => {
  const vitals = { text: "BP 134/69, HR 72.", recordedAt: "2026-08-13T09:00:00Z" };

  it("uses the vitals alone when the clinician dictated no examination findings", () => {
    expect(mergeObjective(vitals, "")).toBe("BP 134/69, HR 72.");
  });

  it("puts the recorded vitals in front of dictated findings", () => {
    expect(mergeObjective(vitals, "Heart sounds normal, chest clear.")).toBe(
      "BP 134/69, HR 72. Heart sounds normal, chest clear.",
    );
  });

  it("does not duplicate vitals the dictation already contains", () => {
    const dictated = "BP 148/92, HR 78. Chest clear.";
    expect(mergeObjective(vitals, dictated)).toBe(dictated);
  });

  it("leaves the objective untouched when the record has no vitals", () => {
    expect(mergeObjective(null, "Chest clear.")).toBe("Chest clear.");
  });
});

describe("the recorded range note", () => {
  // The rule the owner set: highlight ONLY against a range the record itself carries. The colour is a
  // transmission of the HIS's fact, never our judgement — so no range means no note, and there is no
  // default threshold anywhere in the code.
  const withRange = (numeric: string, low: number | null, high: number | null): ObservationItem[] => [
    obs({ code: "8867-4", code_display: "Heart rate", value_numeric: numeric, unit: "bpm", ref_range_low: low, ref_range_high: high }),
  ];

  it("says when a value is above the recorded range", () => {
    const vitals = formatNurseVitals(withRange("112", 60, 100));
    expect(vitals!.text).toBe("HR 112, above the recorded range 60–100.");
  });

  it("says when a value is below the recorded range", () => {
    const vitals = formatNurseVitals(withRange("48", 60, 100));
    expect(vitals!.text).toBe("HR 48, below the recorded range 60–100.");
  });

  it("says nothing when the value sits inside the recorded range", () => {
    const vitals = formatNurseVitals(withRange("72", 60, 100));
    expect(vitals!.text).toBe("HR 72.");
  });

  it("says nothing when the record carries no range — no range is not 'normal', it is unmeasured", () => {
    const vitals = formatNurseVitals(withRange("112", null, null));
    expect(vitals!.text).toBe("HR 112.");
    // And a half-range is not a range: annotating from one bound would be inventing the other.
    expect(formatNurseVitals(withRange("112", 60, null))!.text).toBe("HR 112.");
  });

  it("never annotates blood pressure, whose value is the panel's text rather than one number", () => {
    const vitals = formatNurseVitals([
      obs({ code: "85354-9", code_display: "Blood pressure", value_text: "150/95", unit: "mmHg", ref_range_low: 90, ref_range_high: 120 }),
    ]);
    expect(vitals!.text).toBe("BP 150/95.");
  });
});
