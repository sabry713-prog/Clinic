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
      onset_date: onset || undefined,
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
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-3">
      <h2 className="text-base font-semibold text-white">Add diagnosis to problem list</h2>
      <p className="text-xs text-slate-500">
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
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white placeholder-slate-500"
        />
        <button onClick={suggest} disabled={!text.trim()}
          className="px-3 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-40">
          Suggest code
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-slate-400">Suggested codes (confirm or pick another):</p>
          {suggestions.map((s) => (
            <label key={s.code} className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
              <input type="radio" name="code" checked={selected?.code === s.code}
                onChange={() => setSelected(s)} />
              <span>{s.code_display}</span>
              <span className="text-xs text-slate-500 font-mono">SNOMED {s.code}</span>
            </label>
          ))}
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap items-end gap-3 pt-1">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white">
              <option value="active">active</option>
              <option value="resolved">resolved</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Onset (optional)</label>
            <input type="date" value={onset} onChange={(e) => setOnset(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white" />
          </div>
          <button onClick={add} disabled={busy}
            className="px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 ml-auto">
            {busy ? "Adding…" : "Add to problem list"}
          </button>
        </div>
      )}

      {msg && <p className="text-sm text-green-400">{msg}</p>}
      {error && <p className="text-sm text-slate-400">{error}</p>}
    </div>
  );
}
