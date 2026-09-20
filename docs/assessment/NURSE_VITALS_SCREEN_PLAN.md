# Nurse vitals screen — plan

**Asked for:** a screen for the nurse to record vital signs; whatever else the nurse is needed for; and a
look at Sully's "AI Nurse" as a reference. Assessment only — nothing built.

## 1. Reference: Sully's AI Nurse

Sully.ai markets nine agents on its products/pricing pages, two of them nurse-facing: **AI Nurse** and
**AI Triage Nurse** (alongside AI Scribe, AI Consultant, AI Pharmacist, AI Medical Coder, AI
Interpreter, AI Receptionist, AI Researcher) — `sully.ai/products`, `sully.ai/pricing`, retrieved
2026-09-20. Marketing figures on that page (**100,000+ providers**, **400+ organisations**, **21x ROI**,
**5-15% revenue lift**) are vendor claims and are **[unverified]**.

Sully's own blog post *"AI Scribe for Nurses and What Shift Documentation Actually Needs"* (Aug 6, 2026)
states the axis worth stealing: *"Most AI scribes are built for physician visits—not nursing shifts"*,
and names what a shift-shaped tool must handle — **timestamps, flowsheets, and handoffs**. The post body
could not be read reliably (the page returned images and gradients), so that teaser is the only part
quoted; the rest of its content is **[unverified]**.

**What we adopt:** the shape, not the product. A **worklist** (nursing works a shift, not an encounter),
**timestamped** values, a **flowsheet** view of what has been recorded over the shift, and the handoff as
a first-class output.

**What we do not adopt:** interpretation. Sully's agents advise, triage and summarise. Our boundary is
fixed (CLAUDE.md §2, SFDA MDS-G027): the system records what was measured and never decides what it
means. No early-warning score, no severity flag, no "abnormal" verdict — those are clinical judgements.

## 2. What already exists

* `hospital.observation` (21 columns) already carries everything a capture needs: `patient_id`,
  `encounter_id`, `category`, `code_system`, `code`, `code_display`, `value_numeric`, `value_text`,
  `unit`, `ref_range_low/high/text`, `status`, `effective_at`, `fhir_resource_json`, `based_on`. Nothing
  new is required to store a vital sign.
* Vitals already flow **out**: the SOAP Objective reads them (`CortexContext` nurseVitals), the handoff
  reads the last value per code, and **claim readiness fails an order when `vital-signs` evidence is
  missing** (`claim-readiness.service.ts:322`). So a missing capture is not cosmetic — it is a
  claim-readiness finding.
* They do **not** flow **in** from a human: the only writers are the HIS ingestion service and the dev
  seeds. There is no nurse, no capture form, and no `observation:write` permission.

## 3. The screen

**`/nurse/queue`** — a worklist, not a patient page. The app already has this shape for other roles
(`/pharmacy/queue`, `/front-desk/appointments`), role-guarded the same way.

1. **Worklist**: today's encounters for the ward, each showing whether vitals were captured and when.
   Sorted so the uncaptured come first — the nurse's effort goes to the patients who need it, not to
   hunting through records.
2. **Capture**: one short form per patient — the standard set (blood pressure, heart rate, temperature,
   respiratory rate, oxygen saturation, weight; height where relevant), each with its unit and the
   time it was measured. Values are typed or read from the device; nothing is prefilled from anywhere,
   because a prefilled vital sign is an invented measurement.
3. **Write**: `POST /patients/:id/observations` → `hospital.observation` with `category =
   'vital-signs'`, `source_system = 'nurse-entry'`, `effective_at` from the nurse, LOINC `code` +
   `code_display`, and the standard FHIR `Observation` JSON. Same pattern as the clinician-entered
   condition: a human entry into the mirrored record, attributed to the person who made it.
4. **Immediately useful**: the encounter's Objective fills itself (already implemented), claim
   readiness stops failing on vitals, and the handoff's "Recent Vitals" section has something to show.

**A sourcing task precedes the coding.** LOINC codes must come from LOINC, not from memory — and our own
reference file cannot supply them: `docs/reference/clinical-vocabulary/LOINC_1.6_Top2000CommonLabResultsUS.csv`
is a lab-results list and carries temperature (`8310-5`), weight (`29463-7`) and oxygen saturation
(`2708-6`) but **not** blood pressure, heart rate or respiratory rate. Fetch the **Vital Signs** group
from LOINC.org, store it beside that file with the same re-runnable generator discipline, and only then
wire the form.

## 4. What else the nurse is needed for

Applying the same filter as the journey (`JOURNEY_CONSOLIDATION_ASSESSMENT.md` §6): needed, mergeable,
automatable — and never a clinical judgement.

**Phase 1 — with the vitals screen:**
* the worklist itself (see §3);
* confirming the patient's identity and the reason for visit **as recorded at intake** — the intake
  capture already exists for reception; the nurse screen **shows** it and lets the nurse correct the
  contact details, rather than adding a second intake to keep in sync;
* pain score where the ward uses one — a recorded number, like the others.

**Phase 2 — later, each its own decision:**
* **medication and allergy reconciliation**: recording what the patient says they take, and what they
  report reacting to. This is recording, not deciding — but it writes to mirrored tables that today are
  HIS-fed, so it needs the same "who is the source of truth" decision as the vitals write in PROD.
* **shift handoff for nursing**: Sully's third axis. The doctor's handoff exists; a nursing shift
  handoff is a different document with different fields, and is not a skin over it.
* **flowsheet view**: the shift's values in a row per patient, which is what makes a shift readable —
  but it is a view, and views are cheap once the capture exists.

## 5. Boundaries and decisions

* **New permission** `observation:write`, granted to `nurse` (and to `physician`, who also records
  vitals in practice). No new role is needed — `nurse` already exists in RBAC.
* **Non-SaMD**: recording only. Reference ranges may be **stored** (the column exists) but the open
  question below decides whether they are **shown**.
* **PROD question**: in production the hospital's HIS is where nursing records vitals. Either this
  screen becomes the capture surface that feeds the HIS, or the HIS stays the capture surface and this
  screen is the DEV/gap-filler. The delivery doctrine says every simulation is replaced by the real
  thing before go-live, so this must be decided before the pilot, not after.

## 6. Open questions for the owner

1. **Reference ranges**: show the normal range beside a value, or not at all? Showing a range is
   information; colouring a value against it is the system telling the nurse it is abnormal — which is
   the interpretation boundary. My recommendation: show the range as stored data, never colour it.
2. **Which set** is "the standard set" for this hospital's wards — the six above, or more?
3. **PROD capture surface** (§5).

## 7. Effort, once the above is agreed

| # | Item | Effort |
|---|---|---|
| 0 | Fetch + store the LOINC Vital Signs group (sourced, with a generator) | 0.5 d |
| 1 | `observation:write` permission + the observation write endpoint (scope, RBAC, audit) | 1 d |
| 2 | `/nurse/queue` worklist (uncaptured first) | 1.5 d |
| 3 | The capture form + validation (ranges, units, no prefills) | 1.5 d |
| 4 | Tests: endpoint, permission, the form, and that claim readiness flips to pass | 1 d |
| 5 | Flowsheet view (phase 2) | 1 d |
| — | **Phase 1 total** | **≈ 5.5 days** |
