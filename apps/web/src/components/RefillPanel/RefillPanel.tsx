/**
 * RefillPanel — pharmacy operational tasks (gray-area, administrative only).
 *
 * Lists the patient's active, already-documented medications and lets the
 * clinician request a refill for one (routing only — no dose/route/frequency
 * is ever entered or changed here). Below that, the patient's open/closed
 * refill requests with status, and a Cancel action while still "requested".
 * No interaction or dose-appropriateness checking anywhere in this panel
 * (CLAUDE.md §2).
 */

import { useState, useEffect, useCallback } from "react";
import { api, type MedicationItem, type RefillRequest, ApiError } from "../../lib/api";
import HisTransmitControl from "../HisTransmitControl/HisTransmitControl";

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  routed: "Routed to pharmacy",
  filled: "Filled",
  denied: "Denied",
  cancelled: "Cancelled",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function RefillPanel({ patientId }: { readonly patientId: string }): JSX.Element {
  const [medications, setMedications] = useState<MedicationItem[] | null>(null);
  const [requests, setRequests] = useState<RefillRequest[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [meds, reqs] = await Promise.all([
        api.patients.medications(patientId, { status: "active" }),
        api.patients.refillRequests(patientId),
      ]);
      setMedications(meds.data);
      setRequests(reqs.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load medications/refill requests");
    }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const withBusy = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      setBusyIds((prev) => new Set(prev).add(key));
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Action failed");
      } finally {
        setBusyIds((prev) => { const n = new Set(prev); n.delete(key); return n; });
      }
    },
    [refresh],
  );

  // Active medications with no currently-open (requested/routed) refill request.
  const openMedIds = new Set(
    requests.filter((r) => r.status === "requested" || r.status === "routed").map((r) => r.medication_request_id),
  );
  const refillable = medications?.filter((m) => !openMedIds.has(m.id)) ?? [];

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Refill Requests</h2>
        <span className="text-xs text-slate-500">Administrative routing only — no dose or interaction checking</span>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Active medications</h3>
        {medications === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : refillable.length === 0 ? (
          <p className="text-sm text-slate-500">No active medications without an open refill request.</p>
        ) : (
          <ul className="space-y-2">
            {refillable.map((m) => {
              const busy = busyIds.has(m.id);
              return (
                <li key={m.id} className="border border-slate-700 bg-slate-950/40 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate" dir="ltr">{m.medication_display ?? "Unnamed medication"}</p>
                    <p className="text-xs text-slate-500" dir="ltr">
                      {[m.dose, m.route, m.frequency].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void withBusy(m.id, () => api.patients.createRefillRequest(patientId, m.id))}
                    disabled={busy}
                    className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                  >
                    {busy ? "Requesting…" : "Request refill"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <hr className="border-slate-800" />

      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Refill requests</h3>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-500">None yet</p>
        ) : (
          <ul className="space-y-1.5">
            {requests.map((r) => {
              const busy = busyIds.has(r.id);
              return (
                <li key={r.id} className="flex items-center gap-2 text-sm flex-wrap" dir="ltr">
                  <span className="text-white truncate">{r.medication_display}</span>
                  <span className="text-xs text-slate-400 bg-slate-800 rounded px-1.5 py-0.5">
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                  <span className="text-xs text-slate-500">({formatDate(r.requested_at)})</span>
                  {r.pharmacy_note && <span className="text-xs text-slate-500 truncate">— {r.pharmacy_note}</span>}
                  <HisTransmitControl patientId={patientId} sourceType="refill_request" sourceId={r.id} />
                  {r.status === "requested" && (
                    <button
                      type="button"
                      onClick={() => void withBusy(r.id, () => api.patients.cancelRefillRequest(patientId, r.id))}
                      disabled={busy}
                      className="ml-auto text-xs text-slate-500 hover:text-slate-300 underline disabled:opacity-50"
                    >
                      {busy ? "…" : "Cancel"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
