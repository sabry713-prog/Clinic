/**
 * AmbientPanel — ambient structured-transcription capture
 * (docs/prompts/ambient-segmentation-prompt.md).
 *
 * Flow: explicit consent acknowledgment -> explicit Start/Stop recording ->
 * transcribe (on-prem, same pipeline as dictation) -> "Structure into note"
 * classifies the transcript into section previews (verbatim spans only,
 * server-verified) -> "Create draft" hands those sections to the normal
 * encounter_note draft, which opens in the existing DraftPanel edit/sign/
 * export flow. Nothing is written to the record until "Create draft" is
 * clicked, and nothing is final until the resulting draft is signed there.
 *
 * Constraints (CLAUDE.md §2, docs/architecture/dictation.md):
 * - No always-on/background capture — explicit Start, explicit Stop only.
 * - The clinician is always shown the raw transcript before structuring, and
 *   can review/edit every section before a draft is ever created.
 * - Segmentation only relocates the speaker's own words — see
 *   isClinicianAuthoredOnly re-validation in draft.service.ts, which this UI
 *   cannot bypass (an edit that adds new content is rejected server-side).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { api, type DraftSpecialty, ApiError } from "../../lib/api";

const SECTION_SPECS = [
  { key: "chief_complaint", title: "Chief Complaint" },
  { key: "history", title: "History" },
  { key: "assessment", title: "Assessment" },
  { key: "plan", title: "Plan" },
] as const;

const SPECIALTIES: { value: DraftSpecialty; label: string }[] = [
  { value: "general", label: "General" },
  { value: "cardiology", label: "Cardiology" },
  { value: "orthopedics", label: "Orthopedics" },
  { value: "pediatrics", label: "Pediatrics" },
  { value: "obstetrics_gynecology", label: "OB/GYN" },
  { value: "emergency_medicine", label: "Emergency Medicine" },
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

interface AmbientPanelProps {
  readonly patientId: string;
  /** Called after a draft is successfully created, so the workspace can open
   * the Draft card for the clinician to continue editing/signing there. */
  readonly onDraftCreated: () => void;
}

export default function AmbientPanel({ patientId, onDraftCreated }: AmbientPanelProps): JSX.Element {
  const [language, setLanguage] = useState<"en" | "ar">("en");
  const [specialty, setSpecialty] = useState<DraftSpecialty>("general");
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const [sections, setSections] = useState<Record<string, string> | null>(null);
  const [unclassified, setUnclassified] = useState<string>("");
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const reset = useCallback(() => {
    setTranscript(null);
    setSections(null);
    setUnclassified("");
    setSeconds(0);
    setError(null);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support audio recording. Use Chrome on desktop.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setTranscribing(true);
        try {
          if (chunksRef.current.length === 0) {
            setError("No audio was captured. Check the microphone and try again.");
            return;
          }
          const blob = new Blob(chunksRef.current, { type: mime ?? "audio/webm" });
          const b64 = await blobToBase64(blob);
          const { text } = await api.patients.transcribe(patientId, b64, language);
          setTranscript(text || null);
          if (!text) setError("Transcription returned no text.");
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Transcription failed");
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = rec;
      rec.start(1000);
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Microphone access denied or unavailable.");
    }
  }, [patientId, language]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  const structureNote = useCallback(() => {
    if (!transcript) return;
    setSegmenting(true);
    setError(null);
    api.ambient
      .segment(patientId, transcript, SECTION_SPECS, language)
      .then((result) => {
        const map: Record<string, string> = {};
        for (const s of result.sections) map[s.key] = s.text;
        setSections(map);
        setUnclassified(result.unclassified_text);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Structuring failed"))
      .finally(() => setSegmenting(false));
  }, [patientId, transcript, language]);

  const createDraft = useCallback(() => {
    if (!transcript || !sections) return;
    setCreatingDraft(true);
    setError(null);
    const prefillSections = Object.entries(sections)
      .filter(([, text]) => text.trim())
      .map(([key, text]) => ({ key, text }));
    api.patients
      .createDraft(patientId, "encounter_note", language, specialty, { transcript, sections: prefillSections })
      .then(() => {
        onDraftCreated();
        reset();
        setConsentAcknowledged(false);
      })
      .catch((e: unknown) => {
        setError(
          e instanceof ApiError
            ? `${e.message} — a section may contain text that wasn't in the recording; edit it back to the transcript's own words, or create the draft and add anything else there.`
            : "Failed to create draft",
        );
      })
      .finally(() => setCreatingDraft(false));
  }, [patientId, transcript, sections, language, specialty, onDraftCreated, reset]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-4" data-testid="ambient-panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-slate-200 text-base font-medium">Encounter Recording</h2>
        <div className="flex gap-2 ml-auto">
          <select
            value={language}
            disabled={recording || transcribing}
            onChange={(e) => setLanguage(e.target.value as "en" | "ar")}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
            aria-label="Language"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <select
            value={specialty}
            disabled={recording || transcribing}
            onChange={(e) => setSpecialty(e.target.value as DraftSpecialty)}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
            aria-label="Specialty"
            data-testid="ambient-specialty-select"
          >
            {SPECIALTIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {!transcript && !recording && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={consentAcknowledged}
              onChange={(e) => setConsentAcknowledged(e.target.checked)}
              className="mt-0.5"
              data-testid="consent-checkbox"
            />
            Recording this conversation. Patient has been informed.
          </label>
          <button
            onClick={() => void startRecording()}
            disabled={!consentAcknowledged || transcribing}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm px-3 py-1.5 rounded"
            data-testid="start-recording-btn"
          >
            ● Start recording
          </button>
        </div>
      )}

      {recording && (
        <button
          onClick={stopRecording}
          className="bg-red-600 hover:bg-red-500 animate-pulse text-white text-sm px-3 py-1.5 rounded"
          data-testid="stop-recording-btn"
        >
          ■ Stop recording — {formatDuration(seconds)}
        </button>
      )}

      {transcribing && <p className="text-sm text-slate-400">Transcribing…</p>}

      {error && (
        <div className="text-slate-400 text-sm bg-slate-800 rounded p-3" data-testid="ambient-error">
          {error}
        </div>
      )}

      {transcript && !sections && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Raw transcript — review before structuring:</p>
          <div className="bg-slate-950 border border-slate-700 rounded p-3 text-sm text-slate-200 whitespace-pre-line max-h-48 overflow-y-auto" dir="auto" data-testid="raw-transcript">
            {transcript}
          </div>
          <div className="flex gap-2">
            <button
              onClick={structureNote}
              disabled={segmenting}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
              data-testid="structure-note-btn"
            >
              {segmenting ? "Structuring…" : "Structure into note"}
            </button>
            <button onClick={reset} className="text-sm text-slate-400 hover:text-white px-3 py-1.5">
              Discard
            </button>
          </div>
        </div>
      )}

      {sections && (
        <div className="space-y-3">
          {SECTION_SPECS.map((spec) => (
            <div key={spec.key}>
              <label className="text-xs text-slate-400">{spec.title}</label>
              <textarea
                value={sections[spec.key] ?? ""}
                onChange={(e) => setSections((prev) => ({ ...(prev ?? {}), [spec.key]: e.target.value }))}
                rows={2}
                dir="auto"
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-200 mt-1"
                data-testid={`section-${spec.key}`}
              />
            </div>
          ))}
          {unclassified && (
            <div>
              <label className="text-xs text-slate-400">Unsorted (not confidently classified)</label>
              <div className="w-full bg-slate-950 border border-amber-800/50 rounded p-2 text-sm text-slate-300 mt-1 whitespace-pre-line" dir="auto" data-testid="unclassified-text">
                {unclassified}
              </div>
            </div>
          )}
          <p className="text-xs text-slate-500">
            You can trim or move this text between sections, but can't add new words here — anything
            else can be added once the draft is created.
          </p>
          <div className="flex gap-2">
            <button
              onClick={createDraft}
              disabled={creatingDraft}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
              data-testid="create-draft-btn"
            >
              {creatingDraft ? "Creating…" : "Create draft"}
            </button>
            <button onClick={reset} className="text-sm text-slate-400 hover:text-white px-3 py-1.5">
              Discard
            </button>
          </div>
        </div>
      )}

      <p className="text-slate-500 text-xs border-t border-slate-700 pt-2">
        Explicit start/stop only — no always-on or background capture. Audio is transcribed on-prem and
        discarded. Structuring only relocates the recorded words; it never adds or rewrites content.
      </p>
    </div>
  );
}
