/**
 * EvidenceChainPopover — "Show Reasoning" / "View Evidence Chain" trigger,
 * opening the S4.1 terminal cutaway panel.
 *
 * Renders the exact deterministic provenance NSCRE returned for one finding
 * (services/veritas-graph/evidence_chain.py): the graph traversal as node
 * chips, the source facts as a table, and — when the chain carries them —
 * the verbatim Cypher statements the engine executed. Nothing here is
 * generated or paraphrased: every value displayed is a property the query
 * actually returned, and the query text is passed through byte-for-byte from
 * the engine's own module constants.
 *
 * Reference-map provenance (ICD/SBS coding suggestions) reuses this panel
 * with `queryLabel="SQL executed"` — its "query" is the deterministic
 * Postgres lookup, honestly labeled, never dressed up as Cypher.
 *
 * Same lightweight click-toggle absolute-panel pattern established in
 * NphiesBadge.tsx -- no new UI-library dependency.
 */

import { useRef, useState } from "react";
import { GitBranch, ChevronRight, TerminalSquare } from "lucide-react";
import type { EvidenceChain } from "../../hooks/useAgentOrchestrator";
import FixedPopover from "../common/FixedPopover";

interface EvidenceChainPopoverProps {
  readonly evidenceChain: EvidenceChain;
  /** "Show Reasoning" (agent cards) or "View Evidence Chain" (NPHIES badges). */
  readonly triggerLabel?: string;
  /** What the assertion is (shown at the top of the panel), e.g.
   * "DDI alert: Metformin × Contrast Agent". */
  readonly title?: string;
  /** Section label for the query text — "Cypher executed" (graph) or
   * "SQL executed" (reference-map provenance). */
  readonly queryLabel?: string;
}

export default function EvidenceChainPopover({
  evidenceChain,
  triggerLabel = "Show Reasoning",
  title,
  queryLabel = "Cypher executed",
}: EvidenceChainPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  return (
    <span ref={anchorRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={triggerLabel}
        className="inline-flex items-center gap-1 rounded-full border border-ev-pill-line bg-ev-pill-bg px-2.5 py-0.5 text-[11px] font-semibold text-ev-pill hover:brightness-95"
      >
        <GitBranch className="h-3 w-3" aria-hidden="true" />
        {triggerLabel}
      </button>

      <FixedPopover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        role="dialog"
        ariaLabel="Evidence chain"
        className="rounded-2xl border border-line bg-white p-3 text-xs text-ink-deep shadow-pop"
      >
          {title && (
            <p className="mb-2 text-[11px] font-semibold text-ink-deep" data-testid="evidence-title">
              {title}
            </p>
          )}
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Graph traversal
          </p>
          <div className="flex flex-wrap items-center gap-1" data-testid="evidence-chain-steps">
            {evidenceChain.steps.map((step, i) => (
              <span key={`${step.node_type}-${i}`} className="flex items-center gap-1">
                <span className="rounded border border-line bg-wash px-1.5 py-0.5 font-mono text-[10px] text-ink-deep">
                  {step.node_type}
                  {Object.keys(step.properties).length > 0 && (
                    <span className="text-ink-soft">
                      (
                      {Object.entries(step.properties)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(", ")}
                      )
                    </span>
                  )}
                </span>
                {i < evidenceChain.steps.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-ink-faint" aria-hidden="true" />
                )}
              </span>
            ))}
          </div>

          {/* Source facts — every property of every step, verbatim. */}
          <p className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Source facts
          </p>
          <table className="w-full border-collapse" data-testid="evidence-source-facts">
            <tbody>
              {evidenceChain.steps.flatMap((step, i) =>
                Object.entries(step.properties).map(([k, v]) => (
                  <tr key={`${step.node_type}-${i}-${k}`} className="border-b border-line last:border-0">
                    <td className="py-0.5 pe-2 font-mono text-[10px] text-ink-soft align-top">
                      {step.node_type}.{k}
                    </td>
                    <td className="py-0.5 font-mono text-[10px] text-ink-deep align-top">{String(v)}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>

          {/* The exact query text executed — verbatim from the engine's own
              module constants; dir=ltr because Cypher/SQL read left-to-right
              even in the Arabic locale. */}
          {evidenceChain.cypher && evidenceChain.cypher.length > 0 && (
            <div className="mt-3" data-testid="evidence-cypher-section">
              <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <TerminalSquare className="h-3 w-3" aria-hidden="true" />
                {queryLabel}
              </p>
              {evidenceChain.cypher.map((query, i) => (
                <pre
                  key={`cypher-${i}`}
                  dir="ltr"
                  data-testid={`evidence-cypher-${i}`}
                  className="overflow-x-auto rounded-xl border border-term-bg bg-term-bg p-3 font-mono text-[10.5px] leading-relaxed text-term-cyan shadow-[inset_0_0_40px_rgba(99,102,241,0.08)]"
                >
                  {query}
                </pre>
              ))}
            </div>
          )}

          <p className="mt-2 break-words border-t border-line pt-2 font-mono text-[10px] text-ink-soft">
            {evidenceChain.rendered}
          </p>
    </FixedPopover>
    </span>
  );
}
