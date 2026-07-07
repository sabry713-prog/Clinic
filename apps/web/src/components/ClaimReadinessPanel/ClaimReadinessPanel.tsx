/**
 * ClaimReadinessPanel — NPHIES clean-claim checklist.
 *
 * Renders the deterministic administrative checks from the core service:
 * identity completeness, encounter presence, coded diagnoses/orders/meds,
 * ICD-10-AM mapping status, eligibility-connector status.
 *
 * Status colors here mark ADMINISTRATIVE claim completeness (billing
 * paperwork), never clinical severity — no clinical content is colored,
 * flagged, or prioritized anywhere in this panel (CLAUDE.md §2).
 */

import { useCallback, useState } from "react";
import { api, type ClaimReadiness, ApiError } from "../../lib/api";

const STATUS_STYLE: { [K in "pass" | "warning" | "fail"]: { icon: string; cls: string } } = {
  pass: {
    icon: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    cls: "text-emerald-400",
  },
  warning: {
    icon: "M12 9v3.75m0 3.75h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    cls: "text-amber-400",
  },
  fail: {
    icon: "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
    cls: "text-red-400",
  },
};

const OVERALL_LABEL: Record<ClaimReadiness["overall"], string> = {
  ready: "All administrative checks pass",
  issues: "Submittable after resolving warnings",
  blocked: "Blocking issues — claim cannot be assembled yet",
};

export default function ClaimReadinessPanel({ patientId }: { readonly patientId: string }): JSX.Element {
  const [readiness, setReadiness] = useState<ClaimReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReadiness(await api.patients.claimReadiness(patientId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to run claim checks");
    } finally {
      setBusy(false);
    }
  }, [patientId]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">NPHIES Claim Readiness</h2>
        <span className="text-xs text-slate-500">Administrative completeness checks — not billing advice</span>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      {readiness === null ? (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Run claim-completeness checks"}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">{OVERALL_LABEL[readiness.overall]}</p>
          <ul className="space-y-1.5">
            {readiness.checks.map((c) => {
              const style = STATUS_STYLE[c.status];
              return (
                <li key={c.id} className="flex items-start gap-2.5">
                  <svg
                    className={`w-5 h-5 shrink-0 mt-0.5 ${style.cls}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={style.icon} />
                  </svg>
                  <div className="min-w-0">
                    <p className="text-sm text-white">{c.label}</p>
                    <p className="text-xs text-slate-500">{c.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className="text-xs px-2.5 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-50"
            >
              {busy ? "Checking…" : "Re-run checks"}
            </button>
            <span className="text-xs text-slate-600">{readiness.disclaimer}</span>
          </div>
        </div>
      )}
    </div>
  );
}
