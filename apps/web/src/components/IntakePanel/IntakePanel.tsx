/**
 * IntakePanel — staff-assisted check-in intake capture.
 *
 * reason_for_visit_text is a plain textarea with no autocomplete/suggestion
 * UI, and is displayed in the history list exactly as typed — reinforcing
 * that this is verbatim capture, never interpreted, classified, or fed into
 * any extraction pipeline (CLAUDE.md §2).
 */

import { useState, useEffect, useCallback } from "react";
import { api, type IntakeRecord, type ReminderChannel, ApiError } from "../../lib/api";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function IntakePanel({ patientId }: { readonly patientId: string }): JSX.Element {
  const [records, setRecords] = useState<IntakeRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [contactConfirmed, setContactConfirmed] = useState(false);
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [preferredChannel, setPreferredChannel] = useState<ReminderChannel | "">("");
  const [reasonForVisitText, setReasonForVisitText] = useState("");

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [contact, history] = await Promise.all([
        api.patients.getContact(patientId),
        api.patients.listIntakeRecords(patientId),
      ]);
      if (contact.data) {
        setContactPhone(contact.data.phone ?? "");
        setContactEmail(contact.data.email ?? "");
        setPreferredChannel((contact.data.preferred_channel as ReminderChannel) ?? "");
      }
      setRecords(history.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load intake data");
    }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.patients.createIntakeRecord(patientId, {
        contactConfirmed,
        contactPhone: contactPhone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        preferredChannel: preferredChannel || undefined,
        reasonForVisitText: reasonForVisitText.trim() || undefined,
      });
      setReasonForVisitText("");
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to record intake");
    } finally {
      setSubmitting(false);
    }
  }, [patientId, contactConfirmed, contactPhone, contactEmail, preferredChannel, reasonForVisitText, refresh]);

  return (
    <div className="bg-white border border-line rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">Check-in Intake</h2>
        <span className="text-xs text-ink-soft">Staff-assisted — reason for visit captured verbatim, never interpreted</span>
      </div>

      {error && <p className="text-sm text-ink-soft">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          placeholder="Phone"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          className="text-sm bg-white border border-line rounded-lg px-3 py-2 text-ink"
        />
        <input
          type="text"
          placeholder="Email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          className="text-sm bg-white border border-line rounded-lg px-3 py-2 text-ink"
        />
        <select
          value={preferredChannel}
          onChange={(e) => setPreferredChannel(e.target.value as ReminderChannel | "")}
          className="text-sm bg-white border border-line rounded-lg px-3 py-2 text-ink"
        >
          <option value="">Preferred channel…</option>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-deep">
          <input type="checkbox" checked={contactConfirmed} onChange={(e) => setContactConfirmed(e.target.checked)} />
          Contact confirmed with patient
        </label>
      </div>

      <textarea
        placeholder="Reason for visit — patient's own words, captured as-is"
        value={reasonForVisitText}
        onChange={(e) => setReasonForVisitText(e.target.value)}
        rows={3}
        className="w-full text-sm bg-white border border-line rounded-lg px-3 py-2 text-ink resize-none"
      />

      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting}
        className="text-xs px-3 py-1.5 rounded-lg bg-grad-accent hover:brightness-110 shadow-pill text-white disabled:opacity-50"
      >
        {submitting ? "Recording…" : "Record intake"}
      </button>

      <hr className="border-line" />

      <div>
        <h3 className="text-sm font-medium text-ink-deep mb-2">History</h3>
        {records === null ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-ink-soft">No intake records yet</p>
        ) : (
          <ul className="space-y-2">
            {records.map((r) => (
              <li key={r.id} className="border border-line bg-white rounded-xl px-4 py-3">
                <p className="text-xs text-ink-soft">{formatDateTime(r.captured_at)}{r.contact_confirmed ? " · contact confirmed" : ""}</p>
                {r.reason_for_visit_text && (
                  <p className="text-sm text-ink mt-1" dir="auto">{r.reason_for_visit_text}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
