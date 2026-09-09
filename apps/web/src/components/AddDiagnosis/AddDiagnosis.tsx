/**
 * AddDiagnosis — clinician documents a diagnosis to the problem list.
 *
 * Non-SaMD: the DOCTOR authors the diagnosis and CONFIRMS the coded term. The AI
 * only *suggests* candidate SNOMED codes from the doctor's text — it never
 * decides the diagnosis or the final code. The doctor can pick another code,
 * edit, and is the final decision-maker.
 */

import { useState, useCallback } from "react";
import { api, type CodedTerm, ApiError } from "../../lib/api";

interface AddDiagnosisProps {
  readonly patientId: string;
  readonly onAdded?: () => void;
}

export default function AddDiagnosis({ patientId, onAdded }: AddDiagnosisProps): JSX.Element {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<CodedTerm[]>([]);
  const [selected, setSelected] = useState<CodedTerm | null>(null);
  const [status, setStatus] = useState("active");
  const [onset, setOnset] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const suggest = useCallback(() => {
    if (!text.trim()) return;
    setError(null); setMsg(null);
    api.patients.suggestCodes(text)
      .then((r) => {
        setSuggestions(r.suggestions);
        setSelected(r.suggestions[0] ?? null);
        if (r.suggestions.length === 0) setMsg("No code match — refine the wording or enter the code manually.");
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Suggest failed"));
  }, [text]);

  const add = useCallback(() => {
    if (!selected) return;
    setBusy(true); setError(null); setMsg(null);
    api.patients.addCondition(patientId, {
      code: selected.code,
      code_display: selected.code_display,
      status,
      ...(onset ? { onset_date: onset } : {}),
    })
      .then(() => {
        setMsg(`Added "${selected.code_display}" to the problem list.`);
        setText(""); setSuggestions([]); setSelected(null); setOnset("");
        onAdded?.();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Add failed"))
      .finally(() => setBusy(false));
  }, [patientId, selected, status, onset, onAdded]);

  return (
    <div className="bg-white border border-line rounded-lg p-6 space-y-3">
      <h2 className="text-base font-semibold text-ink">Add diagnosis to problem list</h2>
      <p className="text-xs text-ink-soft">
        You author the diagnosis and confirm the code. The AI only suggests a matching code — you decide.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          dir="auto"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") suggest(); }}
          placeholder="Diagnosis, e.g. headache / type 2 diabetes"
          className="flex-1 bg-veil border border-line rounded px-3 py-2 text-sm text-ink placeholder-ink-faint"
        />
        <button onClick={suggest} disabled={!text.trim()}
          className="px-3 py-2 text-sm rounded bg-white hover:bg-veil border border-line text-ink-deep disabled:opacity-40">
          Suggest code
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-ink-soft">Suggested codes (confirm or pick another):</p>
          {suggestions.map((s) => (
            <label key={s.code} className="flex items-center gap-2 text-sm text-ink-deep cursor-pointer">
              <input type="radio" name="code" checked={selected?.code === s.code}
                onChange={() => setSelected(s)} />
              <span>{s.code_display}</span>
              <span className="text-xs text-ink-soft font-mono">SNOMED {s.code}</span>
            </label>
          ))}
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <div>
            <label className="block text-xs text-ink-soft mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="bg-veil border border-line rounded px-2 py-1 text-sm text-ink">
              <option value="active">active</option>
              <option value="resolved">resolved</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-ink-soft mb-1">Onset (optional)</label>
            <input type="date" value={onset} onChange={(e) => setOnset(e.target.value)}
              className="bg-veil border border-line rounded px-2 py-1 text-sm text-ink" />
          </div>
          <button onClick={add} disabled={busy}
            className="px-3 py-2 text-sm rounded bg-grad-accent hover:brightness-110 shadow-pill text-white disabled:opacity-50 ml-auto">
            {busy ? "Adding…" : "Add to problem list"}
          </button>
        </div>
      )}

      {msg && <p className="text-sm text-status-ok">{msg}</p>}
      {error && <p className="text-sm text-ink-soft">{error}</p>}
    </div>
  );
}
