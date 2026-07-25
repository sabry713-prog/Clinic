/**
 * EvidenceChainPopover — "Show Reasoning" / "View Evidence Chain" trigger.
 *
 * Renders the exact deterministic graph traversal NSCRE returned for one
 * finding (services/veritas-graph/evidence_chain.py, Sprint 7) -- e.g.
 * Patient(id=...) -> LabResult(eGFR=28) -> Medication(name=Metformin) ->
 * Rule(flag=CRITICAL_OVERRIDE). Nothing here is generated; every chip is a
 * property NSCRE's Cypher query actually returned.
 *
 * Same lightweight click-toggle absolute-panel pattern already established
 * in NphiesBadge.tsx -- no new UI-library dependency.
 */

import { useState } from "react";
import { GitBranch, ChevronRight } from "lucide-react";
import type { EvidenceChain } from "../../hooks/useAgentOrchestrator";

interface EvidenceChainPopoverProps {
  readonly evidenceChain: EvidenceChain;
  /** "Show Reasoning" (agent cards) or "View Evidence Chain" (NPHIES badges). */
  readonly triggerLabel?: string;
}

export default function EvidenceChainPopover({
  evidenceChain,
  triggerLabel = "Show Reasoning",
}: EvidenceChainPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={triggerLabel}
        className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:text-white"
      >
        <GitBranch className="h-3 w-3" aria-hidden="true" />
        {triggerLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Evidence chain"
          className="absolute start-0 top-full z-40 mt-1 w-80 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-slate-200 shadow-xl"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Graph traversal
          </p>
          <div className="flex flex-wrap items-center gap-1" data-testid="evidence-chain-steps">
            {evidenceChain.steps.map((step, i) => (
              <span key={`${step.node_type}-${i}`} className="flex items-center gap-1">
                <span className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
                  {step.node_type}
                  {Object.keys(step.properties).length > 0 && (
                    <span className="text-slate-500">
                      (
                      {Object.entries(step.properties)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(", ")}
                      )
                    </span>
                  )}
                </span>
                {i < evidenceChain.steps.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-slate-600" aria-hidden="true" />
                )}
              </span>
            ))}
          </div>
          <p className="mt-2 break-words border-t border-slate-800 pt-2 font-mono text-[10px] text-slate-500">
            {evidenceChain.rendered}
          </p>
        </div>
      )}
    </span>
  );
}
