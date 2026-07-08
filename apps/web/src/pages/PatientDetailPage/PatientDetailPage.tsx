/**
 * PatientDetailPage — routes between the Copilot workspace (default) and
 * the read-only Patient File. See PatientWorkspace.tsx and
 * PatientFilePage.tsx for the actual content; this component only owns
 * patient loading and the view switch.
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { api, type PatientDetail, ApiError } from "../../lib/api";
import { useCopilot } from "../../context/CopilotContext";
import PatientWorkspace from "./PatientWorkspace";
import PatientFilePage from "./PatientFilePage";

type ViewId = "workspace" | "chart";
type CardId = "qa" | "diagnosis" | "narrative" | "handoff" | "draft" | "orders" | "claims" | "search";
const CARD_IDS: readonly CardId[] = ["qa", "diagnosis", "narrative", "handoff", "draft", "orders", "claims", "search"];

export default function PatientDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setPatient } = useCopilot();
  const [searchParams] = useSearchParams();

  const [patient, setPatientData] = useState<PatientDetail | null>(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(true);
  const [patientError, setPatientError] = useState<{ code: string; message: string } | null>(null);

  const patientId = id ?? "";
  const view: ViewId = searchParams.get("view") === "chart" ? "chart" : "workspace";
  const openParam = searchParams.get("open");
  const initialOpen: readonly CardId[] = openParam && (CARD_IDS as readonly string[]).includes(openParam)
    ? [openParam as CardId]
    : [];

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const refreshPatient = (): void => {
    api.patients.get(patientId).then(setPatientData).catch(() => { /* silent */ });
  };

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
        <button
          onClick={() => void navigate("/patients")}
          className="text-sm text-slate-400 hover:text-white transition-colors"
        >
          ← Patients
        </button>

        {view === "workspace" ? (
          <PatientWorkspace patient={patient} initialOpen={initialOpen} onDiagnosisAdded={refreshPatient} />
        ) : (
          <PatientFilePage patient={patient} />
        )}
      </div>
    </div>
  );
}
