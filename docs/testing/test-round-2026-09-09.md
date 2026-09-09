# Test Round Record — 2026-09-09

Recorded during a live execution round against branch `feat/ui-light-theme`
(commit `16bbbb4`), English locale. Every step below was actually performed
in the browser; the **Result** column is what happened this round.

Use this as your manual testing script: follow the steps in order, compare
what you see with the recorded result, and file anything that differs.

## Environment (Step 0)

| Check | How | Recorded result |
|---|---|---|
| Docker infra | `docker compose -f docker-compose.dev.yml up -d` | 6/6 containers healthy (Postgres, Neo4j, Keycloak, MinIO, Jaeger, Mailpit) |
| Core API | `curl localhost:4000/api/v1/health` | `status: ok`, all modules, `profile: clinical` |
| Web | open `http://localhost:3000/login` | login page renders |
| AI services | `curl localhost:500{1..6}/health` | 6/6 healthy |
| LLM config | `.env` → `MODEL_NAME=deepseek-chat` | set (a reasoning model breaks narrative/QA — see guide §0.1) |

## A. Login (physician1 / Test1234!)

1. Open `http://localhost:3000/login` → hospital sign-in button visible.
2. Click **Sign in with Hospital Identity** → Keycloak form appears.
3. Enter `physician1` / `Test1234!` → redirected to `/patients`.
   **Result: PASS** — landed on the patient list as Ahmad Al-Zahrani.
4. Language: sign out, click **Toggle language** on the login page, sign in
   again → whole app flips EN↔AR including direction.
   **Result: PASS** — verified in both directions this round (tested EN).

## B. Patient list

1. List loads rows for `physician1` (20 per page). **Result: PASS — 6 rows in scope.**
2. Type `MRN-009` in search → filters after ~300 ms debounce. **Result: PASS — narrowed to the one patient.**

## C. Copilot workspace (`?view=workspace`)

1. Open a patient (default view). Composer + 11 mode chips render.
2. Ask a factual question in the composer:
   *"What was the creatinine over the last three months?"* → press **Ask**.
   **Result: PASS** — QA card opened with real values, dates and reference
   ranges (e.g. `13 Aug 2026 — 102.9 μmol/L (ref: 59-104)`), no invented prose.
3. Click **Show sources (1)** under the answer.
   **Result: PASS** — source facts expand.
4. Ask an interpretive question in the card input:
   *"Is her kidney function getting worse?"* → press **Send**.
   **Result: PASS** — neutral dashed refusal card, typed reason
   *"trend interpretation — outside this tool's factual scope"*, fact offer
   included. Note: the fact offer said "No values found" because no coded
   lab matches the phrase "kidney function" — honest, not a bug.

## D. Patient file (`?view=chart`)

1. Page loads: identity header, allergies, conditions, brief, observations,
   medications, reconciliation.
2. Click any condition row (e.g. *Ear pain*) → expands every documented
   episode with SNOMED code, dates, status, ward.
   **Result: PASS** — expanded `Code: 16001004 (SNOMED) · 3 documented episode(s)`.
3. *Show N more* pills and the Observations category filter work as in the
   guide §4.

## E. Encounter view (`?view=encounter`)

1. Three panes fill the screen; no page scroll.
2. Scribe: switch source to **Demo playback** → press **Record**.
   **Result: PASS** — button red/pulsing, waveform animates, transcript
   streams with speaker labels + timestamps.
3. Smart checklist: click any item.
   **Result: PASS** — line-through toggles, counter updates (3/6 → 2/6
   when unchecking). Resets on refresh by design (no backend).
4. Orders: click a **Pre-auth required** badge.
   **Result: PASS** — modal opens with the order (Echocardiogram), confirmed
   codes, and the honesty line ("sent exactly as shown — nothing generated").
5. Evidence chain: click the **Code mismatch** badge → tooltip stays open →
   click **View Evidence Chain**.
   **Result: PASS** — floating panel with graph traversal chips + source
   facts. (Mock order lines carry no verbatim query, so the Cypher/SQL
   section is absent there — real NSCRE findings include it.)
6. AI Team: Scribe tab → **Run** (Regenerate SOAP).
   **Result: PASS** — stream: "Regenerating SOAP note…" → "SOAP note
   regenerated successfully."
7. AI Team: Consultant tab → **Run** (Summarise prior encounters).
   **Result: PASS** — full structured summary (identity, active problems…)
   generated from the real narrative service.

## F. Admin pages (admin1 / Test1234!)

Switch user: sign out, sign in as `admin1`.

1. **Audit log** → Tamper detection card → **Verify**.
   **Result: PASS** — "Hash chain intact — 12695 events verified, hashes
   recomputed." **Export to WORM** button present.
2. **Claim simulator** → press **Check** on a row.
   **Result: PASS** — deterministic verdict rendered, e.g. "Fix before send,
   I10→11700-00-10, GREEN" with an Evidence link.
3. **Coder queue** loads with the review queue. **Result: PASS.**

## Findings this round — FIXED (same day)

1. **Admin pages rendered for non-admins via direct URL.**
   FIXED: `RequireRoles` guard (apps/web/src/components/common/
   RequireRoles.tsx) now wraps every `/admin/*`, `/pharmacy/queue`, and
   `/front-desk/appointments` route. A physician visiting `/admin/audit`
   gets an access-denied card naming the required roles — verified live
   (admin1 still sees the queue; physician1 is denied, nothing renders).
   Backend RBAC remains the enforcement point; the guard only stops the
   UI from rendering pages whose actions would 403.
2. **Denied admin actions failed silently.** FIXED: the audit page's
   Verify / WORM errors now render as a visible rejected-state banner
   with a clear "Not authorized — requires an administrator role"
   message for 403s (was near-invisible muted text).
3. The stuck Keycloak page reported at the start of the session was caused
   by all services being down after a machine restart — resolved by
   bringing the stack back up (Step 0).

Re-test after the fix: as `physician1`, open `/admin/audit` → expect the
access-denied card (not the audit page). As `admin1` → the page and Verify
work as recorded in section F. Guard covered by
`RequireRoles.test.tsx` (allow / deny / no-user).
