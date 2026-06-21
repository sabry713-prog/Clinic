/**
 * NarrativePanel — factual narrative summary with hover-to-source UX.
 *
 * Constraints:
 * - No color-coding of any sentence
 * - No severity indicators
 * - No clinical interpretation language
 * - Bilingual: Arabic RTL / English LTR
 * - Re-generation only on explicit user action
 * - Fallback shown as neutral info box (no alarm styling)
 */

import { useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import type { NarrativeItem, ProvenanceEntry } from "../../lib/api";

export interface NarrativePanelProps {
  readonly patientId: string;
  readonly preferredLanguage?: string;
}

const DISCLAIMER_EN =
  "Auto-generated descriptive summary. Not a clinical interpretation. For clinician review only.";
const DISCLAIMER_AR =
  "ملخص وصفي تلقائي. لا يمثل تفسيراً سريرياً. للمراجعة من قِبَل الطاقم الطبي فقط.";

function splitIntoSentences(text: string): Array<{ start: number; end: number; text: string }> {
  const parts: Array<{ start: number; end: number; text: string }> = [];
  let pos = 0;
  const re = /[.!?]\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const sentence = text.slice(pos, end).trim();
    if (sentence) parts.push({ start: pos, end, text: sentence });
    pos = end;
  }
  const tail = text.slice(pos).trim();
  if (tail) parts.push({ start: pos, end: text.length, text: tail });
  return parts;
}

function findProvenanceForSentence(
  charStart: number,
  charEnd: number,
  provenance: readonly ProvenanceEntry[],
): ProvenanceEntry | null {
  // Find the provenance entry whose char_range overlaps this sentence
  for (const entry of provenance) {
    const [pStart, pEnd] = entry.char_range;
    if (pStart < charEnd && pEnd > charStart) {
      return entry;
    }
  }
  return null;
}

export default function NarrativePanel({ patientId, preferredLanguage }: NarrativePanelProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";

  const [language, setLanguage] = useState<string>(preferredLanguage ?? i18n.language ?? "en");
  const [scope, setScope] = useState<"full" | "current_encounter" | "last_30_days">("full");
  const [isLoading, setIsLoading] = useState(false);
  const [narrative, setNarrative] = useState<NarrativeItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredEntryIndex, setHoveredEntryIndex] = useState<number | null>(null);
  const [sidebarSources, setSidebarSources] = useState<ProvenanceEntry | null>(null);

  const handleGenerate = useCallback(
    (regenerate = false) => {
      setIsLoading(true);
      setError(null);
      api.narrative
        .generate(patientId, { language, scope, regenerate })
        .then((data) => {
          setNarrative(data);
          setHoveredEntryIndex(null);
          setSidebarSources(null);
        })
        .catch((err: unknown) => {
          setError(
            err instanceof Error ? err.message : "Failed to generate narrative",
          );
        })
        .finally(() => setIsLoading(false));
    },
    [patientId, language, scope],
  );

  const disclaimer = language === "ar" ? DISCLAIMER_AR : DISCLAIMER_EN;

  const sentences = narrative?.text ? splitIntoSentences(narrative.text) : [];

  // Provenance coverage — % of sentences with at least one verified source link.
  const coveredCount = narrative
    ? sentences.filter((s) => {
        const p = findProvenanceForSentence(s.start, s.end, narrative.provenance);
        return p !== null && p.sources.length > 0;
      }).length
    : 0;
  const coveragePct = sentences.length ? Math.round((100 * coveredCount) / sentences.length) : 0;

  // Copy-with-citation: the narrative followed by a deduped source reference list.
  const handleCopyWithSources = useCallback(() => {
    if (!narrative?.text) return;
    const seen = new Set<string>();
    const refs: string[] = [];
    for (const p of narrative.provenance) {
      for (const s of p.sources) {
        const key = `${s.type}:${s.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push(`${s.type} ${s.id}`);
        }
      }
    }
    const label = language === "ar" ? "المصادر" : "Sources";
    const body = `${narrative.text}\n\n${label}:\n${refs.map((r, i) => `[${i + 1}] ${r}`).join("\n")}`;
    void navigator.clipboard?.writeText(body);
  }, [narrative, language]);

  return (
    <div
      className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-4"
      dir={isRTL ? "rtl" : "ltr"}
      data-testid="narrative-panel"
    >
      {/* Header + controls */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-slate-200 text-base font-medium">
          {t("narrative.title", "Narrative Summary")}
        </h2>
        <div className="flex gap-2 ml-auto">
          {/* Language selector */}
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
            aria-label={t("narrative.languageLabel", "Language")}
            data-testid="language-select"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          {/* Scope selector */}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            className="bg-slate-800 text-slate-300 text-sm border border-slate-600 rounded px-2 py-1"
            aria-label={t("narrative.scopeLabel", "Scope")}
            data-testid="scope-select"
          >
            <option value="full">{t("narrative.scopeFull", "Full record")}</option>
            <option value="current_encounter">{t("narrative.scopeCurrentEncounter", "Current encounter")}</option>
            <option value="last_30_days">{t("narrative.scopeLast30Days", "Last 30 days")}</option>
          </select>
          {/* Generate button */}
          <button
            onClick={() => handleGenerate(false)}
            disabled={isLoading}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm px-3 py-1 rounded transition-colors"
            data-testid="generate-narrative-btn"
          >
            {isLoading
              ? t("narrative.generating", "Generating…")
              : narrative
              ? t("narrative.regenerate", "Regenerate")
              : t("narrative.generate", "Generate Narrative")}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="text-slate-400 text-sm py-4 text-center" data-testid="loading-state">
          {t("narrative.generatingDescription", "Assembling factual summary…")}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-slate-400 text-sm bg-slate-800 rounded p-3" data-testid="error-message">
          {error}
        </div>
      )}

      {/* Fallback message — neutral info box, no alarm styling */}
      {narrative && !narrative.text && narrative.fallback_message && (
        <div
          className="bg-slate-800 border border-slate-600 rounded p-3 text-slate-300 text-sm"
          data-testid="fallback-message"
        >
          {narrative.fallback_message}
        </div>
      )}

      {/* Narrative text + hover-to-source */}
      {narrative?.text && (
        <div className="flex gap-4">
          {/* Text area */}
          <div className="flex-1 text-slate-200 text-sm leading-relaxed space-y-1" data-testid="narrative-text">
            {sentences.map((sent, idx) => {
              const prov = findProvenanceForSentence(
                sent.start,
                sent.end,
                narrative.provenance,
              );
              const isHovered = hoveredEntryIndex === idx;
              return (
                <span
                  key={idx}
                  onMouseEnter={() => {
                    setHoveredEntryIndex(idx);
                    setSidebarSources(prov);
                  }}
                  onMouseLeave={() => {
                    setHoveredEntryIndex(null);
                    setSidebarSources(null);
                  }}
                  className={`cursor-default ${
                    isHovered
                      ? "bg-slate-700 rounded px-0.5"
                      : "hover:bg-slate-800 rounded px-0.5"
                  }`}
                  data-testid={`narrative-sentence-${idx}`}
                >
                  {sent.text}{" "}
                </span>
              );
            })}
          </div>

          {/* Source sidebar — shown on hover */}
          {sidebarSources && sidebarSources.sources.length > 0 && (
            <div
              className="w-48 shrink-0 bg-slate-800 border border-slate-600 rounded p-2 text-xs text-slate-400 space-y-1"
              data-testid="source-sidebar"
            >
              <p className="text-slate-300 font-medium mb-1">
                {t("narrative.sources", "Sources")}
              </p>
              {sidebarSources.sources.map((src, i) => (
                <div key={i} className="truncate">
                  <span className="text-slate-500">{src.type}:</span>{" "}
                  <span className="text-slate-400 font-mono text-xs">{src.id.slice(0, 8)}…</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Provenance coverage + copy-with-citation */}
      {narrative?.text && (
        <div className="flex items-center gap-3 border-t border-slate-700 pt-2">
          <span
            className="text-xs text-slate-400"
            data-testid="provenance-coverage"
            title={t("narrative.coverageHint", "Sentences linked to a documented source")}
          >
            {t("narrative.coverage", "Provenance")}: {coveredCount}/{sentences.length} ({coveragePct}%)
          </span>
          <button
            onClick={handleCopyWithSources}
            className="text-xs text-blue-400 hover:underline ml-auto"
            data-testid="copy-with-sources"
          >
            {t("narrative.copyWithSources", "Copy with sources")}
          </button>
        </div>
      )}

      {/* Disclaimer — always shown after generation */}
      {narrative && (
        <p
          className="text-slate-500 text-xs border-t border-slate-700 pt-2"
          data-testid="disclaimer"
        >
          {disclaimer}
        </p>
      )}
    </div>
  );
}
