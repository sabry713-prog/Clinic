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
import { api, type CodingStatus, type OrderCodingStatus, type LinkageStatus, ApiError } from "../../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function CodingQueue({ patientId }: { readonly patientId: string }): JSX.Element {
  const [status, setStatus] = useState<CodingStatus | null>(null);
  const [orderStatus, setOrderStatus] = useState<OrderCodingStatus | null>(null);
  const [linkage, setLinkage] = useState<LinkageStatus | null>(null);
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [cond, ord, lnk] = await Promise.all([
      api.patients.codingStatus(patientId),
      api.patients.orderCodingStatus(patientId),
      api.patients.linkageStatus(patientId),
    ]);
    setStatus(cond);
    setOrderStatus(ord);
    setLinkage(lnk);
  }, [patientId]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchAll();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load coding status");
    } finally {
      setBusy(false);
    }
  }, [fetchAll]);

  const withRow = useCallback(
    async (rowId: string, fn: () => Promise<unknown>) => {
      setRowBusy((prev) => new Set(prev).add(rowId));
      setError(null);
      try {
        await fn();
        await fetchAll();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Coding update failed");
      } finally {
        setRowBusy((prev) => {
          const n = new Set(prev);
          n.delete(rowId);
          return n;
        });
      }
    },
    [fetchAll],
  );

  const unconfirmed = status?.conditions.filter((c) => c.confirmed === null) ?? [];
  const confirmed = status?.conditions.filter((c) => c.confirmed !== null) ?? [];
  const unconfirmedOrders = orderStatus?.orders.filter((o) => o.confirmed === null) ?? [];
  const confirmedOrders = orderStatus?.orders.filter((o) => o.confirmed !== null) ?? [];

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

          {orderStatus !== null && (
            <div className="pt-2 space-y-2">
              <h3 className="text-sm font-medium text-slate-300">SBS coding (orders)</h3>
              {orderStatus.orders.length === 0 && (
                <p className="text-sm text-slate-500">No active orders to code.</p>
              )}

              {unconfirmedOrders.length > 0 && (
                <ul className="space-y-2">
                  {unconfirmedOrders.map((o) => {
                    const isBusy = rowBusy.has(o.service_request_id);
                    return (
                      <li key={o.service_request_id} className="border border-slate-700 bg-slate-950/40 rounded-xl px-4 py-3 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-white" dir="ltr">
                            {o.order_display}
                            <span className="text-xs text-slate-500 ml-2">
                              {o.category} · {formatDate(o.requested_at)}
                            </span>
                          </p>
                          {o.suggestion ? (
                            <p className="text-xs text-slate-400 mt-0.5" dir="ltr">
                              Suggested code:{" "}
                              <span className="font-mono bg-slate-800 rounded px-1.5 py-0.5 text-slate-200">
                                {o.suggestion.sbs_code}
                              </span>{" "}
                              {o.suggestion.sbs_display}
                              <span className="text-slate-600"> — from reference map</span>
                            </p>
                          ) : (
                            <p className="text-xs text-slate-500 mt-0.5">
                              No reference mapping for this order code — manual coding required at claim assembly.
                            </p>
                          )}
                        </div>
                        {o.suggestion && (
                          <button
                            type="button"
                            onClick={() => void withRow(o.service_request_id, () => api.patients.confirmOrderCoding(patientId, o.service_request_id))}
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

              {confirmedOrders.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-1">Confirmed</p>
                  <ul className="space-y-1">
                    {confirmedOrders.map((o) => {
                      const isBusy = rowBusy.has(o.service_request_id);
                      return (
                        <li key={o.service_request_id} className="flex items-center gap-2 text-sm" dir="ltr">
                          <span className="text-white">{o.order_display}</span>
                          <span className="font-mono text-xs bg-slate-800 rounded px-1.5 py-0.5 text-slate-200">
                            {o.confirmed?.sbs_code}
                          </span>
                          <span className="text-xs text-slate-500 truncate">{o.confirmed?.sbs_display}</span>
                          <button
                            type="button"
                            onClick={() => void withRow(o.service_request_id, () => api.patients.unconfirmOrderCoding(patientId, o.service_request_id))}
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
            </div>
          )}

          {linkage !== null && (
            <div className="pt-2 space-y-2">
              <h3 className="text-sm font-medium text-slate-300">Diagnosis linkage (claim items)</h3>
              <p className="text-xs text-slate-500">
                Link each order to the documented diagnosis it supports. The system does not suggest linkages — this is the clinician's association.
              </p>
              {linkage.orders.length === 0 && (
                <p className="text-sm text-slate-500">No active orders to link.</p>
              )}
              <ul className="space-y-2">
                {linkage.orders.map((o) => {
                  const isBusy = rowBusy.has(`link-${o.service_request_id}`);
                  const choice = linkChoice[o.service_request_id] ?? "";
                  return (
                    <li key={o.service_request_id} className="border border-slate-700 bg-slate-950/40 rounded-xl px-4 py-3 space-y-2">
                      <p className="text-sm text-white" dir="ltr">
                        {o.order_display}
                        <span className="text-xs text-slate-500 ml-2">
                          {o.category} · {formatDate(o.requested_at)}
                        </span>
                      </p>
                      {o.linked.length > 0 && (
                        <ul className="space-y-1">
                          {o.linked.map((l) => (
                            <li key={l.condition_id} className="flex items-center gap-2 text-xs" dir="ltr">
                              <span className="text-slate-400">Linked to</span>
                              <span className="text-slate-200 bg-slate-800 rounded px-1.5 py-0.5">{l.condition_display ?? "Unknown"}</span>
                              <button
                                type="button"
                                onClick={() => void withRow(`link-${o.service_request_id}`, () => api.patients.unlinkDiagnosis(patientId, o.service_request_id, l.condition_id))}
                                disabled={isBusy}
                                className="text-slate-500 hover:text-slate-300 underline disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex items-center gap-2">
                        <select
                          value={choice}
                          onChange={(e) => setLinkChoice((prev) => ({ ...prev, [o.service_request_id]: e.target.value }))}
                          className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-200 max-w-72"
                          dir="ltr"
                        >
                          <option value="">Select documented diagnosis…</option>
                          {linkage.available_conditions
                            .filter((c) => !o.linked.some((l) => l.condition_id === c.condition_id))
                            .map((c) => (
                              <option key={c.condition_id} value={c.condition_id}>
                                {c.condition_display ?? "Unknown"} ({formatDate(c.onset_date)})
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => choice && void withRow(`link-${o.service_request_id}`, () => api.patients.linkDiagnosis(patientId, o.service_request_id, choice))}
                          disabled={isBusy || !choice}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                        >
                          {isBusy ? "Linking…" : "Link"}
                        </button>
                      </div>
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
