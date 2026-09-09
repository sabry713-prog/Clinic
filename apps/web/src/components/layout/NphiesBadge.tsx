/**
 * NphiesBadge — status pill shown next to an order line.
 *
 *   green  — Approved / covered (NPHIES code matched, or payer authorised)
 *   yellow — Pre-authorisation required (1-click action)
 *   blue   — Pended: submitted, payer has not decided yet (Sprint 9)
 *   red    — Code mismatch / rejection risk (suggested codes)
 *
 * A pending payer response is deliberately its own state rather than being
 * folded into green — "submitted" is not "approved", and rendering an
 * undecided claim as approved would misrepresent the payer.
 *
 * The colour reflects BILLING / claim-paperwork state only. It is not a
 * clinical severity indicator and carries no clinical meaning.
 */

import { useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Clock, Loader2 } from "lucide-react";
import type { NphiesStatus } from "./SullyContext";
import EvidenceChainPopover from "../ai-team/EvidenceChainPopover";
import FixedPopover from "../common/FixedPopover";
import type { EvidenceChain } from "../../hooks/useAgentOrchestrator";

// v2 badge tokens (mockup §E): complete/pended/rejected. Green is
// payer-complete ONLY — the pended family covers queued/partial/unrecognised.
const STYLES: Record<NphiesStatus, { pill: string; dot: string; label: string }> = {
  green: {
    pill: "bg-status-ok-bg text-status-ok border-status-ok-line",
    dot: "text-status-ok",
    label: "Approved",
  },
  yellow: {
    pill: "bg-status-pend-bg text-status-pend border-status-pend-line",
    dot: "text-status-pend",
    label: "Pre-auth required",
  },
  blue: {
    pill: "bg-status-pend-bg text-status-pend border-status-pend-line",
    dot: "text-status-pend",
    label: "Pended (under review)",
  },
  red: {
    pill: "bg-status-rej-bg text-status-rej border-status-rej-line",
    dot: "text-status-rej",
    label: "Code mismatch",
  },
};

const ICONS: Record<NphiesStatus, typeof CheckCircle2> = {
  green: CheckCircle2,
  yellow: AlertTriangle,
  blue: Clock,
  red: XCircle,
};

interface NphiesBadgeProps {
  readonly status: NphiesStatus;
  readonly detail: string;
  readonly suggestedCodes?: readonly string[] | undefined;
  /** Label for the 1-click action offered on yellow/red. */
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  /** NSCRE's own graph traversal behind this status, when it came from a live
   * NPHIES agent result (Sprint 8) -- the "View Evidence Chain" trigger only
   * appears when this is set. */
  readonly evidenceChain?: EvidenceChain | null | undefined;
  /** Payer authorization reference, shown on the pill once approved (Sprint 9).
   * Read from the payer response — never generated client-side. */
  readonly authorizationNumber?: string | null | undefined;
  /** A submission is in flight: shows a spinner in place of the status icon. */
  readonly submitting?: boolean | undefined;
  /** Clicking the pill itself opens the pre-auth flow (yellow badges). */
  readonly onBadgeClick?: (() => void) | undefined;
}

export default function NphiesBadge({
  status,
  detail,
  suggestedCodes,
  actionLabel,
  onAction,
  evidenceChain,
  authorizationNumber,
  submitting,
  onBadgeClick,
}: NphiesBadgeProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const style = STYLES[status];

  // Hover-intent bridge: the panel floats in a body portal with a gap
  // between it and the badge, so closing on the badge's mouseleave would
  // snap the tooltip shut before the pointer can cross that gap. Leaving
  // either the badge or the panel starts a short grace timer; entering
  // either cancels it. Outside click and Escape still close immediately.
  const cancelClose = (): void => window.clearTimeout(closeTimer.current);
  const scheduleClose = (): void => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 260);
  };
  const Glyph = ICONS[status];

  // "Approved" alone is ambiguous once a payer is involved; showing the
  // authorization reference on the pill makes it verifiable at a glance.
  const label =
    status === "green" && authorizationNumber
      ? `Approved · ${authorizationNumber}`
      : style.label;

  return (
    <span ref={anchorRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={`NPHIES status: ${label}`}
        title={detail}
        onMouseEnter={() => {
          cancelClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleClose}
        onFocus={() => setOpen(true)}
        onClick={() => {
          cancelClose();
          if (onBadgeClick) {
            setOpen(false);
            onBadgeClick();
          } else {
            // Pin open — hovering already opens, so a toggle here would
            // close the tooltip on the very click that aims to use it.
            setOpen(true);
          }
        }}
        disabled={submitting}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${style.pill} ${
          onBadgeClick && !submitting ? "cursor-pointer hover:brightness-125" : ""
        }`}
      >
        {submitting ? (
          <Loader2 className={`h-3.5 w-3.5 animate-spin ${style.dot}`} aria-hidden="true" />
        ) : (
          <Glyph className={`h-3.5 w-3.5 ${style.dot}`} aria-hidden="true" />
        )}
        {submitting ? "Submitting…" : label}
      </button>

      <FixedPopover
        anchorRef={anchorRef}
        open={open}
        onClose={() => {
          cancelClose();
          setOpen(false);
        }}
        width={288}
        role="tooltip"
        className="rounded-xl border border-line bg-white p-3 text-xs text-ink-deep shadow-pop"
        onPanelMouseEnter={cancelClose}
        onPanelMouseLeave={scheduleClose}
      >
          <span className="block leading-relaxed">{detail}</span>

          {suggestedCodes && suggestedCodes.length > 0 && (
            <span className="mt-2 block">
              <span className="block text-ink-soft">Suggested codes:</span>
              <span className="mt-1 flex flex-wrap gap-1">
                {suggestedCodes.map((code) => (
                  <code
                    key={code}
                    className="rounded bg-veil px-1.5 py-0.5 font-mono text-[11px] text-ink-deep"
                  >
                    {code}
                  </code>
                ))}
              </span>
            </span>
          )}

          {evidenceChain && (
            <span className="mt-2 block">
              <EvidenceChainPopover evidenceChain={evidenceChain} triggerLabel="View Evidence Chain" />
            </span>
          )}

          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className="mt-2 w-full rounded-full bg-grad-accent px-2 py-1 text-xs font-semibold text-white shadow-pill hover:brightness-110 transition-all"
            >
              {actionLabel}
            </button>
          )}
      </FixedPopover>
    </span>
  );
}
