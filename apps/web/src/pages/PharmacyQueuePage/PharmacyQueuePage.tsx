/**
 * PharmacyQueuePage — pharmacist-facing refill queue (gray-area, administrative
 * only). Cross-patient by design, same reasoning as the NPHIES rejection-
 * analytics dashboard: aggregates administrative fields (patient identity,
 * medication name, status, timestamps) only — never clinical content. No
 * interaction or dose-appropriateness check anywhere on this page.
 */

import { useState, useEffect, useCallback } from "react";
import { api, type RefillQueueItem, type RefillStatus, ApiError } from "../../lib/api";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface DenyState {
  readonly id: string;
}

export default function PharmacyQueuePage(): JSX.Element {
  const [items, setItems] = useState<RefillQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [denying, setDenying] = useState<DenyState | null>(null);
  const [noteInput, setNoteInput] = useState("");

  const refresh = useCallback(() => {
    setIsLoading(true);
    api.pharmacy
      .refillQueue()
      .then((r) => setItems(r.data))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load refill queue"))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setStatus = useCallback(
    async (id: string, status: RefillStatus, pharmacyNote?: string) => {
      setBusyIds((prev) => new Set(prev).add(id));
      setError(null);
      try {
        await api.pharmacy.updateRefillStatus(id, status, pharmacyNote);
        refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to update refill request");
      } finally {
        setBusyIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    },
    [refresh],
  );

  const confirmDeny = (): void => {
    if (!denying) return;
    void setStatus(denying.id, "denied", noteInput.trim() || undefined);
    setDenying(null);
    setNoteInput("");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Pharmacy Refill Queue</h1>
        <p className="text-sm text-slate-400 mb-6">
          Open refill requests across patients. Administrative routing only — no dose or interaction
          checking. Ordered oldest-first, never by clinical urgency.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-slate-800 border border-slate-700 rounded-md text-sm text-slate-400">
            {error}
          </div>
        )}

        {denying && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-md w-full mx-4">
              <h2 className="text-base font-semibold mb-3">Deny refill request</h2>
              <p className="text-sm text-slate-400 mb-4">
                Optional administrative note (e.g. "prescription expired per pharmacy records").
              </p>
              <textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                rows={3}
                placeholder="Note (optional)…"
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 resize-none mb-4"
              />
              <div className="flex gap-3">
                <button
                  onClick={confirmDeny}
                  className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-md text-sm text-white hover:bg-slate-600 transition-colors"
                >
                  Confirm deny
                </button>
                <button
                  onClick={() => { setDenying(null); setNoteInput(""); }}
                  className="flex-1 px-4 py-2 bg-transparent border border-slate-700 rounded-md text-sm text-slate-400 hover:border-slate-500 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-slate-400">Loading queue…</p>
        ) : items.length === 0 ? (
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-8 text-center">
            <p className="text-slate-500 text-sm">No open refill requests</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const busy = busyIds.has(item.id);
              return (
                <div key={item.id} className="bg-slate-900 border border-slate-700 rounded-lg p-5" dir="ltr">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{item.medication_display}</p>
                      <p className="text-xs text-slate-400">
                        {item.patient_display_name ?? "Unknown patient"}
                        {item.patient_mrn ? ` (MRN: ${item.patient_mrn})` : ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        Requested {formatDate(item.requested_at)} ·{" "}
                        <span className="text-slate-400">{item.status}</span>
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {item.status === "requested" && (
                        <button
                          onClick={() => void setStatus(item.id, "routed")}
                          disabled={busy}
                          className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-md text-xs text-white hover:bg-slate-600 disabled:opacity-50 transition-colors"
                        >
                          {busy ? "…" : "Route"}
                        </button>
                      )}
                      {item.status === "routed" && (
                        <button
                          onClick={() => void setStatus(item.id, "filled")}
                          disabled={busy}
                          className="px-3 py-1.5 bg-blue-600 border border-blue-500 rounded-md text-xs text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                        >
                          {busy ? "…" : "Fill"}
                        </button>
                      )}
                      <button
                        onClick={() => { setDenying({ id: item.id }); setNoteInput(""); }}
                        disabled={busy}
                        className="px-3 py-1.5 bg-transparent border border-slate-700 rounded-md text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50 transition-colors"
                      >
                        Deny
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
