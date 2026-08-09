# AI Receptionist / Scheduling — Patient Self-Service Booking

**Status:** Patient-facing appointment booking is functional end-to-end (public route `/receptionist`).
The appointment-booking *business logic* is intentionally simple/dummy (small hardcoded department/
appointment-type catalog, no real SMS/email provider). The **identity-verification and session mechanism
is not a stub** — see the section below.

---

## ⚠️ This is a public, unauthenticated surface — real security properties, not stubs

Unlike every other "dummy/stub" connector in this codebase (NPHIES, the hospital-sys HIS connector, patient
reminders), this feature is reachable by anyone with no login. The appointment content it produces is
simple, but the mechanism that gates access to it must hold up as if it were real, because it is:

- **Genuinely random OTP.** `PatientOtpService` generates the 6-digit code via `crypto.randomInt`, never
  derived deterministically from caller-visible data — unlike every other simulated outcome in this
  codebase (`HospitalSysConnectorService.simulateOrr`, `PatientEngagementConnectorService.simulateDelivery`,
  `seed:nphies-claims`), which are deliberately deterministic for demo reproducibility. Predictability here
  would be a real vulnerability, not a feature.
- **Salted hash storage + timing-safe compare.** The code is hashed with a per-request salt
  (`sha256(code:salt)`) before storage; verification uses `crypto.timingSafeEqual`, a new precedent in this
  codebase. The plaintext code is never persisted, never audited, and never returned in any API response —
  the only place it's observable is a masked structured log line (`otp_stub_delivered`), standing in for a
  real SMS/email provider that doesn't exist.
- **Real rate limiting.** Phone-keyed and IP-keyed sliding-window limits on `otp/request`
  (`apps/core/src/ai-receptionist/otp-rate-limit.ts`, mirrors the existing pattern in
  `qa-proxy.controller.ts`), plus a separate limiter and a per-row attempt cap (5) on `otp/verify`.
- **Generic anti-enumeration responses.** `requestOtp()` always responds identically whether or not the
  phone matches a confirmed `app.patient_contact` row — an unmatched phone gets no DB row and no audit
  event at all.
- **Short-TTL, distinctly-named session.** The post-verification booking session (`PatientBookingSessionService`,
  in-memory, 25-minute TTL) uses the `patient_booking_session` cookie — never `session_id`, so it can never
  collide with or be confused for a staff session. `PatientBookingSessionGuard` is a completely separate
  guard from `RbacGuard`; a booking-session principal has no permissions, no roles, and no access to any
  clinical-data route.
- **Server-derived ownership on every mutation.** `patientId` always comes from the verified session
  (`req.bookingSessionPatientId`), never a body/path parameter. The cancel route
  (`AppointmentService.selfServiceCancel`) re-checks `appointment.patient_id` server-side and returns
  `NotFoundException` (404, not 403) on a mismatch, so a tampering caller can't use the response to confirm
  a given appointment id exists.
- **Race-safe booking via a database unique index**, not just an application check —
  `appointment_slot_uniqueness` on `hospital.appointment` is the actual guarantee against two patients
  double-booking the same slot; `AvailabilityService.getSlots()`'s exclusion check is only a UX nicety to
  avoid showing a stale slot.

## Why this stays inside the non-SaMD boundary (CLAUDE.md §2)

`ReceptionistNluService` matches **literal department/appointment-type/clinician name terms only** —
mirrors `matchCatalog()` in `service-request.service.ts` exactly. A patient typing a symptom ("my chest
hurts") produces **no department match at all**; the frontend falls back to a structured picker rather than
guessing. No symptom→department dictionary is ever built, even informally — that would be triage/
routing-by-symptom, forbidden under CLAUDE.md §2. Slots are always listed chronologically, never reordered
by urgency. `hospital.appointment` scheduling carries no clinical content of any kind — department,
appointment type (`follow_up`/`new_patient`/`consultation`/`procedure`), and time only.

## What's simulated

No real SMS/email/WhatsApp provider (OTP delivery is a structured log line only) and no real telephony/IVR
channel — "AI Receptionist" here means the `/receptionist` web page, not a phone system. Slot generation
and the catalog are intentionally small (v1 trims below).

## Schema notes

- `hospital.appointment.created_by` was relaxed to nullable in this migration — a patient-initiated booking
  has no `app.user` row to attribute it to. The staff path (`AppointmentService.schedule()`) is unaffected
  and always still passes a real staff `userId`.
- `hospital.appointment.booked_via` (`staff` | `patient_self_service`) is traceability only — never used
  for access control or clinical decisions.
- `app.provider_availability` is weekly-recurring only; no holiday/exception handling (v1 trim).

## Explicit v1 trims

No real SMS/email provider · no multi-clinician "any provider in department" slot merging (only exact
clinician match or department-level rows serve availability) · fixed 14-day lookahead window on the
frontend, no arbitrary date range · department/appointment-type catalog hardcoded identically on frontend
and backend (no `GET /booking/catalog` endpoint) · no reschedule endpoint (cancel + re-book) · no
holiday/exception handling in `provider_availability` · patient self-service booking always targets
department-level availability (no clinician picker in the patient UI).

## What a real integration would need

1. A real SMS/email/WhatsApp provider with delivery-status webhooks.
2. `main.ts` needs `app.set('trust proxy', ...)` configured before IP-keyed rate limiting is reliable
   behind a real reverse proxy in production — not configured today.
3. Timezone-aware scheduling — all times are currently treated as UTC-naive local clinic time.
4. A resolved PDPL consent-for-contact posture (shared with the Patient Engagement reminder feature).
5. If `apps/core` ever runs multi-instance, both `PatientBookingSessionService` and the staff
   `SessionService` need the same shared-store fix (Redis/DB) together — same in-memory limitation is
   already accepted for both.

## Tables / code

- Migration `1719900000000_ai-receptionist.ts` — `app.patient_otp_request`, `app.provider_availability`,
  `hospital.appointment.booked_via`, `appointment_slot_uniqueness` unique index,
  `hospital.appointment.created_by` relaxed to nullable.
- `apps/core/src/ai-receptionist/` — `PatientOtpService`, `PatientBookingSessionService`,
  `PatientBookingSessionGuard`, `AvailabilityService`, `ReceptionistNluService`,
  `ProviderAvailabilityService`, `otp-rate-limit.ts`, and their controllers
  (`PatientIdentityController`, `PatientBookingController`, `ProviderAvailabilityController`),
  `AiReceptionistModule`.
- `apps/core/src/patient-engagement/appointment.service.ts` — additive `scheduleSelfService()`, `listOwn()`,
  `selfServiceCancel()` (deliberately separate from the staff-facing `schedule()`/`list()`/`updateStatus()`).
- `apps/web/src/pages/AiReceptionistPage/` — the public booking page.
- `apps/web/src/pages/admin/ProviderAvailabilityPage/` — admin CRUD for slot windows.
- New permission `provider_availability:manage` (`packages/shared-types/src/index.ts`), granted to
  `hospital_admin` and `sysadmin` only.
