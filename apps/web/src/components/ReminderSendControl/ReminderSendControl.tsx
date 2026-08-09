/**
 * ReminderSendControl — send a (dummy/stub) appointment reminder.
 * See docs/architecture/patient-engagement-connector.md.
 *
 * Status is shown with ONE neutral style regardless of outcome — this is an
 * administrative delivery status, never a clinical-severity indicator
 * (CLAUDE.md §2). The rendered message / failure detail is shown verbatim in
 * a disclosure, exactly as returned — never rephrased or interpreted here.
 */

import { useState, useEffect, useCallback } from "react";
import { api, type ReminderSend, type ReminderChannel, ApiError } from "../../lib/api";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  delivered: "Delivered (simulated)",
  failed: "Failed (simulated)",
};

const CHANNEL_LABEL: Record<ReminderChannel, string> = {
  sms: "SMS",
  email: "Email",
  whatsapp: "WhatsApp",
};

export default function ReminderSendControl({
  patientId,
  appointmentId,
}: {
  readonly patientId: string;
  readonly appointmentId: string;
}): JSX.Element {
  const [reminders, setReminders] = useState<ReminderSend[] | null>(null);
  const [channel, setChannel] = useState<ReminderChannel>("sms");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const refresh = useCallback(() => {
    api.patients
      .listReminders(patientId)
      .then((r) => setReminders(r.data.filter((rem) => rem.appointment_id === appointmentId)))
      .catch(() => setReminders([]));
  }, [patientId, appointmentId]);

  useEffect(() => { refresh(); }, [refresh]);

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patients.sendReminder(patientId, appointmentId, channel);
      setShowDetail(false);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }, [patientId, appointmentId, channel, refresh]);

  if (reminders === null) return <span className="text-xs text-slate-600">…</span>;

  const latest = reminders[0] ?? null;

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <select
        value={channel}
        onChange={(e) => setChannel(e.target.value as ReminderChannel)}
        disabled={busy}
        className="text-xs bg-slate-950/40 border border-slate-700 rounded-lg px-1.5 py-1 text-slate-300"
      >
        {(Object.keys(CHANNEL_LABEL) as ReminderChannel[]).map((c) => (
          <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void send()}
        disabled={busy}
        className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send reminder"}
      </button>
      {latest && (
        <span className="text-xs text-slate-400 bg-slate-800 rounded px-1.5 py-0.5">
          {CHANNEL_LABEL[latest.channel]}: {STATUS_LABEL[latest.status] ?? latest.status}
        </span>
      )}
      {latest && (
        <button type="button" onClick={() => setShowDetail((v) => !v)} className="text-xs text-slate-500 hover:text-slate-300 underline">
          {showDetail ? "Hide message" : "Review message"}
        </button>
      )}
      {error && <span className="text-xs text-slate-500">{error}</span>}
      {showDetail && latest && (
        <p className="basis-full text-xs text-slate-400 border-s-2 border-slate-700 ps-3 mt-1" dir="auto">
          {latest.rendered_message}
          {latest.simulated_outcome_detail && ` — ${latest.simulated_outcome_detail}`}
        </p>
      )}
    </span>
  );
}
