/**
 * GeneratingIndicator
 *
 * Reusable "content is being generated" affordance for the model-backed panels
 * (Narrative, Handoff). Animated dots + shimmer skeleton lines convey activity
 * during the (reasoning-model) wait.
 *
 * Purely cosmetic — conveys progress only, never clinical meaning. No color
 * coding, no severity, no alarm styling.
 */

import React from "react";

interface GeneratingIndicatorProps {
  /** Short neutral status line, e.g. "Assembling factual summary…" */
  readonly label: string;
  /** Number of skeleton lines to show under the label. Default 4. */
  readonly lines?: number;
  /** Theme: "dark" for slate panels (default), "light" for white surfaces. */
  readonly variant?: "dark" | "light";
}

function Dots({ dotClass }: { readonly dotClass: string }): React.ReactElement {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full animate-bounce ${dotClass}`}
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
        />
      ))}
    </span>
  );
}

export default function GeneratingIndicator({
  label,
  lines = 4,
  variant = "dark",
}: GeneratingIndicatorProps): React.ReactElement {
  const isLight = variant === "light";
  const labelClass = isLight ? "text-gray-400" : "text-slate-400";
  const dotClass = isLight ? "bg-gray-400" : "bg-slate-400";
  const skeletonClass = isLight ? "bg-gray-200" : "bg-slate-700/60";
  return (
    <div className="py-4" role="status" aria-label={label} data-testid="loading-state">
      <div className={`flex items-center gap-2 text-sm mb-3 ${labelClass}`}>
        <Dots dotClass={dotClass} />
        <span>{label}</span>
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={`h-3 rounded animate-pulse ${skeletonClass}`}
            style={{ width: `${[92, 78, 85, 64, 70][i % 5]}%` }}
          />
        ))}
      </div>
    </div>
  );
}
