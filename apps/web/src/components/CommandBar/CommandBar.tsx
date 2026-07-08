/**
 * CommandBar — centered command palette (Ctrl/Cmd+K).
 *
 * Routes typed input to existing, doctor-controlled features:
 *  - free text → patient search (name / MRN)
 *  - active-patient quick actions → deep-link into a workspace card
 *
 * Constraints (non-SaMD boundary — see CLAUDE.md):
 * - Navigation and retrieval only. Nothing executes clinical actions;
 *   all writes stay behind their existing confirm flows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, type PatientSummary } from "../../lib/api";
import { useCopilot } from "../../context/CopilotContext";

interface CommandBarProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

interface ActionItem {
  readonly id: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly run: () => void;
}

const CARD_ACTIONS = ["qa", "diagnosis", "narrative", "handoff", "draft", "orders", "claims", "search"] as const;
const CARD_LABEL_KEY: Record<(typeof CARD_ACTIONS)[number], string> = {
  qa: "shell.tabs.qa",
  diagnosis: "shell.cards.diagnosis",
  narrative: "shell.tabs.narrative",
  handoff: "shell.tabs.handoff",
  draft: "shell.cards.draft",
  orders: "shell.cards.orders",
  claims: "shell.cards.claims",
  search: "shell.tabs.search",
};

export default function CommandBar({ open, onClose }: CommandBarProps): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activePatientId, activePatientName } = useCopilot();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelected(0);
      // Focus after the overlay renders.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced patient search.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      api.patients
        .list({ q: query.trim(), limit: 8 })
        .then((r) => setResults(r.data))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, open]);

  const quickActions: ActionItem[] = useMemo(() => {
    if (!activePatientId || query.trim().length >= 2) return [];
    const items: ActionItem[] = CARD_ACTIONS.map((card) => ({
      id: `card-${card}`,
      label: t(CARD_LABEL_KEY[card]),
      hint: activePatientName ?? undefined,
      run: () => void navigate(`/patients/${activePatientId}?view=workspace&open=${card}`),
    }));
    items.push({
      id: "chart",
      label: t("shell.patientFile"),
      hint: activePatientName ?? undefined,
      run: () => void navigate(`/patients/${activePatientId}?view=chart`),
    });
    return items;
  }, [activePatientId, activePatientName, query, t, navigate]);

  const rows: ActionItem[] = useMemo(() => {
    const patientRows: ActionItem[] = results.map((p) => ({
      id: `patient-${p.id}`,
      label: p.display_name ?? p.mrn ?? p.id,
      hint: `${p.mrn ?? ""}${p.ward ? ` · ${p.ward}` : ""}`,
      run: () => void navigate(`/patients/${p.id}`),
    }));
    return [...patientRows, ...quickActions];
  }, [results, quickActions, navigate]);

  const runRow = useCallback(
    (row: ActionItem | undefined): void => {
      if (!row) return;
      row.run();
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh] bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("shell.commandBar")}
    >
      <div
        className="w-full max-w-xl mx-4 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Context chip + input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
          <svg className="w-5 h-5 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          {activePatientName && query.trim().length < 2 && (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-blue-600/20 text-blue-300 text-xs px-2.5 py-1" dir="ltr">
              {activePatientName}
            </span>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, rows.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter") runRow(rows[selected]);
            }}
            placeholder={t("shell.commandPlaceholder")}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
          <kbd className="shrink-0 text-[10px] text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {searching && (
            <p className="px-4 py-2 text-sm text-slate-500">{t("common.loading")}</p>
          )}
          {!searching && rows.length === 0 && (
            <p className="px-4 py-2 text-sm text-slate-500">
              {query.trim().length >= 2 ? t("shell.noResults") : t("shell.commandHint")}
            </p>
          )}
          {rows.map((row, i) => (
            <button
              key={row.id}
              onClick={() => runRow(row)}
              onMouseEnter={() => setSelected(i)}
              className={`
                w-full flex items-center justify-between gap-3 px-4 py-2 text-start text-sm transition-colors
                ${i === selected ? "bg-slate-800 text-white" : "text-slate-300"}
              `}
            >
              <span className="truncate">{row.label}</span>
              {row.hint && <span className="text-xs text-slate-500 truncate" dir="ltr">{row.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
