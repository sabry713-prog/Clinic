/**
 * ComplianceReport (E5) — DPO-facing audit summary for a date range.
 * Renders the /admin/audit/summary aggregates; "Print" → browser print-to-PDF.
 * IDs/codes and counts only — no PHI free-text.
 */

import { useState, useCallback } from "react";
import { api, type AuditSummary, ApiError } from "../../lib/api";

export default function ComplianceReport(): JSX.Element {
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [data, setData] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(() => {
    setLoading(true); setError(null);
    api.admin
      .auditSummary({ ...(since ? { since } : {}), ...(until ? { until } : {}) })
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load summary"))
      .finally(() => setLoading(false));
  }, [since, until]);

  return (
    <div className="bg-slate-900 rounded-xl p-4 space-y-4 print:bg-white print:text-black">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <h2 className="text-sm font-medium text-slate-300">Compliance summary (DPO)</h2>
        <div>
          <label htmlFor="compliance-since" className="block text-xs text-slate-400 mb-1">Since</label>
          <input id="compliance-since" type="date" value={since} onChange={(e) => setSince(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
        </div>
        <div>
          <label htmlFor="compliance-until" className="block text-xs text-slate-400 mb-1">Until</label>
          <input id="compliance-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
        </div>
        <button onClick={generate} disabled={loading}
          className="px-3 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50">
          {loading ? "Generating…" : "Generate"}
        </button>
        {data && (
          <button onClick={() => window.print()}
            className="px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white ml-auto">
            Print / PDF
          </button>
        )}
      </div>

      {error && <p className="text-sm text-slate-400 print:hidden">{error}</p>}

      {data && (
        <div className="space-y-4 text-sm">
          <div>
            <h3 className="text-base font-semibold">Audit Compliance Report</h3>
            <p className="text-slate-400 print:text-gray-600">
              Range: {data.range.since ?? "all"} → {data.range.until ?? "all"} · generated {new Date(data.generated_at).toLocaleString("en-GB")}
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ["Total events", data.total_events],
              ["Distinct actors", data.distinct_actors],
              ["Patients accessed", data.distinct_patients_accessed],
              ["Integrity", data.integrity.verified ? "✓ verified" : `✗ ${data.integrity.violations} issue(s)`],
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-slate-800 rounded p-3 print:bg-gray-100">
                <div className="text-xs text-slate-400 print:text-gray-600">{label}</div>
                <div className="text-lg font-semibold">{val}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium mb-1">Events by action</h4>
              <table className="w-full">
                <tbody>
                  {data.by_action.map((r) => (
                    <tr key={r.action} className="border-b border-slate-800 print:border-gray-200">
                      <td className="py-1 pr-2">{r.action}</td>
                      <td className="py-1 text-right">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="font-medium mb-1">Events by outcome</h4>
              <table className="w-full">
                <tbody>
                  {data.by_outcome.map((r) => (
                    <tr key={r.outcome} className="border-b border-slate-800 print:border-gray-200">
                      <td className="py-1 pr-2">{r.outcome}</td>
                      <td className="py-1 text-right">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-slate-500 print:text-gray-500">
            Aggregates only — no patient free-text. Hash-chain integrity: {data.integrity.verified ? "verified" : "FAILED"}.
          </p>
        </div>
      )}
    </div>
  );
}
