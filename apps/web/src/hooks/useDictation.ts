/**
 * useDictation — shared mic-recording lifecycle for any component that turns
 * speech into text via the on-prem transcription service. Owns getUserMedia,
 * MediaRecorder, and the call to POST /transcribe; callers decide what to do
 * with the resulting text (insert into a textarea, a single-line input, …).
 *
 * Extracted from the previously-duplicated implementations in DraftPanel and
 * AmbientPanel (docs/architecture/dictation.md) — same mechanism, same
 * on-prem pipeline, no new capability.
 */

import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { blobToBase64 } from "../lib/dictation";

export interface DictationResult {
  readonly text: string;
  readonly raw_text: string;
  readonly reformat: string;
}

export interface UseDictation {
  readonly recording: boolean;
  readonly transcribing: boolean;
  readonly error: string | null;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
}

export function useDictation(
  patientId: string,
  language: "en" | "ar",
  onResult: (result: DictationResult) => void,
): UseDictation {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support audio recording. Use Chrome on desktop.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Pick a mime type the browser actually supports (Safari lacks webm).
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
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
          if (text) onResult({ text, raw_text, reformat });
          else setError("Transcription returned no text.");
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Transcription failed");
        } finally {
          setTranscribing(false);
        }
      };
      recorderRef.current = rec;
      rec.start(1000); // emit data every 1s so short clips still capture audio
      setRecording(true);
    } catch {
      setError("Microphone access denied or unavailable.");
    }
  }, [patientId, language, onResult]);

  const stop = useCallback(() => {
    recorderRef.current?.stop();
    setRecording(false);
  }, []);

  return { recording, transcribing, error, start, stop };
}
