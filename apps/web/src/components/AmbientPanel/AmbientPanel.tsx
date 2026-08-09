/**
 * AmbientPanel — ambient structured-transcription capture
 * (docs/prompts/ambient-segmentation-prompt.md).
 *
 * Flow: explicit consent acknowledgment -> explicit Start/Stop recording ->
 * transcribe (on-prem, same pipeline as dictation) -> "Structure into note"
 * classifies the transcript into section previews (verbatim spans only,
 * server-verified) -> "Create draft" hands those sections to the normal
 * encounter_note draft, which opens in the existing DraftPanel edit/sign/
 * export flow. Nothing is written to the record until "Create draft" is
 * clicked, and nothing is final until the resulting draft is signed there.
 *
 * Constraints (CLAUDE.md §2, docs/architecture/dictation.md):
 * - No always-on/background capture — explicit Start, explicit Stop only.
 * - The clinician is always shown the raw transcript before structuring, and
 *   can review/edit every section before a draft is ever created.
 * - Segmentation only relocates the speaker's own words — see
 *   isClinicianAuthoredOnly re-validation in draft.service.ts, which this UI
 *   cannot bypass (an edit that adds new content is rejected server-side).
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { api, type DraftSpecialty, type ExtractedTerm, ApiError } from "../../lib/api";
import { useDictation, type DictationResult } from "../../hooks/useDictation";

const SECTION_SPECS = [
  { key: "chief_complaint", title: "Chief Complaint" },
  { key: "history", title: "History" },
  { key: "assessment", title: "Assessment" },
  { key: "plan", title: "Plan" },
] as const;

// Non-judgment sections eligible for light AI condensation
// (docs/prompts/ambient-condensation-prompt.md) -- Assessment/Plan are never
// offered a Condense button; this mirrors CONDENSABLE_SECTIONS enforced
// server-side in draft.service.ts/condense.py, which is the real gate --
// this constant only controls whether the button is shown.
const CONDENSABLE_KEYS = new Set(["chief_complaint", "history"]);

// Sections eligible to use an English translation as the draft text
// (docs/prompts/interpreter-prompt.md's ambient-Scribe call site) -- mirrors
// TRANSLATABLE_SECTIONS in draft.service.ts, which is the real gate. All
// sections still get an English preview for reading/reference when the
// dictation language is Arabic; only these two can actually be SUBMITTED as
// English.
const TRANSLATABLE_KEYS = new Set(["chief_complaint", "history"]);

// Purely nominal/lexical labels for the reference glossary's tooltip -- what
// KIND of word each term is, never a severity/judgment label (docs/prompts/
// ambient-term-extraction-prompt.md).
const CATEGORY_LABELS: Record<string, string> = {
  medication: "Medication",
  symptom: "Symptom",
  diagnosis_or_condition: "Diagnosis / condition",
  test_or_procedure: "Test / procedure",
  other: "Other clinical term",
};

const SPECIALTIES: { value: DraftSpecialty; label: string }[] = [
  { value: "general", label: "General" },
  { value: "cardiology", label: "Cardiology" },
  { value: "orthopedics", label: "Orthopedics" },
  { value: "pediatrics", label: "Pediatrics" },
  { value: "obstetrics_gynecology", label: "OB/GYN" },
  { value: "emergency_medicine", label: "Emergency Medicine" },
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

interface AmbientPanelProps {
  readonly patientId: string;
  /** Called after a draft is successfully created, so the workspace can open
   * the Draft card for the clinician to continue editing/signing there. */
  readonly onDraftCreated: () => void;
}

export default function AmbientPanel({ patientId, onDraftCreated }: AmbientPanelProps): JSX.Element {
  const [language, setLanguage] = useState<"en" | "ar">("en");
  const [specialty, setSpecialty] = useState<DraftSpecialty>("general");
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const [sections, setSections] = useState<Record<string, string> | null>(null);
  const [unclassified, setUnclassified] = useState<string>("");
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ambient condensation (docs/prompts/ambient-condensation-prompt.md):
  // condensedKeys tracks which sections currently hold clinician-ACCEPTED
  // condensed text (sent to createDraft so the server applies the relaxed
  // re-validation path instead of the strict verbatim-substring check).
  // suggestions holds a pending proposal awaiting explicit accept/discard --
  // never applied automatically.
  const [condensedKeys, setCondensedKeys] = useState<Set<string>>(new Set());
  const [condensingKey, setCondensingKey] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, { text: string; condensed: boolean }>>({});

  // Ambient auto-translation (docs/prompts/interpreter-prompt.md): fired
  // automatically after structuring an Arabic transcript. `translations`
  // holds a READ-ONLY English preview per section -- the section's own
  // textarea always keeps editing the ORIGINAL-language text, never the
  // translation, because the server always re-derives its own translation
  // from that original-language text (verified against the original-language
  // transcript) and never trusts client-submitted translated text.
  // `translatedKeys` is purely a per-section flag ("use English for this
  // section at draft-creation time"), independent of what the textarea shows.
  const [translations, setTranslations] = useState<Record<string, string | null>>({});
  const [translatingKeys, setTranslatingKeys] = useState<Set<string>>(new Set());
  const [translatedKeys, setTranslatedKeys] = useState<Set<string>>(new Set());

  // Medical-terms reference glossary (docs/prompts/ambient-term-extraction-prompt.md):
  // fires automatically as soon as a raw transcript is captured. Read-only and
  // reference-only -- shown alongside the transcript for the clinician to read
  // in context (a term like "fever" may have appeared as "no fever" in the
  // actual transcript above it), never touches `sections`/createDraft.
  const [terms, setTerms] = useState<ExtractedTerm[] | null>(null);
  const [extractingTerms, setExtractingTerms] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onDictationResult = useCallback(
    (result: DictationResult) => {
      setTranscript(result.text || null);
      if (result.text.trim()) {
        setExtractingTerms(true);
        api.ambient
          .extractTerms(patientId, result.text, language)
          .then((res) => setTerms([...res.terms]))
          .catch(() => setTerms(null))
          .finally(() => setExtractingTerms(false));
      }
    },
    [patientId, language],
  );
  const dictation = useDictation(patientId, language, onDictationResult);
  const recording = dictation.recording;
  const transcribing = dictation.transcribing;

  // Recording duration display — ticks while the shared hook is recording,
  // stops (and is cleared) the moment it isn't, including on unmount.
  useEffect(() => {
    if (recording) {
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [recording]);

  const reset = useCallback(() => {
    setTranscript(null);
    setSections(null);
    setUnclassified("");
    setSeconds(0);
    setError(null);
    setCondensedKeys(new Set());
    setCondensingKey(null);
    setSuggestions({});
    setTranslations({});
    setTranslatingKeys(new Set());
    setTranslatedKeys(new Set());
    setTerms(null);
    setExtractingTerms(false);
  }, []);

  const startRecording = useCallback(() => {
    setError(null);
    void dictation.start();
  }, [dictation]);

  const stopRecording = useCallback(() => {
    dictation.stop();
  }, [dictation]);

  // Auto-fires a read-only English preview for every non-empty section right
  // after an Arabic transcript is structured -- reuses the existing Medical
  // Interpreter endpoint as-is (docs/prompts/interpreter-prompt.md). This is
  // ONLY a preview for the clinician's convenience; it never becomes the
  // submitted section text directly -- see translatedKeys above.
  const translateSections = useCallback(
    (sectionsMap: Record<string, string>) => {
      for (const [key, text] of Object.entries(sectionsMap)) {
        if (!text.trim()) continue;
        setTranslatingKeys((prev) => new Set(prev).add(key));
        api.interpreter
          .translate(patientId, { text, sourceLanguage: "ar", targetLanguage: "en" })
          .then((result) => setTranslations((prev) => ({ ...prev, [key]: result.text })))
          .catch(() => setTranslations((prev) => ({ ...prev, [key]: null })))
          .finally(() =>
            setTranslatingKeys((prev) => {
              const n = new Set(prev);
              n.delete(key);
              return n;
            }),
          );
      }
    },
    [patientId],
  );

  const structureNote = useCallback(() => {
    if (!transcript) return;
    setSegmenting(true);
    setError(null);
    api.ambient
      .segment(patientId, transcript, SECTION_SPECS, language)
      .then((result) => {
        const map: Record<string, string> = {};
        for (const s of result.sections) map[s.key] = s.text;
        setSections(map);
        setUnclassified(result.unclassified_text);
        if (language === "ar") translateSections(map);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Structuring failed"))
      .finally(() => setSegmenting(false));
  }, [patientId, transcript, language, translateSections]);

  const condenseSection = useCallback(
    (key: string) => {
      if (!sections) return;
      const text = sections[key];
      if (!text || !text.trim()) return;
      setCondensingKey(key);
      setError(null);
      api.ambient
        .condense(patientId, key, text, language)
        .then((result) => setSuggestions((prev) => ({ ...prev, [key]: result })))
        .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Condensing failed"))
        .finally(() => setCondensingKey(null));
    },
    [patientId, sections, language],
  );

  const acceptCondensed = useCallback((key: string) => {
    setSuggestions((prev) => {
      const suggestion = prev[key];
      if (suggestion) {
        setSections((s) => ({ ...(s ?? {}), [key]: suggestion.text }));
        setCondensedKeys((keys) => new Set(keys).add(key));
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const discardSuggestion = useCallback((key: string) => {
    setSuggestions((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const toggleUseTranslation = useCallback((key: string, use: boolean) => {
    setTranslatedKeys((keys) => {
      const next = new Set(keys);
      if (use) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const createDraft = useCallback(() => {
    if (!transcript || !sections) return;
    setCreatingDraft(true);
    setError(null);
    const prefillSections = Object.entries(sections)
      .filter(([, text]) => text.trim())
      .map(([key, text]) => ({ key, text }));
    api.patients
      .createDraft(patientId, "encounter_note", language, specialty, {
        transcript,
        sections: prefillSections,
        condensedKeys: Array.from(condensedKeys),
        translatedKeys: Array.from(translatedKeys),
      })
      .then(() => {
        onDraftCreated();
        reset();
        setConsentAcknowledged(false);
      })
      .catch((e: unknown) => {
        setError(
          e instanceof ApiError
            ? `${e.message} — a section may contain text that wasn't in the recording; edit it back to the transcript's own words, or create the draft and add anything else there.`
            : "Failed to create draft",
        );
      })
      .finally(() => setCreatingDraft(false));
  }, [patientId, transcript, sections, language, specialty, onDraftCreated, reset, condensedKeys, translatedKeys]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-4" data-testid="ambient-panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-slate-200 text-base font-medium">Encounter Recording</h2>
        <div className="flex gap-2 ml-auto">
          <select
            value={language}
            disabled={recording || transcribing}
            onChange={(e) => setLanguage(e.target.value as "en" | "ar")}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
            aria-label="Language"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <select
            value={specialty}
            disabled={recording || transcribing}
            onChange={(e) => setSpecialty(e.target.value as DraftSpecialty)}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
            aria-label="Specialty"
            data-testid="ambient-specialty-select"
          >
            {SPECIALTIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {!transcript && !recording && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={consentAcknowledged}
              onChange={(e) => setConsentAcknowledged(e.target.checked)}
              className="mt-0.5"
              data-testid="consent-checkbox"
            />
            Recording this conversation. Patient has been informed.
          </label>
          <button
            onClick={() => void startRecording()}
            disabled={!consentAcknowledged || transcribing}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm px-3 py-1.5 rounded"
            data-testid="start-recording-btn"
          >
            ● Start recording
          </button>
        </div>
      )}

      {recording && (
        <button
          onClick={stopRecording}
          className="bg-red-600 hover:bg-red-500 animate-pulse text-white text-sm px-3 py-1.5 rounded"
          data-testid="stop-recording-btn"
        >
          ■ Stop recording — {formatDuration(seconds)}
        </button>
      )}

      {transcribing && <p className="text-sm text-slate-400">Transcribing…</p>}

      {(error ?? dictation.error) && (
        <div className="text-slate-400 text-sm bg-slate-800 rounded p-3" data-testid="ambient-error">
          {error ?? dictation.error}
        </div>
      )}

      {transcript && !sections && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Raw transcript — review before structuring:</p>
          <div className="bg-slate-950 border border-slate-700 rounded p-3 text-sm text-slate-200 whitespace-pre-line max-h-48 overflow-y-auto" dir="auto" data-testid="raw-transcript">
            {transcript}
          </div>
          {extractingTerms && (
            <p className="text-xs text-slate-500">Finding medical terms…</p>
          )}
          {!extractingTerms && terms && terms.length > 0 && (
            <div className="space-y-1" data-testid="medical-terms-glossary">
              <p className="text-xs text-slate-400">
                Medical terms mentioned (reference only — read alongside the transcript above, not a
                clinical summary):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {terms.map((t, i) => (
                  <span
                    key={`${t.term}-${i}`}
                    className="text-xs px-2 py-0.5 rounded-full border border-slate-600 text-slate-300 bg-slate-800/60"
                    data-testid={`term-chip-${i}`}
                    title={CATEGORY_LABELS[t.category] ?? t.category}
                  >
                    {t.term}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={structureNote}
              disabled={segmenting}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
              data-testid="structure-note-btn"
            >
              {segmenting ? "Structuring…" : "Structure into note"}
            </button>
            <button onClick={reset} className="text-sm text-slate-400 hover:text-white px-3 py-1.5">
              Discard
            </button>
          </div>
        </div>
      )}

      {sections && (
        <div className="space-y-3">
          {SECTION_SPECS.map((spec) => {
            const isCondensable = CONDENSABLE_KEYS.has(spec.key);
            const isTranslatable = TRANSLATABLE_KEYS.has(spec.key);
            const suggestion = suggestions[spec.key];
            const translation = translations[spec.key];
            const isTranslating = translatingKeys.has(spec.key);
            const isUsingTranslation = translatedKeys.has(spec.key);
            return (
              <div key={spec.key}>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-400">{spec.title}</label>
                  {isCondensable && (
                    <button
                      type="button"
                      onClick={() => condenseSection(spec.key)}
                      disabled={condensingKey === spec.key || !(sections[spec.key] ?? "").trim()}
                      className="text-xs text-slate-500 hover:text-slate-300 underline disabled:opacity-50"
                      data-testid={`condense-btn-${spec.key}`}
                    >
                      {condensingKey === spec.key ? "Condensing…" : "Condense"}
                    </button>
                  )}
                </div>
                <textarea
                  value={sections[spec.key] ?? ""}
                  onChange={(e) => setSections((prev) => ({ ...(prev ?? {}), [spec.key]: e.target.value }))}
                  rows={2}
                  dir="auto"
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-200 mt-1"
                  data-testid={`section-${spec.key}`}
                />
                {suggestion && (
                  <div className="mt-1.5 p-2.5 rounded border border-slate-700 bg-slate-800/60 space-y-1.5" data-testid={`condense-suggestion-${spec.key}`}>
                    {suggestion.condensed ? (
                      <>
                        <p className="text-xs text-slate-400">Suggested condensed version — only words from your own text:</p>
                        <p className="text-sm text-slate-200" dir="auto">{suggestion.text}</p>
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => acceptCondensed(spec.key)}
                            className="text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                          >
                            Use condensed version
                          </button>
                          <button
                            type="button"
                            onClick={() => discardSuggestion(spec.key)}
                            className="text-xs px-2.5 py-1 rounded border border-slate-600 text-slate-300 hover:text-white"
                          >
                            Keep original
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-slate-500">No safe condensation found — your original text was kept.</p>
                        <button
                          type="button"
                          onClick={() => discardSuggestion(spec.key)}
                          className="text-xs text-slate-500 hover:text-slate-300 underline shrink-0"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {isTranslating && (
                  <p className="text-xs text-slate-500 mt-1.5">Translating…</p>
                )}
                {!isTranslating && translation !== undefined && (
                  <div className="mt-1.5 p-2.5 rounded border border-slate-700 bg-slate-800/40 space-y-1.5" data-testid={`translation-preview-${spec.key}`}>
                    {translation ? (
                      <>
                        <p className="text-xs text-slate-400">English translation (reference — clinical terms kept as stated):</p>
                        <p className="text-sm text-slate-200" dir="ltr">{translation}</p>
                        {isTranslatable && (
                          <div className="flex gap-2 pt-1">
                            {!isUsingTranslation ? (
                              <button
                                type="button"
                                onClick={() => toggleUseTranslation(spec.key, true)}
                                className="text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                                data-testid={`use-translation-btn-${spec.key}`}
                              >
                                Use English version
                              </button>
                            ) : (
                              <>
                                <span className="text-xs text-blue-300 px-1 py-1">Will use English version</span>
                                <button
                                  type="button"
                                  onClick={() => toggleUseTranslation(spec.key, false)}
                                  className="text-xs px-2.5 py-1 rounded border border-slate-600 text-slate-300 hover:text-white"
                                  data-testid={`keep-arabic-btn-${spec.key}`}
                                >
                                  Keep original
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-slate-500">Translation unavailable — original text kept.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {unclassified && (
            <div>
              <label className="text-xs text-slate-400">Unsorted (not confidently classified)</label>
              <div className="w-full bg-slate-950 border border-amber-800/50 rounded p-2 text-sm text-slate-300 mt-1 whitespace-pre-line" dir="auto" data-testid="unclassified-text">
                {unclassified}
              </div>
            </div>
          )}
          <p className="text-xs text-slate-500">
            You can trim or move this text between sections, but can't add new words here — anything
            else can be added once the draft is created.
          </p>
          <div className="flex gap-2">
            <button
              onClick={createDraft}
              disabled={creatingDraft}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
              data-testid="create-draft-btn"
            >
              {creatingDraft ? "Creating…" : "Create draft"}
            </button>
            <button onClick={reset} className="text-sm text-slate-400 hover:text-white px-3 py-1.5">
              Discard
            </button>
          </div>
        </div>
      )}

      <p className="text-slate-500 text-xs border-t border-slate-700 pt-2">
        Explicit start/stop only — no always-on or background capture. Audio is transcribed on-prem and
        discarded. Structuring only relocates the recorded words; it never adds or rewrites content.
      </p>
    </div>
  );
}
