/**
 * Left column — live ambient scribe (Sprint 4).
 *
 * Replaces the Sprint 3 mock pane with real capture: microphone or fixture
 * replay, a waveform driven by actual audio levels, a streaming transcript,
 * and a SOAP note that fills in and highlights as the conversation happens.
 *
 * The clinician stays the author — every SOAP field is editable, and a manual
 * edit is never overwritten by a later model pass.
 */

import { useEffect, useRef, useState } from "react";
import {
  Mic, Square, ListChecks, FileText, Loader2, ShieldAlert, AlertCircle, FlaskConical,
} from "lucide-react";
import { useLiveScribe } from "./useLiveScribe";
import type { SoapNote } from "./scribeClient";

const SOAP_SECTIONS: readonly { field: keyof SoapNote; label: string }[] = [
  { field: "subjective", label: "Subjective" },
  { field: "objective", label: "Objective" },
  { field: "assessment", label: "Assessment" },
  { field: "plan", label: "Plan" },
];

const FIXTURES = [
  { id: "chest-pain-01", label: "Chest pain" },
  { id: "fever-cough-02", label: "Fever & cough" },
  { id: "abdominal-pain-03", label: "Abdominal pain" },
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Waveform({ levels, active }: { readonly levels: readonly number[]; readonly active: boolean }): JSX.Element {
  return (
    <div className="flex h-6 items-end gap-[2px]" aria-hidden="true">
      {levels.map((v, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full transition-[height] duration-75 ${active ? "bg-blue-400" : "bg-slate-700"}`}
          style={{ height: `${Math.max(3, v * 24)}px` }}
        />
      ))}
    </div>
  );
}

export default function LiveScribePane({
  patientNames = [],
}: {
  readonly patientNames?: readonly string[];
}): JSX.Element {
  const scribe = useLiveScribe(patientNames);
  const feedRef = useRef<HTMLDivElement>(null);
  const [fixtureId, setFixtureId] = useState(FIXTURES[0]!.id);

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [scribe.transcript.length]);

  const doneCount = scribe.checklist.filter((c) => c.done).length;

  return (
    <section className="flex h-full flex-col overflow-hidden bg-slate-900" aria-label="Ambient scribe">
      {/* Recording bar */}
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <button
          type="button"
          onClick={() => (scribe.recording ? scribe.stop() : void scribe.start("microphone"))}
          aria-pressed={scribe.recording}
          disabled={!scribe.micSupported && !scribe.recording}
          title={scribe.micSupported ? undefined : "This browser has no Web Speech API — use a sample below"}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            scribe.recording ? "bg-rose-600 text-white hover:bg-rose-500" : "bg-blue-600 text-white hover:bg-blue-500"
          }`}
        >
          {scribe.recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {scribe.recording ? "Stop" : "Record"}
        </button>

        <Waveform levels={scribe.levels} active={scribe.recording} />

        <span className="ms-auto flex items-center gap-2 text-xs text-slate-400">
          {scribe.structuring && <Loader2 className="h-3 w-3 animate-spin text-blue-400" />}
          {scribe.recording && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />}
          <span className="font-mono">{formatElapsed(scribe.elapsedSeconds)}</span>
        </span>
      </header>

      {/* Fixture replay — works with no microphone */}
      {!scribe.recording && (
        <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/50 px-4 py-2">
          <FlaskConical className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
          <label htmlFor="fixture" className="sr-only">Sample consultation</label>
          <select
            id="fixture"
            value={fixtureId}
            onChange={(e) => setFixtureId(e.target.value)}
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
          >
            {FIXTURES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => void scribe.start("fixture", fixtureId)}
            className="shrink-0 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Replay sample
          </button>
        </div>
      )}

      {/* Errors — policy blocks look different from faults */}
      {scribe.error && (
        <div
          role="status"
          className={`flex items-start gap-2 border-b px-4 py-2 text-[11px] ${
            scribe.blockedByPolicy
              ? "border-amber-900/60 bg-amber-950/30 text-amber-200"
              : "border-slate-800 bg-slate-950/50 text-slate-400"
          }`}
        >
          {scribe.blockedByPolicy
            ? <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            : <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="leading-relaxed">{scribe.error}</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Transcript */}
        <div className="border-b border-slate-800 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <FileText className="h-3.5 w-3.5" /> Live transcript
          </h2>
          <div ref={feedRef} className="max-h-44 space-y-2 overflow-y-auto pe-1">
            {scribe.transcript.length === 0 ? (
              <p className="text-xs text-slate-500">
                {scribe.recording ? "Listening…" : "Press Record, or replay a sample consultation."}
              </p>
            ) : (
              scribe.transcript.map((line, i) => (
                <p key={i} className={`text-xs leading-relaxed ${line.isFinal ? "" : "opacity-60 italic"}`}>
                  <span className={line.speaker === "clinician" ? "text-blue-300" : "text-slate-400"}>
                    {line.speaker === "clinician" ? "Clinician" : "Patient"}
                  </span>
                  <span className="text-slate-200"> {line.text}</span>
                </p>
              ))
            )}
          </div>
        </div>

        {/* SOAP — highlights the sections that just changed */}
        <div className="border-b border-slate-800 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Draft SOAP note
          </h2>
          <div className="space-y-3">
            {SOAP_SECTIONS.map(({ field, label }) => {
              const isHot = scribe.highlighted.includes(field);
              return (
                <label key={field} className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                    {label}
                    {isHot && (
                      <span className="rounded-full bg-blue-500/20 px-1.5 py-px text-[9px] font-semibold uppercase text-blue-300">
                        updated
                      </span>
                    )}
                  </span>
                  <textarea
                    aria-label={label}
                    value={scribe.soap[field]}
                    onChange={(e) => scribe.updateSoap(field, e.target.value)}
                    rows={2}
                    placeholder={`${label}…`}
                    className={`w-full resize-y rounded-md border bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none ${
                      isHot
                        ? "border-blue-500 ring-1 ring-blue-500/40 transition-colors"
                        : "border-slate-700 focus:border-blue-500"
                    }`}
                  />
                </label>
              );
            })}
          </div>
        </div>

        {/* Smart checklist — deterministic, triggered by spoken symptoms */}
        <div className="p-4">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <ListChecks className="h-3.5 w-3.5" /> Smart checklist
            {scribe.checklist.length > 0 && (
              <span className="ms-auto font-normal normal-case text-slate-500">
                {doneCount}/{scribe.checklist.length}
              </span>
            )}
          </h2>
          {scribe.checklist.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              Documentation prompts appear here when a symptom is mentioned.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {scribe.checklist.map((item) => (
                <li key={item.label}>
                  <label className="flex cursor-pointer items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => scribe.toggleChecklistItem(item.label)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
                    />
                    <span className="min-w-0">
                      <span className={item.done ? "text-slate-500 line-through" : "text-slate-200"}>
                        {item.label}
                      </span>
                      <span className="ms-1.5 rounded bg-slate-800 px-1 py-px text-[9px] uppercase text-slate-400">
                        {item.symptom}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
