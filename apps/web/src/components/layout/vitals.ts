/**
 * Nurse-recorded vital signs → the Objective section of the SOAP note.
 *
 * In the clinic the nurse records vitals BEFORE the patient sees the doctor.
 * Those measurements already exist in the record as `hospital.observation`
 * rows (category 'vital-signs', LOINC-coded), so the Objective section is
 * populated from them deterministically -- the values are read, never
 * generated, and the clinician can still edit the field afterwards.
 *
 * Pure functions only: no fetching, no LLM, no defaults invented. A vital for
 * which the record holds no value is simply omitted rather than guessed.
 */

import type { ObservationItem } from "../../lib/api";

/** Display order, matching how vitals are read aloud on a ward round. */
const VITAL_RENDERERS: readonly {
  readonly codes: readonly string[];
  readonly label: string;
  readonly unit: string;
  readonly decimals: number;
}[] = [
  { codes: ["85354-9"], label: "BP", unit: "", decimals: 0 },
  { codes: ["8867-4"], label: "HR", unit: "", decimals: 0 },
  { codes: ["59408-5", "2708-6"], label: "SpO2", unit: "%", decimals: 0 },
  { codes: ["8310-5"], label: "Temp", unit: "°C", decimals: 1 },
  { codes: ["9279-1"], label: "RR", unit: "/min", decimals: 0 },
];

const SYSTOLIC_CODE = "8480-6";
const DIASTOLIC_CODE = "8462-4";

export interface NurseVitals {
  /** e.g. "BP 134/69, HR 72, SpO2 95%, Temp 37.1°C, RR 15/min" */
  readonly text: string;
  /** When the nurse took the most recent of these measurements. */
  readonly recordedAt: string | null;
}

/**
 * Observations arrive over the wire with `value_numeric` as a STRING: the API
 * passes `pg`'s rows straight through, and node-postgres returns NUMERIC as a
 * string to avoid precision loss. Coerce (and reject anything unusable) rather
 * than calling number methods on it -- `"72.4".toFixed()` is a runtime crash.
 */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/** Newest row per code. The API returns rows ordered `effective_at DESC`. */
function latestByCode(rows: readonly ObservationItem[]): Map<string, ObservationItem> {
  const byCode = new Map<string, ObservationItem>();
  for (const row of rows) {
    const code = row.code;
    if (!code || byCode.has(code)) continue;
    byCode.set(code, row);
  }
  return byCode;
}

/**
 * Build the Objective vitals line from observation rows.
 *
 * Returns null when the record holds no usable vital -- the caller must then
 * leave Objective to whatever the clinician dictated rather than inventing a
 * "normal" set of observations.
 */
export function formatNurseVitals(rows: readonly ObservationItem[]): NurseVitals | null {
  if (rows.length === 0) return null;
  const byCode = latestByCode(rows);

  // Blood pressure: the panel row carries "134/69" in value_text. If a feed
  // stored only the components, fall back to systolic/diastolic.
  const parts: string[] = [];
  const used: ObservationItem[] = [];

  for (const spec of VITAL_RENDERERS) {
    let rendered: string | null = null;
    let source: ObservationItem | null = null;

    if (spec.label === "BP") {
      // The panel row carries "134/69" in value_text. A feed that recorded only
      // the components is covered by the systolic/diastolic fallback below.
      const panel = byCode.get("85354-9");
      const panelText = (panel?.value_text ?? "").trim();
      if (panel && panelText.length > 0) {
        rendered = panelText;
        source = panel;
      } else {
        const systolic = toNumber(byCode.get(SYSTOLIC_CODE)?.value_numeric);
        const diastolic = toNumber(byCode.get(DIASTOLIC_CODE)?.value_numeric);
        if (systolic !== null && diastolic !== null) {
          rendered = `${round(systolic, 0)}/${round(diastolic, 0)}`;
          source = byCode.get(SYSTOLIC_CODE) ?? null;
        }
      }
    } else {
      for (const code of spec.codes) {
        const row = byCode.get(code);
        if (!row) continue;
        const text = (row.value_text ?? "").trim();
        const numeric = toNumber(row.value_numeric);
        if (numeric !== null) {
          rendered = `${round(numeric, spec.decimals)}${spec.unit}`;
        } else if (text.length > 0 && /^[0-9.]+$/.test(text)) {
          rendered = `${Number(text).toFixed(spec.decimals)}${spec.unit}`;
        }
        if (rendered !== null) {
          source = row;
          break;
        }
      }
    }

    if (rendered !== null) {
      parts.push(`${spec.label} ${rendered}`);
      if (source) used.push(source);
    }
  }

  if (parts.length === 0) return null;

  const recordedAt =
    used
      .map((r) => r.effective_at)
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .sort()
      .at(-1) ?? null;

  return { text: `${parts.join(", ")}.`, recordedAt };
}

/** True when the text already contains a blood-pressure style reading, so the
 * nurse's line is not duplicated in front of dictated vitals. */
function alreadyHasVitals(text: string): boolean {
  return /\bBP\s*\d|\b\d{2,3}\s*\/\s*\d{2,3}\b|\bHR\s*\d|\bSpO2\s*\d/i.test(text);
}

/**
 * Objective = the nurse's recorded vitals, then whatever else the clinician
 * (or the note drafted from their dictation) put in the section.
 */
export function mergeObjective(
  vitals: NurseVitals | null,
  objectiveText: string,
): string {
  const objective = objectiveText.trim();
  if (!vitals) return objective;
  if (objective.length === 0) return vitals.text;
  if (alreadyHasVitals(objective)) return objective;
  return `${vitals.text} ${objective}`;
}
