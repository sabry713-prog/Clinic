/**
 * PatientDetailPage — aggregated patient view.
 *
 * Shows: PatientHeader (identity, allergies, conditions), LabPanel, MedicationPanel.
 *
 * Constraints:
 * - No color-coding by clinical status
 * - No severity flags
 * - No interpretation language
 * - Plain factual text only
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { api, type PatientDetail, type ObservationItem, type MedicationItem, type MedicationReconciliation, type HandoffOutput, ApiError } from "../../lib/api";
import { useCopilot } from "../../context/CopilotContext";
import PatientHeader from "../../components/PatientHeader/PatientHeader";
import PatientBrief from "../../components/PatientBrief/PatientBrief";
import ServiceRequestPanel from "../../components/ServiceRequestPanel/ServiceRequestPanel";
import LabPanel from "../../components/LabPanel/LabPanel";
import MedicationPanel from "../../components/MedicationPanel/MedicationPanel";
import ReconciliationPanel from "../../components/ReconciliationPanel/ReconciliationPanel";
import RecordSearch from "../../components/RecordSearch/RecordSearch";
import DraftPanel from "../../components/DraftPanel/DraftPanel";
import AddDiagnosis from "../../components/AddDiagnosis/AddDiagnosis";
import NarrativePanel from "../../components/NarrativePanel/NarrativePanel";
import QAConversation from "../../components/QAConversation/QAConversation";
import HandoffView from "../../components/HandoffView/HandoffView";

// Per-tab icons (heroicons-style, 16px). Purely navigational — no clinical
// meaning conveyed by any glyph.
const TAB_ICON_PATHS: Record<string, string> = {
  overview: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 8.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z",
  search: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z",
  narrative: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
  qa: "M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z",
  handoff: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
  drafts: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10",
};

function TabIcon({ tab }: { readonly tab: string }): JSX.Element {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={TAB_ICON_PATHS[tab]} />
    </svg>
  );
}

export default function PatientDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setPatient } = useCopilot();

  const [patient, setPatientData] = useState<PatientDetail | null>(null);
  const [observations, setObservations] = useState<ObservationItem[]>([]);
  const [obsNextCursor, setObsNextCursor] = useState<string | null>(null);
  const [medications, setMedications] = useState<MedicationItem[]>([]);
  const [reconciliation, setReconciliation] = useState<MedicationReconciliation | null>(null);
  const [isLoadingReconciliation, setIsLoadingReconciliation] = useState(true);

  type TabId = "overview" | "search" | "narrative" | "qa" | "handoff" | "drafts";
  const TAB_IDS: readonly TabId[] = ["overview", "search", "narrative", "qa", "handoff", "drafts"];
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const fromUrl = searchParams.get("tab");
    return fromUrl !== null && (TAB_IDS as readonly string[]).includes(fromUrl) ? (fromUrl as TabId) : "overview";
  });

  // Keep the tab in sync when the sidebar / command bar deep-links via ?tab=.
  useEffect(() => {
    const fromUrl = searchParams.get("tab");
    if (fromUrl !== null && (TAB_IDS as readonly string[]).includes(fromUrl) && fromUrl !== activeTab) {
      setActiveTab(fromUrl as TabId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [qaLanguage, setQaLanguage] = useState<"en" | "ar">("en");
  const [handoff, setHandoff] = useState<HandoffOutput | null>(null);
  const [isLoadingHandoff, setIsLoadingHandoff] = useState(false);

  const [isLoadingPatient, setIsLoadingPatient] = useState(true);
  const [isLoadingObs, setIsLoadingObs] = useState(true);
  const [isLoadingMeds, setIsLoadingMeds] = useState(true);
  const [isLoadingMoreObs, setIsLoadingMoreObs] = useState(false);

  const [patientError, setPatientError] = useState<{ code: string; message: string } | null>(null);

  const patientId = id ?? "";

  useEffect(() => {
    if (!patientId) return;

    setIsLoadingPatient(true);
    api.patients
      .get(patientId)
      .then((data) => {
        setPatientData(data);
        setPatient(data.id, data.display_name ?? data.mrn ?? "Unknown patient");
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError) {
          setPatientError({ code: err.code, message: err.message });
        } else {
          setPatientError({ code: "UNKNOWN_ERROR", message: "Failed to load patient" });
        }
      })
      .finally(() => setIsLoadingPatient(false));

    api.patients
      .observations(patientId, { limit: 50 })
      .then((data) => {
        setObservations(data.data);
        setObsNextCursor(data.next_cursor);
      })
      .catch(() => { /* handled silently */ })
      .finally(() => setIsLoadingObs(false));

    api.patients
      .medications(patientId, { status: "active" })
      .then((data) => setMedications(data.data))
      .catch(() => { /* handled silently */ })
      .finally(() => setIsLoadingMeds(false));

    api.patients
      .medicationReconciliation(patientId)
      .then((data) => setReconciliation(data))
      .catch(() => { /* handled silently */ })
      .finally(() => setIsLoadingReconciliation(false));
  }, [patientId]);

  const handleLoadMoreObs = useCallback((): void => {
    if (!obsNextCursor || isLoadingMoreObs) return;
    setIsLoadingMoreObs(true);
    api.patients
      .observations(patientId, { limit: 50, cursor: obsNextCursor })
      .then((data) => {
        setObservations((prev) => [...prev, ...data.data]);
        setObsNextCursor(data.next_cursor);
      })
      .catch(() => { /* handled silently */ })
      .finally(() => setIsLoadingMoreObs(false));
  }, [patientId, obsNextCursor, isLoadingMoreObs]);

  if (isLoadingPatient) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading patient record...</p>
      </div>
    );
  }

  if (patientError) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-slate-300 text-sm">
            {patientError.code === "PATIENT_OUT_OF_SCOPE"
              ? "This patient is not within your care scope."
              : patientError.message}
          </p>
          <p className="text-slate-500 text-xs">Error code: {patientError.code}</p>
          <button
            onClick={() => void navigate(-1)}
            className="text-sm text-slate-400 hover:text-white"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (!patient) return <></>;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Back navigation */}
        <button
          onClick={() => void navigate("/patients")}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          ← Patients
        </button>

        {/* Patient identity, allergies, conditions */}
        <PatientHeader
          id={patient.id}
          mrn={patient.mrn}
          display_name={patient.display_name}
          date_of_birth={patient.date_of_birth}
          sex={patient.sex}
          preferred_language={patient.preferred_language}
          ward={patient.ward}
          allergies={patient.allergies}
          conditions={patient.conditions}
        />

        {/* Factual patient brief — documented conditions, clinics, labs, imaging */}
        <PatientBrief patientId={patient.id} />

        {/* Service requests — extract documented orders, doctor confirms, create */}
        <ServiceRequestPanel patientId={patient.id} />

        {/* Tab navigation */}
        <div className="border-b border-slate-700 flex gap-4">
          {(["overview", "search", "narrative", "qa", "handoff", "drafts"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setSearchParams({ tab }, { replace: true });
                if (tab === "handoff" && !handoff && !isLoadingHandoff) {
                  setIsLoadingHandoff(true);
                  api.handoff
                    .generatePatient(patientId, { scope: "current_shift", language: patient.preferred_language ?? "en" })
                    .then((data) => setHandoff(data))
                    .catch(() => { /* handled silently */ })
                    .finally(() => setIsLoadingHandoff(false));
                }
              }}
              className={`pb-2 text-sm capitalize transition-colors flex items-center gap-1.5 ${
                activeTab === tab
                  ? "text-white border-b-2 border-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <TabIcon tab={tab} />
              {tab === "qa" ? "Q&A" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
          <>
            {/* Observations — plain text, no color-coding */}
            <LabPanel
              observations={observations}
              isLoading={isLoadingObs}
              onLoadMore={handleLoadMoreObs}
              hasMore={obsNextCursor !== null}
            />

            {/* Medications — no interaction checking */}
            <MedicationPanel
              medications={medications}
              isLoading={isLoadingMeds}
            />

            {/* Medication reconciliation — factual source-feed comparison (E1) */}
            <ReconciliationPanel
              data={reconciliation}
              isLoading={isLoadingReconciliation}
            />
          </>
        )}

        {activeTab === "search" && <RecordSearch patientId={patient.id} />}

        {activeTab === "narrative" && (
          <NarrativePanel
            patientId={patient.id}
            preferredLanguage={patient.preferred_language ?? "en"}
          />
        )}

        {activeTab === "qa" && (
          <div className="bg-white rounded-xl h-[600px] flex flex-col overflow-hidden">
            <QAConversation
              patientId={patient.id}
              language={qaLanguage}
              onLanguageToggle={() =>
                setQaLanguage((l) => (l === "en" ? "ar" : "en"))
              }
            />
          </div>
        )}

        {activeTab === "handoff" && (
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

        {activeTab === "drafts" && (
          <div className="space-y-6">
            <AddDiagnosis
              patientId={patient.id}
              onAdded={() => {
                // Refresh the problem list so the new diagnosis shows in the header.
                api.patients.get(patient.id).then(setPatientData).catch(() => { /* silent */ });
              }}
            />
            <DraftPanel patientId={patient.id} />
          </div>
        )}
      </div>
    </div>
  );
}
