/**
 * usePatientTimeline — real encounter/observation/medication history for the
 * VeritasShell centre pane (Phase 2, audit M-4).
 *
 * The pane previously rendered a hardcoded seven-entry constant while the data
 * it needed already existed behind three implemented endpoints. This fetches
 * all three in parallel and merges them into one reverse-chronological feed.
 *
 * Two deliberate properties:
 *
 * 1. **Nothing is interpreted.** Lab values are rendered with the reference
 *    range the source system supplied, exactly as `PatientFilePage` does. No
 *    high/low flagging, no severity, no ordering by clinical importance --
 *    only by date (CLAUDE.md: no clinical judgment in the presentation layer).
 * 2. **Partial failure is not total failure.** Each endpoint is settled
 *    independently, so a single failing call degrades that one section instead
 *    of blanking the whole timeline.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { EncounterItem, MedicationItem, ObservationItem } from "../lib/api";

export interface TimelineFeedEntry {
  readonly id: string;
  readonly kind: "encounter" | "lab" | "note" | "medication" | "imaging";
  readonly title: string;
  readonly detail: string;
  readonly at: string;
  /** Raw timestamp used for sorting; `at` is the display string. */
  readonly sortKey: string;
}

export interface UsePatientTimelineState {
  readonly entries: readonly TimelineFeedEntry[];
  readonly loading: boolean;
  /** Set when at least one source failed; the rest still render. */
  readonly partialError: string | null;
  readonly refresh: () => void;
}

function displayDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/** Lab detail line: value + unit + whatever range the source recorded. */
function observationDetail(o: ObservationItem): string {
  const value =
    o.value_numeric !== null && o.value_numeric !== undefined
      ? `${o.value_numeric}${o.unit ? ` ${o.unit}` : ""}`
      : (o.value_text ?? "");
  const range =
    o.ref_range_text ??
    (o.ref_range_low !== null && o.ref_range_high !== null
      ? `ref ${o.ref_range_low}–${o.ref_range_high}`
      : null);
  return range ? `${value} (${range})` : value;
}

function medicationDetail(m: MedicationItem): string {
  return [m.dose, m.route, m.frequency].filter(Boolean).join(", ");
}

/** Imaging is an observation category; everything else reads as a lab. */
function observationKind(o: ObservationItem): TimelineFeedEntry["kind"] {
  const category = (o.category ?? "").toLowerCase();
  return category.includes("imaging") || category.includes("radiology") ? "imaging" : "lab";
}

export function usePatientTimeline(patientId: string | null): UsePatientTimelineState {
  const [entries, setEntries] = useState<readonly TimelineFeedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!patientId) {
      setEntries([]);
      setPartialError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPartialError(null);

    void (async () => {
      const [encounters, observations, medications] = await Promise.allSettled([
        api.patients.encounters(patientId),
        api.patients.observations(patientId, { limit: 50 }),
        api.patients.medications(patientId),
      ]);
      if (cancelled) return;

      const merged: TimelineFeedEntry[] = [];
      const failed: string[] = [];

      if (encounters.status === "fulfilled") {
        for (const e of encounters.value.data as EncounterItem[]) {
          merged.push({
            id: `enc-${e.id}`,
            kind: "encounter",
            title: e.encounter_type ?? "Encounter",
            detail: [e.ward, e.status].filter(Boolean).join(" · "),
            at: displayDate(e.started_at),
            sortKey: e.started_at ?? "",
          });
        }
      } else failed.push("encounters");

      if (observations.status === "fulfilled") {
        for (const o of observations.value.data as ObservationItem[]) {
          merged.push({
            id: `obs-${o.id}`,
            kind: observationKind(o),
            title: o.code_display ?? o.code ?? "Observation",
            detail: observationDetail(o),
            at: displayDate(o.effective_at),
            sortKey: o.effective_at ?? "",
          });
        }
      } else failed.push("observations");

      if (medications.status === "fulfilled") {
        for (const m of medications.value.data as MedicationItem[]) {
          merged.push({
            id: `med-${m.id}`,
            kind: "medication",
            title: m.medication_display ?? "Medication",
            detail: medicationDetail(m),
            at: displayDate(m.started_at),
            sortKey: m.started_at ?? "",
          });
        }
      } else failed.push("medications");

      // Reverse-chronological; undated entries sink to the bottom rather than
      // being dropped, since an undated record is still a real record.
      merged.sort((a, b) => (b.sortKey || "").localeCompare(a.sortKey || ""));

      setEntries(merged);
      setPartialError(
        failed.length > 0 ? `Could not load: ${failed.join(", ")}. Showing what loaded.` : null,
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [patientId, nonce]);

  return { entries, loading, partialError, refresh };
}
