/**
 * ReconciliationPanel — medication reconciliation across source feeds (E1).
 *
 * Constraints (non-SaMD, CLAUDE.md §2):
 * - Differences are documented FACTS, never warnings/conflicts-to-act-on.
 * - No severity, no flags, no color-coding by importance (neutral styling only).
 * - Alphabetical order only — never ranked by importance.
 */

import type { MedicationReconciliation } from "../../lib/api";

interface ReconciliationPanelProps {
  readonly data: MedicationReconciliation | null;
  readonly isLoading: boolean;
}

function attrs(
  e: { dose: string | null; route: string | null; frequency: string | null } | undefined,
): string {
  if (!e) return "";
  return [e.dose, e.route, e.frequency].filter(Boolean).join(" · ");
}

export default function ReconciliationPanel({
  data,
  isLoading,
}: ReconciliationPanelProps): JSX.Element {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-base font-semibold text-white">Medication Reconciliation</h2>
        {data && data.sources.length > 0 && (
          <span className="text-xs text-slate-500" dir="ltr">
            sources: {data.sources.join(" · ")}
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Documented differences between source feeds. Factual comparison only — not a
        clinical assessment.
      </p>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading reconciliation…</p>
      ) : !data || data.reconciliation.length === 0 ? (
        <p className="text-sm text-slate-500">No medications documented</p>
      ) : data.sources.length < 2 ? (
        <p className="text-sm text-slate-500">
          Only one source feed documented for this patient — nothing to reconcile.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="pb-2 pr-4 font-medium">Medication</th>
                {data.sources.map((s) => (
                  <th key={s} className="pb-2 pr-4 font-medium" dir="ltr">
                    {s}
                  </th>
                ))}
                <th className="pb-2 pr-4 font-medium">Documented differences</th>
              </tr>
            </thead>
            <tbody>
              {data.reconciliation.map((m) => {
                const bySource = new Map(m.entries.map((e) => [e.source, e]));
                return (
                  <tr
                    key={(m.code ?? m.medication_display ?? "") + m.documented_in.join()}
                    className="border-b border-slate-800 last:border-0 align-top"
                  >
                    <td className="py-2 pr-4 text-white">
                      {m.medication_display ?? m.code ?? "Unknown"}
                    </td>
                    {data.sources.map((s) => {
                      const e = bySource.get(s);
                      return (
                        <td key={s} className="py-2 pr-4">
                          {e ? (
                            <span
                              className="text-white"
                              dir="ltr"
                              title={`source id: ${e.source_id}`}
                            >
                              {attrs(e) || "documented"}
                            </span>
                          ) : (
                            <span className="text-slate-500">not documented</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-4 text-slate-300">
                      {m.differences.length === 0 ? (
                        <span className="text-slate-500">—</span>
                      ) : (
                        <ul className="space-y-1">
                          {m.differences.map((d, i) => (
                            <li key={i} dir="auto">
                              {d}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
