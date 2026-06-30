/**
 * CopilotBrief
 *
 * Auto-generated factual narrative summary shown at the top of the Copilot
 * panel when it opens with a patient, so the doctor can read the recent
 * documented history before asking questions.
 *
 * - Reuses the existing narrative capability (CLAUDE.md §1.2 — factual
 *   narrative summary). No interpretation; the service-side blocklist remains
 *   the final gate, and a fallback message is shown if it cannot produce a
 *   compliant summary.
 * - Generated once per (patient, language) and cached for the session, so
 *   reopening or toggling the panel does not refire the model.
 * - Collapsible; the doctor can fold it away to focus on Q&A.
 */

import React, { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import type { NarrativeItem } from "../../lib/api";
import GeneratingIndicator from "../common/GeneratingIndicator";

// Session cache so switching patients / reopening the panel does not regenerate.
const briefCache = new Map<string, NarrativeItem>();

interface CopilotBriefProps {
  readonly patientId: string;
  readonly language: "en" | "ar";
}

export default function CopilotBrief({ patientId, language }: CopilotBriefProps): React.ReactElement {
  const { t } = useTranslation();
  const cacheKey = `${patientId}:${language}`;
  const [item, setItem] = useState<NarrativeItem | null>(briefCache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const cached = briefCache.get(cacheKey);
    if (cached) {
      setItem(cached);
      setError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    setItem(null);
    api.narrative
      .generate(patientId, { language, scope: "full" })
      .then((res) => {
        if (cancelled) return;
        briefCache.set(cacheKey, res);
        setItem(res);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId, language, cacheKey]);

  const regenerate = useCallback(() => {
    briefCache.delete(cacheKey);
    setLoading(true);
    setError(false);
    setItem(null);
    api.narrative
      .generate(patientId, { language, scope: "full", regenerate: true })
      .then((res) => {
        briefCache.set(cacheKey, res);
        setItem(res);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [patientId, language, cacheKey]);

  const isRtl = language === "ar";
  const body = item?.text || item?.fallback_message || "";

  return (
    <section
      className="border-b border-gray-200 bg-gray-50/60 shrink-0"
      dir={isRtl ? "rtl" : "ltr"}
      aria-label={t("brief.title", "Patient summary")}
    >
      {/* Header — collapsible */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-100/70 transition-colors"
        aria-expanded={!collapsed}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          {t("brief.title", "Patient summary")}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 max-h-72 overflow-y-auto">
          {loading && (
            <GeneratingIndicator
              label={t("brief.generating", "Summarising the documented record…")}
              variant="light"
              lines={5}
            />
          )}

          {!loading && error && (
            <div className="flex items-center justify-between gap-2 py-2">
              <p className="text-sm text-gray-500">
                {t("brief.error", "Summary unavailable. Open the Narrative tab or review the record directly.")}
              </p>
              <button
                type="button"
                onClick={regenerate}
                className="text-xs text-blue-600 hover:underline shrink-0"
              >
                {t("common.retry", "Retry")}
              </button>
            </div>
          )}

          {!loading && !error && item && (
            <>
              <p className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">{body}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-xs text-gray-400">{item.disclaimer}</p>
                <button
                  type="button"
                  onClick={regenerate}
                  className="text-xs text-blue-600 hover:underline shrink-0"
                  title={t("brief.refresh", "Regenerate summary")}
                >
                  {t("brief.refresh", "Refresh")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
