# Veritas-Medica — Manual Feature Test Guide

Step-by-step walkthrough of every user-facing feature, with the expected
result at each step. Written against the current `feat/ui-light-theme`
branch. Synthetic data only — nothing here touches a real payer, patient,
or hospital system.

## 0. Start here

### 0.1 Bring the stack up

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres, Neo4j, Keycloak, MinIO
just migrate && just seed
just dev                                          # core :4000 + web :3000
```

`just dev` does **not** start the three AI services. Without them the
agent/scribe features degrade — start them too:

```bash
(cd services/veritas-graph && uv run uvicorn api_router:app --port 5004) &
(cd services/orchestrator && NSCRE_API_URL=http://localhost:5004 uv run uvicorn agent_handlers:app --port 5005) &
(cd services/nphies-engine && NPHIES_CONNECTOR=stub uv run uvicorn api_router:app --port 5006) &
(cd apps/transcription && uv run uvicorn api_router:app --port 5003) &   # live dictation
```

Quick health check: `curl localhost:500{3,4,5,6}/health` → all `{"status":"ok",...}`.

Model note: `.env` must set `MODEL_NAME=deepseek-chat` (not a reasoning-style
model). Reasoning models return their text in a hidden trace and leave
`content` empty — narrative/QA then degrade to fallback messages after
three empty retries instead of generating prose.

### 0.2 Test accounts (Keycloak realm `dev`, password `Test1234!`)

| User | Roles | Can test |
|---|---|---|
| `physician1` | physician | Everything clinical: encounter view, copilot, patient file |
| `admin1` | hospital_admin | All admin pages. **Patient list returns Forbidden by design** (`patient:read` is not in the admin role) — this is correct RBAC, not a bug |
| `nurse1` | nurse | Front-desk queue, appointments, intake |
| `pharmacist1` | pharmacist | Pharmacy refill queue |

### 0.3 Honesty list — things that are stubs BY DESIGN

File nothing against these; they are documented limitations:

- **NPHIES payer link is simulated.** The stub never returns "approved" from
  the payer; `green` badges come from graph necessity rules only.
- **SMS/OTP delivery is a stub.** Receptionist OTP codes are logged to the
  *server console*, never texted.
- **Smart Checklist has no backend.** State resets on refresh (see §3.4).
- **Pending-integration action cards** (dashed chips: "Adjust Dosage",
  "Insert into chart", "Book follow-up"…) are disabled with a reason —
  never dead buttons.
- **Demo playback transcript** is canned — labeled as such on screen.

---

## 1. Global chrome

1. **Login page** `http://localhost:3000/login`
   - Toggle **عربي/English** (top corner) → whole page flips direction and
     language live; the login button is a teal→indigo gradient pill.
   - Sign in as `physician1` → lands on `/patients`.
2. **Sidebar** — white, border-right (border-left in Arabic).
   - The active item is a **gradient pill** (teal→indigo, white text).
   - **Demo-mode chip** sits under the brand: amber pill with a pulsing
     dot — always visible, every page.
   - Collapse toggle at the bottom works; state persists across reload
     (`localStorage`).
3. **Command bar** — press `Ctrl+K` anywhere → overlay opens; type a
   patient name or action; Enter navigates. Esc closes.

---

## 2. Patient list

1. Rows load (20 per page) for `physician1`.
2. **Search** by name or MRN — debounced ~300 ms, list filters.
3. **Ward filter** — type a ward (e.g. `Ward-4A`).
4. **Load more** (white pill button) appends the next page.
5. Click any row → opens that patient's **workspace** view.
6. As `admin1`: the list shows a Forbidden card — expected (§0.2).

---

## 3. Encounter view (`?view=encounter`)

Open a patient, then click **Encounter** in the sidebar. Three panes fill
the screen exactly (no page scroll): scribe right, timeline center, AI team
left in Arabic (mirrored in English).

### 3.1 Ambient scribe — Demo playback (no microphone needed)

1. The capture-source toggle defaults to **Demo playback** when no patient
   is routed; with a patient open it defaults to **Live microphone**.
   Switch to *Demo playback*.
   - A small italic note appears: "scripted sample — not a recording".
2. Press **Record** → button turns red pulsing "Stop"; the waveform bars
   animate; the timer counts up.
3. Transcript lines stream in (clinician/patient labeled, timestamps).
   The feed auto-scrolls to the newest line.
4. Press **Stop** → animation and timer freeze.

### 3.2 Ambient scribe — Live microphone

1. Switch to **Live microphone** (needs the :5003 transcription service
   and an open patient; the button is disabled with an explanatory title
   otherwise).
2. Press **Record** → browser asks for microphone permission → accept.
3. Speak (English or Arabic) → a "Transcribing…" indicator shows, then
   lines appear as they are transcribed.
4. Stop recording. Errors (no mic, service down) show inline in red with
   an alert icon — never a crash.

### 3.3 SOAP draft

1. Below the transcript, four editable fields (S/O/A/P). In demo mode the
   note fills progressively from the canned transcript.
2. Type in any field → your edit sticks; nothing is written to the record
   from this pane (by design — the clinician stays the author).
3. **Regenerate SOAP** lives in the AI Team drawer (§3.6).

### 3.4 Smart checklist

How it works: it is a fixed six-item encounter checklist (3 items
pre-checked). It is a **pure UI aid** — clicking an item toggles a
line-through and the `done/total` counter in the section header updates.
It has no backend: refreshing resets it. To test:

1. Header shows e.g. `3/6` on the right.
2. Click "Order ECG" → gains line-through, counter becomes `4/6`.
3. Click again → unchecks, counter back to `3/6`.
4. Reload the page → back to the default `3/6` (expected, §0.3).

### 3.5 Timeline + orders (center pane)

1. **Patient master timeline** — entries with round icon dots sitting
   fully on the vertical rail (no clipping), newest details per entry.
2. **Category chips** (All / Medications / Labs / Imaging / Procedures)
   filter the order list below; clicking the active chip again clears the
   filter.
3. **NPHIES badges** on order lines:
   - 🟢 **green** — necessity rule matched (never means "payer approved").
   - 🟡 **yellow** — pre-auth required. Click the badge → **Pre-auth
     modal** shows the order, SBS + ICD-10 codes, and the SOAP text as the
     clinical document. Submit → activity stream shows the result; with
     the stub payer the outcome is a **pended** state, never approval.
   - 🔵 **blue "pended"** — submitted, payer undecided.
   - 🔴 **red** — code mismatch. Hover the badge → tooltip lists
     **suggested codes** with a fix-code action.
4. **New order** button → jumps to the workspace with the full
   order-entry panel open (§5.7).

### 3.6 AI Team drawer (left pane)

1. **Five agent tabs** — Scribe, Consult, Pharm, NPHIES, Recep — each
   tab's underline and action header carry that agent's identity color
   (rose/indigo/teal/blue/amber).
2. **Action cards** per agent:
   - *Regenerate SOAP* (Scribe) → calls the orchestrator; needs a live
     patient or posts "SOAP regeneration requires a live patient context."
     to the stream.
   - *Summarise prior encounters / Show related results* (Consultant) →
     posts a summary message; with NSCRE live, findings rows appear.
   - *Submit Pre-Auth* (NPHIES) → runs §3.5's pre-auth flow for the
     yellow-flagged order.
   - Cards with **dashed "Pending integration" chips** do nothing on
     click — by design, hover explains why.
3. **Activity stream** (bottom): every run appends a message with the
   agent's color and a timestamp. Findings rows (e.g. *DDI alert:
   Warfarin × …*, *Renal dose: Metformin (eGFR …)*) each carry an
   **Evidence** link → the cutaway popover (§3.7). Handoff messages show
   `source → target` agent chips.
4. Collapse/expand the drawer with the side-panel icon; the center pane
   reclaims the width.

### 3.7 Evidence-chain cutaway (the hero feature)

1. Click any **Evidence** link (drawer findings, badge tooltip, or
   "Show Reasoning").
2. The popover shows: **node chips** of the graph traversal, a **source
   facts** table (verbatim properties), and the **exact Cypher** in a dark
   terminal block — plus the object-equality guarantee line. For coding
   suggestions the query block is honestly labeled **"SQL executed"**.
3. Everything displayed is what the engine returned — no paraphrasing.

---

## 4. Chart view — Patient file (`?view=chart`)

1. **PatientHeader** — identity strip; **Allergies** and **Conditions**
   lists with *Show N more* pills.
2. Click any condition row → expands **every documented episode** (dates,
   status, ward, visit note). Click again to collapse.
3. **PatientBrief** — at-a-glance strip (conditions / meds / latest lab),
   condition-medication pairs, the **four clinic boxes** (Internal
   Medicine, Nephrology, Endocrinology, Cardiology) with their own
   *Show more* pills, labs grid, procedures, imaging.
4. **Observations** — category chips (All/laboratory/vital-signs/imaging;
   active chip = gradient) filter the table; **Load more** paginates.
5. **Medications** — active list, plain text (no clinical color-coding,
   by design).
6. **Reconciliation** — candidate duplicates, dose discrepancies, stale
   entries.
7. Values stay verbatim (never translated) in Arabic; dates flip to Hijri.

---

## 5. Copilot workspace (`?view=workspace`, the default)

One composer + one feed of cards. Type a question and press **Ask**, or
click any mode chip to open its card. Cards stack and stay open; each has
a header with a close (×) button.

| Chip | What to test | Expected |
|---|---|---|
| 5.1 **Consultant** (QA) | Ask *"What was the creatinine over the last three months?"* | Factual values with dotted-underline assertions + evidence pills; **Sources** toggle lists source facts |
| | Ask an interpretive question: *"Is her kidney function getting worse?"* | **Neutral refusal card** (dashed, muted, italic — never red/alarm) offering the recorded values |
| | Click **عربي/English** in the card header | Conversation clears; ask in Arabic → Arabic answer, values verbatim, direction flips |
| 5.2 **Diagnosis** | Search a condition (e.g. *hypertension*), select, confirm | Added to the problem list; header condition counts refresh |
| 5.3 **Researcher** (Narrative) | Generate | Factual narrative renders; hover/click provenance links to record facts |
| 5.4 **Handoff** | Generate (auto-opens card) | Shift handoff with documented-only sections |
| 5.5 **Draft** | Create a document; record dictation | Draft editable; save persists |
| 5.6 **Orders** | Full order entry: search a service, pick SBS code | ICD/SBS **suggest → confirm** flow; claim readiness badge appears inline |
| 5.7 **Claims** | Review claim readiness panel | Badges per line, coding queue, rejection risk, **1-click pre-auth** |
| 5.8 **Search** | Free-text record search | Matched record snippets |
| 5.9 **Interpreter** | Enter text, translate | Interpreter-mode output (bilingual) |
| 5.10 **Scribe** | Record → generate | Real transcription → **generated SOAP** → "open draft" hand-off |
| 5.11 **Refills** | Request refill | Queued for pharmacy |

Appointments and Intake cards open via the sidebar (nurse/admin) or
`?open=appointments` / `?open=intake` deep links.

---

## 6. Admin pages (sign in as `admin1`)

| Page | Steps | Expected |
|---|---|---|
| **Audit log** | Open *Audit log* → find the **tamper-detection card** → **Verify chain** | "N events, chain intact" |
| | **WORM export** | Export succeeds; object lands in MinIO (`audit/YYYY/MM/DD/*.ndjson.gz`); an audit event records the export |
| **Quarantine** | Review candidate duplicate identities → pick a reason → **Merge** / **Keep separate** | Gradient action buttons; queue shrinks; action audit-logged |
| **User management** | List users, roles | Read-only review surface |
| **NPHIES analytics** | Open | Rejection breakdowns by code/department |
| **Rejection cost** | Open | KPI cards (SAR at risk — illustrative, SAR 2,500/claim basis), gradient bars by department |
| **Claim simulator** | Pick a seeded claim → **Check before you send** | Deterministic verdict (send / do-not-send) with reasons; **sync notes to coder queue** button works |
| **Coder queue** | Review a flagged claim → approve code / return | Queue updates; decisions feed rejection analytics |

---

## 7. Front office

- **AI Receptionist** (`/receptionist`, opens in a new window): follow the
  booking conversation → slot offered → confirm. OTP codes appear in the
  **server console** only (stub, §0.3).
- **Front desk queue** (`nurse1`): appointment list → **Complete** /
  **No-show** actions update the row.
- **Pharmacy queue** (`pharmacist1`): refill requests → **Fill** completes
  the line.

---

## 8. RTL / Arabic spot-check

1. Log out → on the login page toggle to **عربي** → log in as
   `physician1`.
2. Whole app renders right-to-left: sidebar on the right, encounter
   panes mirrored, timeline rail/dots on the right edge of the feed.
3. Patient file: Arabic labels, **Hijri dates**, clinical values and code
   strings (e.g. `168 µmol/L`, `I10`) stay verbatim LTR inside RTL text.
4. Switch back to English via the login-page toggle after signing out.

## 9. Visual regression quick-pass (light v2)

After any UI change, confirm on: login, patient list, chart, workspace,
encounter, one admin page:

- Cards are white, 16–18px radius, soft layered shadow, `#ECEAF4` borders.
- Active nav/chips/buttons use the teal→indigo gradient; secondary
  buttons are white pills.
- Badges: green = payer/graph-confirmed only; amber = pended family; red =
  rejected/mismatch.
- No invisible text anywhere (white-on-white) — resize the window narrow
  and re-check wrapping rows.
