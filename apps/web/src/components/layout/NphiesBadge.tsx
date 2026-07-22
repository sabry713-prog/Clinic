/**
 * NphiesBadge — status pill shown next to an order line.
 *
 *   green  — Approved / covered (NPHIES code matched)
 *   yellow — Pre-authorisation required (1-click action)
 *   red    — Code mismatch / rejection risk (suggested codes)
 *
 * The colour reflects BILLING / claim-paperwork state only. It is not a
 * clinical severity indicator and carries no clinical meaning.
 */

import { useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { NphiesStatus } from "./SullyContext";

const STYLES: Record<NphiesStatus, { pill: string; dot: string; label: string }> = {
  green: {
    pill: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    dot: "text-emerald-400",
    label: "Approved",
  },
  yellow: {
    pill: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    dot: "text-amber-400",
    label: "Pre-auth required",
  },
  red: {
    pill: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    dot: "text-rose-400",
    label: "Code mismatch",
  },
};

const ICONS: Record<NphiesStatus, typeof CheckCircle2> = {
  green: CheckCircle2,
  yellow: AlertTriangle,
  red: XCircle,
};

interface NphiesBadgeProps {
  readonly status: NphiesStatus;
  readonly detail: string;
  readonly suggestedCodes?: readonly string[] | undefined;
  /** Label for the 1-click action offered on yellow/red. */
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
}

export default function NphiesBadge({
  status,
  detail,
  suggestedCodes,
  actionLabel,
  onAction,
}: NphiesBadgeProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const style = STYLES[status];
  const Glyph = ICONS[status];

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`NPHIES status: ${style.label}`}
        title={detail}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${style.pill}`}
      >
        <Glyph className={`h-3.5 w-3.5 ${style.dot}`} aria-hidden="true" />
        {style.label}
      </button>

      {open && (
        <span
          role="tooltip"
          className="absolute end-0 top-full z-30 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 shadow-xl"
        >
          <span className="block leading-relaxed">{detail}</span>

          {suggestedCodes && suggestedCodes.length > 0 && (
            <span className="mt-2 block">
              <span className="block text-slate-400">Suggested codes:</span>
              <span className="mt-1 flex flex-wrap gap-1">
                {suggestedCodes.map((code) => (
                  <code
                    key={code}
                    className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-200"
                  >
                    {code}
                  </code>
                ))}
              </span>
            </span>
          )}

          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="mt-2 w-full rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
            >
              {actionLabel}
            </button>
          )}
        </span>
      )}
    </span>
  );
}
