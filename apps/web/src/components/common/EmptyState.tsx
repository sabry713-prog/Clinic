/**
 * EmptyState
 *
 * Neutral "nothing documented here" affordance for record panels. A muted
 * icon plus a short factual line. No alarm styling, no clinical meaning — an
 * empty record section is a fact, not a finding.
 */

import React from "react";

interface EmptyStateProps {
  /** Factual line, e.g. "No observations documented". */
  readonly message: string;
  /** Optional inline-SVG path; defaults to a document glyph. */
  readonly iconPath?: string;
}

const DEFAULT_ICON =
  "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z";

export default function EmptyState({ message, iconPath }: EmptyStateProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
        <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath ?? DEFAULT_ICON} />
        </svg>
      </div>
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
