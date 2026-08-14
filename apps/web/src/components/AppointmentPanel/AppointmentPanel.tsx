/**
 * AppointmentPanel — Patient Engagement, administrative scheduling only.
 *
 * Schedules an appointment (date/time, type, department/clinician free-text)
 * and lists the patient's appointments with status actions (complete/cancel/
 * no-show) and a reminder-send control per row. No conflict/double-booking
 * check and no clinical content anywhere here (CLAUDE.md §2) — this is
 * intentionally minimal scheduling, not a real booking system.
 */

import { useState, useEffect, useCallback } from "react";
import { api, type Appointment, type AppointmentStatus, ApiError } from "../../lib/api";
import { formatDateTime } from "../../lib/dates";
import i18n from "../../i18n";
import ReminderSendControl from "../ReminderSendControl/ReminderSendControl";

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export default function AppointmentPanel({ patientId }: { readonly patientId: string }): JSX.Element {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const [scheduledAt, setScheduledAt] = useState("");
  const [appointmentType, setAppointmentType] = useState("");
  const [departmentDisplay, setDepartmentDisplay] = useState("");
  const [clinicianDisplay, setClinicianDisplay] = useState("");
  const [scheduling, setScheduling] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await api.patients.listAppointments(patientId);
      setAppointments(res.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load appointments");
    }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const schedule = useCallback(async () => {
    if (!scheduledAt || !appointmentType.trim()) return;
    setScheduling(true);
    setError(null);
    try {
      await api.patients.createAppointment(
        patientId,
        new Date(scheduledAt).toISOString(),
        appointmentType.trim(),
        departmentDisplay.trim() || undefined,
        clinicianDisplay.trim() || undefined,
      );
      setScheduledAt("");
      setAppointmentType("");
      setDepartmentDisplay("");
      setClinicianDisplay("");
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to schedule appointment");
    } finally {
      setScheduling(false);
    }
  }, [patientId, scheduledAt, appointmentType, departmentDisplay, clinicianDisplay, refresh]);

  const updateStatus = useCallback(
    async (appointmentId: string, status: AppointmentStatus) => {
      setBusyIds((prev) => new Set(prev).add(appointmentId));
      setError(null);
      try {
        await api.patients.updateAppointmentStatus(patientId, appointmentId, status);
        await refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Action failed");
      } finally {
        setBusyIds((prev) => { const n = new Set(prev); n.delete(appointmentId); return n; });
      }
    },
    [patientId, refresh],
  );

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Appointments</h2>
        <span className="text-xs text-slate-500">Administrative scheduling only — no clinical content</span>
      </div>

      {error && <p className="text-sm text-slate-400">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="text-sm bg-slate-950/40 border border-slate-700 rounded-lg px-3 py-2 text-white"
        />
        <input
          type="text"
          placeholder="Appointment type (e.g. follow_up)"
          value={appointmentType}
          onChange={(e) => setAppointmentType(e.target.value)}
          className="text-sm bg-slate-950/40 border border-slate-700 rounded-lg px-3 py-2 text-white"
        />
        <input
          type="text"
          placeholder="Department (optional)"
          value={departmentDisplay}
          onChange={(e) => setDepartmentDisplay(e.target.value)}
          className="text-sm bg-slate-950/40 border border-slate-700 rounded-lg px-3 py-2 text-white"
        />
        <input
          type="text"
          placeholder="Clinician (optional)"
          value={clinicianDisplay}
          onChange={(e) => setClinicianDisplay(e.target.value)}
          className="text-sm bg-slate-950/40 border border-slate-700 rounded-lg px-3 py-2 text-white"
        />
      </div>
      <button
        type="button"
        onClick={() => void schedule()}
        disabled={scheduling || !scheduledAt || !appointmentType.trim()}
        className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
      >
        {scheduling ? "Scheduling…" : "Schedule appointment"}
      </button>

      <hr className="border-slate-800" />

      {appointments === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : appointments.length === 0 ? (
        <p className="text-sm text-slate-500">No appointments yet</p>
      ) : (
        <ul className="space-y-2">
          {appointments.map((a) => {
            const busy = busyIds.has(a.id);
            return (
              <li key={a.id} className="border border-slate-700 bg-slate-950/40 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap" dir="ltr">
                <div className="min-w-0">
                  <p className="text-sm text-white">{a.appointment_type} — {formatDateTime(a.scheduled_at, i18n.language)}</p>
                  <p className="text-xs text-slate-500">
                    {[a.department_display, a.clinician_display].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <span className="text-xs text-slate-400 bg-slate-800 rounded px-1.5 py-0.5">
                  {STATUS_LABEL[a.status]}
                </span>
                {a.status === "scheduled" && <ReminderSendControl patientId={patientId} appointmentId={a.id} />}
                {a.status === "scheduled" && (
                  <span className="ml-auto inline-flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void updateStatus(a.id, "completed")}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-50"
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateStatus(a.id, "no_show")}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-50"
                    >
                      No-show
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateStatus(a.id, "cancelled")}
                      disabled={busy}
                      className="text-xs text-slate-500 hover:text-slate-300 underline disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
