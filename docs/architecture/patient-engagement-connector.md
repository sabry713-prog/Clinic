# Patient Engagement (Reminders / Intake) — Dummy/Stub

**Status:** Dummy integration. `PATIENT_ENGAGEMENT_CONNECTOR=stub` (default) is the only mode that sends
anything — no real SMS/email/WhatsApp provider exists. `=live` throws honestly rather than pretending to
send.

---

## Why this stays inside the non-SaMD boundary (CLAUDE.md §2)

Cortex.ai performs **no interaction, risk, or clinical-content reasoning anywhere in this feature.**
Concretely:

- **Reminder text is a fixed, factual template** — appointment date/time, appointment type, and
  department only. It is never model-generated, never includes a reason for visit, and never includes
  any clinical detail. `PatientEngagementConnectorService.renderTemplate()` is the only place reminder
  text is produced, and it does pure string substitution against `hospital.appointment` fields.
- **Intake's free-text `reason_for_visit_text` is captured and displayed verbatim.** `IntakeService.capture()`
  only trims surrounding whitespace and caps length — it never summarizes, classifies, or feeds the text
  into any extraction/classification pipeline. This is deliberately kept separate from
  `ServiceRequestService`'s ad-hoc quick-entry text handling, which does run text through catalog matching —
  wiring a patient's own intake words into an order-candidate pipeline would blur toward triage-adjacent
  behavior even without any AI involved.
- **The appointment and delivery target are always re-derived server-side.** The caller supplies only an
  `appointmentId` + `channel` — never message content, never a raw phone/email. This is what stops the
  reminder endpoint being usable to message an arbitrary number.
- **`hospital.appointment` scheduling has no conflict/urgency logic** — `schedule()` performs no
  double-booking check and status transitions are purely administrative
  (`scheduled → completed | cancelled | no_show`), never gated by clinical content. This table is
  intentionally minimal; it's the seam a future "AI Receptionist / Scheduling" feature is expected to
  extend, not replace.

## What's simulated in `stub` mode (the only mode that runs)

Everything. `PatientEngagementConnectorService.send()` computes a **deterministic** simulated
delivered/failed outcome from a hash of `(appointmentId, channel, patientId)` — same
"deterministic, not random" convention as `seed:nphies-claims` and `HospitalSysConnectorService.simulateOrr()` —
so the same reminder always reproduces the same simulated result. About 1 in 10 simulated sends fail with a
canned reason (`SIMULATED_FAILURES`). Unlike the hospital-system HIS connector, there is **no idempotency-key
uniqueness constraint** on `app.reminder_send` — reminders are legitimately re-sendable (a real failure
retry, or a second reminder before the visit), so repeat sends are allowed by design.

`PATIENT_ENGAGEMENT_CONNECTOR=live` throws `PATIENT_ENGAGEMENT_LIVE_NOT_CONFIGURED` honestly — same
pattern as `NPHIES_LIVE_NOT_CONFIGURED` / `HOSPITAL_SYS_LIVE_NOT_CONFIGURED` — rather than silently falling
back to stub behavior.

## Schema notes

- `hospital.appointment` deliberately breaks this codebase's usual `hospital.*` convention (every other
  table there is a FHIR-ingestion mirror with `source_system`/`fhir_resource_json`). This one is
  staff-authored inside Cortex.ai directly, since no appointment feed exists to ingest yet.
- `app.patient_contact` lives in `app.*`, not as new columns on `hospital.patient`, because
  `hospital.patient` is overwritten by the FHIR ingestion sync — a nurse-confirmed phone number there
  could be silently clobbered by a stale/missing `telecom` field on the next sync.
- `app.intake_record` is insert-only — no update endpoint exists, same immutability discipline as
  `source_excerpt` elsewhere in this codebase.

## What a real integration would need

1. A real SMS/email/WhatsApp provider (e.g. Unifonic, Twilio) with delivery-status webhooks — this stub's
   "delivered/failed" is entirely simulated at send time, not a real delivery-receipt callback.
2. A resolved PDPL consent-for-contact posture: explicit patient consent to be contacted at a given
   channel, consent withdrawal handling, and a retention policy for `app.patient_contact` /
   `app.reminder_send`.
3. Real appointment data — either from a real scheduling module (see the future AI Receptionist/Scheduling
   backlog item) or an ingested feed from the hospital's own scheduling system, reconciled against
   `hospital.appointment`'s current staff-authored-only model.
4. Rate limiting / cooldown on reminder sends if this is exposed beyond internal staff use.

## Tables / code

- Migration `1719800000000_patient-engagement.ts` — `hospital.appointment`, `app.patient_contact`,
  `app.reminder_send`, `app.intake_record`.
- `apps/core/src/patient-engagement/` — `AppointmentService`/`Controller`, `IntakeService`/`Controller`,
  `PatientEngagementConnectorService`, `ReminderController`, `PatientEngagementModule`.
- `apps/web/src/components/AppointmentPanel/`, `ReminderSendControl/`, `IntakePanel/` — patient-page UI.
- `apps/web/src/pages/FrontDeskQueuePage/` — cross-patient scheduled-appointments queue.
- New permissions `appointment:write`, `intake:write`, `reminder:send`
  (`packages/shared-types/src/index.ts`) — granted to `nurse` (all three) and `hospital_admin`
  (`appointment:write` + `reminder:send` only).
