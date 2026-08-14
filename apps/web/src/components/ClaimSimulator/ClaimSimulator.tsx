/**
 * ClaimSimulator — "check before you send" across the seeded claim batch (E3).
 *
 * Administrative claim-integrity surface only (CLAUDE.md §2): every verdict
 * is billing paperwork (completeness, coding, documented necessity rules) —
 * colors mark claim states, never anything about a patient's condition. The
 * simulation is read-only: nothing is submitted to any payer from here.
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type ClaimSimulationReport, type SimulatorPatientVerdict, type SimulatorVerdict, type NecessityStatus, ApiError } from "../../lib/api";
import EvidenceChainPopover from "../ai-team/EvidenceChainPopover";

const VERDICT_STYLE: Record<SimulatorVerdict, { cls: string; key: string }> = {
  send: { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", key: "claimSim.verdictSend" },
  fix_before_send: { cls: "bg-amber-500/15 text-amber-300 border-amber-500/30", key: "claimSim.verdictFix" },
  do_not_send: { cls: "bg-red-500/15 text-red-300 border-red-500/30", key: "claimSim.verdictDoNotSend" },
};

const NECESSITY_STYLE: Record<NecessityStatus, string> = {
  GREEN: "text-emerald-400",
  YELLOW: "text-amber-400",
  RED: "text-red-400",
  UNAVAILABLE: "text-slate-500",
};

/** The graph's own chain, or null — the popover is only offered when the
 * graph actually sent one (UNAVAILABLE verdicts carry none, honestly). */
function chainOfNecessity(n: SimulatorPatientVerdict["necessity"][number]) {
  const chain = n.evidence_chain;
  if (!chain) return null;
  return { steps: chain.steps, rendered: chain.rendered, ...(chain.cypher ? { cypher: chain.cypher } : {}) };
}

function formatSar(value: number): string {
  return new Intl.NumberFormat("en-SA").format(value);
}

function PatientRow({ patient }: { readonly patient: SimulatorPatientVerdict }): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const verdict = VERDICT_STYLE[patient.verdict];
  return (
    <>
      <tr className="border-t border-slate-800 hover:bg-slate-800/40">
        <td className="px-3 py-2 font-mono text-xs text-slate-300">{patient.mrn ?? "—"}</td>
        <td className="px-3 py-2 text-sm text-slate-200">{patient.display_name ?? "—"}</td>
        <td className="px-3 py-2 text-xs text-slate-400">
          {patient.historical_rejections}/{patient.historical_claims}
        </td>
        <td className="px-3 py-2">
          <span className={`inline-block rounded border px-2 py-0.5 text-xs ${verdict.cls}`}>
            {t(verdict.key)}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-slate-400">
          {patient.necessity.length === 0
            ? "—"
            : patient.necessity.map((n) => {
                const chain = chainOfNecessity(n);
                return (
                  <span key={`${n.order_id}-${n.icd10_code}`} className="me-1 inline-flex items-center gap-1">
                    <span className={`font-mono ${NECESSITY_STYLE[n.status]}`} dir="ltr">
                      {n.icd10_code}→{n.sbs_code} {n.status}
                    </span>
                    {chain && (
                      <EvidenceChainPopover
                        evidenceChain={chain}
                        triggerLabel={t("claimSim.evidence")}
                        title={t("claimSim.necessityTitle", { code: `${n.icd10_code}→${n.sbs_code}` })}
                      />
                    )}
                  </span>
                );
              })}
        </td>
        <td className="px-3 py-2 text-end">
          <button
            type="button"
            onClick={() => {
              setOpen(!open);
            }}
            className="text-xs text-slate-400 hover:text-white underline"
            aria-expanded={open}
          >
            {open ? t("claimSim.hideChecks") : t("claimSim.showChecks")}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-800 bg-slate-900/60">
          <td colSpan={6} className="px-3 py-2">
            <p className="text-xs text-slate-400 mb-1">
              {t("claimSim.readinessLabel")}: <span className="font-mono">{patient.readiness_overall}</span>
            </p>
            {patient.failed_checks.length > 0 && (
              <p className="text-xs text-red-300 mb-1">
                {t("claimSim.failedChecks")}: <span className="font-mono">{patient.failed_checks.join(", ")}</span>
              </p>
            )}
            {patient.warning_checks.length > 0 && (
              <p className="text-xs text-amber-300 mb-1">
                {t("claimSim.warningChecks")}: <span className="font-mono">{patient.warning_checks.join(", ")}</span>
              </p>
            )}
            {patient.necessity
              .filter((n) => n.suggested_codes.length > 0)
              .map((n) => (
                <p key={`sug-${n.order_id}-${n.icd10_code}`} className="text-xs text-slate-400">
                  {t("claimSim.suggestedDx", { code: `${n.icd10_code}→${n.sbs_code}` })}:{" "}
                  <span className="font-mono">{n.suggested_codes.map((s) => s.icd10).join(", ")}</span>
                </p>
              ))}
          </td>
        </tr>
      )}
    </>
  );
}

export default function ClaimSimulator(): JSX.Element {
  const { t } = useTranslation();
  const [report, setReport] = useState<ClaimSimulationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setReport(await api.admin.runClaimSimulator());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("claimSim.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const syncQueue = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await api.admin.syncCoderQueue();
      setMessage(
        t("claimSim.synced", {
          added: result.added,
          preserved: result.preserved,
          removed: result.removed,
          size: result.queue_size,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("claimSim.errorGeneric"));
    } finally {
      setSyncing(false);
    }
  }, [t]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-white">{t("claimSim.title")}</h2>
          <p className="text-xs text-slate-500">{t("claimSim.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="text-sm px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
          >
            {busy ? t("claimSim.running") : report ? t("claimSim.rerun") : t("claimSim.run")}
          </button>
          <button
            type="button"
            onClick={() => void syncQueue()}
            disabled={syncing || report === null}
            className="text-sm px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
            title={report === null ? t("claimSim.syncDisabledHint") : undefined}
          >
            {syncing ? t("claimSim.syncing") : t("claimSim.syncQueue")}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {message && <p className="text-sm text-emerald-300">{message}</p>}

      {report && (
        <div className="space-y-4">
          {!report.graph_available && (
            <p className="text-xs text-amber-300 border border-amber-500/30 rounded p-2">
              {t("claimSim.graphUnavailable")}
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-800/60 rounded p-3">
              <p className="text-xs text-slate-400">{t("claimSim.cardChecked")}</p>
              <p className="text-xl font-semibold text-white">{report.summary.patients_checked}</p>
            </div>
            <div className="bg-slate-800/60 rounded p-3">
              <p className="text-xs text-slate-400">{t("claimSim.cardFlagged")}</p>
              <p className="text-xl font-semibold text-amber-300">
                {report.summary.fix_before_send + report.summary.do_not_send}
              </p>
            </div>
            <div className="bg-slate-800/60 rounded p-3">
              <p className="text-xs text-slate-400">{t("claimSim.cardRed")}</p>
              <p className="text-xl font-semibold text-red-300">{report.summary.orders_red}</p>
            </div>
            <div className="bg-slate-800/60 rounded p-3">
              <p className="text-xs text-slate-400">{t("claimSim.cardSar")}</p>
              <p className="text-xl font-semibold text-white">
                {formatSar(report.summary.estimated_sar_at_risk)} <span className="text-xs text-slate-400">SAR</span>
              </p>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-800 rounded">
            <table className="w-full text-start">
              <thead>
                <tr className="text-xs text-slate-500 bg-slate-800/40">
                  <th className="px-3 py-2 text-start font-medium">{t("claimSim.colMrn")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("claimSim.colPatient")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("claimSim.colHistory")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("claimSim.colVerdict")}</th>
                  <th className="px-3 py-2 text-start font-medium">{t("claimSim.colNecessity")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {report.patients.map((p) => (
                  <PatientRow key={p.patient_id} patient={p} />
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-600">{report.disclaimer}</p>
          <p className="text-xs text-slate-600">
            {t("claimSim.sarNote", { value: formatSar(report.summary.average_claim_value_sar) })}{" "}
            <a className="underline hover:text-slate-400" href="/admin/rejection-cost">
              {t("claimSim.rejectionCostLink")}
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
