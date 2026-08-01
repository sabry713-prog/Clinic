# Stabilization Audit — Veritas-Medica

**Branch:** `audit/feature-verification`
**Date:** 2026-07-25
**Scope:** front end (`apps/web`), core API (`apps/core`), orchestrator
(`services/orchestrator`), graph engine (`services/veritas-graph`), NPHIES
service (`services/nphies-engine`).

---

## Executive summary

The backend is in materially better shape than the front end. Every engine
audited — NSCRE graph queries, the NPHIES FHIR client, the inter-agent bus —
is implemented, tested, and verifiable against live data. **496 tests pass**
(88 veritas-graph, 57 orchestrator, 34 nphies-engine, 149 web, 168 core), and
both TypeScript projects typecheck clean.

The gap is almost entirely **integration**: working backends that no UI path
reaches, and UI surfaces still reading hardcoded mock constants. The prototype
demos well because the mocks are good, which is exactly what makes this
risky — several headline capabilities (ambient scribe, evidence chains,
inter-agent handoffs) look functional on screen while being entirely static.

Two findings are not "unfinished wiring" but genuine defects that should be
fixed before any further demo to an external party:

- **H-1** sends real patient data to an out-of-Kingdom LLM endpoint with the
  project's own PHI egress guard bypassed.
- **H-4** means the flagship "hover-to-source" explainability feature — the
  central claim of the product — renders nowhere in the default demo.

### Remediation status (updated 2026-07-25)

Phase 1 landed on `fix/phase-1-demo-and-ui-stabilization`:

| ID | Status |
|---|---|
| H-1 | **Deferred by decision** — DeepSeek is approved for the prototype phase on synthetic data, so no de-identification wrapper was added. Re-open before any real patient data reaches the platform. |
| H-2 | **Fixed** — core routes + web client + drawer invocation wired |
| H-3 | **Fixed** — real `useDictation` capture with an explicit Live/Demo toggle |
| H-4 | **Fixed** — evidence chains attached to mock orders and messages |
| M-1 | Open — Phase 4 |
| M-2 | **Fixed** — false success badges replaced with "Pending integration" |
| M-3 | **Fixed** — post-care drafted live via the new endpoint |
| M-4 | **Fixed** — timeline reads real observations/medications/encounters |
| M-1, M-5 – M-7 | Open — Phases 4-5 |
| L-1 – L-3 | Open — Phase 5 |
| L-4 | **Fixed** — `I25.1` added to mock order `o5` |

### Severity counts

| Severity | Count |
|---|---|
| High | 4 |
| Medium | 7 |
| Low | 4 |

---

## HIGH

### H-1 — DeepSeek egress bypasses the PHI residency guard

**Files:** `services/orchestrator/deepseek_client.py`,
`apps/narrative/src/narrative/model_client.py`

`packages/phi-guard` is the project's single decision point for outbound model
calls, and `.env` sets `PHI_EGRESS_POLICY=deidentify`. Two services that call
`api.deepseek.com` never consult it:

- `services/orchestrator/deepseek_client.py` — **zero** references to
  `phi_guard`, and `phi-guard` is not in its `pyproject.toml` dependencies.
- `apps/narrative` — no `phi_guard` usage anywhere, with
  `NARRATIVE_MODEL_PROVIDER=deepseek`.

`apps/qa` and `services/nphies-engine` *do* honour the guard, so this is an
inconsistency, not an accepted design.

**What actually crosses the boundary:** `generate_soap_note(transcript)` sends
the full encounter transcript. `format_agent_prose(facts, …)` sends NSCRE graph
facts including patient IDs, medication names, eGFR values, and rationales —
and every Sprint 8/10 agent (pharmacist, consultant, NPHIES, scribe,
receptionist) routes through it. `api.deepseek.com` classifies as `EXTERNAL`.

**Impact:** PDPL / data-residency exposure. The configured policy silently does
not apply on these paths.

> **Status: deferred by decision (2026-07-25).** DeepSeek is approved for the
> prototype phase against synthetic data, so Phase 1 deliberately left
> `deepseek_client.py` unchanged. That reasoning holds only while the data is
> synthetic — this finding must be re-opened before the platform touches real
> patient records, and the inconsistency with `apps/qa` and
> `services/nphies-engine` remains true in the meantime.

---

### H-2 — Sprint 10 agent bus and post-care engine are unreachable from the UI

**Files:** `apps/core/src/ai-team/ai-team.controller.ts`,
`apps/web/src/lib/api.ts`

`agent_bus.py` and `receptionist_agent.py` are complete and covered by 34
tests, and `agent_handlers.py` exposes `POST /api/v1/agents/handoff-chain` and
`POST /api/v1/agents/post-care`. But:

- `ai-team.controller.ts` declares exactly one route — `@Sse("stream")`. There
  is no proxy for either endpoint.
- `apps/web/src/lib/api.ts` has no client method for either. (The `handoff` key
  at line ~1279 is the unrelated shift-handoff feature.)

**Impact:** the entire Sprint 10 deliverable is dead code from the user's
perspective. Handoffs shown in the drawer are the four hardcoded `INITIAL_MESSAGES`
entries, not real routing.

> **Status: fixed (Phase 2).** `POST patients/:id/ai-team/handoff-chain` and
> `POST patients/:id/ai-team/post-care` added to `ai-team.controller.ts` with
> the same scope check, RBAC guard and audit events as the SSE route;
> `api.aiTeam.*` added to the web client; `SullyContext` invokes both on a
> debounced order/assessment change and renders each hop into the activity
> stream. Mounted under the patient path rather than the spec's bare
> `/api/v1/ai-team/...` so the scope check cannot be bypassed via a body
> parameter.

---

### H-3 — Ambient Scribe (left pane) is entirely mock, while a working implementation sits unused

**Files:** `apps/web/src/components/layout/panes/AmbientScribePane.tsx`,
`apps/web/src/hooks/useDictation.ts`, `SullyContext.tsx`

`AmbientScribePane` consumes only `useSully()`. Behind it:

- **Recording** — `toggleRecording` flips a boolean that starts a
  `setInterval` walking `MOCK_TRANSCRIPT`. No microphone is opened.
- **Transcript** — `MOCK_TRANSCRIPT.slice(0, lineCount)`, seven canned lines.
- **SOAP note** — `SOAP_STAGES[…]`, a six-stage canned reveal. DeepSeek's
  `generate_soap_note()` is never called from this pane.

A real implementation already exists in `apps/web/src/hooks/useDictation.ts`
(MediaRecorder + `POST /transcribe`) and is used by the older `AmbientPanel` —
just not by VeritasShell.

**Impact:** the headline "ambient scribe" capability is a scripted animation.

> **Status: fixed.** `AmbientScribePane` now uses `useDictation` for real
> capture, with an explicit "Live microphone" / "Demo playback" radio toggle.
> Demo playback is retained for offline use and is labelled "scripted sample —
> not a recording" so it can never be mistaken for a live capture. Live mode is
> disabled with an explanation when no encounter is open. SOAP generation
> (H-3b) remains on the canned stages and is still open.

---

### H-4 — Evidence chains never render in the default demo

**File:** `apps/web/src/components/layout/SullyContext.tsx`

`EvidenceChainPopover` only renders when `evidenceChain` is set. In
`SullyContext.tsx`, `evidenceChain` is assigned in exactly three places — all
inside the live `useAgentOrchestrator` effects. **No mock order line and no
mock message carries one.**

So without a live NSCRE *and* a real `patientId` routed into the shell, the
"Show Reasoning" / "View Evidence Chain" trigger appears **nowhere** — not on
agent messages, not on NPHIES badges.

**Impact:** the product's central differentiator is invisible in the demo path
most people will see. Highest demo-risk item in this report; also the cheapest
to fix (add one chain to a mock order and one mock message).

> **Status: fixed.** Three chains added to `SullyContext.tsx`, each attached
> only where it is clinically coherent: the captured Metformin renal chain on
> the Metformin handoff messages, an NPHIES necessity chain on the
> echocardiogram badge, and a code-mismatch chain on the angiography badge.
> Verified in the running app — "Show Reasoning" renders the full traversal.

---

## MEDIUM

### M-1 — All agent action cards are no-ops

**File:** `SullyContext.tsx` → `runAgentAction`

Every "Run" button across all five agent tabs — "Regenerate SOAP note",
"Insert into chart", "Adjust Dosage", "Check formulary tier", "Submit
Pre-Auth", "Fix code mismatch", "Book follow-up", "Send visit summary" —
calls `runAgentAction`, which appends `"<label> — requested."` to the message
list and does nothing else. No network call, no state change.

### M-2 — ReceptionistTab "Book" and "Dispatch" buttons do not book or dispatch

**Files:** `panes/AiTeamDrawer.tsx`, `ai-team/ReceptionistTab.tsx`

Both handlers route into `runAgentAction` (see M-1). The button shows a
spinner and a green "Booked" / "Dispatched" confirmation, but nothing is sent
and no appointment is created. The optimistic success state is misleading and
should be treated as a correctness bug, not just missing wiring.

### M-3 — Post-care package is hardcoded

`postCare` is `MOCK_POST_CARE`, a module constant. `receptionist_agent.py`'s
`run_post_care_workflow()` is never called from the UI (follows from H-2).

### M-4 — Timeline pane never reads real patient history

**File:** `panes/TimelinePane.tsx`

`timeline: MOCK_TIMELINE` — seven hardcoded entries. The data exists
(`GET /api/v1/patients/:id/observations`, `/medications`, `/encounters` are all
implemented in `patient.controller.ts`) but the centre pane never requests it.

> **Status: fixed (Phase 2).** New `usePatientTimeline` hook fetches all three
> in parallel via `Promise.allSettled`, merges them reverse-chronologically and
> renders lab values with the source's own reference range only -- no
> high/low flagging, no ordering by clinical importance. A single failing
> source degrades that section and surfaces a notice rather than blanking the
> timeline. Mock remains the demo-mode fallback.

### M-5 — "New order" and category filters have no handlers

`TimelinePane.tsx` contains **zero** `onClick` attributes. The "New order"
button and all four category chips (Medications / Labs / Imaging / Procedures)
are decorative.

### M-6 — NPHIES FHIR profiles are unverified placeholders

`GET :5006/health` reports `"profiles_verified": false`. The canonical URLs in
`config/nphies_profiles.json` are structurally plausible but were not taken
from the official NPHIES IG (documented in-file). Live submission would likely
be rejected on profile conformance.

This is *by design* pending CCHI onboarding and is correctly flagged at
runtime — listed here so it is not mistaken for readiness.

### M-7 — Smart checklist is local-only

`checklist` is `useState(MOCK_CHECKLIST)`; toggles never persist and reset on
unmount.

---

## LOW

### L-1 — Long-running dev services serve stale code

Observed during this audit: the process on `:5005` exposed only `/health` and
`/api/v1/agents/stream` — it was started before Sprint 10 and silently served
outdated routes, making working endpoints appear to 404. The same happened on
`:5004` during Sprint 10 (a process from an earlier session held the port and
the new one failed to bind).

Operational, not a code defect, but it has now caused false "broken endpoint"
signals twice. Worth a `just restart-services` target that kills by port.

### L-2 — Core API was not running during the audit

`:4000` was down. Everything depending on it (pre-auth submit, SSE status,
patient data) is unreachable until started. Not a defect; noted so the report
isn't read as "core is broken".

### L-3 — "Apply suggested code" on red badges is a no-op

Falls under M-1, called out separately because the label implies a concrete
state change to the order.

### L-4 — Mock red order has no ICD-10 code

`o5` (Coronary angiography) lacks `icd10Code`, so it could not be submitted
even if it offered pre-auth. Currently cosmetic — red badges route to "Apply
suggested code", not submission — but it will surface the moment that path is
wired.

---

## What genuinely works end-to-end

Worth recording, so remediation doesn't re-open solved problems:

- **NSCRE graph engine** — DDI, renal dose safety, NPHIES necessity, and
  alternative screening all execute deterministic Cypher against live Neo4j.
  Verified live: a real `CRITICAL_OVERRIDE` (Metformin, eGFR 22.05) with a
  correct evidence chain, and warfarin screening correctly rejecting all four
  NSAIDs.
- **Pre-auth submission path** — genuinely wired end-to-end:
  `TimelinePane` → `PreAuthModal` → `submitPreAuth` → `api.patients.submitPreAuth`
  → core `POST /patients/:id/nphies/pre-auth` → `:5006` → SSE status back into
  the badge. `patientId` and `encounterId` are both routed from
  `PatientDetailPage`. Correctly refuses to submit in demo mode rather than
  faking an approval, and only `approved` turns a badge green — `pended` stays
  visibly undecided.
- **NPHIES FHIR bundles** — validated against real FHIR R4B schema via
  `fhir.resources`, not hand-asserted.
- **Agent bus routing** — all five hops verified live, evidence chain preserved
  byte-for-byte, Plan draft never auto-applied.
- **Data-residency guard** — correctly fails closed for `nphies.sa` until
  explicitly allowlisted (this is what makes H-1's absence elsewhere notable).

---

## Fix checklist

Ordered by dependency, not just severity — items near the top unblock others.

### Phase 1 — Correctness and compliance

- [ ] **H-1a** Add `phi-guard` to `services/orchestrator/pyproject.toml` and
      route `_chat_completion()` in `deepseek_client.py` through
      `guard_outbound()`, passing patient names for de-identification.
- [ ] **H-1b** Do the same for `apps/narrative/src/narrative/model_client.py`.
- [ ] **H-1c** Add a test asserting that a PHI-bearing prompt to an external
      endpoint is refused under `PHI_EGRESS_POLICY=block` — mirroring
      `packages/phi-guard/tests/test_phi_guard.py`.
- [x] **M-2a** Remove the optimistic success state from `ReceptionistTab`'s
      buttons until they are wired, or disable them with an explanatory
      tooltip. Do not show "Dispatched" for something that was not sent.
- [x] **L-4** Add an `icd10Code` to mock order `o5`.

### Phase 2 — Make the demo honest (highest visible payoff)

- [x] **H-4** Add a realistic `evidenceChain` to at least one mock order line
      and one mock agent message so "Show Reasoning" renders without a live
      backend. Reuse the real captured chain from
      `docs/executive-demo/LIVE_DEMO_GUIDE.md`.
- [x] **H-3a** Replace `AmbientScribePane`'s mock recording with the existing
      `useDictation` hook; keep the mock as an explicit `autoStream` fallback
      for tests and offline demos.
- [ ] **H-3b** Wire the captured transcript to `generate_soap_note()` via a new
      core proxy route, replacing `SOAP_STAGES`.
- [ ] **M-5** Add handlers for "New order" and the category chips, or remove
      them until the order-entry flow exists.

### Phase 3 — Close the Sprint 10 loop

- [x] **H-2a** Add `POST patients/:id/ai-team/handoff-chain` and
      `POST patients/:id/ai-team/post-care` to `ai-team.controller.ts`, with the
      same `RequirePermission` + patient-scope + audit treatment as the existing
      SSE route.
- [x] **H-2b** Add `api.aiTeam.runHandoffChain()` and `api.aiTeam.postCare()`
      to `apps/web/src/lib/api.ts`.
- [x] **M-3** Replace `MOCK_POST_CARE` with a fetch from the new endpoint,
      keeping the mock as the demo-mode fallback.
- [ ] **M-2b** Point "Book" at the existing appointment API
      (`apps/core/src/patient-engagement/appointment.service.ts`) and "Dispatch"
      at `reminder-connector.service.ts`.

### Phase 4 — Remaining state wiring

- [ ] **M-1** Give each agent action card a real handler, or mark unimplemented
      ones visibly as coming soon.
- [x] **M-4** Fetch the timeline from `/observations`, `/medications` and
      `/encounters`, falling back to `MOCK_TIMELINE` in demo mode.
- [ ] **M-7** Persist checklist state.

### Phase 5 — Operational

- [ ] **L-1** Add a `just restart-services` target that kills by port before
      starting, so stale processes stop producing phantom 404s.
- [ ] **L-2** Document the required service set and ports in the demo runbook
      (`:3000 :4000 :5001-:5006 :7687`).
- [ ] **M-6** Track NPHIES IG onboarding; replace the placeholder canonical URLs
      and flip `verified_against_official_ig` when the real IG lands.

---

## Method

Static tracing of every UI element in `SullyShell` through `SullyContext` to
either an API client call or a module constant; route enumeration in the core
controllers; live `curl` against each running service; and full test-suite
execution. Findings marked as verified were confirmed against live services
and real Neo4j seed data, not inferred from code alone.
