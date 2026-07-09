# "Documented Since Your Last Visit" Panel

**Status:** Pending CTO + Clinical Advisor sign-off (built per a direct request to mirror a competitor's
"Consider" panel — see rationale below; not yet formally approved for real-patient use). No Regulatory
Consultant sign-off required per CLAUDE.md §6 item 3, since this feature involves **no generative model
and no prompt template** — pure deterministic SQL, same risk class as `docs/prompts/specialty-templates.md`.
**Change control:** New feature not enumerated in CLAUDE.md §1 — requires CTO + Clinical Advisor
approval (CLAUDE.md §6 item 4) before real-patient use.

## Why this exists, and what it deliberately is not

Sully.ai's UI has a "Consider" panel on the patient page surfacing AI-flagged items such as *"Worsening
Major Depressive Disorder... monitor response to recent Prozac dose change"* and *"High-Risk Medication
Combination... assess for insomnia and potential interaction risk."* That panel combines several things
CLAUDE.md §2 explicitly forbids in one UI element: diagnostic trend interpretation ("worsening"),
drug-drug interaction checking, risk characterization ("High-Risk"), and clinical recommendations
("monitor for," "assess for"). It cannot be reproduced as designed.

This panel is the boundary-safe reframing: a **purely factual list of what's newly documented** between
the patient's previous encounter and now. No item is characterized as good, bad, risky, or worth
worrying about — the panel states facts with their own real timestamps and lets the clinician draw every
conclusion themselves, the same posture as every other generative-free feature in this codebase
(`PatientBrief`, the NPHIES claim-readiness checks, specialty templates).

## What was deliberately left out

- **No trend/change language.** Every item is a standalone new fact ("New medication order: Warfarin
  5mg"), never framed as a change from a prior state ("dose increased from X to Y").
- **No dose-change pairing.** `hospital.medication_request` has no supersession/version link — two rows
  sharing a drug code with different doses are NOT necessarily the same prescription edited; inferring
  that pairing would itself be an interpretive leap the schema can't support with certainty. Each new
  medication order stands alone; the clinician compares doses themselves, same as reading the record
  directly.
- **No drug-interaction checking, no risk scoring, no severity language.**
- **No color-coding by severity.** Every item — condition, allergy, medication — renders with the exact
  same neutral styling. Only a plain "NEW" tag and the item's own date differentiate anything.
- **No recommendations.** Nothing says "monitor," "consider," "assess," or similar.

## Boundary definition and data caveats

"Previous visit" = the second-most-recent row in `hospital.encounter` for the patient (by `started_at`).
If fewer than two encounters exist, the panel shows a first-visit empty state rather than guessing a
boundary. The boundary timestamp is the previous encounter's `started_at`.

Each fact type uses the only timestamp column available on its table, with different real-world
semantics that the panel does not paper over:

| Item type | Boundary column | Semantics |
|---|---|---|
| Condition | `hospital.condition.onset_date` | Clinical onset date, **not** documentation time — a condition documented today with an old onset date will not appear as "new" |
| Allergy | `hospital.allergy_intolerance.recorded_at` | Date the allergy was recorded |
| Medication | `hospital.medication_request.started_at` | FHIR `authoredOn` — order-authored date, the closest available proxy for "when this order was placed" |

Neither `condition` nor `medication_request` nor `allergy_intolerance` has a `created_at`/`updated_at`
column in the schema, and `last_synced_at` is touched on every ingestion resync regardless of whether
anything actually changed — so it cannot be used as a freshness signal. This panel uses the best
available domain timestamp per table and documents the caveat rather than presenting false precision.

## Where it's implemented

- `apps/core/src/patient/patient.service.ts`: `getSinceLastVisit()`, `SinceLastVisit*` interfaces.
- `apps/core/src/patient/patient.controller.ts`: `GET patients/:id/since-last-visit`, audited as
  `PATIENT_SINCE_LAST_VISIT_VIEW`.
- `apps/web/src/components/SinceLastVisitPanel/SinceLastVisitPanel.tsx`: always-visible panel above the
  Copilot workspace composer (not gated behind a chip, matching the competitor panel's prominent
  placement).

Tested in `apps/core/src/patient/patient.service.spec.ts` (`getSinceLastVisit` describe block): no
previous encounter returns empty; boundary correctly filters by the previous encounter's start; no
dose-change pairing is attempted; response contains zero words from the existing blocklist word list.
`apps/web/src/components/SinceLastVisitPanel/SinceLastVisitPanel.test.tsx` additionally proves every
rendered item shares identical CSS classes regardless of type (no severity color-coding).
