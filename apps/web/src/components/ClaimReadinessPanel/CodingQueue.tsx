/**
 * CodingQueue — ICD-10-AM coding confirmation for documented conditions.
 *
 * Each card shows a doctor-documented condition, its SNOMED code, and the
 * deterministic reference-map ICD-10-AM suggestion. The clinician confirms
 * (or removes a confirmation). Nothing enters the claim path without an
 * explicit confirmation; conditions with no reference mapping say so
 * honestly instead of guessing.
 */

import { useCallback, useState } from "react";
import { api, type CodingStatus, ApiError } from "../../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function CodingQueue({ patientId }: { readonly patientId: string }): JSX.Element {
  const [status, setStatus] = useState<CodingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.patients.codingStatus(patientId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load coding status");
    } finally {
      setBusy(false);
    }
  }, [patientId]);

  const withRow = useCallback(
    async (conditionId: string, fn: () => Promise<unknown>) => {
      setRowBusy((prev) => new Set(prev).add(conditionId));
      setError(null);
      try {
        await fn();
        setStatus(await api.patients.codingStatus(patientId));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Coding update failed");
      } finally {
        setRowBusy((prev) => {
          const n = new Set(prev);
          n.delete(conditionId);
          return n;
        });
      }
    },
    [patientId],
  );

  const unconfirmed = status?.conditions.filter((c) => c.confirmed === null) ?? [];
  const confirmed = status?.conditions.filter((c) => c.confirmed !== null) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">ICD-10-AM coding (claim vocabulary)</h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="text-xs px-2.5 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-50"
        >
          {busy ? "Loading…" : status === null ? "Load coding status" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      {status !== null && (
        <>
          {status.conditions.length === 0 && (
            <p className="text-sm text-slate-500">No active documented conditions to code.</p>
          )}

          {unconfirmed.length > 0 && (
            <ul className="space-y-2">
              {unconfirmed.map((c) => {
                const isBusy = rowBusy.has(c.condition_id);
                return (
                  <li key={c.condition_id} className="border border-slate-700 bg-slate-950/40 rounded-xl px-4 py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white" dir="ltr">
                        {c.condition_display ?? "Unknown condition"}
                        <span className="text-xs text-slate-500 ml-2">
                          SNOMED {c.snomed_code ?? "—"} · onset {formatDate(c.onset_date)}
                        </span>
                      </p>
                      {c.suggestion ? (
                        <p className="text-xs text-slate-400 mt-0.5" dir="ltr">
                          Suggested code:{" "}
                          <span className="font-mono bg-slate-800 rounded px-1.5 py-0.5 text-slate-200">
                            {c.suggestion.icd10am_code}
                          </span>{" "}
                          {c.suggestion.icd10am_display}
                          <span className="text-slate-600"> — from reference map</span>
                        </p>
                      ) : (
                        <p className="text-xs text-slate-500 mt-0.5">
                          No reference mapping for this SNOMED code — manual coding required at claim assembly.
                        </p>
                      )}
                    </div>
                    {c.suggestion && (
                      <button
                        type="button"
                        onClick={() => void withRow(c.condition_id, () => api.patients.confirmCoding(patientId, c.condition_id))}
                        disabled={isBusy}
                        className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                      >
                        {isBusy ? "Confirming…" : "Confirm code"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {confirmed.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1">Confirmed</p>
              <ul className="space-y-1">
                {confirmed.map((c) => {
                  const isBusy = rowBusy.has(c.condition_id);
                  return (
                    <li key={c.condition_id} className="flex items-center gap-2 text-sm" dir="ltr">
                      <span className="text-white">{c.condition_display}</span>
                      <span className="font-mono text-xs bg-slate-800 rounded px-1.5 py-0.5 text-slate-200">
                        {c.confirmed?.icd10am_code}
                      </span>
                      <span className="text-xs text-slate-500 truncate">{c.confirmed?.icd10am_display}</span>
                      <button
                        type="button"
                        onClick={() => void withRow(c.condition_id, () => api.patients.unconfirmCoding(patientId, c.condition_id))}
                        disabled={isBusy}
                        className="text-xs text-slate-500 hover:text-slate-300 underline disabled:opacity-50"
                      >
                        {isBusy ? "…" : "Remove"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <p className="text-xs text-slate-600">{status.disclaimer}</p>
        </>
      )}
    </div>
  );
}
