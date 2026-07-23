/**
 * Left column — Ambient Scribe & live SOAP note.
 *
 * Recording status bar + waveform, streaming transcript, an auto-updating
 * SOAP draft the clinician can edit, and the Smart Checklist widget.
 *
 * The clinician remains the author: the SOAP fields are plain editable text
 * areas and nothing is written to the record from here.
 */

import { useEffect, useRef } from "react";
import { Mic, Square, ListChecks, FileText } from "lucide-react";
import { useSully, type SoapField } from "../SullyContext";

const SOAP_SECTIONS: readonly { field: SoapField; label: string }[] = [
  { field: "subjective", label: "Subjective" },
  { field: "objective", label: "Objective" },
  { field: "assessment", label: "Assessment" },
  { field: "plan", label: "Plan" },
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Purely decorative waveform; animates only while recording. */
function Waveform({ active }: { readonly active: boolean }): JSX.Element {
  const bars = [6, 12, 9, 16, 11, 7, 14, 10, 5, 13, 8, 15, 9, 6, 12];
  return (
    <div className="flex h-6 items-end gap-[3px]" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full ${active ? "bg-blue-400 animate-pulse" : "bg-slate-700"}`}
          style={{ height: `${active ? h : 4}px`, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

export default function AmbientScribePane(): JSX.Element {
  const { recording, elapsedSeconds, transcript, soap, checklist, toggleRecording, updateSoap, toggleChecklistItem } = useSully();
  const feedRef = useRef<HTMLDivElement>(null);

  // Keep the newest transcript line in view as it streams.
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    // jsdom (tests) has no scrollTo; fall back to setting scrollTop.
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [transcript.length]);

  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <section className="flex h-full flex-col overflow-hidden bg-slate-900" aria-label="Ambient scribe">
      {/* Recording status bar */}
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <button
          type="button"
          onClick={toggleRecording}
          aria-pressed={recording}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            recording
              ? "bg-rose-600 text-white hover:bg-rose-500"
              : "bg-blue-600 text-white hover:bg-blue-500"
          }`}
        >
          {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {recording ? "Stop" : "Record"}
        </button>

        <Waveform active={recording} />

        <span className="ms-auto flex items-center gap-2 text-xs text-slate-400">
          {recording && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />}
          <span className="font-mono">{formatElapsed(elapsedSeconds)}</span>
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Live transcript */}
        <div className="border-b border-slate-800 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <FileText className="h-3.5 w-3.5" /> Live transcript
          </h2>
          <div ref={feedRef} className="max-h-44 space-y-2 overflow-y-auto pe-1">
            {transcript.length === 0 ? (
              <p className="text-xs text-slate-500">
                {recording ? "Listening…" : "Press Record to start the ambient transcript."}
              </p>
            ) : (
              transcript.map((line) => (
                <p key={line.id} className="text-xs leading-relaxed">
                  <span className={line.speaker === "clinician" ? "text-blue-300" : "text-slate-400"}>
                    {line.speaker === "clinician" ? "Clinician" : "Patient"}
                  </span>
                  <span className="text-slate-600"> · {line.at} </span>
                  <span className="text-slate-200">{line.text}</span>
                </p>
              ))
            )}
          </div>
        </div>

        {/* SOAP draft */}
        <div className="border-b border-slate-800 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Draft SOAP note
          </h2>
          <div className="space-y-3">
            {SOAP_SECTIONS.map(({ field, label }) => (
              <label key={field} className="block">
                <span className="mb-1 block text-[11px] font-medium text-slate-300">{label}</span>
                <textarea
                  aria-label={label}
                  value={soap[field]}
                  onChange={(e) => updateSoap(field, e.target.value)}
                  rows={2}
                  placeholder={`${label}…`}
                  className="w-full resize-y rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Smart checklist */}
        <div className="p-4">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <ListChecks className="h-3.5 w-3.5" /> Smart checklist
            <span className="ms-auto font-normal normal-case text-slate-500">
              {doneCount}/{checklist.length}
            </span>
          </h2>
          <ul className="space-y-1.5">
            {checklist.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => toggleChecklistItem(item.id)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-slate-600 bg-slate-800 accent-blue-500"
                  />
                  <span className={item.done ? "text-slate-500 line-through" : "text-slate-200"}>
                    {item.label}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
