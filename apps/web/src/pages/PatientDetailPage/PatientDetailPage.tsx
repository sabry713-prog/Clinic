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
import { api, type PatientDetail, type ObservationItem, type MedicationItem, ApiError } from "../../lib/api";
import PatientHeader from "../../components/PatientHeader/PatientHeader";
import LabPanel from "../../components/LabPanel/LabPanel";
import MedicationPanel from "../../components/MedicationPanel/MedicationPanel";
import NarrativePanel from "../../components/NarrativePanel/NarrativePanel";
import QAConversation from "../../components/QAConversation/QAConversation";

export default function PatientDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [observations, setObservations] = useState<ObservationItem[]>([]);
  const [obsNextCursor, setObsNextCursor] = useState<string | null>(null);
  const [medications, setMedications] = useState<MedicationItem[]>([]);

  const [activeTab, setActiveTab] = useState<"overview" | "narrative" | "qa">("overview");
  const [qaLanguage, setQaLanguage] = useState<"en" | "ar">("en");

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
        setPatient(data);
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

        {/* Tab navigation */}
        <div className="border-b border-slate-700 flex gap-4">
          {(["overview", "narrative", "qa"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
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
          </>
        )}

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
      </div>
    </div>
  );
}
