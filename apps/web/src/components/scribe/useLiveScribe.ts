/**
 * useLiveScribe — wires audio capture to live SOAP structuring.
 *
 * Owns: capture lifecycle, transcript accumulation, debounced structuring
 * calls, per-section highlight timers, and the Smart Checklist.
 *
 * Degrades honestly. If the orchestrator is down or the PHI egress policy
 * blocks the model call, capture and the transcript keep working and the
 * reason is surfaced — the clinician never silently loses their words.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startAudioStream,
  isMicrophoneSupported,
  WAVEFORM_BAR_COUNT,
  type AudioSourceKind,
  type AudioStreamHandle,
  type TranscriptChunk,
} from "../../services/audio_stream";
import {
  EMPTY_SOAP,
  ScribeError,
  fetchChecklist,
  isOrchestratorUp,
  openSession,
  structureTranscript,
  type ChecklistItem,
  type SoapNote,
} from "./scribeClient";

/** Wait this long after speech stops before asking the model to restructure. */
const STRUCTURE_DEBOUNCE_MS = 1500;
/** How long a section stays highlighted after it changes. */
const HIGHLIGHT_MS = 2000;

export interface LiveScribeState {
  readonly recording: boolean;
  readonly transcript: readonly TranscriptChunk[];
  readonly levels: readonly number[];
  readonly soap: SoapNote;
  /** Sections updated in the last pass — drives the highlight. */
  readonly highlighted: readonly (keyof SoapNote)[];
  readonly checklist: readonly ChecklistItem[];
  readonly elapsedSeconds: number;
  readonly structuring: boolean;
  readonly error: string | null;
  /** true when the error came from the PHI egress policy, not a fault. */
  readonly blockedByPolicy: boolean;
  readonly micSupported: boolean;
  start: (source: AudioSourceKind, fixtureId?: string) => Promise<void>;
  stop: () => void;
  updateSoap: (field: keyof SoapNote, value: string) => void;
  toggleChecklistItem: (label: string) => void;
}

export function useLiveScribe(patientNames: readonly string[] = []): LiveScribeState {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [levels, setLevels] = useState<number[]>(() => new Array(WAVEFORM_BAR_COUNT).fill(0));
  const [soap, setSoap] = useState<SoapNote>(EMPTY_SOAP);
  const [highlighted, setHighlighted] = useState<(keyof SoapNote)[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [elapsedSeconds, setElapsed] = useState(0);
  const [structuring, setStructuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedByPolicy, setBlocked] = useState(false);

  const handleRef = useRef<AudioStreamHandle | null>(null);
  const sessionRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const highlightRef = useRef<number | null>(null);
  const elapsedRef = useRef<number | null>(null);
  // Manual edits must not be clobbered by the next model pass.
  const editedRef = useRef<Set<keyof SoapNote>>(new Set());
  const transcriptTextRef = useRef("");

  const micSupported = isMicrophoneSupported();

  const runStructuring = useCallback(async () => {
    const text = transcriptTextRef.current.trim();
    if (!text) return;

    setStructuring(true);
    try {
      const result = await structureTranscript(text, patientNames);
      setSoap((prev) => {
        const next = { ...result.soap };
        // Preserve anything the clinician typed themselves.
        for (const field of editedRef.current) next[field] = prev[field];
        return next;
      });
      const changed = result.changed.filter((f) => !editedRef.current.has(f));
      setHighlighted(changed);
      if (highlightRef.current) window.clearTimeout(highlightRef.current);
      highlightRef.current = window.setTimeout(() => setHighlighted([]), HIGHLIGHT_MS);
      setChecklist((prev) => mergeChecklist(prev, result.checklist));
      setError(null);
      setBlocked(false);
    } catch (err) {
      if (err instanceof ScribeError) {
        setBlocked(err.blockedByPolicy);
        setError(
          err.blockedByPolicy
            ? `SOAP structuring blocked by data-residency policy: ${err.message}`
            : `Could not structure the note: ${err.message}`,
        );
      } else {
        setError("Could not reach the scribe service. Transcript is still being captured.");
      }
      // Checklist is deterministic and local to the orchestrator — still try it.
      try {
        const items = await fetchChecklist(text);
        setChecklist((prev) => mergeChecklist(prev, items));
      } catch { /* orchestrator down entirely */ }
    } finally {
      setStructuring(false);
    }
  }, [patientNames]);

  const handleChunk = useCallback((chunk: TranscriptChunk) => {
    setTranscript((prev) => {
      // Interim results replace the previous interim, finals append.
      const last = prev[prev.length - 1];
      const next = last && !last.isFinal ? [...prev.slice(0, -1), chunk] : [...prev, chunk];
      transcriptTextRef.current = next.map((c) => c.text).join(" ");
      return next;
    });

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => { void runStructuring(); }, STRUCTURE_DEBOUNCE_MS);
  }, [runStructuring]);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setRecording(false);
    if (elapsedRef.current) { window.clearInterval(elapsedRef.current); elapsedRef.current = null; }
    if (debounceRef.current) { window.clearTimeout(debounceRef.current); debounceRef.current = null; }
    // Final pass so the closing sentences make it into the note.
    void runStructuring();
  }, [runStructuring]);

  const start = useCallback(async (source: AudioSourceKind, fixtureId?: string) => {
    setError(null);
    setBlocked(false);

    if (!(await isOrchestratorUp())) {
      setError(
        "Scribe service is not running (expected on :5010). Capture will work; SOAP structuring will not.",
      );
    }

    try {
      if (!sessionRef.current) {
        sessionRef.current = await openSession(patientNames).catch(() => null);
      }
      const handle = await startAudioStream(
        { source, ...(fixtureId ? { fixtureId } : {}), language: "en-US" },
        {
          onChunk: handleChunk,
          onLevel: (l) => setLevels([...l]),
          onError: (e) => setError(e.message),
          onEnd: () => setRecording(false),
        },
      );
      handleRef.current = handle;
      setRecording(true);
      const startedAt = Date.now();
      elapsedRef.current = window.setInterval(
        () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
        1000,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start audio capture.");
      setRecording(false);
    }
  }, [handleChunk, patientNames]);

  const updateSoap = useCallback((field: keyof SoapNote, value: string) => {
    editedRef.current.add(field);
    setSoap((prev) => ({ ...prev, [field]: value }));
  }, []);

  const toggleChecklistItem = useCallback((label: string) => {
    setChecklist((prev) =>
      prev.map((i) => (i.label === label ? { ...i, done: !i.done } : i)),
    );
  }, []);

  useEffect(() => () => {
    handleRef.current?.stop();
    if (elapsedRef.current) window.clearInterval(elapsedRef.current);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (highlightRef.current) window.clearTimeout(highlightRef.current);
  }, []);

  return {
    recording, transcript, levels, soap, highlighted, checklist,
    elapsedSeconds, structuring, error, blockedByPolicy, micSupported,
    start, stop, updateSoap, toggleChecklistItem,
  };
}

/** Keep user-ticked state when new items arrive. */
function mergeChecklist(
  prev: readonly ChecklistItem[],
  incoming: readonly ChecklistItem[],
): ChecklistItem[] {
  const doneLabels = new Set(prev.filter((i) => i.done).map((i) => i.label));
  return incoming.map((i) => ({ ...i, done: doneLabels.has(i.label) }));
}
