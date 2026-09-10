/**
 * Left column — Ambient Scribe & live SOAP note.
 *
 * Recording status bar + waveform, streaming transcript, an auto-updating
 * SOAP draft the clinician can edit, and the Smart Checklist widget.
 *
 * The clinician remains the author: the SOAP fields are plain editable text
 * areas and nothing is written to the record from here.
 */

import { useCallback, useEffect, useRef } from "react";
import { Mic, Square, ListChecks, FileText, Loader2, AlertTriangle } from "lucide-react";
import { useSully, type SoapField } from "../SullyContext";
import { useDictation, type DictationResult } from "../../../hooks/useDictation";

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
          className={`w-[3px] rounded-full ${active ? "bg-agent-cons animate-pulse" : "bg-line-strong"}`}
          style={{ height: `${active ? h : 4}px`, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}

export default function AmbientScribePane(): JSX.Element {
  const {
    recording, elapsedSeconds, transcript, soap, soapError, soapLoading, checklist,
    toggleRecording, updateSoap, toggleChecklistItem,
    dictationMode, patientId, transcribing, dictationError,
    setDictationMode, appendTranscriptLine, setTranscribing, setDictationError,
  } = useSully();
  const feedRef = useRef<HTMLDivElement>(null);

  // Audit H-3: real microphone capture + the on-prem transcription service,
  // replacing the setInterval animation that previously stood in for it. The
  // canned playback is kept as an explicit `demo` mode for offline use and
  // for tests, rather than being deleted.
  const onResult = useCallback(
    (result: DictationResult) => appendTranscriptLine(result.text),
    [appendTranscriptLine],
  );
  const dictation = useDictation(patientId ?? "", "en", onResult);

  // Mirror the hook's transient state into the shared store so the header can
  // render it without the pane owning transcript state itself.
  useEffect(() => setTranscribing(dictation.transcribing), [dictation.transcribing, setTranscribing]);
  useEffect(() => setDictationError(dictation.error), [dictation.error, setDictationError]);

  const liveMode = dictationMode === "live";
  // Live capture is only offered when there is a patient to post audio against.
  const canRecordLive = liveMode && Boolean(patientId);
  const isRecording = liveMode ? dictation.recording : recording;

  const handleRecordClick = useCallback(() => {
    if (!liveMode) {
      toggleRecording();
      return;
    }
    if (dictation.recording) dictation.stop();
    else void dictation.start();
  }, [liveMode, toggleRecording, dictation]);

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
    <section className="flex h-full flex-col overflow-hidden bg-white" aria-label="Ambient scribe">
      {/* Recording status bar */}
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRecordClick}
            aria-pressed={isRecording}
            disabled={liveMode && !canRecordLive}
            title={
              liveMode && !canRecordLive
                ? "Live dictation needs an open patient encounter. Switch to Demo playback to preview the scribe."
                : undefined
            }
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              isRecording
                ? "bg-rose-600 text-white hover:bg-rose-500"
                : "bg-grad-accent text-white hover:brightness-110 shadow-pill"
            }`}
          >
            {isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {isRecording ? "Stop" : "Record"}
          </button>

          <Waveform active={isRecording} />

          <span className="ms-auto flex items-center gap-2 text-xs text-ink-soft">
            {isRecording && <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />}
            <span className="font-mono">{formatElapsed(elapsedSeconds)}</span>
          </span>
        </div>

        {/* Capture-source toggle. Explicit rather than implicit, so nobody
            mistakes canned playback for a live recording. */}
        <div
          role="radiogroup"
          aria-label="Dictation source"
          className="mt-2.5 flex items-center gap-1 text-[11px]"
        >
          {(["live", "demo"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={dictationMode === mode}
              aria-label={mode === "live" ? "Live microphone" : "Demo playback"}
              onClick={() => setDictationMode(mode)}
              className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
                dictationMode === mode
                  ? "bg-veil text-ink"
                  : "text-ink-soft hover:text-ink-deep"
              }`}
            >
              {mode === "live" ? "Live microphone" : "Demo playback"}
            </button>
          ))}
          {dictationMode === "demo" && (
            <span className="ms-1 text-[10px] italic text-demo-text/80">
              scripted sample — not a recording
            </span>
          )}
        </div>

        {liveMode && !patientId && (
          <p className="mt-2 text-[11px] leading-relaxed text-status-pend">
            No patient encounter is open, so audio has nowhere to be transcribed against.
            Switch to Demo playback to preview the scribe.
          </p>
        )}

        {transcribing && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-soft">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Transcribing…
          </p>
        )}

        {dictationError && (
          <p
            role="alert"
            className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-rose-600"
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            {dictationError}
          </p>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Live transcript */}
        <div className="border-b border-line p-4">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            <FileText className="h-3.5 w-3.5" /> Live transcript
          </h2>
          <div ref={feedRef} className="max-h-44 space-y-2 overflow-y-auto pe-1">
            {transcript.length === 0 ? (
              <p className="text-xs text-ink-soft">
                {isRecording ? "Listening…" : "Press Record to start the ambient transcript."}
              </p>
            ) : (
              transcript.map((line) => (
                <p key={line.id} className="text-xs leading-relaxed">
                  <span className={`font-semibold ${line.speaker === "clinician" ? "text-agent-cons" : "text-agent-pharm"}`}>
                    {line.speaker === "clinician" ? "Clinician" : "Patient"}
                  </span>
                  <span className="text-ink-faint"> · {line.at} </span>
                  <span className="text-ink-deep">{line.text}</span>
                </p>
              ))
            )}
          </div>
        </div>

        {/* SOAP draft */}
        <div className="border-b border-line p-4">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Draft SOAP note
            {soapLoading && (
              <span className="flex items-center gap-1 font-normal normal-case text-ink-faint" data-testid="soap-generating">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> generating…
              </span>
            )}
          </h2>
          {soapError && (
            <p
              role="status"
              data-testid="soap-error"
              className="mb-2 flex items-start gap-2 rounded-xl border border-status-pend-line bg-status-pend-bg px-3 py-2 text-[11px] leading-relaxed text-status-pend"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {soapError}
            </p>
          )}
          <div className="space-y-3">
            {SOAP_SECTIONS.map(({ field, label }) => (
              <label key={field} className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-deep">{label}</span>
                <textarea
                  aria-label={label}
                  value={soap[field]}
                  onChange={(e) => updateSoap(field, e.target.value)}
                  rows={2}
                  placeholder={`${label}…`}
                  className="w-full resize-y rounded-lg border border-line bg-wash px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-brand-indigo focus:outline-none focus:ring-1 focus:ring-brand-indigo/30"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Smart checklist */}
        <div className="p-4">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            <ListChecks className="h-3.5 w-3.5" /> Smart checklist
            <span className="ms-auto font-normal normal-case text-ink-soft">
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
                    className="mt-0.5 h-3.5 w-3.5 rounded border-line-strong bg-veil accent-brand-indigo"
                  />
                  <span className={item.done ? "text-ink-soft line-through" : "text-ink-deep"}>
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
