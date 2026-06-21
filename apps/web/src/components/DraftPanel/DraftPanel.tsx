/**
 * DraftPanel (E6) — grounded document drafting.
 *
 * The clinician generates a draft, edits it, and signs it. A prominent DRAFT
 * watermark shows until signed. Unsigned drafts cannot be exported (the export
 * button is disabled and the API enforces it). Assessment/Plan sections are
 * the clinician's own authored text — the system never writes them.
 */

import { useState, useCallback } from "react";
import { api, type DocumentDraft, type DraftDocumentType, ApiError } from "../../lib/api";

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

  const isSigned = draft?.status === "signed";

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

          <p className="text-xs text-slate-500 mt-2">{draft.disclaimer}</p>

          <div className="flex items-center gap-2 mt-3">
            {!isSigned ? (
              <>
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
                  Export is available after signing.
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
