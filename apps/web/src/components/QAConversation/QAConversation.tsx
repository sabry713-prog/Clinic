/**
 * QAConversation
 *
 * Conversational Q&A UI. Constraints:
 * - No severity / alert styling on refused responses (neutral muted style only)
 * - No color-coding of clinical content
 * - Question text is patient-scoped to the patientId prop
 * - Language toggle clears the conversation (different language = new session)
 * - All user-facing strings through i18next
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import type { QAResponse, AnswerSource } from "../../lib/api";

// Plain-language refusal categories (neutral, non-alarming) — E4 trust surface.
// Describes the KIND of question, not a severity. Clinical facts are still
// offered in the answer body via the fact-offer path.
const REFUSAL_LABELS: Record<string, { en: string; ar: string }> = {
  TREND_INTERPRETATION: { en: "trend interpretation", ar: "تفسير اتجاه" },
  DIAGNOSTIC_SUGGESTION: { en: "diagnostic suggestion", ar: "اقتراح تشخيصي" },
  DIFFERENTIAL_DIAGNOSIS: { en: "differential diagnosis", ar: "تشخيص تفريقي" },
  RISK_ASSESSMENT: { en: "risk assessment", ar: "تقييم خطورة" },
  TREATMENT_RECOMMENDATION: { en: "treatment recommendation", ar: "توصية علاجية" },
  MEDICATION_SAFETY_JUDGMENT: { en: "medication-safety judgement", ar: "حكم على سلامة الدواء" },
  REFERRAL_RECOMMENDATION: { en: "referral recommendation", ar: "توصية بالإحالة" },
  LAB_INTERPRETATION: { en: "lab interpretation", ar: "تفسير نتيجة مخبرية" },
  PROGNOSTIC_QUESTION: { en: "prognostic question", ar: "سؤال عن المآل" },
  RED_FLAG_IDENTIFICATION: { en: "red-flag identification", ar: "تحديد إشارات تحذيرية" },
  COMPARATIVE_JUDGMENT: { en: "comparative judgement", ar: "حكم مقارن" },
  OUT_OF_SCOPE: { en: "outside this record's scope", ar: "خارج نطاق هذا السجل" },
  OTHER_INTERPRETIVE: { en: "an interpretive question", ar: "سؤال تفسيري" },
};

function refusalCategoryLabel(category: string | null, isRtl: boolean): string {
  const entry = (category && REFUSAL_LABELS[category]) || REFUSAL_LABELS["OTHER_INTERPRETIVE"]!;
  return isRtl
    ? `النوع: ${entry.ar} — خارج النطاق الواقعي لهذه الأداة.`
    : `Type: ${entry.en} — outside this tool's factual scope.`;
}

interface Turn {
  id: string;
  question: string;
  response: QAResponse;
}

interface QAConversationProps {
  readonly patientId: string;
  readonly language: "en" | "ar";
  readonly onLanguageToggle: () => void;
  /** Optional question to auto-submit once, e.g. typed into the workspace
   * composer before this card was open. Each distinct value submits once. */
  readonly initialQuestion?: string;
}

export default function QAConversation({
  patientId,
  language,
  onLanguageToggle,
  initialQuestion,
}: QAConversationProps): React.ReactElement {
  const { t } = useTranslation();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Question echoed immediately while the answer is generated, so the doctor
  // sees their question during the (reasoning-model) wait instead of a blank.
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const consumedInitialQuestion = useRef<string | null>(null);

  // Clear conversation when patient or language changes
  useEffect(() => {
    setTurns([]);
    setConversationId(null);
    setInput("");
    setError(null);
  }, [patientId, language]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, loading]);

  const toggleSources = useCallback((id: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const submit = useCallback(async (override?: string) => {
    const question = (override ?? input).trim();
    if (!question || loading) return;

    setInput("");
    setLoading(true);
    setPendingQuestion(question);
    setError(null);

    try {
      const response = await api.qa.ask(patientId, {
        question,
        language,
        conversation_id: conversationId,
      });

      // Update conversation ID from first response
      if (!conversationId && response.conversation_id) {
        setConversationId(response.conversation_id);
      }

      setTurns((prev) => [
        ...prev,
        { id: response.interaction_id, question, response },
      ]);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : t("qa.error_generic");
      setError(msg);
    } finally {
      setLoading(false);
      setPendingQuestion(null);
      inputRef.current?.focus();
    }
  }, [input, loading, conversationId, patientId, language, t]);

  // Auto-submit a question handed in from outside (workspace composer),
  // once per distinct value.
  useEffect(() => {
    if (initialQuestion && consumedInitialQuestion.current !== initialQuestion) {
      consumedInitialQuestion.current = initialQuestion;
      void submit(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const handleLanguageToggle = (): void => {
    onLanguageToggle();
    // Conversation cleared by useEffect above when language prop changes
  };

  return (
    <div className="flex flex-col h-full" dir={language === "ar" ? "rtl" : "ltr"}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-800">
          {t("qa.title")}
        </h2>
        <button
          type="button"
          onClick={handleLanguageToggle}
          className="text-sm text-blue-600 hover:underline"
          aria-label={t("qa.toggle_language")}
        >
          {language === "en" ? "عربي" : "English"}
        </button>
      </div>

      {/* Disclaimer — shown once at the top */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
        {t("qa.disclaimer")}
      </div>

      {/* Conversation turns */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {turns.length === 0 && !loading && (
          <p className="text-sm text-gray-400 text-center mt-8">
            {t("qa.empty_state")}
          </p>
        )}

        {turns.map((turn) => (
          <TurnItem
            key={turn.id}
            turn={turn}
            language={language}
            sourcesExpanded={expandedSources.has(turn.id)}
            onToggleSources={() => toggleSources(turn.id)}
            t={t}
          />
        ))}

        {loading && (
          <div className="space-y-2">
            {/* Echo the doctor's question immediately during the wait */}
            {pendingQuestion && (
              <div className={`flex ${language === "ar" ? "justify-start" : "justify-end"}`}>
                <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-blue-600 text-white text-sm opacity-90">
                  {pendingQuestion}
                </div>
              </div>
            )}
            {/* Assistant typing bubble */}
            <div className={`flex ${language === "ar" ? "justify-end" : "justify-start"}`}>
              <div
                className="rounded-2xl px-4 py-3 bg-gray-100 flex items-center gap-2"
                role="status"
                aria-label={t("qa.thinking")}
              >
                <TypingDots />
                <span className="text-xs text-gray-400">{t("qa.thinking")}</span>
              </div>
            </div>
          </div>
        )}

        {error !== null && (
          <p className="text-sm text-gray-700 bg-gray-100 rounded px-3 py-2" role="alert">
            {error}
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={t("qa.placeholder")}
            aria-label={t("qa.input_label")}
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading || input.trim() === ""}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label={t("qa.send")}
          >
            {t("qa.send")}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          {t("qa.enter_hint")}
        </p>
      </div>
    </div>
  );
}

// ── TypingDots ────────────────────────────────────────────────────────────────
//
// Three bouncing dots — a neutral "generating" affordance. Purely cosmetic;
// conveys activity, never clinical meaning.

function TypingDots(): React.ReactElement {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
        />
      ))}
    </span>
  );
}

// ── AnswerBody ────────────────────────────────────────────────────────────────
//
// Renders bulleted answers ("• Label: text" lines) as a structured list with
// a neutral record-type tag per row. All tags share one muted style — no
// color-coding by record type or content. Non-bulleted answers (refusals,
// single-fact answers) render as plain text.

function prettyLabel(raw: string): string {
  const cleaned = raw.replace(/-/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function AnswerBody({ text }: { readonly text: string }): React.ReactElement {
  const lines = text.split("\n");
  const hasBullets = lines.some((l) => l.startsWith("• "));

  if (!hasBullets) {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }

  const preamble = lines.filter((l) => !l.startsWith("• ") && l.trim() !== "");
  const bullets = lines
    .filter((l) => l.startsWith("• "))
    .map((l) => l.slice(2));

  return (
    <div className="space-y-2">
      {preamble.map((line, i) => (
        <p key={`p-${i}`} className="font-medium">
          {line}
        </p>
      ))}
      <ul className="space-y-1.5">
        {bullets.map((item, i) => {
          const match = /^([^:]{2,40}?(?:\([^)]*\))?):\s+(.*)$/s.exec(item);
          return (
            <li key={`b-${i}`} className="flex items-start gap-2">
              {match ? (
                <>
                  <span className="shrink-0 mt-0.5 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 whitespace-nowrap">
                    {prettyLabel(match[1]!)}
                  </span>
                  <span className="min-w-0">{match[2]}</span>
                </>
              ) : (
                <span className="min-w-0">{item}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── TurnItem ──────────────────────────────────────────────────────────────────

interface TurnItemProps {
  readonly turn: Turn;
  readonly language: "en" | "ar";
  readonly sourcesExpanded: boolean;
  readonly onToggleSources: () => void;
  readonly t: (key: string) => string;
}

function TurnItem({
  turn,
  language,
  sourcesExpanded,
  onToggleSources,
  t,
}: TurnItemProps): React.ReactElement {
  const isAllowed = turn.response.classification === "ALLOWED";
  const isRtl = language === "ar";

  return (
    <div className="space-y-2">
      {/* User question — aligned to end */}
      <div className={`flex ${isRtl ? "justify-start" : "justify-end"}`}>
        <div className="max-w-[80%] rounded-2xl px-4 py-2 bg-blue-600 text-white text-sm">
          {turn.question}
        </div>
      </div>

      {/* System response — aligned to start */}
      <div className={`flex ${isRtl ? "justify-end" : "justify-start"}`}>
        <div className="max-w-[85%] space-y-2">
          {/* Response bubble — neutral muted style for both ALLOWED and REFUSED */}
          <div
            className={`rounded-2xl px-4 py-3 text-sm ${
              isAllowed
                ? "bg-gray-100 text-gray-800"
                : "bg-gray-50 text-gray-700 border border-gray-200 italic"
            }`}
            // No red/warning/alert styling for refused — neutral italic is sufficient
          >
            <AnswerBody text={turn.response.answer_text} />
          </div>

          {/* Refusal category in plain language — small, neutral (no alarm).
              Neutral info glyph (an "i", never a warning icon). */}
          {!isAllowed && (
            <p className="flex items-center gap-1 text-xs text-gray-400 px-1">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <span>{refusalCategoryLabel(turn.response.refusal_category, isRtl)}</span>
            </p>
          )}

          {/* Sources toggle — only for ALLOWED responses with sources */}
          {isAllowed && turn.response.sources.length > 0 && (
            <button
              type="button"
              onClick={onToggleSources}
              className="text-xs text-blue-600 hover:underline px-1"
              aria-expanded={sourcesExpanded}
            >
              {sourcesExpanded ? t("qa.hide_sources") : t("qa.show_sources")} (
              {turn.response.sources.length})
            </button>
          )}

          {sourcesExpanded && isAllowed && (
            <SourceList sources={turn.response.sources} t={t} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── SourceList ────────────────────────────────────────────────────────────────

interface SourceListProps {
  readonly sources: readonly AnswerSource[];
  readonly t: (key: string) => string;
}

function SourceList({ sources, t }: SourceListProps): React.ReactElement {
  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <p className="px-3 py-1.5 text-xs font-medium text-gray-500 border-b border-gray-100">
        {t("qa.sources_header")}
      </p>
      <ul className="divide-y divide-gray-50">
        {sources.map((src, i) => (
          <li key={`${src.id}-${i}`} className="px-3 py-2">
            <p className="text-xs text-gray-700 font-medium">{src.fact_segment}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {src.type}
              {src.code ? ` · ${src.code}` : ""}
              {src.source_system ? ` · ${src.source_system}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
