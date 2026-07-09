/**
 * SinceLastVisitPanel — deterministic, boundary-filtered reproduction of
 * facts newly documented between the patient's previous encounter and now
 * (docs/architecture/since-last-visit.md).
 *
 * This is the boundary-safe reframing of a competitor pattern that surfaces
 * AI-flagged "things to consider" with risk labels and trend language. This
 * panel does neither: every item is a plain fact with its own real
 * timestamp, one neutral color regardless of type (no severity color-coding,
 * no "high risk" badges), no drug-interaction checking, and no dose-change
 * pairing (the schema has no supersession link, so pairing two medication
 * rows by code would be an inference, not a fact).
 *
 * Always visible above the composer — not gated behind a chip — so it stays
 * immediately glanceable, same placement intent as the pattern it replaces.
 */

import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import type { SinceLastVisitItem } from "../../lib/api";

export interface SinceLastVisitPanelProps {
  readonly patientId: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "date unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date unknown";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function itemLabel(item: SinceLastVisitItem): { text: string; date: string } {
  if (item.type === "condition") {
    return { text: item.code_display ?? "Condition", date: formatDate(item.onset_date) };
  }
  if (item.type === "allergy") {
    const reaction = item.reaction ? ` — reaction: ${item.reaction}` : "";
    return { text: `${item.code_display ?? "Allergy"}${reaction}`, date: formatDate(item.recorded_at) };
  }
  const parts = [item.medication_display, item.dose, item.route, item.frequency].filter(Boolean);
  return { text: parts.join(" "), date: formatDate(item.started_at) };
}

const TYPE_LABEL: Record<SinceLastVisitItem["type"], string> = {
  condition: "Diagnosis",
  allergy: "Allergy",
  medication: "Medication order",
};

export default function SinceLastVisitPanel({ patientId }: SinceLastVisitPanelProps): JSX.Element | null {
  const [hasPreviousEncounter, setHasPreviousEncounter] = useState<boolean | null>(null);
  const [items, setItems] = useState<readonly SinceLastVisitItem[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    setHasPreviousEncounter(null);
    setItems([]);
    setError(false);
    api.patients
      .sinceLastVisit(patientId)
      .then((data) => {
        setHasPreviousEncounter(data.has_previous_encounter);
        setItems(data.items);
      })
      .catch(() => setError(true));
  }, [patientId]);

  // Silent on load/error — this is a supplementary glance panel, not a
  // primary workflow; a failure here should never block the workspace.
  if (hasPreviousEncounter === null || error) return null;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4" data-testid="since-last-visit-panel">
      <h2 className="text-sm font-medium text-slate-200 mb-1">Documented Since Your Last Visit</h2>
      {!hasPreviousEncounter ? (
        <p className="text-sm text-slate-500" data-testid="since-last-visit-empty">
          No previous visit to compare — this is the first documented encounter.
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid="since-last-visit-empty">
          Nothing new documented since the last visit.
        </p>
      ) : (
        <ul className="space-y-1.5 mt-2">
          {items.map((item, idx) => {
            const { text, date } = itemLabel(item);
            return (
              <li
                key={idx}
                className="flex items-baseline gap-2 text-sm text-slate-300"
                data-testid="since-last-visit-item"
                data-item-type={item.type}
              >
                <span className="shrink-0 text-[10px] font-medium tracking-wide text-blue-300/80 bg-blue-950/40 border border-blue-800/40 rounded px-1.5 py-0.5">
                  NEW
                </span>
                <span className="text-slate-500 text-xs shrink-0">{TYPE_LABEL[item.type]}:</span>
                <span className="flex-1">{text}</span>
                <span className="text-slate-500 text-xs shrink-0" dir="ltr">{date}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
