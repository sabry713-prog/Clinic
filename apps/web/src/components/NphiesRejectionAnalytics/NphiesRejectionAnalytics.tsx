/**
 * NphiesRejectionAnalytics — hospital-wide factual dashboard of NPHIES
 * claim outcomes over time. Counts only, no interpretation: this shows
 * what happened to submitted claims (accepted/rejected, which rejection
 * codes, how often per week), not any judgment about why or what to do.
 * Admin-only (hospital_admin/sysadmin), matching the audit summary panel.
 */

import { useCallback, useState } from "react";
import { api, type NphiesRejectionAnalytics as Analytics, ApiError } from "../../lib/api";

function formatWeek(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function NphiesRejectionAnalytics(): JSX.Element {
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(() => {
    setLoading(true);
    setError(null);
    api.admin
      .nphiesRejectionAnalytics({ ...(since ? { since } : {}), ...(until ? { until } : {}) })
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load analytics"))
      .finally(() => setLoading(false));
  }, [since, until]);

  const maxWeekTotal = data ? Math.max(1, ...data.by_week.map((w) => w.total)) : 1;

  return (
    <div className="bg-slate-900 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-sm font-medium text-slate-300">NPHIES rejection analytics</h2>
        <div>
          <label htmlFor="rej-since" className="block text-xs text-slate-400 mb-1">Since</label>
          <input id="rej-since" type="date" value={since} onChange={(e) => setSince(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
        </div>
        <div>
          <label htmlFor="rej-until" className="block text-xs text-slate-400 mb-1">Until</label>
          <input id="rej-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white" />
        </div>
        <button onClick={generate} disabled={loading}
          className="px-3 py-2 text-sm rounded bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50">
          {loading ? "Loading…" : "Generate"}
        </button>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      {data && (
        <div className="space-y-5 text-sm">
          <p className="text-slate-400">
            Range: {data.range.since ?? "all"} → {data.range.until ?? "all"} · generated {new Date(data.generated_at).toLocaleString("en-GB")}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ["Total claims", data.total_claims],
              ["Rejected", data.rejected_claims],
              ["Rejection rate", `${Math.round(data.rejection_rate * 1000) / 10}%`],
              ["Distinct rejection codes", data.by_rejection_code.length],
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-slate-800 rounded p-3">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="text-lg font-semibold text-white">{val}</div>
              </div>
            ))}
          </div>

          <div>
            <h3 className="font-medium mb-2 text-white">Claims per week (rejected shown against total)</h3>
            {data.by_week.length === 0 ? (
              <p className="text-slate-500">No claims in range.</p>
            ) : (
              <div className="flex items-end gap-1 h-32">
                {data.by_week.map((w) => (
                  <div key={w.week} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${formatWeek(w.week)}: ${w.total} total, ${w.rejected} rejected`}>
                    <div className="w-full rounded-t bg-slate-700 relative" style={{ height: `${Math.max(4, (w.total / maxWeekTotal) * 100)}px` }}>
                      {w.rejected > 0 && (
                        <div
                          className="absolute bottom-0 left-0 right-0 rounded-t bg-slate-400"
                          style={{ height: `${(w.rejected / w.total) * 100}%` }}
                        />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500">{formatWeek(w.week)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="font-medium mb-1 text-white">Claims by status</h4>
              <table className="w-full">
                <tbody>
                  {data.by_status.map((r) => (
                    <tr key={r.status} className="border-b border-slate-800">
                      <td className="py-1 pr-2 text-slate-300">{r.status}</td>
                      <td className="py-1 text-right text-white">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 className="font-medium mb-1 text-white">Top rejection codes</h4>
              {data.by_rejection_code.length === 0 ? (
                <p className="text-slate-500">No rejections in range.</p>
              ) : (
                <table className="w-full">
                  <tbody>
                    {data.by_rejection_code.map((r) => (
                      <tr key={r.code} className="border-b border-slate-800">
                        <td className="py-1 pr-2 text-slate-300 font-mono text-xs">{r.code}</td>
                        <td className="py-1 text-right text-white">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-500">{data.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
