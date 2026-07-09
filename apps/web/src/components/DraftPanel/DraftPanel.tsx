/**
 * DraftPanel (E6) — grounded document drafting.
 *
 * The clinician generates a draft, edits it, and signs it. A prominent DRAFT
 * watermark shows until signed. Unsigned drafts cannot be exported (the export
 * button is disabled and the API enforces it). Assessment/Plan sections are
 * the clinician's own authored text — the system never writes them.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { api, type DocumentDraft, type DraftDocumentType, type DraftSpecialty, type DraftSummary, ApiError } from "../../lib/api";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Blank clinician-authored placeholders the draft inserts (EN + AR).
const PLACEHOLDER_RE = /\((?:Dictate or type [^)]*?here\.|أمل[ِi]? أو اكتب [^)]*?هنا\.)\)/g;

// Place dictated/typed text into the draft. If the cursor sits inside a blank
// "(Dictate or type … here.)" placeholder, that placeholder is replaced; else
// the first remaining placeholder is filled (so dictation lands in the section
// the clinician is authoring, not at the end). With no placeholders left, the
// text is inserted at the cursor.
function placeDictation(prev: string, insert: string, caret: number): { text: string; caret: number } {
  const placeholders = [...prev.matchAll(PLACEHOLDER_RE)];
  const here = placeholders.find((m) => caret >= m.index! && caret <= m.index! + m[0].length);
  const target = here ?? placeholders[0];
  if (target) {
    const start = target.index!;
    const text = prev.slice(0, start) + insert + prev.slice(start + target[0].length);
    return { text, caret: start + insert.length };
  }
  const at = Math.min(Math.max(caret, 0), prev.length);
  const needsNl = at > 0 && prev[at - 1] !== "\n";
  const text = prev.slice(0, at) + (needsNl ? "\n" : "") + insert + prev.slice(at);
  return { text, caret: at + insert.length + (needsNl ? 1 : 0) };
}

const DOC_TYPES: { value: DraftDocumentType; label: string }[] = [
  { value: "discharge_summary", label: "Discharge summary" },
  { value: "referral_letter", label: "Referral letter" },
  { value: "transfer_note", label: "Transfer note" },
  { value: "visit_summary", label: "Visit summary" },
];

// Section-title terminology only (docs/prompts/specialty-templates.md) — the
// same facts are assembled regardless of specialty; only labels change.
const SPECIALTIES: { value: DraftSpecialty; label: string }[] = [
  { value: "general", label: "General" },
  { value: "cardiology", label: "Cardiology" },
  { value: "orthopedics", label: "Orthopedics" },
  { value: "pediatrics", label: "Pediatrics" },
  { value: "obstetrics_gynecology", label: "OB/GYN" },
  { value: "emergency_medicine", label: "Emergency Medicine" },
];

interface DraftPanelProps {
  readonly patientId: string;
}

export default function DraftPanel({ patientId }: DraftPanelProps): JSX.Element {
  // Draft + dictation language. Defaults to English; the doctor can switch to
  // Arabic. (Not tied to the patient's preferred language.)
  const [language, setLanguage] = useState<"en" | "ar">("en");
  const [docType, setDocType] = useState<DraftDocumentType>("discharge_summary");
  const [specialty, setSpecialty] = useState<DraftSpecialty>("general");
  const [draft, setDraft] = useState<DocumentDraft | null>(null);
  const [list, setList] = useState<DraftSummary[]>([]);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [rawTranscript, setRawTranscript] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Last known caret position in the editor, so dictation fills the section the
  // clinician is in (the Dictate button blurs the textarea, losing live focus).
  const caretRef = useRef<number>(0);

  const isSigned = draft?.status === "signed";

  const refreshList = useCallback(() => {
    api.patients.listDrafts(patientId).then((r) => setList(r.data)).catch(() => { /* silent */ });
  }, [patientId]);

  useEffect(() => { refreshList(); }, [refreshList]);

  const openDraft = useCallback((id: string) => {
    setError(null);
    api.drafts.get(id).then((d) => { setDraft(d); setEditText(d.edited_text ?? d.generated_text); setRawTranscript(null); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to open draft"));
  }, []);

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
            // Fill the section the clinician is in (replace its blank
            // placeholder) instead of appending at the end of the document.
            setEditText((prev) => {
              const { text: next, caret } = placeDictation(prev, text, caretRef.current);
              caretRef.current = caret;
              requestAnimationFrame(() => {
                const el = textareaRef.current;
                if (el) { el.focus(); el.setSelectionRange(caret, caret); }
              });
              return next;
            });
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

  // Typed-text path: faithfully polish what the clinician WROTE (same on-prem
  // reformat as dictation — no new content). Keeps the original for fidelity.
  const makeProfessional = useCallback(async () => {
    if (!editText.trim()) return;
    setError(null); setTranscribing(true);
    try {
      const original = editText;
      const { text, reformat } = await api.patients.reformat(patientId, original, language);
      setEditText(text);
      setRawTranscript(reformat === "llm" && original !== text ? original : null);
      setShowRaw(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Reformat failed");
    } finally { setTranscribing(false); }
  }, [patientId, language, editText]);

  const run = useCallback(async (fn: () => Promise<DocumentDraft>) => {
    setBusy(true); setError(null);
    try {
      const d = await fn();
      setDraft(d);
      setEditText(d.edited_text ?? d.generated_text);
      refreshList();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    } finally { setBusy(false); }
  }, [refreshList]);

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
            value={language}
            disabled={busy || recording || transcribing}
            onChange={(e) => setLanguage(e.target.value as "en" | "ar")}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
            aria-label="Language"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <select
            value={docType}
            disabled={busy}
            onChange={(e) => setDocType(e.target.value as DraftDocumentType)}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
          >
            {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <select
            value={specialty}
            disabled={busy}
            onChange={(e) => setSpecialty(e.target.value as DraftSpecialty)}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
            aria-label="Specialty"
            data-testid="specialty-select"
          >
            {SPECIALTIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            onClick={() => void run(() => api.patients.createDraft(patientId, docType, language, specialty))}
            disabled={busy}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm px-3 py-1 rounded"
          >
            {busy ? "Generating…" : "Generate draft"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      {/* This patient's drafts & signed documents */}
      {list.length > 0 && (
        <div className="border border-slate-800 rounded">
          <p className="text-xs text-slate-400 px-3 py-2 border-b border-slate-800">
            Documents for this patient ({list.length})
          </p>
          <ul className="divide-y divide-slate-800 max-h-40 overflow-y-auto">
            {list.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => openDraft(d.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-800 flex items-center gap-2 ${
                    draft?.id === d.id ? "bg-slate-800" : ""
                  }`}
                >
                  <span className="capitalize text-slate-200">{d.document_type.replace(/_/g, " ")}</span>
                  <span className={`text-xs ${d.status === "signed" ? "text-green-400" : "text-slate-400"}`}>
                    {d.status === "signed" ? "✓ signed" : "draft"}
                  </span>
                  <span className="text-xs text-slate-500 ml-auto" dir="ltr">
                    {new Date(d.created_at).toLocaleDateString("en-GB")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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
            ref={textareaRef}
            value={editText}
            readOnly={isSigned}
            onChange={(e) => { setEditText(e.target.value); caretRef.current = e.target.selectionStart; }}
            onSelect={(e) => { caretRef.current = (e.target as HTMLTextAreaElement).selectionStart; }}
            onClick={(e) => { caretRef.current = (e.target as HTMLTextAreaElement).selectionStart; }}
            onKeyUp={(e) => { caretRef.current = (e.target as HTMLTextAreaElement).selectionStart; }}
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
                  {transcribing ? "Working…" : recording ? "■ Stop dictation" : "🎙 Dictate"}
                </button>
                <button
                  onClick={() => void makeProfessional()}
                  disabled={busy || transcribing || recording || !editText.trim()}
                  className="text-sm px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
                  title="Polish what you typed into professional prose (your words only, on-prem)"
                >
                  ✨ Make professional
                </button>
                <button
                  onClick={() => void run(() => api.drafts.update(draft.id, editText))}
                  disabled={busy}
                  className="text-sm px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
                >
                  Save edits
                </button>
                <button
                  onClick={() => void run(async () => {
                    // Persist the current editor text before freezing it, so a
                    // request typed/dictated but not yet "Saved" is not lost.
                    await api.drafts.update(draft.id, editText);
                    return api.drafts.sign(draft.id);
                  })}
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
