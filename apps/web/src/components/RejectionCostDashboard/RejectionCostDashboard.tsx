/**
 * RejectionCostDashboard — hospital-wide factual dashboard showing estimated
 * SAR at-risk by NPHIES rejection code. Counts only, no interpretation: this
 * shows how many claims were rejected under each code and an estimated cost
 * impact using a fixed average claim value. Admin-only (hospital_admin/sysadmin).
 *
 * DISCLAIMER: The SAR estimates are derived from a fixed average claim value
 * and do not reflect actual payer settlement amounts. Real reimbursement data
 * requires payer settlement feeds.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  type NphiesRejectionAnalytics as Analytics,
  type ClaimSimulationReport,
  ApiError,
} from "../../lib/api";

/** Fixed average claim value in SAR — dashboard mock constant. */
const AVERAGE_CLAIM_VALUE_SAR = 2_500;

function formatSar(value: number): string {
  return new Intl.NumberFormat("en-SA", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function RejectionCostDashboard(): JSX.Element {
  const { t } = useTranslation();
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Prospective view (E3 claim simulator): runs alongside the historical
  // analytics and must never break it — it has its own loading/error state.
  const [simulation, setSimulation] = useState<ClaimSimulationReport | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.admin
      .nphiesRejectionAnalytics()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load rejection analytics"))
      .finally(() => setLoading(false));
  }, []);

  const loadSimulation = useCallback(() => {
    setSimulationError(null);
    api.admin
      .runClaimSimulator()
      .then(setSimulation)
      .catch(() => setSimulationError("unavailable"));
  }, []);

  useEffect(() => {
    load();
    loadSimulation();
  }, [load, loadSimulation]);

  if (loading) {
    return (
      <div className="bg-slate-900 rounded-xl p-6 text-sm text-slate-400">
        Loading rejection cost data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-900 rounded-xl p-6 text-sm text-slate-400">
        <p>{error}</p>
        <button onClick={load} className="mt-2 text-xs text-sky-400 hover:text-sky-300">Retry</button>
      </div>
    );
  }

  if (!data) return <div className="bg-slate-900 rounded-xl p-6 text-sm text-slate-400">No data.</div>;

  const totalRejected = data.rejected_claims;
  const estimatedTotalSar = totalRejected * AVERAGE_CLAIM_VALUE_SAR;
  const totalByCode = data.by_rejection_code.reduce((sum, r) => sum + r.count, 0);
  const maxCodeCount = data.by_rejection_code.length > 0
    ? Math.max(...data.by_rejection_code.map((r) => r.count))
    : 1;

  return (
    <div className="bg-slate-900 rounded-xl p-4 space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          ["Total claims", data.total_claims.toLocaleString("en-SA")],
          ["Rejected claims", totalRejected.toLocaleString("en-SA")],
          ["Rejection rate", `${Math.round(data.rejection_rate * 1000) / 10}%`],
          ["Est. SAR at risk", formatSar(estimatedTotalSar)],
        ] as const).map(([label, val]) => (
          <div key={label} className="bg-slate-800 rounded p-3">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="text-lg font-semibold text-white">{val}</div>
          </div>
        ))}
      </div>

      {/* Prospective — claim simulator (E3). Same estimate basis as the
          historical cards above, but for claims NOT yet sent: flagged
          pre-submission verdicts from the deterministic simulator. */}
      <div className="border border-slate-700 rounded p-3 space-y-2">
        <h3 className="font-medium text-white text-sm">
          {t("rejectionCost.prospectiveTitle")}
        </h3>
        {simulationError !== null ? (
          <p className="text-xs text-slate-500">{t("rejectionCost.prospectiveUnavailable")}</p>
        ) : simulation === null ? (
          <p className="text-xs text-slate-500">{t("rejectionCost.prospectiveLoading")}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-800 rounded p-3">
              <div className="text-xs text-slate-400">{t("rejectionCost.prospectiveChecked")}</div>
              <div className="text-lg font-semibold text-white">
                {simulation.summary.patients_checked.toLocaleString("en-SA")}
              </div>
            </div>
            <div className="bg-slate-800 rounded p-3">
              <div className="text-xs text-slate-400">{t("rejectionCost.prospectiveFlagged")}</div>
              <div className="text-lg font-semibold text-amber-300">
                {simulation.summary.claims_flagged.toLocaleString("en-SA")}
              </div>
            </div>
            <div className="bg-slate-800 rounded p-3">
              <div className="text-xs text-slate-400">{t("rejectionCost.prospectiveRed")}</div>
              <div className="text-lg font-semibold text-red-300">
                {simulation.summary.orders_red.toLocaleString("en-SA")}
              </div>
            </div>
            <div className="bg-slate-800 rounded p-3">
              <div className="text-xs text-slate-400">{t("rejectionCost.prospectiveSar")}</div>
              <div className="text-lg font-semibold text-white">
                {formatSar(simulation.summary.estimated_sar_at_risk)}
              </div>
            </div>
          </div>
        )}
        <p className="text-xs text-slate-500">
          {t("rejectionCost.prospectiveNote")}{" "}
          <a className="underline hover:text-slate-400" href="/admin/claim-simulator">
            {t("rejectionCost.prospectiveLink")}
          </a>
        </p>
      </div>

      {/* Rejection code breakdown */}
      <div>
        <h3 className="font-medium mb-2 text-white text-sm">
          SAR at risk by rejection code
        </h3>
        {data.by_rejection_code.length === 0 ? (
          <p className="text-slate-500 text-sm">No rejections recorded.</p>
        ) : (
          <div className="space-y-2">
            {data.by_rejection_code
              .slice()
              .sort((a, b) => b.count - a.count)
              .map((r) => {
                const sar = r.count * AVERAGE_CLAIM_VALUE_SAR;
                const pctOfRejected = totalByCode > 0 ? (r.count / totalByCode) * 100 : 0;
                return (
                  <div key={r.code} className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs text-slate-300 w-20 shrink-0" title={`Rejection code: ${r.code}`}>
                      {r.code}
                    </span>
                    <div className="flex-1">
                      <div className="h-5 bg-slate-800 rounded relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 bg-slate-500 rounded"
                          style={{ width: `${Math.max(4, (r.count / maxCodeCount) * 100)}%` }}
                        />
                        <span className="absolute inset-y-0 left-2 flex items-center text-xs text-white">
                          {r.count.toLocaleString("en-SA")} claims
                        </span>
                      </div>
                    </div>
                    <span className="text-right text-white w-24 shrink-0">{formatSar(sar)}</span>
                    <span className="text-right text-slate-400 w-16 shrink-0 text-xs">
                      {Math.round(pctOfRejected)}%
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Status breakdown */}
      <div>
        <h3 className="font-medium mb-2 text-white text-sm">Claims by status</h3>
        <table className="w-full text-sm">
          <tbody>
            {data.by_status.map((r) => (
              <tr key={r.status} className="border-b border-slate-800">
                <td className="py-1 pr-2 text-slate-300">{r.status}</td>
                <td className="py-1 text-right text-white">{r.count.toLocaleString("en-SA")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Disclaimer */}
      <div className="bg-slate-800/50 border border-slate-700 rounded p-3 text-xs text-slate-400 space-y-1">
        <p className="font-medium text-slate-300">Estimated — not actual settlement data</p>
        <p>
          SAR values are calculated using a fixed average claim value of{" "}
          {formatSar(AVERAGE_CLAIM_VALUE_SAR)}. Actual reimbursement amounts
          require payer settlement data which is not available in this system.
        </p>
        <p>{data.disclaimer}</p>
      </div>

      {/* Generated timestamp */}
      <p className="text-xs text-slate-500">
        Generated {new Date(data.generated_at).toLocaleString("en-GB")}
        {" · "}Range: {data.range.since ?? "all"} → {data.range.until ?? "all"}
      </p>
    </div>
  );
}
