/**
 * DraftPanel (E6) — grounded document drafting.
 *
 * The clinician generates a draft, edits it, and signs it. A prominent DRAFT
 * watermark shows until signed. Unsigned drafts cannot be exported (the export
 * button is disabled and the API enforces it). Assessment/Plan sections are
 * the clinician's own authored text — the system never writes them.
 */

import { useState, useCallback, useRef } from "react";
import { api, type DocumentDraft, type DraftDocumentType, ApiError } from "../../lib/api";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const DOC_TYPES: { value: DraftDocumentType; label: string }[] = [
  { value: "discharge_summary", label: "Discharge summary" },
  { value: "referral_letter", label: "Referral letter" },
  { value: "transfer_note", label: "Transfer note" },
  { value: "visit_summary", label: "Visit summary" },
];

interface DraftPanelProps {
  readonly patientId: string;
  readonly language: string;
}

export default function DraftPanel({ patientId, language }: DraftPanelProps): JSX.Element {
  const [docType, setDocType] = useState<DraftDocumentType>("discharge_summary");
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [rawTranscript, setRawTranscript] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const isSigned = draft?.status === "signed";

  // Dictation: record → on-prem transcribe (+ light reformat) → insert the
  // clinician's words into the editable draft. The model authors nothing here.
  const startDictation = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support audio recording. Use Chrome on desktop.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Pick a mime type the browser actually supports (Safari lacks webm).
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find(
        (m) => MediaRecorder.isTypeSupported(m),
      );
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setTranscribing(true);
        try {
          if (chunksRef.current.length === 0) {
            setError("No audio was captured. Check the microphone and try again.");
            return;
          }
          const blob = new Blob(chunksRef.current, { type: mime ?? "audio/webm" });
          const b64 = await blobToBase64(blob);
          const { text, raw_text, reformat } = await api.patients.transcribe(patientId, b64, language);
          if (text) {
            setEditText((prev) => (prev ? `${prev}\n${text}` : text));
            // If the on-prem LLM polished the dictation, keep the raw transcript
            // so the clinician can confirm fidelity before signing.
            setRawTranscript(reformat === "llm" && raw_text !== text ? raw_text : null);
            setShowRaw(false);
          } else setError("Transcription returned no text.");
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Transcription failed");
        } finally { setTranscribing(false); }
      };
      recorderRef.current = rec;
      rec.start(1000); // emit data every 1s so short clips still capture audio
      setRecording(true);
    } catch {
      setError("Microphone access denied or unavailable.");
    }
  }, [patientId, language]);

  const stopDictation = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  const run = useCallback(async (fn: () => Promise<DocumentDraft>) => {
    setBusy(true); setError(null);
    try {
      const d = await fn();
      setDraft(d);
      setEditText(d.edited_text ?? d.generated_text);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally { setBusy(false); }
  }, []);

  const onExport = useCallback(async () => {
    if (!draft) return;
    try {
      const { text } = await api.drafts.export(draft.id);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${draft.document_type}-${draft.id.slice(0, 8)}.txt`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed");
    }
  }, [draft]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-white">Document Draft</h2>
        <div className="flex gap-2 ml-auto">
          <select
            value={docType}
            disabled={busy}
            onChange={(e) => setDocType(e.target.value as DraftDocumentType)}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
          >
            {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <button
            onClick={() => void run(() => api.patients.createDraft(patientId, docType, language))}
            disabled={busy}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm px-3 py-1 rounded"
          >
            {busy ? "Generating…" : "Generate draft"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      {draft && (
        <div className="relative">
          {/* DRAFT watermark until signed */}
          {!isSigned && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
              <span className="text-6xl font-bold text-slate-700/30 rotate-[-20deg] select-none">
                DRAFT
              </span>
            </div>
          )}

          <textarea
            value={editText}
            readOnly={isSigned}
            onChange={(e) => setEditText(e.target.value)}
            dir="auto"
            className="relative w-full h-80 bg-slate-950 border border-slate-700 rounded p-3 text-sm text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-slate-500"
          />

          {/* Fidelity check: compare the polished text to the raw dictation */}
          {rawTranscript && (
            <div className="mt-2">
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="text-xs text-blue-400 hover:underline"
              >
                {showRaw ? "Hide original dictation" : "Polished from your dictation — show original"}
              </button>
              {showRaw && (
                <pre className="mt-1 whitespace-pre-wrap bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-400" dir="auto">
                  {rawTranscript}
                </pre>
              )}
            </div>
          )}

          <p className="text-xs text-slate-500 mt-2">{draft.disclaimer}</p>

          <div className="flex items-center gap-2 mt-3">
            {!isSigned ? (
              <>
                <button
                  onClick={() => (recording ? stopDictation() : void startDictation())}
                  disabled={busy || transcribing}
                  className={`text-sm px-3 py-1 rounded text-white disabled:opacity-50 ${
                    recording ? "bg-red-600 hover:bg-red-500 animate-pulse" : "bg-slate-700 hover:bg-slate-600"
                  }`}
                  title="Dictate — speech is transcribed on-prem and inserted as your text to edit"
                >
                  {transcribing ? "Transcribing…" : recording ? "■ Stop dictation" : "🎙 Dictate"}
                </button>
                <button
                  onClick={() => void run(() => api.drafts.update(draft.id, editText))}
                  disabled={busy}
                  className="text-sm px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
                >
                  Save edits
                </button>
                <button
                  onClick={() => void run(() => api.drafts.sign(draft.id))}
                  disabled={busy}
                  className="text-sm px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  Sign
                </button>
                <span className="text-xs text-slate-500 ml-auto">
                  Clinician dictation only (your own notes — not the patient). Runs on-prem;
                  audio is transcribed then discarded. In stub mode it inserts placeholder text.
                </span>
              </>
            ) : (
              <>
                <span className="text-xs text-green-400" data-testid="signed-badge">
                  ✓ Signed {draft.signed_at ? new Date(draft.signed_at).toLocaleString("en-GB") : ""}
                </span>
                <button
                  onClick={() => void onExport()}
                  className="text-sm px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white ml-auto"
                >
                  Export
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
