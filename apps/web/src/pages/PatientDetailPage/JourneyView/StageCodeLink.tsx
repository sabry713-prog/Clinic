/**
 * Stage 4 — Code & link.
 *
 * SBS codes: the deterministic suggestions arrive pre-checked; one
 * "Approve selected codes" confirms them (per-order endpoint, batched
 * behind a single explicit click — the approval gesture CLAUDE.md §2
 * requires).
 *
 * Linkage: fully clinician-chosen (the system never suggests which
 * diagnosis supports which order). Each documented diagnosis renders as a
 * chip annotated with the payer rulebook's verdict for that pair
 * (GREEN/YELLOW/RED — the same information NPHIES badges show after
 * linking, surfaced before the tap). One tap links; Remove undoes.
 *
 * Completion = no unconfirmed SBS suggestions and no unlinked orders.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type OrderCodingStatus,
  type LinkageStatus,
  type LinkageVerdicts,
  ApiError,
} from "../../../lib/api";
import { formatDate } from "../../../lib/dates";

interface StageCodeLinkProps {
  readonly patientId: string;
  readonly onDone: (done: boolean) => void;
  readonly onChanged: () => void;
}

const VERDICT_STYLE: Record<string, string> = {
  GREEN: "border-status-ok-line bg-status-ok-bg",
  YELLOW: "border-status-pend-line bg-status-pend-bg",
  RED: "border-status-rej-line bg-status-rej-bg",
  UNAVAILABLE: "border-line bg-veil",
};

const VERDICT_DOT: Record<string, string> = {
  GREEN: "bg-status-ok",
  YELLOW: "bg-status-pend",
  RED: "bg-status-rej",
  UNAVAILABLE: "bg-ink-faint",
};

export default function StageCodeLink({ patientId, onDone, onChanged }: StageCodeLinkProps): JSX.Element {
  const [coding, setCoding] = useState<OrderCodingStatus | null>(null);
  const [linkage, setLinkage] = useState<LinkageStatus | null>(null);
  const [verdicts, setVerdicts] = useState<LinkageVerdicts | null>(null);
  const [sbsSelected, setSbsSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.patients.orderCodingStatus(patientId).then(setCoding).catch(() => setCoding(null));
    api.patients.linkageStatus(patientId).then(setLinkage).catch(() => setLinkage(null));
    api.patients.linkageVerdicts(patientId).then(setVerdicts).catch(() => setVerdicts(null));
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const unconfirmed = useMemo(
    () => (coding?.orders ?? []).filter((o) => o.confirmed == null && o.suggestion != null),
    [coding],
  );
  const unlinked = useMemo(
    () => (linkage?.orders ?? []).filter((o) => o.linked.length === 0),
    [linkage],
  );

  useEffect(() => {
    onDone(unconfirmed.length === 0 && unlinked.length === 0);
  }, [unconfirmed.length, unlinked.length, onDone]);

  // Pre-check every available suggestion (veto by unchecking).
  useEffect(() => {
    setSbsSelected(new Set(unconfirmed.map((o) => o.service_request_id)));
  }, [unconfirmed]);

  const verdictFor = (orderId: string, conditionId: string): string | null => {
    const hit = verdicts?.pairs.find((p) => p.order_id === orderId && p.condition_id === conditionId);
    return hit ? hit.status : null;
  };

  const approveSelectedCodes = (): void => {
    const chosen = unconfirmed.filter((o) => sbsSelected.has(o.service_request_id));
    if (chosen.length === 0) return;
    setBusy(true); setError(null); setMsg(null);
    Promise.all(chosen.map((o) => api.patients.confirmOrderCoding(patientId, o.service_request_id)))
      .then(() => {
        setMsg(`Approved ${chosen.length} SBS code(s).`);
        setSbsSelected(new Set());
        load();
        onChanged();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to approve codes"))
      .finally(() => setBusy(false));
  };

  const link = (orderId: string, conditionId: string): void => {
    setBusy(true); setError(null);
    api.patients
      .linkDiagnosis(patientId, orderId, conditionId)
      .then(() => { load(); onChanged(); })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to link"))
      .finally(() => setBusy(false));
  };

  return (
    <section aria-label="Stage: Code and link" data-testid="journey-stage-panel-codelink" className="space-y-5">
      <header>
        <h2 className="text-lg font-bold text-ink">4 · Code &amp; link</h2>
        <p className="text-sm text-ink-soft">
          Approve the suggested SBS codes in one click. Link each order to the diagnosis it supports — your call; the colored dots show what the payer rulebook would say about each pair.
        </p>
      </header>

      {/* SBS codes */}
      <div>
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-2">
          SBS codes — proposed by the system, approved by you
        </h3>
        {coding == null ? (
          <p className="text-sm text-ink-faint">Loading coding status…</p>
        ) : unconfirmed.length === 0 ? (
          <p className="text-sm text-status-ok bg-status-ok-bg border border-status-ok-line rounded-xl px-3 py-2" data-testid="sbs-all-confirmed">
            All orders have a clinician-confirmed SBS code.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {unconfirmed.map((o) => (
                <li key={o.service_request_id} className="flex items-center gap-2.5 rounded-xl border border-line bg-mist px-3 py-2">
                  <input
                    type="checkbox"
                    checked={sbsSelected.has(o.service_request_id)}
                    onChange={() =>
                      setSbsSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(o.service_request_id)) next.delete(o.service_request_id);
                        else next.add(o.service_request_id);
                        return next;
                      })
                    }
                    aria-label={`Confirm code for ${o.order_display}`}
                    className="h-4 w-4 accent-brand-indigo"
                  />
                  <span className="min-w-0 flex-1 text-sm text-ink truncate" dir="ltr">
                    <span className="font-medium">{o.order_display}</span>
                    <span className="text-ink-soft text-xs"> → {o.suggestion?.sbs_code} {o.suggestion?.sbs_display}</span>
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={approveSelectedCodes}
              disabled={busy || sbsSelected.size === 0}
              data-testid="approve-selected-codes"
              className="mt-3 px-4 py-2 rounded-full bg-grad-accent text-white text-sm font-semibold shadow-pill hover:brightness-110 disabled:opacity-50 transition-all"
            >
              {busy ? "Approving…" : `Approve selected codes (${sbsSelected.size})`}
            </button>
          </>
        )}
      </div>

      {/* Diagnosis linkage — clinician taps; rulebook verdict dots inform */}
      <div>
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-1">
          Diagnosis linkage — your association; dots = payer rulebook verdict for that pair
        </h3>
        {verdicts != null && !verdicts.graph_available && (
          <p className="mb-2 text-[11px] text-status-pend bg-status-pend-bg border border-status-pend-line rounded-lg px-2.5 py-1.5">
            Necessity graph unreachable — verdict dots hidden (never guessed).
          </p>
        )}
        {linkage == null ? (
          <p className="text-sm text-ink-faint">Loading linkage status…</p>
        ) : unlinked.length === 0 ? (
          <p className="text-sm text-status-ok bg-status-ok-bg border border-status-ok-line rounded-xl px-3 py-2" data-testid="linkage-complete">
            Every order is linked to a documented diagnosis.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {unlinked.map((o) => (
              <li key={o.service_request_id} className="rounded-xl border border-line px-3 py-2.5" data-testid={`linkage-row-${o.service_request_id}`}>
                <p className="text-sm font-medium text-ink mb-1.5" dir="ltr">{o.order_display}</p>
                <div className="flex flex-wrap gap-1.5" dir="ltr">
                  {linkage.available_conditions.map((c) => {
                    const v = verdictFor(o.service_request_id, c.condition_id);
                    const style = v && VERDICT_STYLE[v] ? VERDICT_STYLE[v] : "border-line bg-white";
                    return (
                      <button
                        key={c.condition_id}
                        type="button"
                        disabled={busy}
                        onClick={() => link(o.service_request_id, c.condition_id)}
                        title={v ? `Payer rulebook for this pair: ${v}` : "Payer rulebook verdict not loaded"}
                        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${style} text-ink-deep hover:border-brand-indigo disabled:opacity-50 transition-colors`}
                      >
                        <span className={`h-2 w-2 rounded-full ${v && VERDICT_DOT[v] ? VERDICT_DOT[v] : "bg-ink-faint"}`} aria-hidden="true" />
                        {c.condition_display ?? "Unknown"}
                        <span className="text-ink-faint">({formatDate(c.onset_date, "en")})</span>
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {msg && <p className="text-sm text-status-ok">{msg}</p>}
      {error && <p className="text-sm text-status-rej" role="alert">{error}</p>}
    </section>
  );
}
