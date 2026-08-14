/**
 * AiReceptionistPage — public, unauthenticated patient self-service booking
 * (docs/architecture/ai-receptionist.md). No AppShell chrome, no staff
 * session dependency -- reachable at /receptionist with no login.
 *
 * Free-text intent matching is catalog-term-only (department/appointment-
 * type names) via api.booking.matchIntent -- it never infers a department
 * from a symptom description. When there's no confident match, the picker
 * below is shown instead of guessing (CLAUDE.md §2).
 */

import { useCallback, useState } from "react";
import { api, type Appointment, type BookingSlot, ApiError } from "../../lib/api";
import { formatSlotLabel } from "../../lib/dates";
import i18n from "../../i18n";

const DEPARTMENTS = [
  "Cardiology",
  "Dermatology",
  "Orthopedics",
  "Pediatrics",
  "Internal Medicine",
  "ENT",
  "Obstetrics & Gynecology",
] as const;

const APPOINTMENT_TYPES: readonly { value: string; label: string }[] = [
  { value: "follow_up", label: "Follow-up" },
  { value: "new_patient", label: "New patient" },
  { value: "consultation", label: "Consultation" },
  { value: "procedure", label: "Procedure" },
];

const LOOKAHEAD_DAYS = 14;

type Step = "phone" | "otp" | "intent" | "slots" | "success" | "my-appointments";

function formatSlot(iso: string, language: string | undefined): string {
  return formatSlotLabel(iso, language);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function AiReceptionistPage(): JSX.Element {
  const [step, setStep] = useState<Step>("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");

  const [intentText, setIntentText] = useState("");
  const [matchConfirming, setMatchConfirming] = useState(false);
  const [departmentDisplay, setDepartmentDisplay] = useState("");
  const [appointmentType, setAppointmentType] = useState("");
  // S4.4 — patient's scheduling preference for the clinician's gender. Empty
  // string = no preference (all slots shown).
  const [clinicianGender, setClinicianGender] = useState<"" | "male" | "female">("");

  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [bookedAppointment, setBookedAppointment] = useState<Appointment | null>(null);

  const [myAppointments, setMyAppointments] = useState<Appointment[] | null>(null);

  const sendCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.booking.requestOtp(phone);
      setStep("otp");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to send code");
    } finally {
      setBusy(false);
    }
  }, [phone]);

  const verifyCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await api.booking.verifyOtp(phone, code);
      setStep("intent");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Invalid or expired code");
    } finally {
      setBusy(false);
    }
  }, [phone, code]);

  const searchIntent = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.booking.matchIntent(intentText);
      if (result.confident && result.departmentDisplay) {
        setDepartmentDisplay(result.departmentDisplay);
        setAppointmentType(result.appointmentType ?? "");
        setMatchConfirming(true);
      } else {
        setMatchConfirming(false);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Search failed");
      setMatchConfirming(false);
    } finally {
      setBusy(false);
    }
  }, [intentText]);

  const loadSlots = useCallback(async () => {
    if (!departmentDisplay || !appointmentType) {
      setError("Please choose a department and appointment type");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.booking.availability(
        departmentDisplay,
        null,
        todayIso(),
        addDaysIso(LOOKAHEAD_DAYS),
        clinicianGender === "" ? null : clinicianGender,
      );
      setSlots(res.data);
      setStep("slots");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load availability");
    } finally {
      setBusy(false);
    }
  }, [departmentDisplay, appointmentType, clinicianGender]);

  const bookSlot = useCallback(
    async (slotStart: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.booking.bookAppointment(departmentDisplay, appointmentType, null, slotStart);
        setBookedAppointment(result);
        setStep("success");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "This slot may no longer be available -- please pick another");
        await loadSlots();
      } finally {
        setBusy(false);
      }
    },
    [departmentDisplay, appointmentType, loadSlots],
  );

  const openMyAppointments = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.booking.myAppointments();
      setMyAppointments(res.data);
      setStep("my-appointments");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load appointments");
    } finally {
      setBusy(false);
    }
  }, []);

  const cancelMyAppointment = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.booking.cancelAppointment(id);
      const res = await api.booking.myAppointments();
      setMyAppointments(res.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to cancel");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white shadow-lg mb-4 p-3">
            <img src="/logo-icon.png" alt="" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white">Book an Appointment</h1>
          <p className="text-blue-300 mt-1 text-sm">No account needed -- verify your phone to get started</p>
        </div>

        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 shadow-2xl space-y-4">
          {error && (
            <div role="alert" className="p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm text-center">
              {error}
            </div>
          )}

          {step === "phone" && (
            <>
              <label className="block text-sm text-slate-300">
                Phone number
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+966500000000"
                  dir="ltr"
                  className="mt-1 w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-white"
                />
              </label>
              <button
                type="button"
                onClick={() => void sendCode()}
                disabled={busy || !phone.trim()}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-sm"
              >
                {busy ? "Sending…" : "Send verification code"}
              </button>
            </>
          )}

          {step === "otp" && (
            <>
              <p className="text-sm text-slate-300 text-center">Enter the 6-digit code sent to {phone}</p>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                dir="ltr"
                className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-white text-center tracking-[0.5em] text-lg"
              />
              <button
                type="button"
                onClick={() => void verifyCode()}
                disabled={busy || code.length !== 6}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-sm"
              >
                {busy ? "Verifying…" : "Verify"}
              </button>
            </>
          )}

          {step === "intent" && (
            <>
              <p className="text-sm text-slate-300">What would you like to book?</p>
              <textarea
                value={intentText}
                onChange={(e) => setIntentText(e.target.value)}
                rows={2}
                placeholder="e.g. follow-up with Cardiology"
                className="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-white resize-none"
              />
              <button
                type="button"
                onClick={() => void searchIntent()}
                disabled={busy || !intentText.trim()}
                className="w-full py-2.5 rounded-xl border border-slate-600 text-slate-200 hover:border-slate-400 text-sm"
              >
                {busy ? "Searching…" : "Search"}
              </button>

              {matchConfirming ? (
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-sm text-blue-200 text-center space-y-2">
                  <p>
                    {departmentDisplay}
                    {appointmentType && ` · ${APPOINTMENT_TYPES.find((t) => t.value === appointmentType)?.label ?? appointmentType}`}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void loadSlots()} className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs">
                      That's right
                    </button>
                    <button type="button" onClick={() => setMatchConfirming(false)} className="flex-1 py-2 rounded-lg border border-slate-600 text-slate-300 text-xs">
                      Pick manually
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 pt-2 border-t border-white/10">
                  <label className="block text-xs text-slate-400">
                    Department
                    <select
                      value={departmentDisplay}
                      onChange={(e) => setDepartmentDisplay(e.target.value)}
                      className="mt-1 w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                    >
                      <option value="">Choose…</option>
                      {DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-slate-400">
                    Appointment type
                    <select
                      value={appointmentType}
                      onChange={(e) => setAppointmentType(e.target.value)}
                      className="mt-1 w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                    >
                      <option value="">Choose…</option>
                      {APPOINTMENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-slate-400">
                    Clinician preference · تفضيل الطبيب
                    <select
                      value={clinicianGender}
                  onChange={(e) => setClinicianGender(e.target.value as "" | "male" | "female")}
                  className="mt-1 w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                  aria-label="Clinician gender preference"
                >
                  <option value="">No preference · لا تفضيل</option>
                  <option value="female">Female physician · طبيبة</option>
                  <option value="male">Male physician · طبيب</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void loadSlots()}
                    disabled={busy || !departmentDisplay || !appointmentType}
                    className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-sm"
                  >
                    Continue
                  </button>
                </div>
              )}

              <button type="button" onClick={() => void openMyAppointments()} className="w-full text-xs text-slate-400 hover:text-slate-200 underline">
                View my appointments
              </button>
            </>
          )}

          {step === "slots" && (
            <>
              <p className="text-sm text-slate-300 text-center">
                {departmentDisplay} — pick a time in the next {LOOKAHEAD_DAYS} days
              </p>
              {slots.length === 0 ? (
                <p className="text-sm text-slate-500 text-center">No open slots in this window</p>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1.5">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => void bookSlot(s.start)}
                      disabled={busy}
                      className="w-full text-left px-3 py-2 rounded-lg border border-slate-700 hover:border-blue-400 text-slate-200 text-sm disabled:opacity-50"
                    >
                      {formatSlot(s.start, i18n.language)}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => setStep("intent")} className="w-full text-xs text-slate-400 hover:text-slate-200 underline">
                Back
              </button>
            </>
          )}

          {step === "success" && bookedAppointment && (
            <div className="text-center space-y-3">
              <p className="text-green-300 text-sm">Appointment booked</p>
              <p className="text-white text-sm">
                {bookedAppointment.appointment_type} — {formatSlot(bookedAppointment.scheduled_at, i18n.language)}
              </p>
              <p className="text-slate-400 text-xs">{bookedAppointment.department_display}</p>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setStep("intent"); setIntentText(""); setMatchConfirming(false); setDepartmentDisplay(""); setAppointmentType(""); }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-200 text-sm"
                >
                  Book another
                </button>
                <button type="button" onClick={() => void openMyAppointments()} className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm">
                  My appointments
                </button>
              </div>
            </div>
          )}

          {step === "my-appointments" && (
            <>
              <p className="text-sm text-slate-300 text-center">Your appointments</p>
              {myAppointments === null || myAppointments.length === 0 ? (
                <p className="text-sm text-slate-500 text-center">No appointments yet</p>
              ) : (
                <ul className="space-y-2">
                  {myAppointments.map((a) => (
                    <li key={a.id} className="p-3 rounded-lg border border-slate-700 flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm text-white">{a.appointment_type} — {formatSlot(a.scheduled_at, i18n.language)}</p>
                        <p className="text-xs text-slate-500">{a.department_display} · {a.status}</p>
                      </div>
                      {a.status === "scheduled" && (
                        <button
                          type="button"
                          onClick={() => void cancelMyAppointment(a.id)}
                          disabled={busy}
                          className="text-xs text-slate-400 hover:text-slate-200 underline disabled:opacity-50 shrink-0"
                        >
                          Cancel
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setStep("intent")} className="w-full text-xs text-slate-400 hover:text-slate-200 underline">
                Book a new appointment
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
