/**
 * InterpreterPanel — Medical Interpreter mode.
 *
 * Translates a short clinician<->patient communication message between
 * languages. This does NOT read or summarize the patient record -- the
 * doctor (or staff) types the message to translate, in either direction.
 * Clinical terms (drug names, lab names, diagnosis names, values) are
 * preserved verbatim in the translated output, never substituted, per
 * CLAUDE.md §8.
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import type { TranslatedMessage } from "../../lib/api";

export interface InterpreterPanelProps {
  readonly patientId: string;
}

const LANGUAGES: readonly { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
  { code: "ur", label: "اردو" },
  { code: "tl", label: "Tagalog" },
  { code: "hi", label: "हिन्दी" },
];

export default function InterpreterPanel({ patientId }: InterpreterPanelProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";

  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [targetLanguage, setTargetLanguage] = useState("ar");
  const [messageText, setMessageText] = useState("");
  const [result, setResult] = useState<TranslatedMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = useCallback(() => {
    const text = messageText.trim();
    if (!text) return;
    setIsLoading(true);
    setError(null);
    setResult(null);
    api.interpreter
      .translate(patientId, { text, sourceLanguage, targetLanguage })
      .then((data) => setResult(data))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to translate message");
      })
      .finally(() => setIsLoading(false));
  }, [patientId, messageText, sourceLanguage, targetLanguage]);

  const handleSwap = useCallback(() => {
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
    setResult(null);
  }, [sourceLanguage, targetLanguage]);

  return (
    <div
      className="bg-white border border-line rounded-lg p-4 space-y-4"
      dir={isRTL ? "rtl" : "ltr"}
      data-testid="interpreter-panel"
    >
      <div className="flex items-center gap-3">
        <h2 className="text-ink-deep text-base font-medium">
          {t("interpreter.title", "Medical Interpreter")}
        </h2>
      </div>

      {/* Language selectors */}
      <div className="flex items-center gap-2">
        <select
          value={sourceLanguage}
          onChange={(e) => setSourceLanguage(e.target.value)}
          className="bg-veil text-ink-deep text-sm border border-line-strong rounded px-2 py-1"
          aria-label={t("interpreter.sourceLanguageLabel", "From")}
          data-testid="source-language-select"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSwap}
          className="text-ink-soft hover:text-ink p-1"
          aria-label={t("interpreter.swapLanguages", "Swap languages")}
          data-testid="swap-languages-btn"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        </button>
        <select
          value={targetLanguage}
          onChange={(e) => setTargetLanguage(e.target.value)}
          className="bg-veil text-ink-deep text-sm border border-line-strong rounded px-2 py-1"
          aria-label={t("interpreter.targetLanguageLabel", "To")}
          data-testid="target-language-select"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </div>

      {/* Message input */}
      <textarea
        value={messageText}
        onChange={(e) => setMessageText(e.target.value)}
        placeholder={t("interpreter.placeholder", "Type a message to translate for the patient…")}
        rows={3}
        className="w-full bg-veil text-ink-deep text-sm border border-line-strong rounded p-2 placeholder-ink-faint focus:outline-none resize-none"
        data-testid="interpreter-message-input"
      />

      <button
        onClick={handleTranslate}
        disabled={isLoading || !messageText.trim()}
        className="bg-white hover:bg-veil border border-line disabled:opacity-50 text-ink-deep text-sm px-3 py-1.5 rounded transition-colors"
        data-testid="translate-btn"
      >
        {isLoading ? t("interpreter.translating", "Translating…") : t("interpreter.translate", "Translate")}
      </button>

      {error && (
        <div className="text-ink-soft text-sm bg-veil rounded p-3" data-testid="interpreter-error">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-agent-cons-bg border border-ev-pill-line rounded-lg p-4 space-y-2" data-testid="translation-result">
          {result.text ? (
            <p className="text-ink text-sm leading-relaxed whitespace-pre-line">{result.text}</p>
          ) : (
            <p className="text-ink-deep text-sm">{result.fallback_message}</p>
          )}
          <p className="text-agent-nph/70 text-xs border-t border-ev-pill-line pt-2">{result.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
