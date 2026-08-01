/**
 * ReceptionistTab — post-care drafts in the AI Team drawer (Sprint 10).
 *
 * Shows what services/orchestrator/receptionist_agent.py drafted from the
 * finalized discharge order: candidate follow-up slots, patient outreach
 * messages, and lab-prep reminders — each with a 1-click dispatch button.
 *
 * Two things this component is deliberate about, mirroring the engine:
 *
 * 1. Every item is a DRAFT. Nothing here has been booked or sent, and the
 *    review banner says so rather than leaving the clinician to assume it.
 * 2. Care instructions are model-written clinical text. That is called out
 *    inline, because "the AI wrote this and it is about to go to a patient" is
 *    exactly the thing a reviewer needs to know before pressing send.
 */

import { useState } from "react";
import {
  CalendarClock,
  MessageSquare,
  FlaskConical,
  Send,
  Check,
  Clock,
  Loader2,
  AlertTriangle,
} from "lucide-react";

export interface FollowupSlot {
  readonly starts_at: string;
  readonly department: string | null;
  readonly appointment_type: string;
  readonly status: string;
}

export interface LabPrepReminder {
  readonly lab: string;
  readonly instruction: string;
  readonly source: string;
}

export interface DispatchPayload {
  readonly patient_id: string;
  readonly channel: "sms" | "whatsapp";
  readonly kind: string;
  readonly body: string;
  readonly status: string;
}

export interface CareInstructions {
  readonly text: string;
  readonly requires_clinician_review: boolean;
}

export interface PostCarePackage {
  readonly followup_slots: readonly FollowupSlot[];
  readonly lab_prep_reminders: readonly LabPrepReminder[];
  readonly care_instructions: CareInstructions | null;
  readonly dispatch_payloads: readonly DispatchPayload[];
}

interface ReceptionistTabProps {
  readonly postCare: PostCarePackage | null;
  /** Book one drafted slot. Resolves when the booking is confirmed. */
  readonly onBookSlot?: ((slot: FollowupSlot) => Promise<void>) | undefined;
  /** Dispatch one drafted message. Resolves when the send is accepted. */
  readonly onDispatch?: ((payload: DispatchPayload) => Promise<void>) | undefined;
  /** Audit M-2: set while the handlers above do not yet reach a real booking
   * or messaging endpoint. Buttons then render an explicit "Pending
   * integration" chip instead of a success badge for work that never left the
   * browser. Callers that ARE wired to a backend pass `false`. */
  readonly pendingIntegration?: boolean;
  /** True while the package is being drafted server-side (Phase 2). */
  readonly loading?: boolean;
}

function formatSlot(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", whatsapp: "WhatsApp" };

function SectionHeading({
  icon: Icon,
  children,
}: {
  readonly icon: typeof CalendarClock;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </h4>
  );
}

/** Button that shows a spinner while its action runs, then a done state.
 *
 * Audit M-2: this previously rendered a green "Dispatched" / "Booked"
 * confirmation as soon as its handler resolved -- and the only handler wired
 * to it appended a line to the activity stream without sending anything. A
 * success badge for a message that was never sent is worse than a disabled
 * button, so `pendingIntegration` now short-circuits to an explicit
 * "Pending integration" state and no success is ever claimed until a real
 * endpoint is wired in (Phase 2).
 */
function ActionButton({
  label,
  doneLabel,
  onRun,
  pendingIntegration,
}: {
  readonly label: string;
  readonly doneLabel: string;
  readonly onRun: () => Promise<void>;
  readonly pendingIntegration: boolean;
}): JSX.Element {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  if (pendingIntegration) {
    return (
      <span
        data-testid="pending-integration"
        title={`${label} is not connected to a backend yet — nothing will be sent.`}
        className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] font-medium text-slate-400"
      >
        <Clock className="h-3 w-3" aria-hidden="true" />
        Pending integration
      </span>
    );
  }

  if (state === "done") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300">
        <Check className="h-3 w-3" aria-hidden="true" />
        {doneLabel}
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={state === "busy"}
      onClick={() => {
        setState("busy");
        void onRun()
          .then(() => setState("done"))
          .catch(() => setState("idle"));
      }}
      className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-50"
    >
      {state === "busy" ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <Send className="h-3 w-3" aria-hidden="true" />
      )}
      {state === "busy" ? "Working…" : label}
    </button>
  );
}

export default function ReceptionistTab({
  postCare,
  onBookSlot,
  onDispatch,
  pendingIntegration = true,
  loading = false,
}: ReceptionistTabProps): JSX.Element {
  if (loading && !postCare) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Drafting the post-care package…
      </p>
    );
  }

  if (!postCare) {
    return (
      <p className="text-[11px] leading-relaxed text-slate-500">
        No post-care package drafted yet. This fills in once a discharge order is finalised
        for the encounter.
      </p>
    );
  }

  const { followup_slots: slots, lab_prep_reminders: labPrep, care_instructions: care } = postCare;
  const dispatches = postCare.dispatch_payloads;

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Drafts for review — nothing below has been booked or sent yet. Booking and dispatch are not connected to a backend yet.
      </p>

      {slots.length > 0 && (
        <section>
          <SectionHeading icon={CalendarClock}>Follow-up slots</SectionHeading>
          <ul className="space-y-1.5">
            {slots.map((slot) => (
              <li
                key={slot.starts_at}
                className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-[11px] font-medium text-slate-100">
                    {formatSlot(slot.starts_at)}
                  </span>
                  {slot.department && (
                    <span className="block text-[10px] text-slate-500">{slot.department}</span>
                  )}
                </span>
                {onBookSlot && (
                  <ActionButton
                    label="Book"
                    doneLabel="Booked"
                    pendingIntegration={pendingIntegration}
                    onRun={() => onBookSlot(slot)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {care?.text && (
        <section>
          <SectionHeading icon={MessageSquare}>Patient care instructions</SectionHeading>
          <p className="mb-1.5 text-[10px] italic text-amber-300/80">
            AI-drafted clinical text — review before sending.
          </p>
          <p
            data-testid="care-instructions"
            className="whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950 p-2.5 text-[11px] leading-relaxed text-slate-300"
          >
            {care.text}
          </p>
        </section>
      )}

      {labPrep.length > 0 && (
        <section>
          <SectionHeading icon={FlaskConical}>Lab preparation</SectionHeading>
          <ul className="space-y-1.5">
            {labPrep.map((r) => (
              <li key={r.lab} className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2">
                <span className="block text-[11px] font-medium text-slate-100">{r.lab}</span>
                <span className="block text-[11px] leading-relaxed text-slate-400">
                  {r.instruction}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dispatches.length > 0 && (
        <section>
          <SectionHeading icon={Send}>Outreach messages</SectionHeading>
          <ul className="space-y-1.5">
            {dispatches.map((payload, i) => (
              <li
                key={`${payload.kind}-${i}`}
                className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                    {CHANNEL_LABEL[payload.channel] ?? payload.channel}
                  </span>
                  <span className="text-[10px] text-slate-500">{payload.kind.replace(/_/g, " ")}</span>
                </div>
                <p className="mb-2 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-300">
                  {payload.body}
                </p>
                {onDispatch && (
                  <ActionButton
                    label="Dispatch"
                    doneLabel="Dispatched"
                    pendingIntegration={pendingIntegration}
                    onRun={() => onDispatch(payload)}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
