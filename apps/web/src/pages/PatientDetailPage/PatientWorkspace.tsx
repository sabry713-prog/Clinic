/**
 * PatientWorkspace — the Copilot workspace, default view for a patient.
 *
 * One composer, one feed. Instead of six separate tabs each with their
 * own controls, every action (ask a question, add a diagnosis, generate a
 * narrative, create a handoff, draft a document, extract orders, check
 * claim readiness, search records) is a chip in the composer; running an
 * action opens (or focuses) its card in the feed below. Cards stay open
 * across actions so the doctor's session accumulates in one place instead
 * of losing context switching tabs.
 *
 * Constraints (unchanged from the tabbed version — CLAUDE.md §2):
 * - No auto-execute. Every card that writes data still requires an
 *   explicit doctor confirmation inside that card — this component only
 *   controls which cards are visible, never what they do.
 * - No new suggestions, no clinical judgement introduced by this layer.
 *   It is pure navigation/composition chrome around existing, already-
 *   reviewed features.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type PatientDetail, type HandoffOutput } from "../../lib/api";
import QAConversation from "../../components/QAConversation/QAConversation";
import NarrativePanel from "../../components/NarrativePanel/NarrativePanel";
import HandoffView from "../../components/HandoffView/HandoffView";
import DraftPanel from "../../components/DraftPanel/DraftPanel";
import AddDiagnosis from "../../components/AddDiagnosis/AddDiagnosis";
import RecordSearch from "../../components/RecordSearch/RecordSearch";
import ServiceRequestPanel from "../../components/ServiceRequestPanel/ServiceRequestPanel";
import ClaimReadinessPanel from "../../components/ClaimReadinessPanel/ClaimReadinessPanel";

type CardId = "qa" | "diagnosis" | "narrative" | "handoff" | "draft" | "orders" | "claims" | "search";

interface ChipDef {
  readonly id: CardId;
  readonly label: string;
  readonly icon: string;
}

const CHIPS: readonly ChipDef[] = [
  { id: "qa", label: "Ask", icon: "M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" },
  { id: "diagnosis", label: "Diagnosis", icon: "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" },
  { id: "narrative", label: "Narrative", icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" },
  { id: "handoff", label: "Handoff", icon: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" },
  { id: "draft", label: "Draft", icon: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" },
  { id: "orders", label: "Orders", icon: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" },
  { id: "claims", label: "Claims", icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" },
  { id: "search", label: "Search", icon: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" },
];

const CARD_LABEL: Record<CardId, string> = {
  qa: "Ask a factual question",
  diagnosis: "Add diagnosis to problem list",
  narrative: "Factual narrative",
  handoff: "Shift-change handoff",
  draft: "Draft a document",
  orders: "Service requests",
  claims: "NPHIES claim readiness",
  search: "Search this patient's records",
};

function Icon({ path, className = "w-4 h-4" }: { readonly path: string; readonly className?: string }): JSX.Element {
  return (
    <svg className={`${className} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

interface PatientWorkspaceProps {
  readonly patient: PatientDetail;
  readonly initialOpen: readonly CardId[];
  readonly onDiagnosisAdded: () => void;
}

export default function PatientWorkspace({ patient, initialOpen, onDiagnosisAdded }: PatientWorkspaceProps): JSX.Element {
  const patientId = patient.id;

  const [openCards, setOpenCards] = useState<CardId[]>(() =>
    initialOpen.length > 0 ? Array.from(new Set(initialOpen)) : [],
  );
  const [composerText, setComposerText] = useState("");
  const [qaLanguage, setQaLanguage] = useState<"en" | "ar">("en");
  const [handoff, setHandoff] = useState<HandoffOutput | null>(null);
  const [isLoadingHandoff, setIsLoadingHandoff] = useState(false);
  const [pendingQaQuestion, setPendingQaQuestion] = useState<string | null>(null);

  // Reset the accumulated session when the patient changes.
  useEffect(() => {
    setOpenCards(initialOpen.length > 0 ? Array.from(new Set(initialOpen)) : []);
    setHandoff(null);
    setPendingQaQuestion(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const openCard = useCallback((id: CardId) => {
    setOpenCards((prev) => (prev.includes(id) ? prev : [...prev, id]));
    requestAnimationFrame(() => {
      document.getElementById(`workspace-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    if (id === "handoff" && !handoff && !isLoadingHandoff) {
      setIsLoadingHandoff(true);
      api.handoff
        .generatePatient(patientId, { scope: "current_shift", language: patient.preferred_language ?? "en" })
        .then((data) => setHandoff(data))
        .catch(() => { /* handled silently */ })
        .finally(() => setIsLoadingHandoff(false));
    }
  }, [handoff, isLoadingHandoff, patientId, patient.preferred_language]);

  const closeCard = useCallback((id: CardId) => {
    setOpenCards((prev) => prev.filter((c) => c !== id));
  }, []);

  const submitComposer = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const text = composerText.trim();
    if (!text) return;
    setPendingQaQuestion(text);
    setComposerText("");
    openCard("qa");
  }, [composerText, openCard]);

  return (
    <div className="space-y-6">
      {/* Compact identity line — full chart lives in Patient File */}
      <div className="flex items-baseline gap-3 text-sm">
        <span className="font-medium text-white" dir="ltr">{patient.display_name ?? patient.mrn}</span>
        <span className="text-slate-500" dir="ltr">{patient.mrn}</span>
        {patient.allergies.length > 0 && (
          <span className="text-slate-400 truncate" dir="ltr">
            Allergies: {patient.allergies.map((a) => a.code_display).join(", ")}
          </span>
        )}
      </div>

      {/* Composer */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-3 space-y-3">
        <form onSubmit={submitComposer} className="flex items-center gap-2">
          <input
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            placeholder="Ask a factual question about this patient's record…"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none px-2 py-1.5"
          />
          <button
            type="submit"
            disabled={!composerText.trim()}
            className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
          >
            Ask
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => openCard(chip.id)}
              className={`
                inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-colors
                ${openCards.includes(chip.id)
                  ? "bg-blue-600/20 border-blue-600/50 text-blue-300"
                  : "border-slate-700 text-slate-300 hover:text-white hover:border-slate-500"}
              `}
            >
              <Icon path={chip.icon} className="w-3.5 h-3.5" />
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed */}
      {openCards.length === 0 ? (
        <p className="text-sm text-slate-500 px-1">
          Use the composer above to ask a question, add a diagnosis, generate a document, or review orders and claims.
        </p>
      ) : (
        <div className="space-y-4">
          {openCards.map((id) => (
            <div key={id} id={`workspace-card-${id}`} className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800">
                <span className="text-sm font-medium text-white">{CARD_LABEL[id]}</span>
                <button
                  type="button"
                  onClick={() => closeCard(id)}
                  aria-label={`Close ${CARD_LABEL[id]}`}
                  className="text-slate-500 hover:text-white"
                >
                  <Icon path="M6 18L18 6M6 6l12 12" className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4">
                {id === "qa" && (
                  <div className="bg-white rounded-xl h-[560px] flex flex-col overflow-hidden -m-4">
                    <QAConversation
                      patientId={patientId}
                      language={qaLanguage}
                      onLanguageToggle={() => setQaLanguage((l) => (l === "en" ? "ar" : "en"))}
                      {...(pendingQaQuestion ? { initialQuestion: pendingQaQuestion } : {})}
                    />
                  </div>
                )}
                {id === "diagnosis" && (
                  <AddDiagnosis
                    patientId={patientId}
                    onAdded={onDiagnosisAdded}
                  />
                )}
                {id === "narrative" && (
                  <NarrativePanel patientId={patientId} preferredLanguage={patient.preferred_language ?? "en"} />
                )}
                {id === "handoff" && (
                  handoff
                    ? <HandoffView handoff={handoff} isLoading={isLoadingHandoff} />
                    : <HandoffView handoff={{
                        id: "",
                        patient_id: patientId,
                        ward_id: null,
                        generated_at: new Date().toISOString(),
                        language: "en",
                        scope: "current_shift",
                        text: "",
                        sections: {
                          identity_and_admission: [],
                          documented_today: [],
                          current_medications: [],
                          recent_vitals: [],
                          recent_labs: [],
                          pending_orders: [],
                        },
                        provenance: [],
                        disclaimer: "Reproduces documented information from the patient record. For clinician reference only. Not a clinical assessment.",
                      }} isLoading={isLoadingHandoff} />
                )}
                {id === "draft" && <DraftPanel patientId={patientId} />}
                {id === "orders" && <ServiceRequestPanel patientId={patientId} />}
                {id === "claims" && <ClaimReadinessPanel patientId={patientId} />}
                {id === "search" && <RecordSearch patientId={patientId} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
