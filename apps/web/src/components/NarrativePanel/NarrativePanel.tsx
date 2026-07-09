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

import { useState, useCallback, useRef, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import type { NarrativeItem, PatientRecap, ProvenanceEntry } from "../../lib/api";
import GeneratingIndicator from "../common/GeneratingIndicator";

export interface NarrativePanelProps {
  readonly patientId: string;
  readonly preferredLanguage?: string;
}

const DISCLAIMER_EN =
  "Auto-generated descriptive summary. Not a clinical interpretation. For clinician review only.";
const DISCLAIMER_AR =
  "ملخص وصفي تلقائي. لا يمثل تفسيراً سريرياً. للمراجعة من قِبَل الطاقم الطبي فقط.";

type SegmentKind = "sentence" | "bullet" | "header";
interface Segment { start: number; end: number; text: string; kind: SegmentKind; }

const BULLET_LINE_RE = /^[•\-*]\s+/;
const HEADER_LINE_RE = /^\*\*[^*]+\*\*:?$/;

// Splits narrative text into hoverable segments for the provenance feature.
// Line-aware: a whole bullet line or a whole bolded-header line is one
// segment (list items and headers don't reliably end in sentence
// punctuation); ordinary prose lines are still split sentence-by-sentence as
// before. start/end are char offsets into the ORIGINAL text, unchanged by
// this line-awareness, so provenance char-range matching is unaffected.
function splitIntoSentences(text: string): Segment[] {
  const segments: Segment[] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    const lineStart = pos;
    const trimmed = line.trim();
    if (trimmed === "") {
      pos += line.length + 1;
      continue;
    }
    const leadingWs = line.length - line.replace(/^\s+/, "").length;
    const contentStart = lineStart + leadingWs;
    const contentEnd = lineStart + line.replace(/\s+$/, "").length;

    if (BULLET_LINE_RE.test(trimmed)) {
      // start/end still span the FULL original line (bullet marker included)
      // so provenance char-range matching stays correct; only the displayed
      // text has the marker stripped, since the <li> already renders one.
      segments.push({ start: contentStart, end: contentEnd, text: trimmed.replace(BULLET_LINE_RE, ""), kind: "bullet" });
    } else if (HEADER_LINE_RE.test(trimmed)) {
      segments.push({ start: contentStart, end: contentEnd, text: trimmed, kind: "header" });
    } else {
      const lineText = text.slice(contentStart, contentEnd);
      const re = /[.!?]\s+/g;
      let localPos = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(lineText)) !== null) {
        const end = m.index + m[0].length;
        const sentence = lineText.slice(localPos, end).trim();
        if (sentence) segments.push({ start: contentStart + localPos, end: contentStart + end, text: sentence, kind: "sentence" });
        localPos = end;
      }
      const tail = lineText.slice(localPos).trim();
      if (tail) segments.push({ start: contentStart + localPos, end: contentEnd, text: tail, kind: "sentence" });
    }
    pos += line.length + 1;
  }
  return segments;
}

// Renders inline **bold** markdown segments. No other markdown (italics,
// links) is interpreted — kept deliberately narrow, matching QAConversation.
function renderInline(text: string): JSX.Element[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

// Groups consecutive same-kind segments (a run of bullets, a run of
// sentences) so they render as one <ul> or one flowing paragraph, while
// keeping each segment's own start/end for per-segment hover-to-source.
function groupSegments(segments: Segment[]): Array<{ kind: SegmentKind; segments: Array<Segment & { index: number }> }> {
  const groups: Array<{ kind: SegmentKind; segments: Array<Segment & { index: number }> }> = [];
  segments.forEach((seg, index) => {
    const last = groups[groups.length - 1];
    if (last && last.kind === seg.kind && seg.kind !== "header") {
      last.segments.push({ ...seg, index });
    } else {
      groups.push({ kind: seg.kind, segments: [{ ...seg, index }] });
    }
  });
  return groups;
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
  const [recap, setRecap] = useState<PatientRecap | null>(null);
  const [isLoadingRecap, setIsLoadingRecap] = useState(false);
  const [recapError, setRecapError] = useState<string | null>(null);
  const [showRecap, setShowRecap] = useState(false);

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
          setRecap(null);
          setShowRecap(false);
          setRecapError(null);
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

  const handleToggleRecap = useCallback(() => {
    if (!narrative) return;
    if (recap !== null) {
      setShowRecap((v) => !v);
      return;
    }
    setIsLoadingRecap(true);
    setRecapError(null);
    api.narrative
      .patientRecap(patientId, narrative.id)
      .then((data) => {
        setRecap(data);
        setShowRecap(true);
      })
      .catch((err: unknown) => {
        setRecapError(err instanceof Error ? err.message : "Failed to generate patient recap");
      })
      .finally(() => setIsLoadingRecap(false));
  }, [patientId, narrative, recap]);

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
          {/* Patient-facing plain-language recap toggle */}
          {narrative?.text && (
            <button
              onClick={handleToggleRecap}
              disabled={isLoadingRecap}
              className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-sm px-3 py-1 rounded transition-colors"
              data-testid="patient-recap-toggle"
            >
              {isLoadingRecap
                ? t("narrative.recapLoading", "Restyling…")
                : showRecap
                ? t("narrative.recapShowClinical", "Show clinical summary")
                : t("narrative.recapShow", "Patient recap")}
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <GeneratingIndicator
          label={t("narrative.generatingDescription", "Assembling factual summary…")}
          lines={5}
        />
      )}

      {/* Error */}
      {error && (
        <div className="text-slate-400 text-sm bg-slate-800 rounded p-3" data-testid="error-message">
          {error}
        </div>
      )}

      {recapError && (
        <div className="text-slate-400 text-sm bg-slate-800 rounded p-3" data-testid="recap-error-message">
          {recapError}
        </div>
      )}

      {/* Patient recap — same facts, friendlier prose. Distinct styling so
          it's never confused with the clinical text underneath. */}
      {showRecap && recap && (
        <div className="bg-blue-950/30 border border-blue-800/50 rounded-lg p-4 space-y-2" data-testid="patient-recap">
          {recap.text ? (
            <p className="text-slate-100 text-sm leading-relaxed whitespace-pre-line">{recap.text}</p>
          ) : (
            <p className="text-slate-300 text-sm">{recap.fallback_message}</p>
          )}
          <p className="text-blue-300/70 text-xs border-t border-blue-800/40 pt-2">{recap.disclaimer}</p>
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
      {narrative?.text && !showRecap && (
        <div className="flex gap-4">
          {/* Text area */}
          <div className="flex-1 text-slate-200 text-sm leading-relaxed space-y-2" data-testid="narrative-text">
            {groupSegments(sentences).map((group, gi) => {
              const renderSegment = (seg: Segment & { index: number }) => {
                const prov = findProvenanceForSentence(seg.start, seg.end, narrative.provenance);
                const isHovered = hoveredEntryIndex === seg.index;
                return (
                  <span
                    key={seg.index}
                    onMouseEnter={() => {
                      setHoveredEntryIndex(seg.index);
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
                    data-testid={`narrative-sentence-${seg.index}`}
                  >
                    {renderInline(seg.text)}{" "}
                  </span>
                );
              };

              if (group.kind === "header") {
                return (
                  <p key={gi} className="font-semibold text-slate-100 mt-3 first:mt-0">
                    {renderSegment(group.segments[0]!)}
                  </p>
                );
              }
              if (group.kind === "bullet") {
                return (
                  <ul key={gi} className="list-disc list-inside space-y-1 marker:text-slate-500">
                    {group.segments.map((seg) => (
                      <li key={seg.index}>{renderSegment(seg)}</li>
                    ))}
                  </ul>
                );
              }
              return <p key={gi}>{group.segments.map((seg) => renderSegment(seg))}</p>;
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
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 ml-auto"
            data-testid="copy-with-sources"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
            </svg>
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
