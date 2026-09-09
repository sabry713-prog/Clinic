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
import { placeDictation } from "../../lib/dictation";
import { useDictation, type DictationResult } from "../../hooks/useDictation";

const DOC_TYPES: { value: DraftDocumentType; label: string }[] = [
  { value: "discharge_summary", label: "Discharge summary" },
  { value: "referral_letter", label: "Referral letter" },
  { value: "transfer_note", label: "Transfer note" },
  { value: "visit_summary", label: "Visit summary" },
  { value: "encounter_note", label: "Encounter note" },
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
  const [reformatting, setReformatting] = useState(false);
  const [rawTranscript, setRawTranscript] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
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
  const onDictationResult = useCallback((result: DictationResult) => {
    // Fill the section the clinician is in (replace its blank placeholder)
    // instead of appending at the end of the document.
    setEditText((prev) => {
      const { text: next, caret } = placeDictation(prev, result.text, caretRef.current);
      caretRef.current = caret;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) { el.focus(); el.setSelectionRange(caret, caret); }
      });
      return next;
    });
    // If the on-prem LLM polished the dictation, keep the raw transcript so
    // the clinician can confirm fidelity before signing.
    setRawTranscript(result.reformat === "llm" && result.raw_text !== result.text ? result.raw_text : null);
    setShowRaw(false);
  }, []);
  const dictation = useDictation(patientId, language, onDictationResult);
  const recording = dictation.recording;
  const transcribing = dictation.transcribing || reformatting;

  const startDictation = useCallback(() => {
    setError(null);
    void dictation.start();
  }, [dictation]);

  // Typed-text path: faithfully polish what the clinician WROTE (same on-prem
  // reformat as dictation — no new content). Keeps the original for fidelity.
  const makeProfessional = useCallback(async () => {
    if (!editText.trim()) return;
    setError(null); setReformatting(true);
    try {
      const original = editText;
      const { text, reformat } = await api.patients.reformat(patientId, original, language);
      setEditText(text);
      setRawTranscript(reformat === "llm" && original !== text ? original : null);
      setShowRaw(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Reformat failed");
    } finally { setReformatting(false); }
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
    <div className="bg-white border border-line rounded-lg p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-ink">Document Draft</h2>
        <div className="flex gap-2 ml-auto">
          <select
            value={language}
            disabled={busy || recording || transcribing}
            onChange={(e) => setLanguage(e.target.value as "en" | "ar")}
            className="bg-veil text-ink-deep text-sm border border-line-strong rounded px-2 py-1"
            aria-label="Language"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <select
            value={docType}
            disabled={busy}
            onChange={(e) => setDocType(e.target.value as DraftDocumentType)}
            className="bg-veil text-ink-deep text-sm border border-line-strong rounded px-2 py-1"
          >
            {DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <select
            value={specialty}
            disabled={busy}
            onChange={(e) => setSpecialty(e.target.value as DraftSpecialty)}
            className="bg-veil text-ink-deep text-sm border border-line-strong rounded px-2 py-1"
            aria-label="Specialty"
            data-testid="specialty-select"
          >
            {SPECIALTIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            onClick={() => void run(() => api.patients.createDraft(patientId, docType, language, specialty))}
            disabled={busy}
            className="bg-white hover:bg-veil border border-line disabled:opacity-50 text-ink-deep text-sm px-3 py-1 rounded"
          >
            {busy ? "Generating…" : "Generate draft"}
          </button>
        </div>
      </div>

      {(error ?? dictation.error) && <p className="text-sm text-ink-soft">{error ?? dictation.error}</p>}

      {/* This patient's drafts & signed documents */}
      {list.length > 0 && (
        <div className="border border-line rounded">
          <p className="text-xs text-ink-soft px-3 py-2 border-b border-line">
            Documents for this patient ({list.length})
          </p>
          <ul className="divide-y divide-line max-h-40 overflow-y-auto">
            {list.map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => openDraft(d.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-veil flex items-center gap-2 ${
                    draft?.id === d.id ? "bg-veil" : ""
                  }`}
                >
                  <span className="capitalize text-ink-deep">{d.document_type.replace(/_/g, " ")}</span>
                  <span className={`text-xs ${d.status === "signed" ? "text-status-ok" : "text-ink-soft"}`}>
                    {d.status === "signed" ? "✓ signed" : "draft"}
                  </span>
                  <span className="text-xs text-ink-soft ml-auto" dir="ltr">
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
              <span className="text-6xl font-bold text-ink-deep/30 rotate-[-20deg] select-none">
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
            className="relative w-full h-80 bg-wash border border-line rounded p-3 text-sm text-ink-deep font-mono leading-relaxed focus:outline-none focus:border-line-strong"
          />

          {/* Fidelity check: compare the polished text to the raw dictation */}
          {rawTranscript && (
            <div className="mt-2">
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="text-xs text-agent-nph hover:underline"
              >
                {showRaw ? "Hide original dictation" : "Polished from your dictation — show original"}
              </button>
              {showRaw && (
                <pre className="mt-1 whitespace-pre-wrap bg-wash border border-line rounded p-2 text-xs text-ink-soft" dir="auto">
                  {rawTranscript}
                </pre>
              )}
            </div>
          )}

          <p className="text-xs text-ink-soft mt-2">{draft.disclaimer}</p>

          <div className="flex items-center gap-2 mt-3">
            {!isSigned ? (
              <>
                <button
                  onClick={() => (recording ? dictation.stop() : startDictation())}
                  disabled={busy || transcribing}
                  className={`text-sm px-3 py-1 rounded text-ink disabled:opacity-50 ${
                    recording ? "bg-red-600 hover:bg-red-500 animate-pulse" : "bg-white hover:bg-veil border border-line"
                  }`}
                  title="Dictate — speech is transcribed on-prem and inserted as your text to edit"
                >
                  {transcribing ? "Working…" : recording ? "■ Stop dictation" : "🎙 Dictate"}
                </button>
                <button
                  onClick={() => void makeProfessional()}
                  disabled={busy || transcribing || recording || !editText.trim()}
                  className="text-sm px-3 py-1 rounded bg-white hover:bg-veil border border-line text-ink-deep disabled:opacity-50"
                  title="Polish what you typed into professional prose (your words only, on-prem)"
                >
                  ✨ Make professional
                </button>
                <button
                  onClick={() => void run(() => api.drafts.update(draft.id, editText))}
                  disabled={busy}
                  className="text-sm px-3 py-1 rounded bg-white hover:bg-veil border border-line text-ink-deep disabled:opacity-50"
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
                  className="text-sm px-3 py-1 rounded bg-grad-accent hover:brightness-110 shadow-pill text-white disabled:opacity-50"
                >
                  Sign
                </button>
                <span className="text-xs text-ink-soft ml-auto">
                  Clinician dictation only (your own notes — not the patient). Runs on-prem;
                  audio is transcribed then discarded. In stub mode it inserts placeholder text.
                </span>
              </>
            ) : (
              <>
                <span className="text-xs text-status-ok" data-testid="signed-badge">
                  ✓ Signed {draft.signed_at ? new Date(draft.signed_at).toLocaleString("en-GB") : ""}
                </span>
                <button
                  onClick={() => void onExport()}
                  className="text-sm px-3 py-1 rounded bg-grad-accent hover:brightness-110 shadow-pill text-white ml-auto"
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
