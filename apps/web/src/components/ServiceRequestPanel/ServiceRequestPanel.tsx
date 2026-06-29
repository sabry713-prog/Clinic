/**
 * ServiceRequestPanel — turn a clinician's DOCUMENTED orders into structured
 * service requests.
 *
 * Flow: extract candidate services from the doctor's notes/orders → the doctor
 * reviews each (with the verbatim source excerpt) and confirms → selected
 * orders are created. The system never decides or suggests a service: every
 * candidate is a verbatim extraction of something the doctor already wrote.
 */

import { useState, useEffect, useCallback } from "react";
import { api, type ServiceCandidate, type ServiceRequestItem, ApiError } from "../../lib/api";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function keyOf(c: ServiceCandidate): string {
  return c.code ?? c.code_display;
}

export default function ServiceRequestPanel({ patientId }: { readonly patientId: string }): JSX.Element {
  const [candidates, setCandidates] = useState<ServiceCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [existing, setExisting] = useState<ServiceRequestItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.patients.serviceRequests(patientId).then((r) => setExisting(r.data)).catch(() => { /* silent */ });
  }, [patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  const extract = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const { data } = await api.patients.serviceRequestCandidates(patientId);
      setCandidates(data);
      setSelected(new Set(data.map(keyOf))); // default: all checked
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to extract requested services");
    } finally { setBusy(false); }
  }, [patientId]);

  const toggle = (k: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const create = useCallback(async () => {
    if (!candidates) return;
    const items = candidates.filter((c) => selected.has(keyOf(c)));
    if (items.length === 0) return;
    setBusy(true); setError(null);
    try {
      await api.patients.createServiceRequests(patientId, items);
      setCandidates(null); setSelected(new Set());
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create service requests");
    } finally { setBusy(false); }
  }, [candidates, selected, patientId, refresh]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Service Requests</h2>
        <span className="text-xs text-slate-500">From the doctor's documented orders — confirm before creating</span>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      {/* Existing requests */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Created requests</h3>
        {existing.length === 0 ? (
          <p className="text-sm text-slate-500">None yet</p>
        ) : (
          <ul className="space-y-1">
            {existing.map((s) => (
              <li key={s.id} className="text-sm text-white" dir="ltr">
                <span className="inline-block rounded bg-slate-700 text-slate-200 text-xs px-1.5 py-0.5 mr-2">{s.category}</span>
                {s.code_display}
                <span className="text-slate-500 ml-2">({s.status}, {formatDate(s.requested_at)})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <hr className="border-slate-800" />

      {/* Extraction + confirmation */}
      {candidates === null ? (
        <button
          type="button"
          onClick={() => void extract()}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
        >
          {busy ? "Reading orders…" : "Extract requested services from notes"}
        </button>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-slate-500">No documented service requests found in this patient's notes.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            Review each documented request and confirm. Only checked items are created.
          </p>
          <ul className="space-y-2">
            {candidates.map((c) => {
              const k = keyOf(c);
              return (
                <li key={k} className="border border-slate-700 rounded px-3 py-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(k)}
                      onChange={() => toggle(k)}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="text-sm text-white" dir="ltr">
                        <span className="inline-block rounded bg-slate-700 text-slate-200 text-xs px-1.5 py-0.5 mr-2">{c.category}</span>
                        {c.code_display}
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        Documented: “{c.source_excerpt}”
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy || selected.size === 0}
              className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : `Create ${selected.size} selected order(s)`}
            </button>
            <button
              type="button"
              onClick={() => { setCandidates(null); setSelected(new Set()); }}
              disabled={busy}
              className="text-sm px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
