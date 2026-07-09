/**
 * RejectionRiskPanel — "will this get rejected?" checks, modeled on how
 * Sully.ai describes its own AI Medical Coder validation step: "validates
 * code pairs against payer-specific edits" and "predictive denial
 * scoring" from past claim outcomes.
 *
 * Both sections here are deterministic over doctor-confirmed codes:
 * - Pairing compatibility: set-membership lookup, not a clinical judgment.
 * - Historical frequency: plain retrospective counts, not a prediction.
 * Neither suggests a diagnosis or interprets clinical data.
 */

import { useCallback, useState } from "react";
import { api, type RejectionRiskReport, ApiError } from "../../lib/api";

export default function RejectionRiskPanel({ patientId }: { readonly patientId: string }): JSX.Element {
  const [report, setReport] = useState<RejectionRiskReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.patients.rejectionRisk(patientId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load rejection-risk checks");
    } finally {
      setBusy(false);
    }
  }, [patientId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-300">Rejection-risk checks (pairing + history)</h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="text-xs px-2.5 py-1.5 rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-50"
        >
          {busy ? "Loading…" : report === null ? "Run checks" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      {report !== null && (
        <>
          {report.pairings.length === 0 ? (
            <p className="text-sm text-slate-500">No coded, linked diagnosis+procedure pairings yet — confirm codes and link orders first.</p>
          ) : (
            <ul className="space-y-2">
              {report.pairings.map((p) => (
                <li
                  key={`${p.condition_id}-${p.service_request_id}`}
                  className={`border rounded-xl px-4 py-3 ${p.known_valid_pairing ? "border-slate-700 bg-slate-950/40" : "border-amber-700/50 bg-amber-950/20"}`}
                >
                  <p className="text-sm text-white" dir="ltr">
                    <span className="font-mono bg-slate-800 rounded px-1.5 py-0.5 text-xs">{p.icd10am_code}</span>
                    {" "}{p.condition_display} <span className="text-slate-500">+</span>{" "}
                    <span className="font-mono bg-slate-800 rounded px-1.5 py-0.5 text-xs">{p.sbs_code}</span>
                    {" "}{p.order_display}
                  </p>
                  <p className={`text-xs mt-1 ${p.known_valid_pairing ? "text-emerald-400" : "text-amber-400"}`}>
                    {p.known_valid_pairing
                      ? "In the known-valid compatibility table."
                      : "Not found in the known-valid compatibility table — verify before submission."}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {report.history.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1">Historical rejection frequency for these codes (all patients)</p>
              <table className="w-full text-xs">
                <tbody>
                  {report.history.map((h) => (
                    <tr key={`${h.code_type}-${h.code}`} className="border-b border-slate-800">
                      <td className="py-1 pr-2 font-mono text-slate-300">{h.code}</td>
                      <td className="py-1 pr-2 text-slate-500">{h.code_type}</td>
                      <td className="py-1 pr-2 text-slate-300">
                        {h.rejected_claims} of {h.total_claims} past claims rejected ({Math.round(h.rejection_rate * 1000) / 10}%)
                      </td>
                      <td className="py-1 text-slate-500">
                        {h.common_rejection_codes.length > 0 ? `most common: ${h.common_rejection_codes.join(", ")}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-slate-600">{report.disclaimer}</p>
        </>
      )}
    </div>
  );
}
