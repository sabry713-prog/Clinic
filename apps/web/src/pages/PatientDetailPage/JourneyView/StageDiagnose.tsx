/**
 * Stage 2 — Diagnose. The SOAP assessment is analyzed on entry (existing
 * deterministic suggester + spelling assist); already-documented problems
 * are shown as on-file (nothing to do). The clinician taps suggestions to
 * select, one "Add selected" creates them (suggest→confirm unchanged).
 * Completion = the record already has at least one active diagnosis.
 */

import { useEffect, useMemo, useState } from "react";
import { api, type PatientDetail, type CodedTerm, ApiError } from "../../../lib/api";

interface StageDiagnoseProps {
  readonly patient: PatientDetail;
  readonly onDone: (done: boolean) => void;
  readonly onChanged: () => void;
}

function readSoapAssessment(patientId: string): string {
  try {
    const raw = sessionStorage.getItem(`sully.scribe.${patientId}`);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { soap?: Partial<Record<"assessment" | "plan", string>> };
    return [parsed.soap?.assessment, parsed.soap?.plan]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .join(" ");
  } catch {
    return "";
  }
}

export default function StageDiagnose({ patient, onDone, onChanged }: StageDiagnoseProps): JSX.Element {
  const documented = patient.conditions ?? [];
  const [candidates, setCandidates] = useState<readonly CodedTerm[]>([]);
  const [didYouMean, setDidYouMean] = useState<readonly CodedTerm[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [analyzed, setAnalyzed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const assessment = useMemo(() => readSoapAssessment(patient.id), [patient.id]);
  const hasDocumentedDiagnosis = documented.length > 0;

  useEffect(() => {
    onDone(hasDocumentedDiagnosis);
  }, [hasDocumentedDiagnosis, onDone]);

  // Auto-analyze once on entry: the SOAP assessment is the natural source.
  useEffect(() => {
    if (analyzed || !assessment) return;
    setAnalyzed(true);
    api.patients
      .suggestCodes(assessment)
      .then((r) => {
        setCandidates(r.suggestions);
        setDidYouMean(r.did_you_mean ?? []);
        setSelected(new Set(r.suggestions.map((t) => t.code)));
      })
      .catch(() => {
        /* analysis is a convenience — manual entry still works below */
      });
  }, [analyzed, assessment]);

  const toggle = (code: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const addSelected = (): void => {
    if (selected.size === 0) return;
    setBusy(true); setError(null); setMsg(null);
    const chosen = candidates.filter((t) => selected.has(t.code));
    Promise.all(chosen.map((t) => api.patients.addCondition(patient.id, { code: t.code, code_display: t.code_display, status: "active" })))
      .then(() => {
        setMsg(`Added ${chosen.length} diagnosis(es) to the problem list.`);
        setCandidates([]); setSelected(new Set());
        onChanged();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to add diagnosis"))
      .finally(() => setBusy(false));
  };

  return (
    <section aria-label="Stage: Diagnose" data-testid="journey-stage-panel-diagnose" className="space-y-4">
      <header>
        <h2 className="text-lg font-bold text-ink">2 · Diagnoses</h2>
        <p className="text-sm text-ink-soft">
          The SOAP assessment was analyzed automatically. Confirm what belongs on the problem list — you author the diagnosis and confirm its code.
        </p>
      </header>

      <div>
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-2">
          On file — {documented.length} documented diagnosis(es)
        </h3>
        {documented.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" dir="ltr">
            {documented.slice(0, 10).map((c) => (
              <li key={c.id} className="text-xs px-2.5 py-1 rounded-full border border-line bg-mist text-ink-deep">
                {c.code_display ?? "Unknown"}
                <span className="text-ink-faint"> · {c.status ?? ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">No documented diagnoses yet — add from the suggestions below.</p>
        )}
      </div>

      {assessment && candidates.length > 0 && (
        <div>
          <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-1">
            Suggested from this encounter's assessment — proposed by the system, approved by you
          </h3>
          <ul className="space-y-1.5">
            {candidates.map((t) => (
              <li key={t.code}>
                <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
                  <input type="checkbox" checked={selected.has(t.code)} onChange={() => toggle(t.code)} className="h-4 w-4 accent-brand-indigo" />
                  <span className="font-medium">{t.code_display}</span>
                  <span className="font-mono text-[11px] text-ink-faint">{t.code}</span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addSelected}
            disabled={busy || selected.size === 0}
            className="mt-3 px-4 py-2 rounded-full bg-grad-accent text-white text-sm font-semibold shadow-pill hover:brightness-110 disabled:opacity-50 transition-all"
          >
            {busy ? "Adding…" : `Add selected (${selected.size})`}
          </button>
        </div>
      )}

      {assessment && candidates.length === 0 && didYouMean.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-soft">Closest vocabulary terms for the assessment wording:</span>
          {didYouMean.map((t) => (
            <span key={t.code} className="text-xs px-2.5 py-1 rounded-full border border-line bg-white text-ink-deep">
              {t.code_display}
            </span>
          ))}
          <span className="text-[11px] text-ink-faint">— add via the Diagnosis card if clinically intended.</span>
        </div>
      )}

      {!assessment && (
        <p className="text-sm text-status-pend bg-status-pend-bg border border-status-pend-line rounded-xl px-3 py-2">
          No SOAP draft found for this encounter — record in stage 1, or manage diagnoses from the Diagnosis card.
        </p>
      )}

      {msg && <p className="text-sm text-status-ok" data-testid="diagnose-msg">{msg}</p>}
      {error && <p className="text-sm text-status-rej" role="alert">{error}</p>}
    </section>
  );
}
