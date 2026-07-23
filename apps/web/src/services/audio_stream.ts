/**
 * Audio capture + live transcription for the ambient scribe.
 *
 * Two sources, one interface:
 *   - "microphone" — getUserMedia + Web Speech API for on-device speech-to-text,
 *     plus an AnalyserNode driving the waveform.
 *   - "fixture"    — replays a mock transcript from /data/mock_audio at its
 *     recorded pace. No mic needed; deterministic for demos and tests.
 *
 * Speech-to-text runs in the browser. Only recognised TEXT is sent to the
 * orchestrator — raw audio never leaves the machine.
 */

export type AudioSourceKind = "microphone" | "fixture";

export interface TranscriptChunk {
  readonly text: string;
  readonly speaker: "clinician" | "patient";
  /** ms since capture started */
  readonly atMs: number;
  /** false while the recogniser may still revise this text */
  readonly isFinal: boolean;
}

export interface AudioStreamCallbacks {
  onChunk?: (chunk: TranscriptChunk) => void;
  /** 0..1 amplitude samples for the waveform, ~20fps */
  onLevel?: (levels: readonly number[]) => void;
  onError?: (error: Error) => void;
  onEnd?: () => void;
}

export interface FixtureTranscript {
  readonly id: string;
  readonly title: string;
  readonly expected_symptoms?: readonly string[];
  readonly chunks: readonly {
    readonly at_ms: number;
    readonly speaker: "clinician" | "patient";
    readonly text: string;
  }[];
}

/** Bars in the waveform display. */
const WAVEFORM_BARS = 24;
const LEVEL_INTERVAL_MS = 50;

// The Web Speech API is not in TS's DOM lib and is vendor-prefixed.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isMicrophoneSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    getSpeechRecognition() !== null
  );
}

/**
 * A running capture. `stop()` is idempotent and always releases the mic.
 */
export interface AudioStreamHandle {
  stop: () => void;
  readonly kind: AudioSourceKind;
}

// ---------------------------------------------------------------------------
// Microphone
// ---------------------------------------------------------------------------
async function startMicrophone(
  callbacks: AudioStreamCallbacks,
  language: string,
): Promise<AudioStreamHandle> {
  const Recognition = getSpeechRecognition();
  if (!Recognition) {
    throw new Error(
      "This browser has no Web Speech API. Use a fixture transcript instead.",
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const started = Date.now();

  // --- waveform ---
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const buffer = new Uint8Array(analyser.frequencyBinCount);

  const levelTimer = window.setInterval(() => {
    analyser.getByteFrequencyData(buffer);
    const step = Math.floor(buffer.length / WAVEFORM_BARS) || 1;
    const levels: number[] = [];
    for (let i = 0; i < WAVEFORM_BARS; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum = sum + (buffer[i * step + j] ?? 0);
      levels.push(Math.min(1, sum / step / 255));
    }
    callbacks.onLevel?.(levels);
  }, LEVEL_INTERVAL_MS);

  // --- speech to text ---
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = language;

  recognition.onresult = (event: any): void => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = String(result[0]?.transcript ?? "").trim();
      if (!text) continue;
      callbacks.onChunk?.({
        text,
        // A single mic cannot separate speakers; everything is attributed to
        // the clinician rather than guessing who spoke.
        speaker: "clinician",
        atMs: Date.now() - started,
        isFinal: Boolean(result.isFinal),
      });
    }
  };

  recognition.onerror = (event: any): void => {
    // "no-speech" and "aborted" are normal during a pause — not failures.
    const code = String(event?.error ?? "unknown");
    if (code === "no-speech" || code === "aborted") return;
    callbacks.onError?.(new Error(`Speech recognition error: ${code}`));
  };

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(levelTimer);
    try { recognition.stop(); } catch { /* already stopped */ }
    stream.getTracks().forEach((t) => t.stop());
    void audioCtx.close().catch(() => undefined);
    callbacks.onLevel?.(new Array(WAVEFORM_BARS).fill(0));
    callbacks.onEnd?.();
  };

  // Chrome ends recognition after a silence; restart until we're told to stop.
  recognition.onend = (): void => {
    if (!stopped) {
      try { recognition.start(); } catch { /* racing a stop() */ }
    }
  };

  recognition.start();
  return { stop, kind: "microphone" };
}

// ---------------------------------------------------------------------------
// Fixture replay
// ---------------------------------------------------------------------------
export async function loadFixture(id: string): Promise<FixtureTranscript> {
  const res = await fetch(`/mock_audio/${id}.transcript.json`);
  if (!res.ok) throw new Error(`Fixture "${id}" not found (${res.status})`);
  return (await res.json()) as FixtureTranscript;
}

function startFixture(
  fixture: FixtureTranscript,
  callbacks: AudioStreamCallbacks,
  speed: number,
): AudioStreamHandle {
  const timers: number[] = [];
  let stopped = false;

  fixture.chunks.forEach((chunk) => {
    const delay = Math.max(0, chunk.at_ms / speed);
    timers.push(
      window.setTimeout(() => {
        if (stopped) return;
        callbacks.onChunk?.({
          text: chunk.text,
          speaker: chunk.speaker,
          atMs: chunk.at_ms,
          isFinal: true,
        });
      }, delay),
    );
  });

  // Synthetic waveform so the UI looks alive during replay.
  const levelTimer = window.setInterval(() => {
    const levels = Array.from({ length: WAVEFORM_BARS }, () => Math.random() * 0.8 + 0.1);
    callbacks.onLevel?.(levels);
  }, LEVEL_INTERVAL_MS);
  timers.push(levelTimer);

  const last = fixture.chunks[fixture.chunks.length - 1];
  const endAt = last ? last.at_ms / speed + 1200 : 0;
  timers.push(
    window.setTimeout(() => {
      if (!stopped) stop();
    }, endAt),
  );

  function stop(): void {
    if (stopped) return;
    stopped = true;
    timers.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    callbacks.onLevel?.(new Array(WAVEFORM_BARS).fill(0));
    callbacks.onEnd?.();
  }

  return { stop, kind: "fixture" };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export interface StartOptions {
  readonly source: AudioSourceKind;
  /** Required when source is "fixture". */
  readonly fixtureId?: string;
  /** Replay speed multiplier for fixtures (2 = twice as fast). */
  readonly speed?: number;
  readonly language?: string;
}

export async function startAudioStream(
  options: StartOptions,
  callbacks: AudioStreamCallbacks,
): Promise<AudioStreamHandle> {
  if (options.source === "microphone") {
    return startMicrophone(callbacks, options.language ?? "en-US");
  }
  if (!options.fixtureId) {
    throw new Error('A fixtureId is required when source is "fixture".');
  }
  const fixture = await loadFixture(options.fixtureId);
  return startFixture(fixture, callbacks, options.speed ?? 1);
}

export const WAVEFORM_BAR_COUNT = WAVEFORM_BARS;
