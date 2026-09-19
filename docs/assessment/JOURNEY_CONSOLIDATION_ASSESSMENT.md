# Journey Consolidation Assessment

**Date**: 2026-09-19 · **Scope**: make the Journey the doctor's single working surface.
**Status**: assessment only — no code written. Items marked P* are recorded in
`UNIFIED_DEMO_TO_PILOT_PLAN.md`; E* are the backlog's own (`ENGINEERING_WORK_BREAKDOWN.md`).

## 1. The directive

> "I don't want to use anything from the old development like encounter or etc. I need to unify the
> doctor — this is why we developed the new journey where the doctor will run everything within this
> wizard. Assess and come back with the needed changes so everything will be in the journey, not only
> for the diagnose step, for anything else which needs to be done outside the journey steps."

So the goal is not a better stage 2. It is that **no doctor task requires leaving the wizard**, and
that the surfaces which currently duplicate or shadow the journey are retired or absorbed.

## 2. Measured current state

`PatientDetailPage` renders **four** views for one patient (`PatientDetailPage.tsx:163-189`):

| view | component | who it is for | journey overlap |
|---|---|---|---|
| `workspace` | `PatientWorkspace` | the doctor's tool row (Consultant · Draft · Search · Interpreter) + "More tools" | none directly, but it is a **second** doctor surface |
| `chart` | `PatientFilePage` | read-only record (kept by explicit request) | none |
| `journey` | `JourneyView` | the encounter wizard (stages 1-5) | — |
| `encounter` | `CortexShell` | the 3-pane shell: scribe pane + timeline + AI Team drawer | **duplicates stages 1-3** |

The workspace's own comment already states the intended rule — "The Journey owns the encounter flow
(Document → Diagnose → Order → Code & link → Submit) … The row keeps what the Journey does not
cover" — with the duplicate chips moved to a menu: Diagnosis, Orders, Scribe, Coder
(`PatientWorkspace.tsx:66-79`). **Consolidation was started. The assessment below is what is left.**

## 3. Gaps that still put the doctor outside the journey

| # | Gap | Evidence | Consequence |
|---|---|---|---|
| **G1** | **Stage 2 reads the browser session, not the saved note.** Stage 1 saves the reviewed note to the record via the drafts API and its comment says the note becomes "reachable from later journey stages" — but `StageDiagnose` reads `sessionStorage['cortex.scribe.<id>'].soap.assessment` | `StageDocument.tsx` header vs `StageDiagnose.tsx:20` | Close the tab and step 2 shows "no assessment", although the note is on the record. The intended contract and the implementation diverge. |
| **G2** | **The smart checklist is not persisted.** It lives in React state; leaving the stage loses it | `CortexContext` + backlog **E4c** (`app.encounter_checklist` does not exist) | The clinician does checklist work that does not survive, and it is invisible to anyone else. |
| **G3** | **A confirmed diagnosis is not linked to the encounter or the note.** `hospital.condition` has no `encounter_id` and no document reference | column list verified; no condition↔encounter link in the source | "Which problems came from this encounter?" is unanswerable from the record, and per-encounter diagnosis reporting cannot be derived. |
| **G4** | **The payer check (stage 3) runs before the coding it depends on (stage 4)** | `StageOrder` reads `app.condition_icd_coding`, written by `icd-coding.service.ts` in stage 4 | Every order reads "not checkable" — recorded as **P2** (Option A). |
| **G5** | **The AI Team drawer lives only in the old encounter shell.** The journey's stage 1 renders the scribe pane without it | `CortexShell` vs `StageDocument` | The doctor must open the old surface to use the Consultant/Pharmacist/NPHIES agents. |
| **G6** | **Eight agent-action buttons do nothing** | backlog **E4a** | Buttons that look live are inert — worse than absent. |
| **G7** | **Stage 1 can save a note but cannot sign it inside the journey** | `DraftPanel` holds `api.drafts.update` + `sign` | Sign-off — a clinical act — happens on a surface outside the wizard. |
| **G8** | **NPHIES claim readiness detail is outside the wizard** | `ClaimReadinessPanel` / `/nphies/*` vs stage 5's summary | Stage 5 submits what another surface explains. |
| **G9** | **No self-pay path** | recorded **P1** | A cash patient's claim would be "accepted" by a payer that does not exist. |

## 4. Endpoints — to add or enhance

| # | Endpoint | Today | Action | Source |
|---|---|---|---|---|
| E-1 | `POST patients/:id/ai-team/soap` | **missing** (`generate_soap_note` exists, never called) | **add** — stage 1's real SOAP generation | **E4b** |
| E-2 | `app.encounter_checklist` + `GET/PUT patients/:id/encounters/:eid/checklist` | **missing** | **add** — checklist persistence | **E4c** |
| E-3 | `GET/POST patients/:id/drafts` + `:id/sign` | exists (`api.drafts.*`) | **enhance** — expose save **and sign** inside stage 1 | G7 |
| E-4 | `POST patients/:id/conditions` | exists | **enhance** — accept `encounter_id` (+ draft id) | G3 / P3 |
| E-5 | `PATCH patients/:id/service-requests/:orderId` | **missing** | **add** — order lifecycle (`active → completed/cancelled`) | order-lifecycle v2 |
| E-6 | provisional coding at stage 3 | **missing** | **enhance** (`icd-coding` exists; add the provisional read) | **P2** |
| E-7 | `POST patients/:id/nphies/eligibility` | exists | **enhance** — skip for self-pay; stage 5 becomes invoice | **P1** |
| E-8 | the 8 agent actions | missing/inert | **wire 4, label the rest "Pending integration"** — do not invent backends | **E4a** |
| E-9 | `runAgentAction` | exists in `CortexContext` | **move the AI Team drawer into the journey** | G5 |

## 5. What belongs inside the journey — the test

Raised in review: the AI Team may be needed for some tasks and is not mandatory for the encounter,
so why move it into the wizard? Why not leave it in a menu? The same question applies to every item
above, and it needs a rule rather than a preference.

**The test:**

1. Does the **next stage consume it**? Then it is inside. (Stage 2 cannot work without the note;
   stage 3 cannot be checked without the codes.)
2. Must the **record contain it** for the encounter to be complete or the claim to stand? Then it is
   inside. (A diagnosis must be tied to the encounter it was made in.)
3. Otherwise it is **situational**: the doctor reaches for it when the case calls for it, and it
   belongs one click away — **openable from inside the journey without losing the encounter**, but
   not a step.

That third clause is the one that matters for the AI Team: the requirement is not "make the agents a
stage", it is "do not force the doctor to leave the wizard to reach them." A drawer satisfies it; a
stage would not.

Applied to the items above:

| Item | Verdict | Where |
|---|---|---|
| Stage 2 reads the **saved** note | inside — dependency | stage 2 |
| Real SOAP generation (E4b) | inside — stage 1's core function | stage 1 |
| Save **and sign** the note | inside — produces the record | stage 1 |
| Checklist persistence (E4c) | inside — per-encounter by definition | stage 1 |
| Encounter linkage on the diagnosis | inside — record integrity | stage 2 |
| **The AI Team** | **situational** | **drawer/menu, openable in-journey** |
| The 8 inert agent buttons (E4a) | neither — fix in place | wherever they already live |
| Draft / Search / Interpreter / Handoff / Refills / Researcher | situational | menu |
| Appointments / intake / pharmacy queues | **not the doctor's** | sidebar (role-guarded) |

## 5. Prioritised plan

**Phase 1 — the journey becomes self-sufficient** (doctor never leaves)
1. G1/E-1: stage 2 reads the **saved** note (with the session as a fallback), stage 1 gains real SOAP generation.
2. G7/E-3: save **and sign** inside stage 1.
3. G2/E-2: checklist persistence.
4. G3/E-4: encounter linkage on the diagnosis write.
5. G5/G6/E-9/E-8 — **revised after review**: the AI Team is **situational**, not a stage. The
   requirement is only that it can be opened **from inside the journey without losing the encounter**
   (a drawer), and that the 8 inert buttons are wired where cheap or labelled "Pending integration"
   (E4a's own disposition). Nothing about the agents becomes mandatory per encounter.

**Phase 2 — the answers become correct**
6. P1/E-7 self-pay. 7. P2/E-6 provisional coding. 8. E-5 order lifecycle.

**Phase 3 — retire the duplicates** (decision required, nothing deleted without it)
9. Remove the Diagnosis / Orders / Scribe / Coder menu entries once the stages cover them.
10. Decide the fate of the `encounter` view (the Cortex shell). Its unique content is the AI Team
   drawer and the order timeline; once G5 lands and stage 3 carries the payer status, it has no
   doctor-facing function left — and it is the surface the directive names.

## 6. Second filter — needed? mergeable? automatable?

Standing instruction from review: for every feature or task in the journey, ask in order —

1. **Is it really needed?** (Does it exist because the encounter requires it, or because the screen
   was designed that way?)
2. **Can it be merged** into something the doctor already does?
3. **Can it be automated** so the doctor does not do it at all?

The goal is to cut the doctor's time and effort as far as the boundary allows. The boundary is
fixed: **never automate a clinical assertion or a signature.** Reads, derivations, persistence and
traversal are fair game.

Applied to the items above:

| Item | Needed? | Merge? | Automate? | Verdict |
|---|---|---|---|---|
| Stage 2 reads the saved note | yes — it is a dependency, not a feature | — | **already automatic**, just broken | fix the read path |
| SOAP generation (E4b) | yes — the note is the encounter's product | — | **yes: draft from the transcript, doctor edits** | **the biggest saving** |
| Save the note | yes | yes — no button | **yes: auto-save as it is edited** | removes G1 by construction |
| Sign the note | yes | — | **no — a signature is an explicit act** | keep one clear Sign |
| Checklist (E4c) | yes | **yes — fold into the note's completeness strip** | **yes: ticks derive from the note (already do)** | persist + merge, not a panel |
| Encounter linkage (P3) | yes | — | **yes: invisible, an id on insert** | correctness, zero doctor cost |
| AI Team | situational | — | **partly: auto-run the read-only ones** (Consultant summary; Pharmacist only when a medication is ordered; necessity already merged into stage 3) | drawer + auto-run where free |
| Order↔diagnosis link (step 4) | yes | **yes: one approval instead of taps** | **auto-link when unambiguous** (one candidate diagnosis), ask when not | fewer taps |
| Code confirmation (step 4) | yes | — | **no — the clinician confirms the code; that is the boundary** | keep |

**The structural finding.** The runbook itself says stage 2 is *"usually nothing to add"* and stage
4 is *"pre-checked → approve"*. So two of the five stages are frequently **no-ops** that still cost a
click and a screen each. The cheapest change in the whole list is therefore not a feature: **skip a
stage that has nothing for the doctor to decide, and say so.** Applied to stages 2 and 4 that is two
screens and two approvals saved per encounter, every encounter.

## 7. Revised plan, ordered by saving per day of effort

| # | Change | Effort | Doctor's saving |
|---|---|---|---|
| 1 | Fix stage 2 to read the **saved** note (session as fallback only) | 0.5 d | correctness; the assessment stops depending on a live tab |
| 2 | **Auto-save the note** as it is edited, one explicit **Sign** | 0.5 d | nothing to lose, nothing to press |
| 3 | **Skip a stage with nothing to decide** (stages 2 and 4, with the reason shown) | 1 d | **2 screens + 2 approvals per encounter** |
| 4 | Real **SOAP generation** from the transcript (E4b) | 3 d | **minutes per encounter** |
| 5 | Encounter linkage on the diagnosis write (P3) | 0.5 d | none — correctness only |
| 6 | Checklist: persist + fold into the note's completeness strip (E4c) | 1.5 d | one panel and one manual pass |
| 7 | Auto-run the read-only agents; drawer stays for the rest | 1 d | a click and a wait per use |
| 8 | Auto-link order↔diagnosis when unambiguous | 1.5 d | several taps per encounter |

**Progress.** Items 1 (`d03a2c8`), 3 for stage 2, and 5 (`de35738`) are done and verified; item 3
for stage 4, item 2, and the rest remain. Stage 4's skip needs the same treatment once its
"nothing to approve" condition is defined against live data.

**G10 — found while doing item 3: no in-stage manual coding path.** Stage 2's analysis catch block
says "manual entry still works below", and the render has no manual entry at all. So when the
vocabulary does not recognise the note, the only remedy the screen offered was a trip to the
Diagnosis card — a duplicate the consolidation removes. The remedy is a search box over the same
`suggestCodes` endpoint inside the stage; recorded as work, not as a wording fix.

**≈ 9.5 engineering days.** The first three (2 days total) remove the two screens and the lost-work
risk before any new capability is built; SOAP generation is the single largest time saver and comes
fourth because it is the largest piece of work.

## 8. Revised by review

The first version of this assessment proposed moving the AI Team **into** the journey. That
over-reached: the agents answer situational questions, and forcing them into the wizard would make
optional work look mandatory. The test in §5 now governs the whole list, and the only in-journey
requirement for them is reachability without context loss.

## 9. Boundary note

None of this adds clinical judgement. Every item is persistence, linkage, or surfacing a fact that
already exists. The one item that changes what the doctor is *told* — P2's provisional coding — is
labelled provisional and never reaches a payer.
