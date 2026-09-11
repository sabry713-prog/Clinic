/**
 * JourneyView — the one-screen Encounter Journey wizard.
 *
 * Consolidates the whole clinical→claim flow (document → diagnose →
 * order → code & link → submit) into a single guided surface. Every stage
 * pre-loads its data; system proposals arrive pre-selected where the
 * governance rules allow it (orders, SBS codes); the clinician approves
 * each stage with one explicit action. Linkage remains fully clinician-
 * chosen — the system only annotates chips with the payer rulebook's
 * verdict (the same GREEN/YELLOW/RED the badges show after linking).
 *
 * Guardrail (CLAUDE.md §2, no-auto-execute): nothing is created, coded,
 * linked, or submitted without the clinician's explicit click.
 */

import { useState } from "react";
import type { PatientDetail } from "../../../lib/api";
import { useJourneyState, JOURNEY_STAGES, type JourneyStage } from "./useJourneyState";
import StageDocument from "./StageDocument";
import StageDiagnose from "./StageDiagnose";
import StageOrder from "./StageOrder";
import StageCodeLink from "./StageCodeLink";
import StageSubmit from "./StageSubmit";

const STAGE_LABELS: Record<JourneyStage, string> = {
  document: "Document",
  diagnose: "Diagnose",
  order: "Order",
  codelink: "Code & link",
  submit: "Submit",
};

const STAGE_HINTS: Record<JourneyStage, string> = {
  document: "Record — the SOAP drafts itself",
  diagnose: "Confirm the diagnoses (already analyzed)",
  order: "Create the suggested orders",
  codelink: "Approve codes · link diagnoses",
  submit: "Eligibility auto-check → submit",
};

interface JourneyViewProps {
  readonly patient: PatientDetail;
  /** Encounter the pre-auth flow submits against, when one is open. */
  readonly encounterId: string | null;
}

export default function JourneyView({ patient, encounterId }: JourneyViewProps): JSX.Element {
  const { stage, setStage, completed, markCompleted } = useJourneyState(patient.id);
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = (): void => setRefreshKey((k) => k + 1);

  const stageIndex = JOURNEY_STAGES.indexOf(stage);

  return (
    <div className="space-y-4" data-testid="journey-view">
      {/* Identity + guardrail strip */}
      <div className="bg-white border border-line rounded-[18px] shadow-card px-5 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-ink truncate" dir="ltr">
            {patient.display_name ?? patient.mrn}
            <span className="font-medium text-ink-soft text-sm"> · MRN {patient.mrn ?? "—"} · Encounter journey</span>
          </p>
          <p className="text-[11px] text-ink-faint" dir="ltr">
            The system proposes — you approve. Nothing is created, coded, linked, or submitted without your confirmation.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-demo-line bg-demo-chip px-3 py-1 text-[11px] font-semibold text-demo-text">
          <span className="h-2 w-2 rounded-full bg-demo-pulse shadow-[0_0_0_3px_rgba(245,158,11,0.18)]" />
          Demo mode · simulated integrations
        </span>
      </div>

      <div className="flex gap-4 items-start">
        {/* Stage rail */}
        <nav aria-label="Journey stages" className="w-52 shrink-0 bg-white border border-line rounded-[18px] shadow-card p-3 space-y-1.5">
          {JOURNEY_STAGES.map((id, i) => {
            const isCurrent = id === stage;
            const isDone = completed.has(id);
            const reachable = i <= Math.max(stageIndex, [...completed].length ? JOURNEY_STAGES.indexOf([...completed][Math.min([...completed].length - 1, 4)] as JourneyStage) : 0) || isDone;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setStage(id)}
                aria-current={isCurrent ? "step" : undefined}
                data-testid={`journey-stage-${id}`}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-start transition-colors ${
                  isCurrent ? "bg-grad-accent text-white shadow-nav" : reachable ? "text-ink-deep hover:bg-veil" : "text-ink-faint hover:bg-veil"
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    isCurrent ? "bg-white/25 text-white" : isDone ? "bg-status-ok-bg text-status-ok" : "bg-veil text-ink-soft"
                  }`}
                >
                  {isDone ? "✓" : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-tight">{STAGE_LABELS[id]}</span>
                  <span className={`block text-[10px] leading-tight ${isCurrent ? "text-white/80" : "text-ink-faint"}`}>
                    {STAGE_HINTS[id]}
                  </span>
                </span>
              </button>
            );
          })}
          <p className="pt-1 px-2.5 text-[10px] text-ink-faint leading-snug">
            Progress survives a refresh — the journey resumes where you left it.
          </p>
        </nav>

        {/* Stage panel */}
        <div className="min-w-0 flex-1 bg-white border border-line rounded-[18px] shadow-card p-5">
          {stage === "document" && <StageDocument patientId={patient.id} onDone={(d) => markCompleted("document", d)} />}
          {stage === "diagnose" && (
            <StageDiagnose patient={patient} onDone={(d) => markCompleted("diagnose", d)} onChanged={bumpRefresh} />
          )}
          {stage === "order" && <StageOrder patientId={patient.id} onDone={(d) => markCompleted("order", d)} onChanged={bumpRefresh} />}
          {stage === "codelink" && (
            <StageCodeLink patientId={patient.id} onDone={(d) => markCompleted("codelink", d)} onChanged={bumpRefresh} />
          )}
          {stage === "submit" && (
            <StageSubmit
              patientId={patient.id}
              encounterId={encounterId}
              refreshKey={refreshKey}
              onDone={(d) => markCompleted("submit", d)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
