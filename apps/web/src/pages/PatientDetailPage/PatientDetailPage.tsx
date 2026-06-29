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
import { useParams, useNavigate } from "react-router-dom";
import { api, type PatientDetail, type ObservationItem, type MedicationItem, type MedicationReconciliation, type HandoffOutput, ApiError } from "../../lib/api";
import { useCopilot } from "../../context/CopilotContext";
import PatientHeader from "../../components/PatientHeader/PatientHeader";
import PatientBrief from "../../components/PatientBrief/PatientBrief";
import LabPanel from "../../components/LabPanel/LabPanel";
import MedicationPanel from "../../components/MedicationPanel/MedicationPanel";
import ReconciliationPanel from "../../components/ReconciliationPanel/ReconciliationPanel";
import RecordSearch from "../../components/RecordSearch/RecordSearch";
import DraftPanel from "../../components/DraftPanel/DraftPanel";
import AddDiagnosis from "../../components/AddDiagnosis/AddDiagnosis";
import NarrativePanel from "../../components/NarrativePanel/NarrativePanel";
import QAConversation from "../../components/QAConversation/QAConversation";
import HandoffView from "../../components/HandoffView/HandoffView";

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

  const [activeTab, setActiveTab] = useState<"overview" | "search" | "narrative" | "qa" | "handoff" | "drafts">("overview");
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

        {/* Tab navigation */}
        <div className="border-b border-slate-700 flex gap-4">
          {(["overview", "search", "narrative", "qa", "handoff", "drafts"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab === "handoff" && !handoff && !isLoadingHandoff) {
                  setIsLoadingHandoff(true);
                  api.handoff
                    .generatePatient(patientId, { scope: "current_shift", language: patient.preferred_language ?? "en" })
                    .then((data) => setHandoff(data))
                    .catch(() => { /* handled silently */ })
                    .finally(() => setIsLoadingHandoff(false));
                }
              }}
              className={`pb-2 text-sm capitalize transition-colors ${
                activeTab === tab
                  ? "text-white border-b-2 border-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
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
