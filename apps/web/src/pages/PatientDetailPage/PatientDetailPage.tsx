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
import SullyShell from "../../components/layout/SullyShell";

type ViewId = "workspace" | "chart" | "encounter";
type CardId = "qa" | "diagnosis" | "narrative" | "handoff" | "draft" | "orders" | "claims" | "search" | "interpreter" | "ambient";
const CARD_IDS: readonly CardId[] = ["qa", "diagnosis", "narrative", "handoff", "draft", "orders", "claims", "search", "interpreter", "ambient"];

export default function PatientDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setPatient } = useCopilot();
  const [searchParams] = useSearchParams();

  const [patient, setPatientData] = useState<PatientDetail | null>(null);
  // Encounter the NPHIES pre-auth flow submits against (Sprint 9). Taken from
  // the patient's own encounter list -- never fabricated, because this value
  // becomes the Encounter identifier inside a real FHIR Claim bundle.
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(true);
  const [patientError, setPatientError] = useState<{ code: string; message: string } | null>(null);

  const patientId = id ?? "";
  const viewParam = searchParams.get("view");
  const view: ViewId =
    viewParam === "chart" ? "chart" : viewParam === "encounter" ? "encounter" : "workspace";
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

  // Resolve the encounter the pre-auth flow submits against. Prefers an
  // in-progress encounter, else the most recent one. Stays null when the
  // patient has none -- the pre-auth modal then explains that rather than
  // inventing an encounter identifier for a claim bundle.
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    api.patients
      .encounters(patientId)
      .then(({ data }) => {
        if (cancelled) return;
        const active = data.find((e) => e.status === "in-progress");
        setActiveEncounterId(active?.id ?? data[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setActiveEncounterId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const refreshPatient = (): void => {
    api.patients.get(patientId).then(setPatientData).catch(() => { /* silent */ });
  };

  if (isLoadingPatient) {
    return (
      <div className="min-h-screen bg-wash flex items-center justify-center">
        <p className="text-ink-soft text-sm">Loading patient record...</p>
      </div>
    );
  }

  if (patientError) {
    return (
      <div className="min-h-screen bg-wash flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-ink-deep text-sm">
            {patientError.code === "PATIENT_OUT_OF_SCOPE"
              ? "This patient is not within your care scope."
              : patientError.message}
          </p>
          <p className="text-ink-soft text-xs">Error code: {patientError.code}</p>
          <button
            onClick={() => void navigate(-1)}
            className="text-sm text-ink-soft hover:text-ink"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (!patient) return <></>;

  // The encounter shell is a full-height 3-pane workspace (mockup §B): it
  // fills the main area instead of scrolling inside the content column, so
  // its wrapper swaps the padded/max-width page chrome for a definite-height
  // flex column. The other views keep the document-style page chrome.
  const encounterView = view === "encounter";

  return (
    <div
      className={
        encounterView
          ? "flex h-screen flex-col overflow-hidden bg-wash text-ink"
          : "min-h-screen bg-wash text-ink p-6"
      }
    >
      <div
        className={
          encounterView
            ? "flex min-h-0 flex-1 flex-col"
            : "max-w-6xl mx-auto space-y-6"
        }
      >
        <button
          onClick={() => void navigate("/patients")}
          className={
            encounterView
              ? "px-5 py-2.5 text-sm text-ink-soft hover:text-ink transition-colors"
              : "text-sm text-ink-soft hover:text-ink transition-colors"
          }
        >
          ← Patients
        </button>

        {view === "workspace" && (
          <PatientWorkspace
            patient={patient}
            initialOpen={initialOpen}
            openRequest={openParam && (CARD_IDS as readonly string[]).includes(openParam) ? (openParam as CardId) : null}
            onDiagnosisAdded={refreshPatient}
          />
        )}
        {view === "chart" && <PatientFilePage patient={patient} />}
        {view === "encounter" && (
          <div className="min-h-0 flex-1 px-3 pb-3">
            <SullyShell
              patientName={patient.display_name ?? patient.mrn ?? undefined}
              patientId={patientId}
              encounterId={activeEncounterId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
