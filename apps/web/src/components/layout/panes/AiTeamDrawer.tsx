/**
 * Right column — collapsible "AI Team" drawer.
 *
 * Tab selectors for the specialised agents, a container of 1-click action
 * cards for the active agent, and an inter-agent activity stream (mock).
 *
 * Collapsing the drawer hands its width back to the center column; the
 * transition is driven by a width class on the container in SullyShell.
 */

import { useEffect, useRef } from "react";
import {
  PanelRightClose, PanelRightOpen, Bot, Play, ArrowRight, Clock,
} from "lucide-react";
import {
  useSully, agentActions, AGENT_IDS, AGENT_LABELS, type AgentId,
} from "../SullyContext";
import EvidenceChainPopover from "../../ai-team/EvidenceChainPopover";
import ReceptionistTab from "../../ai-team/ReceptionistTab";

/** Short tab labels so five agents fit without wrapping. */
const TAB_LABELS: Record<AgentId, string> = {
  scribe: "Scribe",
  consultant: "Consult",
  pharmacist: "Pharm",
  nphies: "NPHIES",
  receptionist: "Recep",
};

export default function AiTeamDrawer(): JSX.Element {
  const {
    activeAgent, messages, drawerOpen, postCare, postCareLoading, postCarePendingIntegration,
    setActiveAgent, toggleDrawer, runAgentAction,
  } = useSully();
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // Collapsed: a thin rail with just the expand control.
  if (!drawerOpen) {
    return (
      <aside
        className="flex h-full w-12 flex-col items-center border-s border-slate-800 bg-slate-900 py-3"
        aria-label="AI Team drawer (collapsed)"
      >
        <button
          type="button"
          onClick={toggleDrawer}
          aria-expanded={false}
          aria-label="Expand AI Team drawer"
          title="Expand AI Team"
          className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <PanelRightOpen className="h-5 w-5" />
        </button>
        <Bot className="mt-3 h-5 w-5 text-blue-400" aria-hidden="true" />
      </aside>
    );
  }

  const actions = agentActions(activeAgent);

  return (
    <aside
      className="flex h-full w-full flex-col border-s border-slate-800 bg-slate-900"
      aria-label="AI Team drawer"
    >
      <header className="flex items-center gap-2 border-b border-slate-800 px-3 py-2.5">
        <Bot className="h-4 w-4 text-blue-400" aria-hidden="true" />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-300">AI Team</h2>
        <button
          type="button"
          onClick={toggleDrawer}
          aria-expanded
          aria-label="Collapse AI Team drawer"
          title="Collapse"
          className="ms-auto rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      {/* Agent tabs */}
      <div role="tablist" aria-label="Agents" className="flex border-b border-slate-800">
        {AGENT_IDS.map((agent) => (
          <button
            key={agent}
            role="tab"
            aria-selected={activeAgent === agent}
            aria-label={AGENT_LABELS[agent]}
            onClick={() => setActiveAgent(agent)}
            className={`flex-1 border-b-2 px-1 py-2 text-[11px] font-medium transition-colors ${
              activeAgent === agent
                ? "border-blue-500 text-white"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {TAB_LABELS[agent]}
          </button>
        ))}
      </div>

      {/* Action cards */}
      <div role="tabpanel" aria-label={`${AGENT_LABELS[activeAgent]} actions`} className="border-b border-slate-800 p-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {AGENT_LABELS[activeAgent]} actions
        </h3>
        {activeAgent === "receptionist" ? (
          <ReceptionistTab
            postCare={postCare}
            loading={postCareLoading}
            pendingIntegration={postCarePendingIntegration}
            onBookSlot={async (slot) => {
              runAgentAction({
                id: `book-${slot.starts_at}`,
                label: "Book follow-up",
                description: slot.starts_at,
              });
            }}
            onDispatch={async (payload) => {
              runAgentAction({
                id: `dispatch-${payload.kind}`,
                label: `Dispatch ${payload.channel}`,
                description: payload.kind,
              });
            }}
          />
        ) : (
        <div className="space-y-2">
          {actions.map((action) => (
            <div key={action.id} className="rounded-lg border border-slate-800 bg-slate-950 p-2.5">
              <p className="text-xs font-medium text-slate-100">{action.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{action.description}</p>
              {action.pendingIntegration ? (
                <span
                  data-testid="pending-integration"
                  title={`${action.label} is not connected to a backend yet — nothing will be sent.`}
                  className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] font-medium text-slate-400"
                >
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  Pending integration
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => runAgentAction(action)}
                  className="mt-2 inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
                >
                  <Play className="h-3 w-3" /> Run
                </button>
              )}
            </div>
          ))}
        </div>
        )}
      </div>

      {/* Activity stream */}
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Agent activity
        </h3>
        <div ref={streamRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pe-1">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-md px-2.5 py-2 ${
                msg.handoff ? "border-s-2 border-violet-500/60 bg-violet-500/5" : "bg-slate-950"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                {msg.handoff ? (
                  <span
                    data-testid="handoff-chain"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-300"
                  >
                    {msg.handoff.sourceAgent}
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    {msg.handoff.targetAgent}
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-blue-300">{AGENT_LABELS[msg.from]}</span>
                )}
                <span className="font-mono text-[10px] text-slate-600">{msg.at}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">{msg.text}</p>
              {msg.findings && msg.findings.length > 0 && (
                <ul className="mt-1.5 space-y-1" data-testid="message-findings">
                  {msg.findings.map((finding) => (
                    <li
                      key={`${finding.kind}-${finding.label}`}
                      className="flex flex-wrap items-center gap-1.5 rounded border border-slate-800 bg-slate-950/60 px-1.5 py-1"
                    >
                      <span className="text-[11px] text-slate-300">{finding.label}</span>
                      <EvidenceChainPopover
                        evidenceChain={finding.evidenceChain}
                        triggerLabel="Evidence"
                        title={finding.label}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {msg.evidenceChain && (
                <div className="mt-1.5">
                  <EvidenceChainPopover evidenceChain={msg.evidenceChain} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
