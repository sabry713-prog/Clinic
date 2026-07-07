/**
 * ServiceRequestPanel — turn a clinician's DOCUMENTED orders into structured
 * service requests.
 *
 * Flow: extract candidate services from the doctor's notes/orders → the doctor
 * reviews each (with the verbatim source excerpt) and confirms → selected
 * orders are created. The system never decides or suggests a service: every
 * candidate is a verbatim extraction of something the doctor already wrote.
 * There is deliberately no auto-execute: each card requires an explicit
 * doctor action (confirm or dismiss).
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

// Per-category icons — purely navigational glyphs, no clinical meaning.
const CATEGORY_ICONS: Record<string, string> = {
  laboratory: "M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5",
  imaging: "M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-1.5 0a3 3 0 11-6 0 3 3 0 016 0z",
  procedure: "M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z",
  other: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z",
};

function CategoryIcon({ category }: { readonly category: string }): JSX.Element {
  const d = CATEGORY_ICONS[category] ?? CATEGORY_ICONS["other"];
  return (
    <div className="shrink-0 w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
      <svg className="w-5 h-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </div>
  );
}

export default function ServiceRequestPanel({ patientId }: { readonly patientId: string }): JSX.Element {
  const [candidates, setCandidates] = useState<ServiceCandidate[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<Set<string>>(new Set());
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
      setDismissed(new Set());
      setExpanded(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to extract requested services");
    } finally { setBusy(false); }
  }, [patientId]);

  const confirmOne = useCallback(async (c: ServiceCandidate) => {
    const k = keyOf(c);
    setConfirming((prev) => new Set(prev).add(k));
    setError(null);
    try {
      await api.patients.createServiceRequests(patientId, [c]);
      setCandidates((prev) => prev?.filter((x) => keyOf(x) !== k) ?? null);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create service request");
    } finally {
      setConfirming((prev) => { const n = new Set(prev); n.delete(k); return n; });
    }
  }, [patientId, refresh]);

  const confirmAll = useCallback(async () => {
    if (!candidates) return;
    const items = candidates.filter((c) => !dismissed.has(keyOf(c)));
    if (items.length === 0) return;
    setBusy(true); setError(null);
    try {
      await api.patients.createServiceRequests(patientId, items);
      setCandidates(null); setDismissed(new Set());
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create service requests");
    } finally { setBusy(false); }
  }, [candidates, dismissed, patientId, refresh]);

  const dismissOne = (k: string): void => {
    setDismissed((prev) => new Set(prev).add(k));
  };

  const toggleExpanded = (k: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const visible = candidates?.filter((c) => !dismissed.has(keyOf(c))) ?? null;

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

      {/* Extraction + confirmation queue */}
      {candidates === null ? (
        <button
          type="button"
          onClick={() => void extract()}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 disabled:opacity-50"
        >
          {busy ? "Reading orders…" : "Extract requested services from notes"}
        </button>
      ) : visible !== null && visible.length === 0 ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-slate-500">
            {candidates.length === 0
              ? "No documented service requests found in this patient's notes."
              : "All extracted requests handled."}
          </p>
          <button
            type="button"
            onClick={() => { setCandidates(null); setDismissed(new Set()); }}
            className="text-xs text-slate-400 hover:text-white underline"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Each card is a verbatim extraction from the doctor's own documentation. Review the source, then confirm or dismiss — nothing is created without confirmation.
          </p>
          <ul className="space-y-2">
            {visible?.map((c) => {
              const k = keyOf(c);
              const isConfirming = confirming.has(k);
              const isExpanded = expanded.has(k);
              return (
                <li key={k} className="border border-slate-700 bg-slate-950/40 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <CategoryIcon category={c.category} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate" dir="ltr">
                        <span className="text-slate-400">Create</span>{" "}
                        <span className="font-medium bg-slate-800 rounded px-1.5 py-0.5">{c.code_display}</span>{" "}
                        <span className="text-slate-400">order</span>{" "}
                        <span className="text-xs text-slate-500">({c.category})</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(k)}
                        className="text-xs text-slate-500 hover:text-slate-300 mt-0.5"
                      >
                        {isExpanded ? "Hide source" : "Review source"}
                      </button>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => dismissOne(k)}
                        disabled={isConfirming}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmOne(c)}
                        disabled={isConfirming}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                      >
                        {isConfirming ? "Creating…" : "Confirm"}
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <p className="mt-2 ms-12 text-xs text-slate-400 border-s-2 border-slate-700 ps-3" dir="auto">
                      Documented: “{c.source_excerpt}”
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void confirmAll()}
              disabled={busy || (visible?.length ?? 0) === 0}
              className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {busy ? "Creating…" : `Confirm all remaining (${visible?.length ?? 0})`}
            </button>
            <button
              type="button"
              onClick={() => { setCandidates(null); setDismissed(new Set()); }}
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
