/**
 * LabPanel — displays chronological lab observations.
 *
 * Constraints:
 * - No color-coding based on reference range position
 * - No "H" / "L" / "critical" badges
 * - No interpretation language
 * - Reference ranges displayed as plain text: [low-high unit]
 * - Values displayed as plain text: "Creatinine: 168 μmol/L [59-104]"
 */

import { useState } from "react";
import { useShowMore, ShowMoreButton } from "../ShowMore/ShowMore";

const INITIAL_ROWS = 5;

export interface ObservationItem {
  readonly id: string;
  readonly category: string | null;
  readonly code: string | null;
  readonly code_display: string | null;
  readonly value_numeric: number | null;
  readonly value_text: string | null;
  readonly unit: string | null;
  readonly ref_range_low: number | null;
  readonly ref_range_high: number | null;
  readonly ref_range_text: string | null;
  readonly effective_at: string | null;
}

interface LabPanelProps {
  readonly observations: readonly ObservationItem[];
  readonly isLoading: boolean;
  readonly onLoadMore?: () => void;
  readonly hasMore: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatValue(obs: ObservationItem): string {
  if (obs.value_numeric !== null && obs.unit) {
    return `${obs.value_numeric} ${obs.unit}`;
  }
  if (obs.value_numeric !== null) {
    return String(obs.value_numeric);
  }
  return obs.value_text ?? "—";
}

function formatRefRange(obs: ObservationItem): string {
  if (obs.ref_range_text) return `[${obs.ref_range_text}]`;
  if (obs.ref_range_low !== null && obs.ref_range_high !== null) {
    const unit = obs.unit ?? "";
    return `[${obs.ref_range_low}–${obs.ref_range_high}${unit ? ` ${unit}` : ""}]`;
  }
  if (obs.ref_range_low !== null) return `[≥${obs.ref_range_low}]`;
  if (obs.ref_range_high !== null) return `[≤${obs.ref_range_high}]`;
  return "";
}

const CATEGORIES = ["All", "laboratory", "vital-signs", "imaging"];

export default function LabPanel({
  observations,
  isLoading,
  onLoadMore,
  hasMore,
}: LabPanelProps): JSX.Element {
  const [activeCategory, setActiveCategory] = useState<string>("All");

  const filtered =
    activeCategory === "All"
      ? observations
      : observations.filter((o) => o.category === activeCategory);

  const rows = useShowMore(filtered, INITIAL_ROWS);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
      <h2 className="text-base font-semibold text-white mb-4">Observations</h2>

      {/* Category filter tabs — no clinical significance implied */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={[
              "px-3 py-1 text-xs rounded-full border transition-colors",
              activeCategory === cat
                ? "bg-slate-600 border-slate-500 text-white"
                : "bg-transparent border-slate-700 text-slate-400 hover:border-slate-500",
            ].join(" ")}
          >
            {cat}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading observations...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">No observations documented</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="pb-2 pr-4 font-medium">Date</th>
                <th className="pb-2 pr-4 font-medium">Observation</th>
                <th className="pb-2 pr-4 font-medium">Value</th>
                <th className="pb-2 pr-4 font-medium">Reference Range</th>
              </tr>
            </thead>
            <tbody>
              {rows.visible.map((obs) => (
                <tr
                  key={obs.id}
                  className="border-b border-slate-800 last:border-0"
                >
                  <td className="py-2 pr-4 text-slate-400 whitespace-nowrap">
                    <span dir="ltr">{formatDate(obs.effective_at)}</span>
                  </td>
                  <td className="py-2 pr-4 text-white">
                    {obs.code_display ?? obs.code ?? "Unknown"}
                  </td>
                  {/* Plain text value — no color-coding.
                      dir=ltr isolates "16 /min"-style values in RTL layouts */}
                  <td className="py-2 pr-4 text-white font-mono">
                    <span dir="ltr">{formatValue(obs)}</span>
                  </td>
                  <td className="py-2 pr-4 text-slate-400">
                    <span dir="ltr">{formatRefRange(obs)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ShowMoreButton state={rows} itemLabel="observations" />
        </div>
      )}

      {hasMore && onLoadMore && rows.expanded && (
        <button
          onClick={onLoadMore}
          className="mt-4 text-sm text-slate-400 hover:text-white transition-colors"
        >
          Load more observations
        </button>
      )}
    </div>
  );
}
