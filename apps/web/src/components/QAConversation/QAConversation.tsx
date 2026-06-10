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

interface Turn {
  id: string;
  question: string;
  response: QAResponse;
}

interface QAConversationProps {
  readonly patientId: string;
  readonly language: "en" | "ar";
  readonly onLanguageToggle: () => void;
}

export default function QAConversation({
  patientId,
  language,
  onLanguageToggle,
}: QAConversationProps): React.ReactElement {
  const { t } = useTranslation();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const submit = useCallback(async () => {
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    setLoading(true);
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
      inputRef.current?.focus();
    }
  }, [input, loading, conversationId, patientId, language, t]);

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
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span
              className="inline-block w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"
              role="status"
              aria-label={t("common.loading")}
            />
            <span>{t("qa.thinking")}</span>
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
            className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
              isAllowed
                ? "bg-gray-100 text-gray-800"
                : "bg-gray-50 text-gray-700 border border-gray-200 italic"
            }`}
            // No red/warning/alert styling for refused — neutral italic is sufficient
          >
            {turn.response.answer_text}
          </div>

          {/* Classification label — small, neutral */}
          {!isAllowed && (
            <p className="text-xs text-gray-400 px-1">
              {t("qa.factual_only")}
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
