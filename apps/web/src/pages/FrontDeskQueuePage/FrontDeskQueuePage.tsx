/**
 * FrontDeskQueuePage — front-desk-facing appointment queue (Patient
 * Engagement, administrative only). Cross-patient by design, same reasoning
 * as the pharmacist refill queue / NPHIES rejection-analytics dashboard:
 * aggregates administrative fields (patient identity, schedule, status)
 * only — never clinical content.
 */

import { useState, useEffect, useCallback } from "react";
import { api, type AppointmentQueueItem, type AppointmentStatus, ApiError } from "../../lib/api";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function FrontDeskQueuePage(): JSX.Element {
  const [items, setItems] = useState<AppointmentQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    setIsLoading(true);
    api.frontDesk
      .appointmentsQueue()
      .then((r) => setItems(r.data))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Failed to load appointment queue"))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setStatus = useCallback(
    async (id: string, status: AppointmentStatus) => {
      setBusyIds((prev) => new Set(prev).add(id));
      setError(null);
      try {
        await api.frontDesk.updateAppointmentStatus(id, status);
        refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to update appointment");
      } finally {
        setBusyIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    },
    [refresh],
  );

  return (
    <div className="min-h-screen bg-wash text-ink p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Front Desk — Appointments</h1>
        <p className="text-sm text-ink-soft mb-6">
          Scheduled appointments across patients. Administrative scheduling only — no clinical content.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-veil border border-line rounded-md text-sm text-ink-soft">
            {error}
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-ink-soft">Loading queue…</p>
        ) : items.length === 0 ? (
          <div className="bg-white border border-line rounded-lg p-8 text-center">
            <p className="text-ink-soft text-sm">No scheduled appointments</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const busy = busyIds.has(item.id);
              return (
                <div key={item.id} className="bg-white border border-line rounded-lg p-5" dir="ltr">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <p className="text-sm text-ink truncate">{item.appointment_type} — {formatDateTime(item.scheduled_at)}</p>
                      <p className="text-xs text-ink-soft">
                        {item.patient_display_name ?? "Unknown patient"}
                        {item.patient_mrn ? ` (MRN: ${item.patient_mrn})` : ""}
                      </p>
                      <p className="text-xs text-ink-soft">
                        {[item.department_display, item.clinician_display].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => void setStatus(item.id, "completed")}
                        disabled={busy}
                        className="px-3.5 py-1.5 bg-grad-accent border border-transparent rounded-full text-xs font-semibold text-white shadow-pill hover:brightness-110 disabled:opacity-50 transition-all"
                      >
                        {busy ? "…" : "Complete"}
                      </button>
                      <button
                        onClick={() => void setStatus(item.id, "no_show")}
                        disabled={busy}
                        className="px-3 py-1.5 bg-grad-accent border border-transparent rounded-full font-semibold text-white shadow-pill hover:brightness-110 transition-all text-xs"
                      >
                        {busy ? "…" : "No-show"}
                      </button>
                      <button
                        onClick={() => void setStatus(item.id, "cancelled")}
                        disabled={busy}
                        className="px-3 py-1.5 bg-transparent border border-line rounded-md text-xs text-ink-deep hover:border-line-strong disabled:opacity-50 transition-colors"
                      >
                        Cancel
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
