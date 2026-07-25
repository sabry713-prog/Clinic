# Veritas-Medica — Live Demo Guide (10 Minutes)

*A step-by-step script for whoever is driving the keyboard during an
executive demo. Follow the Demo Prep checklist the day before — every scene
below assumes it's already been run once.*

## Demo structure, and why it's split this way

Two things are true about this build today, and this guide is written
around both of them rather than around either alone:

1. **The `VeritasShell` UI (Scenes 1, 2, 4, 5) works flawlessly today with
   zero backend dependency** — `SullyShell`'s built-in demo data drives a
   fully interactive scribe pane, order entry with live-clickable NPHIES
   badges, an AI Team drawer, and evidence-chain popovers. This is the safe
   spine of the demo — nothing here can fail on stage.
2. **When a real patient is wired in with graph-computed data available**
   (see Prep step 3), the AI Team drawer's activity stream *also* receives
   genuine NSCRE-grounded messages appended live via Server-Sent Events —
   a bonus "this isn't a mockup" moment for a technical audience, on top of
   the guaranteed-flawless mock spine.
3. **Scene 3's exact "propose Metformin, live safety check fires" moment**
   is not yet wired to a UI order-entry trigger — proposing a *new* order
   and getting a live NSCRE check against it is built and working
   end-to-end (verified below), but today it's reached via the graph
   engine's own API, not a "place order" button in `VeritasShell`. Scene 3
   is written as a deliberate "let's look under the hood" cutaway for
   exactly this reason — for a CTO in the room, watching a real API call
   return real JSON is *more* convincing than a UI animation, not less.

Say this plainly if asked — it is more credible than pretending everything
is wired end-to-end, and it previews Slide 10's pilot roadmap ("wire order
entry to the live safety check" is a natural Week 1–2 pilot milestone).

---

## Demo Prep Checklist (run once, the day before)

**1. Start the full stack.**

```bash
just demo-setup && just dev
```

Confirms Postgres, Keycloak, and the standard core/narrative/qa/web
services are up. This does **not** start the Neo4j-backed graph services
used for the live cutaway in Scene 3 — start those separately:

```bash
# Neo4j (if not already running as a service/container)
# then, from services/veritas-graph:
NEO4J_URI=bolt://localhost:7687 NEO4J_AUTH=neo4j/veritas-dev-password \
  .venv/Scripts/python.exe -m uvicorn api_router:app --port 5004

# from services/orchestrator (grounds the AI Team drawer's live stream):
NSCRE_API_URL=http://localhost:5004 \
  .venv/Scripts/python.exe -m uvicorn agent_handlers:app --port 5005
```

**2. Log in.** `physician1 / Test1234!` (see `docs/demo-runbook.md`) for the
standard walkthrough patients. Note: this login's patient scope is derived
from `hospital.encounter.attending_user_id` — it does **not** automatically
include the two specific demo patients referenced in Scene 3 below (they
come from the larger synthetic FHIR seed used to build the knowledge
graph, a separate dataset from the 5 fixed walkthrough patients). If you
hit **"This patient is not within your care scope"** navigating to one of
them, either:

- log in as the hospital admin account instead (full scope), or
- grant scope explicitly, once, for the demo login:

  ```sql
  INSERT INTO hospital.encounter (id, patient_id, attending_user_id, status, started_at)
  VALUES (gen_random_uuid(), '<demo-patient-id>', '<physician1-user-id>', 'in-progress', now())
  ON CONFLICT DO NOTHING;
  ```

**3. Pick your patient for Scenes 1, 2, 4, 5.** Any patient works for the
mock spine. For the "bonus live AI Team stream" described above, use a
patient with real graph data and confirm at least one finding will surface
— e.g. the two identified below for Scene 3 (their real, current graph data
is described there). Navigate to `/patients/<id>?view=encounter`.

**4. Smoke-test Scene 3's live call once, before the room fills up:**

```bash
curl -s -X POST http://localhost:5004/api/v1/nscre/check-order \
  -H "Content-Type: application/json" \
  -d '{"patient_id":"ca76ab0b-f423-4a19-9a32-bb2a1a1b7d0f","proposed_drug_key":"metformin"}'
```

Expect a `dose_safety` array with one entry, `"flag":"CRITICAL_OVERRIDE"`.
If it comes back empty, the Neo4j reference data hasn't been (re-)ingested
— re-run `ingest_nscre_rules()` per `services/veritas-graph/nscre_engine.py`
before the demo, not during it.

---

## Scene 1 — Ambient Scribe in Action *(≈ 2 min)*

**Setup**: `VeritasShell`, Ambient Scribe pane (left column) visible.

1. Say to the room: *"This is a live encounter. I'm going to play a
   doctor-patient conversation and let the scribe do the writing."*
2. Click **Record**. Narrate a short simulated exchange out loud, in the
   cadence of the built-in transcript (chest tightness on exertion, no pain
   at rest, vitals, exam findings, plan) — the transcript pane fills in
   as you speak.
3. Point at the **SOAP note** panel on the same screen: *"Subjective,
   Objective, Assessment, Plan — filling in as the encounter happens, not
   typed afterward."* Show that every field remains a normal editable
   textarea — nothing here is locked behind the AI.
4. **Line to land**: *"The clinician still owns every word. The scribe just
   removes the typing."*

---

## Scene 2 — Automated Order Entry & NPHIES Validation *(≈ 2 min)*

**Setup**: Center pane, Clinical Order Entry section, scrolled into view.

1. Point at the order line for **Echocardiogram, transthoracic** — its
   badge reads 🟡 **Pre-auth required**.
2. Click the badge. The tooltip opens: *"Pre-authorisation required by the
   payer before this service can be claimed."*
3. Click **Submit Pre-Auth**. Point at the AI Team drawer's activity
   stream on the right — a new line appears: *"Submit Pre-Auth —
   requested."*
4. Now point at **Coronary angiography** — 🔴 **Code mismatch**. Open its
   badge: *"No recorded necessity rule links this procedure to the
   documented diagnoses. High rejection risk"* — with two **suggested
   replacement codes** shown directly in the tooltip.
5. **Line to land**: *"This is the moment that normally happens two weeks
   later, as a rejected claim. Here it happens before the order is even
   signed."*

*(If narrating a fresh order instead of the two shown by default: "ordering
a Lumbar MRI" produces the same 🟡 pattern — pick whichever order line on
screen best matches the story; the mechanism is identical for every line.)*

---

## Scene 3 — NSCRE Safety Check: Under the Hood *(≈ 2 min)*

**Setup**: switch to a terminal window alongside the browser (or a second
monitor) — this is the deliberate "let's look under the hood" cutaway
described above.

1. Say: *"Let's simulate a doctor proposing Metformin for a patient with
   significantly reduced kidney function — an eGFR of 22, well under the
   safe threshold. Watch what the reasoning engine does before any text is
   generated."*
2. Run the prepared call (same as Prep step 4):

   ```bash
   curl -s -X POST http://localhost:5004/api/v1/nscre/check-order \
     -H "Content-Type: application/json" \
     -d '{"patient_id":"ca76ab0b-f423-4a19-9a32-bb2a1a1b7d0f","proposed_drug_key":"metformin"}' \
     | python -m json.tool
   ```

3. Point at the response as it prints:
   - `"flag": "CRITICAL_OVERRIDE"`
   - `"egfr_value": 22.05`, `"threshold": 30.0`
   - `"rationale": "Metformin is contraindicated below eGFR 30 due to
     accumulation risk and lactic acidosis."`
   - the full `evidence_chain.rendered` string — read it aloud:
     `Patient(...) -> LabResult(test=eGFR, value=22.05, ...) ->
     Medication(name=Metformin) -> Rule(flag=CRITICAL_OVERRIDE, ...)`
4. **Line to land**: *"That entire result — the flag, the number, the
   rationale — came from one deterministic query against this patient's
   actual lab history. No language model touched any of those facts. The
   language model's only job, which you'll see next, is to turn this exact
   JSON into a sentence a clinician reads comfortably — never to decide
   what the JSON says."*

---

## Scene 4 — Inspecting Evidence Chains *(≈ 1.5 min)*

**Setup**: back to the browser, AI Team drawer, activity stream.

1. Find any agent message or NPHIES badge tooltip that shows a **"Show
   Reasoning"** / **"View Evidence Chain"** button — every live-grounded
   message and every order badge carries one.
2. Click it. The panel opens showing the graph traversal as a chain of
   chips: `Patient → LabResult → Medication → Rule`, plus the full rendered
   path as a monospace string underneath.
3. **Line to land**: *"This is the same evidence chain you just watched
   come out of the terminal in Scene 3 — rendered for a clinician instead
   of a developer, but it is not a summary. Every chip here is a real node
   the graph query actually returned. Click it, and you're not being asked
   to trust the AI — you're being shown the query."*

---

## Scene 5 — AI Team Collaboration *(≈ 2.5 min)*

**Setup**: AI Team drawer, tab bar at top.

1. Click the **Pharm** (Pharmacist) tab. Point at its action cards —
   *"Adjust Dosage"*, *"Check formulary tier"*. Click **Run** on one; show
   the activity stream update in real time.
2. Click the **Consult** (Consultant) tab. Point at its actions —
   *"Summarise prior encounters"*, *"Show related results"*. Click **Run**.
3. If a real patient with live graph data is loaded (Prep step 3), point
   out that the activity stream may already contain a message that
   *wasn't* triggered by a button click at all — it arrived automatically
   over the live SSE connection the moment the page loaded, sourced from
   the same NSCRE engine shown in Scene 3.
4. Collapse and re-expand the drawer (the panel-toggle button in the
   header) to show it doesn't lose state.
5. **Line to land, closing the demo**: *"Four specialists, one shared
   evidence stream, one shared graph of facts underneath all of them. None
   of them can disagree with the patient record, because none of them are
   allowed to invent one."*

---

## If something goes wrong on stage

- **AI Team drawer shows nothing new / feels static**: that's fine — it's
  running on the guaranteed mock spine described at the top of this guide.
  Don't apologize for it; narrate Scenes 1/2/4/5 exactly as written, they
  don't depend on any live service.
- **Scene 3's curl comes back empty**: fall back to narrating the JSON
  shown in this guide directly (it's a real, previously-captured response,
  reproduced verbatim above) while you fix the environment after the
  meeting — say *"let me show you the exact output from our last verified
  run"* rather than re-running a broken call live.
- **Login shows "This patient is not within your care scope"**: use the
  hospital admin login, or skip straight to Scene 3's terminal cutaway,
  which doesn't require the browser session at all.
