# Handover Verification Audit

**Date:** 17 September 2026
**Repo:** `D:\New folder\Clinic` · branch `feat/ui-light-theme` · HEAD `88ead32` (15 commits since baseline `d0fbf96`)
**Claim under audit:** *"All pre-production technical items are now complete. Every item from the readiness assessment is either done or requires external parties (clinical dataset, hospital agreement, NPHIES certification). The system is technically ready for the specialist demo and pilot application."*
**Audited against:** `docs/reports/FINDINGS_AND_RECOMMENDATIONS_REGISTER.md` (35 findings: C01–C10, H01–H07, M01–M12, L01–L06)

**Evidence standard:** a commit message is not evidence. Every verdict below rests on a cited file:line, a live probe, a database/graph query, or a test run. Work marked **[P]** was verified directly by the parent session; **[W]** by an independent verification workstream, with commands and outputs recorded.

---

## 1. Verdict

**The completion claim is not sustained.** Of 35 findings: **0 fully verified as complete**, **21 partial**, **13 not done**, 1 refuted-by-test. The direction of travel is genuinely right — several controls are real and working — but the demo cannot currently be brought up, the evidence chain cannot produce a finding, and two pre-PHI gates are broken at the schema level.

**Most important:** the documented one-command bring-up is broken. `just migrate` fails, so `just demo-setup` and `just demo` cannot complete.

| Group | Verified | Partial | Not done |
|---|---|---|---|
| C01–C10 (pre-demo Criticals) | 0 | 9 | 1 (C10) |
| H01–H07 (pre-demo Highs) | 0 | 6 | 1 (H05) |
| M01–M12 (pre-pilot) | 0 | 5 | 7 |
| L01–L06 (production) | 0 | 0 | 6 |

---

## 2. What is genuinely done (verified working)

| Item | Evidence |
|---|---|
| **H02 core health** **[P]** | `/health` liveness, `/health/ready` with live dependency checks (`postgres up 31ms`, `veritas-graph up 12ms`, `orchestrator up 10ms`), `/health/preflight` running real read-only queries (`patient_count`, `audit_events`). `apps/core/src/health/health.controller.ts:48-119` |
| **C08 disclosure (API level)** **[P]** | NPHIES engine and core readiness both report `connector_mode: stub`, `profiles_verified: false`; live submission path throws (`connector.service.ts:66-73`) |
| **C05 honest degradation** **[P]** | Live NSCRE call returns `overall_defer: true` with named `evidence_gaps` — unknown does not render green |
| **C06 runtime engine** **[P]** | ASR is `faster-whisper:large-v3`, not stub; UI has explicit live/demo radio + "scripted sample — not a recording" (`AmbientScribePane.tsx:198-231`) |
| **C07 container bindings** **[P]** | All 11 published ports are `127.0.0.1:` (`docker-compose.dev.yml:10,33,55-56,71-73,84-85,100-101`) |
| **C09/M11 checksums** **[W]** | `data/reference-release-manifest.json` v2026-09-15.1 with 10 sha256 entries — **10/10 verified** by test; `verify_reference_release.py:21-76` |
| **Audit chain** **[P]** | `audit.event` — 16,531 rows with `hash_prev`/`hash_self`/actor/action/outcome |
| **M09 coder-queue code** **[W]** | Genuinely Postgres-backed (`coder-queue.service.ts:110-176`) — but the table does not exist (see B1/B8) |
| **C03 source parsing** **[W]** | `synthesis.py:276` now parses model-emitted `[N]` deterministically (`:104-139`); word-overlap reduced to fallback |
| **Duplicate transcript keys (H04 sub-item)** **[W]** | Fixed — `SullyContext.tsx:209-217,801-818`, demo-XOR-live at `:990-991` |
| **Quality gates** **[P]** | `typecheck` PASS 8/8; `build` PASS 5/5 |

---

## 3. Blocking findings

### B1 — The documented bring-up is broken: migrations fail to load **[P]** — **CLOSED 17 Sep, see §10**
`node-pg-migrate` cannot parse three new migration filenames (they use `-` where the convention is `_`, and `1720000000000` is reused):

```
$ pnpm exec node-pg-migrate up -m migrations --envPath ../../.env --dry-run
Can't determine timestamp for 1720000000000-dsr-completion.ts
Can't determine timestamp for 1720100000000-coder-queue-durable.ts
exit=1
```

- Affected: `apps/core/migrations/1720000000000-dsr-completion.ts`, `1720100000000-coder-queue-durable.ts`, `1720200000000-ingestion-partial-status.ts`
- Live DB has 22 migrations applied; **none of these three**.
- **Consequence:** `just migrate`, `just demo-setup` and `just demo` cannot complete. A clean demo bring-up is currently impossible.
- **Consequence (causal):** the three M-commits (M07 DSR, M09 coder queue, M05 partial status) are inert at the schema layer — their code queries tables/columns that were never created. This single defect explains much of §4-M.

**Fix:** rename to the `_` convention with unique timestamps (`1720300000000_dsr-completion.ts` etc.), re-run `just migrate`, and add a migrations smoke check to CI.

### B2 — Zero-auth session minting still enabled by default **[P]** — **CLOSED 17 Sep, see §10**
```
POST http://localhost:4000/api/v1/dev/session  {"external_subject":"00000000-0000-0000-0000-000000000010"}
→ HTTP 201 {"session_id":"ddef7036-fa91-4c31-8b33-37aaf24eeaec"}
```
`.env.example:187-188` carries the comment "demo builds leave this unset" immediately followed by `DEV_SESSION_ENABLED=true`; `.env:140` is also `true`. The gate requires exactly `"true"` (`dev-session.controller.ts:38-55`), so it opens by default.

**Fix:** `false` in both files, or delete the endpoint from demo builds.

### B3 — Three internal services still exposed on all interfaces with no authentication **[P]** — **CLOSED 17 Sep, see §10**
| Port | Service | Binding | Off-LAN probe |
|---|---|---|---|
| 3000 | web | `0.0.0.0` | 200 |
| 4000 | core | `0.0.0.0` | 404 (answering) |
| 5004 | veritas-graph | `0.0.0.0` | 200 |
| 5005 | orchestrator | `0.0.0.0` | 200 |
| 5006 | nphies-engine | `0.0.0.0` | 200 |
| 5001/5002/5003 | narrative/qa/transcription | `127.0.0.1` | 000 ✅ |

The graph service declares **no authentication at all** (`securitySchemes: {}`, global `security: NONE`) and exposes `POST /api/v1/nscre/evaluate-encounter`, which returns findings for any patient ID — bypassing core RBAC and patient scope. Confirmed in the service log: `Uvicorn running on http://0.0.0.0:5004`. **[W]** additionally found no service-auth mechanism anywhere (`INTERNAL_SERVICE_TOKEN`/`X-Service` absent) and no NetworkPolicy templates in Helm.

**Fix:** bind all six services to `127.0.0.1` in dev/demo; add a service token or mTLS before any multi-host deployment.

### B4 — C10: manually typed SOAP still never reaches Stage 2 **[P]** + **[W, proven by test]**
`SullyContext.tsx:769-777` persists only `liveSoap` and early-returns when `liveTranscript.length === 0 && liveSoap == null`. Manual edits go to `soapOverride` (`:1205-1207`); the merged `soap` (`:1092-1095`) is never persisted. `StageDiagnose.tsx:19-30` reads only `sully.scribe.<patientId>`.

Workstream proof (scratch vitest, file removed after): `C10 EVIDENCE: sessionStorage['sully.scribe.pt-typed'] = null`. The same holds for `StageOrder.tsx:24` and `ServiceRequestPanel.tsx:127`. The `Save note to record` button (`StageDocument.tsx:41-100`) writes a *server draft* that no later stage reads. There is **no journey E2E spec** in `tests/e2e/`, and the four existing specs are skippable.

**Fix:** persist the merged note (and overrides) in the mirror effect; loosen the restore guard; make Stages 2/3 fall back to the drafts API; add a non-skippable journey E2E.

### B5 — No patient projection: the evidence chain defers for every patient **[P]** — **PLUMBING FIXED 17 Sep, see §11; two data gaps remain**
NSCRE reads Neo4j only (`nscre_engine.py:78-93`). `etl_pskg.py` is the only Postgres→Neo4j projection and is **wired into no justfile recipe**. Neo4j holds **0 `Patient` nodes** while demo patient MRN-009 has **6 medications and 105 observations** in Postgres.

```
POST :5004/api/v1/nscre/evaluate-encounter  (patient 3dfa474c-…)
→ {"drug_interactions":[], "dose_safety":[], "necessity":[], "overall_defer":true,
   "evidence_gaps":[{"check":"drug_interactions","detail":"No active medications found…"},
                    {"check":"dose_safety","detail":"No eGFR result found…"}]}
```

Reference layer is also thin: `NphiesDiagnosis` 6, `NphiesService` 5, `NPHIES_JUSTIFIES` 8 (manifest expects 100+/100+/500+). Total graph: 69 nodes, 63 relationships.

**Fix:** run `etl_pskg.py` for the demo cohort and add it to `just demo-setup`; assert manifest counts in the same recipe.

### B6 — Demo images do not build **[W, real build run]**
`docker build -f apps/qa/Dockerfile.demo apps/qa` → **exit 2**: `cannot normalize a relative path beyond the base directory: /app/../../packages/blocklist` (and `phi-guard`). Cause: build contexts remain app-dirs (`docker-compose.demo.yml:121,136,151,166,181,199`) while each pyproject declares path dependencies outside them (`apps/qa/pyproject.toml:29-33` and siblings). Control: `services/veritas-graph/Dockerfile.demo` (no path deps) built successfully — so the failure is exactly the context mismatch. No `.dockerignore` anywhere → 170 MB contexts.

`docker-compose.demo.yml` also omits `core` and `web` (documented at `:9-12` as staying on the host), and **no justfile recipe invokes it** — `infra-up`, `demo-setup` and `demo` all use `docker-compose.dev.yml`.

**Fix:** build from the repo root with `-f apps/qa/Dockerfile.demo .`, add `.dockerignore`, add a launcher recipe, and include core/web or state the two-process model explicitly in the manifest.

### B7 — The frozen manifest contradicts the running system **[P]**
| Manifest | Actual (17 Sep) |
|---|---|
| patients 50 | **12,533** |
| `service_request` 100+ | **20** |
| `nphies_claim` 60 | 64 |
| Neo4j `Patient` 50 | **0** |
| `NPHIES_JUSTIFIES` 500+ | **8** |
| `app.audit_event` | no such table — actual: `audit.event` (16,531 rows) |

`docs/DEMO_MANIFEST.md` also lacks encounter IDs, expected findings, and is unlink to the reference-release version; all checklist boxes are unchecked (no rehearsal evidence). **[W]**

### B8 — Two pre-PHI gates are broken at the schema layer **[W]**
- **M02:** `session.service.ts:133` runs `SELECT u.enabled` → live error `column u.enabled does not exist`. `app."user"` has 9 columns with no `enabled` and no `roles`; admin writes to `roles` (`admin.controller.ts:317`) and `disabled_at` (`:355`) that the check never reads, while the check reads `app.user_role`. The spec passes only because it mocks the phantom column.
- **M07:** the DSR service queries `subject_id_hash`/`completed_at`/`result_note` (`dsr.service.ts:57-61,99-104,152-155`) while the live table has `subject_id`/`fulfilled_at`/`notes`. Erasure would throw. Legal-hold handling exists only in a docstring; there is no ambient-consent enforcement anywhere in `apps/core`.
- Both are downstream of B1 (migrations unapplied).

---

## 4. Per-item verdicts

### C01–C10 — pre-demonstration Criticals

| ID | Verdict | Why |
|---|---|---|
| C01 | **PARTIAL** | MD and PPTX rewritten, but the **exported decks still carry the prohibited claims**: `specialist-deck.html:45,46,90,91,287` ("cannot invent facts", "It cannot drift"), `specialist-deck.pdf` (pdftotext), `EXECUTIVE_PRESENTATION.md:20,82,188` ("Zero-Hallucination", "live NPHIES FHIR sandbox from day one"), `LIVE_DEMO_GUIDE.md:21`. Stale exports committed by `c71a9ca` were never regenerated. |
| C02 | **PARTIAL** | Init exclusivity fixed (`SullyContext.tsx:706-712,731,1337`; `TimelinePane.tsx:122-131`). **But patient-switch retention is unfixed and proven:** a mounted provider keeps the prior dataset (test: `messages=7, orders=5` retained after `patientId` change) — no `key={patientId}` at `PatientDetailPage.tsx:177-181`, no reset effect. |
| C03 | **PARTIAL** | Deterministic `[N]` parsing added (`synthesis.py:104-139,276`). No entailment check (a citation need not support the claim); containment is a client-side gate that is off by default (`demoContainment.ts:20-23`, `.env.example:190`); direct API calls bypass it. |
| C04 | **PARTIAL** | Client-only filter (`AiTeamDrawer.tsx:92-98`). **Server unchanged:** `agent_handlers.py:207-213,236-243` still registers and streams consultant/pharmacist, `:187-190` invites dose prose, `agent_bus.py:291-320` still calls NSCRE alternative-candidates. `DEMO_CONTAINMENT` appears in no Python file. |
| C05 | **PARTIAL** | `overall_defer`/`evidence_gaps` now propagated for pharmacist + consultant (`agent_handlers.py:118-121,158-161`) and rendered (`SullyContext.tsx:842-843,866-867`); verified live. Gaps: `nphies_agent` verdicts carry neither (`:177-183`); the defer note renders only when prose is empty; zero tests reference these fields; no missing-data demo case exists. |
| C06 | **PARTIAL** | UI separation is real. **Stub still serves live capture**: `config.py:14` defaults `transcription_engine="stub"`, `.env.example:61` sets stub, and `/transcribe` (`main.py:81-103`) performs no engine rejection. Commit `9bb46e9` declared C06 "verified — no code change needed". |
| C07 | **PARTIAL** | Container loopback done; **dev-session enabled by default** (B2) and six services still on `0.0.0.0` without caller auth (B3). |
| C08 | **PARTIAL** | Simulation labels and connector disclosure added. **Still standing:** `EXECUTIVE_PRESENTATION.md:188` claims "live NPHIES FHIR sandbox from day one"; local-readiness vs payer-outcome states only partly surfaced. SAR illustrative labelling was added (`en.json:168`) — the one sub-item closed. |
| C09 | **PARTIAL** | Manifest, checksums (10/10 verified) and expected counts exist; **B7** shows the counts do not match the environment; no encounter IDs, no expected findings, no rehearsal evidence. |
| C10 | **NOT DONE** | B4 — proven broken by test; no journey E2E; no clean-run-twice evidence. |

### H01–H07 — pre-demonstration Highs

| ID | Verdict | Why |
|---|---|---|
| H01 | **PARTIAL** | Catalog exists but **images do not build** (B6), `core`/`web` absent, no launcher recipe, no `.dockerignore`, no startup smoke wired to it. |
| H02 | **PARTIAL** | Core is genuinely good. **Python services have no equivalent readiness** — `apps/narrative/main.py:69`, `apps/qa/main.py:90`, `apps/transcription/main.py:73`, `services/veritas-graph/api_router.py:60`, `services/orchestrator/agent_handlers.py:201` return static `{"status":"ok"}`; only nphies-engine adds connector fields. `profiles_verified` is hardcoded `false` (`health.controller.ts:92`); `graph_nodes` is a `-1` sentinel (`:132`); qa still tolerates DB-pool failure (`api/main.py:64-68`). |
| H03 | **PARTIAL** | Timeouts added in `ai-team`, `ambient`, `draft`, `claim-simulator`, health. **Still bare fetch with no deadline:** `qa-proxy.service.ts:57`, `narrative-proxy.service.ts:86,213`, `nphies/preauth.service.ts:76,105`, `interpreter.service.ts:42`, `linkage-verdicts.service.ts:141`. No shared client, no typed retryable errors. UI still swallows errors at `SullyContext.tsx:774,1052,1115`. |
| H04 | **PARTIAL** | `apps/core` lint is 0 errors / 252 warnings — **achieved partly by weakening config**: `.eslintrc.json` in `88ead32` downgraded 12 rules to `warn`, turned `unsafe-*` off in tests, disabled `no-extraneous-class`. `apps/web` has **426 errors**; root `pnpm run lint` fails; CI runs that job (`ci.yml:47-49`). **`.github/` is unchanged since baseline** — CI still covers only node/narrative/qa; no Playwright, no load tests, no classifier eval, no other Python services. |
| H05 | **NOT DONE** | No file in scope touched. Fixed 340px/320px panes, no resize (`SullyShell.tsx:44-66`); `Encounter view ·` hardcoded, not `t()` (`:52`); `i18n/{en,ar}.json` have no encounter/scribe/timeline/journey namespaces; the copy conflict survives (`PreAuthModal.tsx:113` "exactly as shown" vs `TimelinePane.tsx:65` `"current encounter"`). |
| H06 | **PARTIAL** | `DEMO_TRUTH_TABLE.md` is solid (113 lines: live/scripted/simulated/unavailable, connector modes, expected clicks). Branding still split (`Cortex.ai` at `en.json:3,94` vs `Veritas-Medica` in 11 service files); `docs/demo-runbook.md` not reconciled. SAR constant still fixed at 2,500 (`claim-simulator.service.ts:101,240-241`) but now labelled illustrative. |
| H07 | **PARTIAL** | Ignore patterns added (`.gitignore:68-85`, `git check-ignore` confirms all three hit `:82`). **Artifacts not moved or encrypted:** `backups/restore-point-2026-07-07.dump` (1,123,412 B), `env-restore-point-2026-07-07.bak` (2,919 B), `RESTORE.md`. No archive patterns (`*.zip`, `*.tar.gz`), so a compressed copy escapes the deny list. Git-level protection only; any workspace copy carries the dump and env backup. |

### M01–M12 — pre-pilot

| ID | Verdict | Why |
|---|---|---|
| M01 | **NOT DONE** | `session.service.ts:48` in-process Map; `auth.service.ts:23` pendingStates Map; `otp-rate-limit.ts:2,38-49` in-memory; `ingestion.scheduler.ts:11-38` `setInterval`, no advisory lock. No Redis, no shared store. Chart still requests 3 replicas (`values.yaml:30`), so the "keep demo single-instance" fallback is contradicted. Live symptom: **21 ingestion runs stuck in `running`**, 8 failed, 182 completed. |
| M02 | **NOT DONE (broken)** | B8. Pre-PHI gate unmet. |
| M03 | **PARTIAL** | Gate implemented (`local-key-provider.service.ts:30-45`) but lazy (only at wrap/unwrap) and untested; `customer-key-provider.service.ts:33-46` still throws even when a KMS ref is configured. No KMS/HSM wrapping, rotation or recovery. |
| M04 | **NOT DONE** | Live: all 9 `hospital.*` tables have `relrowsecurity=true` but **`relforcerowsecurity=false`**; no `set_config`/`SET LOCAL` anywhere in application code (only policy reads in migrations); single owner-role pool (`database.module.ts:26-33`); tenant hardcoded (`session.service.ts:136`); `patient-scope.service.ts:82-86` reads only `LIMIT 1` role. |
| M05 | **PARTIAL (inert)** | Partial-failure tracking added (`ingestion.service.ts:72,99-116`) but the migration never applied, so the live CHECK still permits only `running|completed|failed` — writing `partial` would violate it. Pagination explicitly deferred (`:368-375` "for now we take the first page"); `attending_fhir_ref` extracted (`fhir-mapper.ts:43,211-228`) but never written (`:409-450`); merge still log-only (`:242-252`). |
| M06 | **NOT DONE** | Commit `901fbc7` claims M06 but touched only `ingest_ontologies.py` + manifest/verify script. `etl_pskg.py`/`graph_client.py` unchanged since `9ab2935`; still MERGE-only (`:335`) with no stale-fact deletion, no atomic publication, no source-version lineage for patient facts. Related: B5. |
| M07 | **NOT DONE (non-functional)** | B8. Anonymise + Neo4j delete code exists (`:191-232,268-271`) but the Neo4j leg is silently skipped if env is unset (`:244-246`), and failures are non-fatal yet marked completed (`:278-294`). Legal-hold awareness is docstring-only. No ambient-consent enforcement. |
| M08 | **PARTIAL** | Audit still fail-open (`audit.middleware.ts:47-109`, dead-letter to stderr `:94-104`); no outbox. **WORM unchanged**: `worm-export.service.ts:179-185` returns silently without the SDK while the caller logs "AUDIT_WORM_EXPORTED … completed" (`:147-156`); only ETag presence checked (`:217-221`). `backup-db.sh:41-52` unchanged — reproduced: the here-string overrides the pipe, so the dump is discarded and `pipefail` fails. |
| M09 | **PARTIAL** | Queue code is genuinely Postgres-backed (`coder-queue.service.ts:110-176`) but **the table does not exist** (B1); `sync()` is row-by-row, untransactional, `updated` hardcoded to 0 (`:137`). NPHIES remains in-process (`tasks.py:13-21`, `StatusBroker` dict `:62-104`). |
| M10 | **NOT DONE** | Active Q&A still bypasses hybrid retrieval (`apps/qa/main.py:383-388` passes `pool=None, embedder=None, _override_chunks`); `source_id` is the patient id on every chunk (`main.py:135,170,192,217,250,280,302`); `_BM25_SQL` still has no `ORDER BY` (`retriever.py:30-47`). Commit `c8b16a0` claims typed fact contracts but the diff contains none. |
| M11 | **PARTIAL (ATC not fixed)** | Manifest + checksum gate are real. **ATC bug intact:** `ingest_ontologies.py:207-214` slices `atc[:3]` while `_ATC_DESCRIPTIONS` keys are 4 characters (`:189-203`), so descriptions resolve empty. All 10 manifest entries are `licensed:false`; approver is self-approval ("product-owner (CTO) — session approval"). |
| M12 | **NOT DONE** | `packages/classifier/eval/evaluate.py` untouched (last `03e40f5`); corpora still small; the eval calls `classify()` with no model (`:102`), so only the rule layer is exercised and the sole model is `StubModelClassifier` (`model_layer.py:33`). `c8b16a0` added `apps/qa/eval/evaluate.py`, self-labelled SCAFFOLD (`:11-13`). Translation fidelity still unverified (`draft.service.ts:218`). |

### L01–L06 — production programme

**All six: NOT DONE — untouched.** Hard evidence: `git diff --stat d0fbf96 HEAD -- infra/` and `-- .github/` are both **empty** — zero infra or CI bytes changed since the baseline.

- **L01** Helm/Terraform unchanged (`infra/helm` last touched 30 Jun; `infra/terraform` 10 Jun). Values still cover only core/web/narrative/qa; no migration Job; web deployment sets `readOnlyRootFilesystem` with no writable mounts.
- **L02** No service authentication anywhere; no NetworkPolicy templates in Helm.
- **L03** No OTel collector or alerting manifests; scrape annotations still point at absent metrics.
- **L04** HPA is CPU-only; pool fixed at `max: 20`; no load-test gate.
- **L05** `security.yml` unchanged with mutable action refs (`trivy-action@master`, `trufflehog@main`); no SBOM, signing or admission control.
- **L06** No RPO/RTO, drill, or recovery test anywhere outside the assessment documents.

**Note on the claim's wording:** "requires external parties" does not cover L01–L06 or M01/M04/M06/M10/M12 — those are engineering work, not external dependencies.

---

## 5. Quality gates — measured

| Command | Result |
|---|---|
| `pnpm run typecheck` | **PASS** 8/8 |
| `pnpm run build` | **PASS** 5/5 |
| `pnpm run test` | **PASS with a flake** — web 28/28 files; core run 1 failed 1/210 (`health.controller.spec.ts:51` preflight timeout under parallelism), core run 2 210/210. The spec passes alone in 7.99 s (preflight 2,143 ms) and asserts a hard-coded `count: "50"` — the manifest's stale figure. |
| `pnpm run lint` | **FAIL** — 426 errors in `apps/web`; core 0 errors but with 12 rules downgraded/disabled |
| `just migrate` | **FAIL** — B1 |

---

## 6. Claims that exceed the diffs

| Commit | Claim | Reality |
|---|---|---|
| `9bb46e9` | "C06 verified" | No code change; stub ASR still serves live capture |
| `901fbc7` | "M11 reference governance + **M06 graph lineage** + M08 audit retry" | `etl_pskg.py`/`graph_client.py` untouched — no lineage, no deletion |
| `c8b16a0` | "M10 **typed fact contracts** + M12 evaluation harness" | Neither the Q&A retrieval path nor the classifier eval changed |
| `88ead32` | "eliminate all ESLint errors" | True for core; 12 rules weakened; web still 426 errors |
| `503c0fc` | "H01 demo launcher" | Compose exists but images fail to build; no recipe; no core/web |
| — | "All pre-production technical items complete" | 0 verified complete, 21 partial, 13 not done |

---

## 7. Remediation order

**Tier 0 — unblock (hours):**
1. Fix the three migration filenames to the `_` convention with unique timestamps; run `just migrate`; confirm `app.coder_queue_item` and the DSR/ingestion columns exist (B1 → fixes M05/M07/M09 schema halves).
2. `DEV_SESSION_ENABLED=false` in `.env.example` and `.env` (B2).
3. Bind `:3000/:4000/:5004/:5005/:5006` to loopback (B3).

**Tier 1 — make the demo real (1–3 days):**
4. Run the PSKG ETL for the demo cohort and add it to `just demo-setup`; assert manifest counts (B5).
5. Re-run `just demo-setup` from clean and reconcile `DEMO_MANIFEST.md` to observed counts; add encounter IDs and expected findings (B7).
6. Fix the demo build contexts to the repo root + add `.dockerignore` + a launcher recipe (B6).
7. Fix C10 persistence (merged note + overrides) and add a non-skippable journey E2E (B4).
8. Regenerate **all** deck exports from the corrected markdown; delete stale html/pdf (C01).
9. `key={patientId}` on the shell mount + patient-switch test (C02).

**Tier 2 — honesty of the control surface:**
10. Server-side demo containment (C04), deterministic citation support (C03), nphies_agent defer fields + a missing-data demo case (C05), stub rejection on live capture (C06).
11. Fix `apps/web` lint and stop weakening core rules (H04); surface the banned claims in `EXECUTIVE_PRESENTATION.md` (C01/C08).

**Tier 3 — pre-PHI (before any real data):** M02 and M07 schema-truth fixes, M01 shared state/singleton scheduling, M04 RLS enforcement, M03 KMS, behind the existing gates.

**Tier 4 — production programme:** L01–L06.

---

## 8. Resume-here state

**Environment (17 Sep):** Docker 29.6.1 up; containers `cc-postgres/cc-keycloak/cc-neo4j/cc-minio/cc-mailpit/cc-jaeger` healthy with loopback bindings; web `:3000`, core `:4000`, python `:5001–5006` running (`just dev`); `audit.event` 16,531 rows; Neo4j 69 nodes / 63 relationships / 0 patients; Postgres 12,533 patients (mostly ingestion noise) with the demo patient MRN-009 = `3dfa474c-6d96-40a6-ad92-a91dd413213b` (15 encounters, 28 conditions, 105 observations, 6 medications).

**Do not run** `just demo` or `just demo-setup` until B1 is fixed — migration will fail and `infra-reset` would wipe the databases.

**Blocked paths:** clean bring-up (B1), demo compose images (B6), SOAP→Stage 2 journey (B4), evidence chain for any patient (B5), DevSession-free operation (B2).

**Unblocked and usable now:** `just dev`, the core API, all six Python services, the Postgres and Neo4j consoles, health/preflight endpoints, the audit log, and unit/e2e test infrastructure.


---

## 10. Tier 0 remediation — applied and verified (17 September)

The three Tier 0 blockers are fixed and re-verified against live behaviour. Changes are in the working tree and **not committed** — review and commit at your discretion.

### B1 — migration runner restored ✅
The three migrations were TypeORM-style (`MigrationInterface`/`QueryRunner`), which this repo's runner cannot execute at all — renaming alone would not have worked. They were converted to node-pg-migrate (`pgm.sql` inside `up`/`down` exports), with the SQL unchanged, and renamed to the `_` convention with unique timestamps:

| Before | After |
|---|---|
| `1720000000000-dsr-completion.ts` | `1720300000000_dsr-completion.ts` |
| `1720100000000-coder-queue-durable.ts` | `1720400000000_coder-queue-durable.ts` |
| `1720200000000-ingestion-partial-status.ts` | `1720500000000_ingestion-partial-status.ts` |

- **Verification:** `node-pg-migrate up --dry-run` → exit 0, `Migrations complete!`; `just migrate` applied all three.
- **Schema confirmed:** `app.coder_queue_item` exists; `app.dsr_request` now carries `completed_at` and `result_note`; `ingestion_run_status_check` permits `partial`.
- **Residual (B8 partly open):** the DSR service also queries `subject_id_hash`, which no migration adds — the live column is `subject_id`. Erasure is therefore still not end-to-end; that is a Tier 3 pre-PHI item, not a runner defect.

### B2 — dev-session bypass closed ✅
`DEV_SESSION_ENABLED=false` in `.env.example` and `.env`; the example's comment now states plainly that the endpoint mints a fully-authorized session with no authentication.

- **Verification:** `POST /api/v1/dev/session` with the seeded physician subject → **HTTP 403 `Dev session endpoint disabled (set DEV_SESSION_ENABLED=true in development)`** (previously HTTP 201 + `session_id`).

### B3 — internal services bound to loopback ✅
- `apps/core/src/main.ts` → binds `CORE_HOST ?? "127.0.0.1"`
- `apps/web/vite.config.ts` → binds `WEB_HOST ?? "localhost"` (covers both IPv4 and IPv6 loopback)
- All six Python entrypoints → `host=os.environ.get("SERVICE_HOST", "127.0.0.1")`, with `import os` added where absent

Docker is unaffected: each `Dockerfile.demo` passes `--host 0.0.0.0` explicitly in its CMD, and both compose files publish container ports on `127.0.0.1`. `SERVICE_HOST`/`CORE_HOST`/`WEB_HOST` remain available as explicit overrides for a tunnel or container demo.

- **Verification:** netstat shows `127.0.0.1` on `:4000` and `:5001–:5006`; probes from the machine's LAN interface now return **000 (blocked)** for `:3000`, `:4000`, `:5001`, `:5004`, `:5005`, `:5006` — previously `:4000` answered 404 and `:5004/:5005/:5006` answered 200.

### Gates after the change
| Check | Result |
|---|---|
| `pnpm run typecheck` | **PASS** 8/8 |
| `pnpm --filter @app/core run test` | **PASS** — 29 suites, 210/210 tests |
| Python entrypoint syntax | All six parse cleanly |

### Files touched
`apps/core/migrations/1720300000000_dsr-completion.ts` (new), `1720400000000_coder-queue-durable.ts` (new), `1720500000000_ingestion-partial-status.ts` (new), three originals deleted · `apps/core/src/main.ts` · `apps/web/vite.config.ts` · `services/veritas-graph/api_router.py` · `services/orchestrator/agent_handlers.py` · `services/nphies-engine/api_router.py` · `apps/narrative/main.py` · `apps/qa/main.py` · `apps/transcription/main.py` · `.env.example` · `.env`

### Still open after Tier 0
B4 (C10 manual-SOAP persistence), B5 (no patient projection — the evidence chain still defers for every patient), B6 (demo images do not build), B7 (manifest contradicts runtime data), and the residual halves of B8. Tier 1 items 4–9 in §7 are the next step; `just demo` remains unsafe until §7 item 5 (clean reset + reconciliation) is done, because `infra-reset` would wipe the databases.


---

## 11. Tier 1 / B5 — patient projection restored; two data gaps remain (17 September)

### What was fixed

The ETL's only entrypoint refreshed **every** row in `hospital.patient` (12,533 rows, mostly unrelated ingested FHIR records), so nobody ran it for a demo. It now accepts a bounded cohort — `--patients`, `--mrn-prefix`, `--limit` — with the full refresh still the default when no argument is given (`services/veritas-graph/etl_pskg.py`). A recipe `just graph-pskg` projects the seeded `MRN-` cohort, and it is now a step in `just demo-setup` (after `graph-seed`).

**Result of the run:**

```
Synced 502 patients, 101 encounters, 173 conditions, 73 medications, 476 lab results into the graph.
```

| Graph content | Before | After |
|---|---|---|
| `Patient` nodes | **0** | **502** |
| `Encounter` / `HAS_ENCOUNTER` | 0 | 101 |
| `Medication` / `PRESCRIBED` | 0 | 47 / 70 |
| `LabResult` / `HAS_LAB` | 0 | 476 / 476 |
| `Condition` / `DIAGNOSED_WITH` | 0 | 64 / 173 |

**Effect on the evidence chain:** the gap *"No active medications found for this patient"* is **gone** — the engine now reaches the patient's medications through `HAS_ENCOUNTER → PRESCRIBED`. Graph service tests: **124 passed**.

### What still defers, and why it is data rather than plumbing

1. **`dose_safety` needs an eGFR lab.** The query requires `toLower(l.test_name) CONTAINS 'gfr'` (`nscre_engine.py:99-100`). The seeded cohort has **Creatinine but no eGFR for any `MRN-` patient** — verified: `0` distinct MRN- patients with a gfr-shaped observation. (Postgres does hold 432 eGFR observations, but every one belongs to an ingested record with **no MRN**, outside the demo cohort.)
2. **`necessity` needs an SFDA code on the medication.** NSCRE reads `Medication.sfda_code` (`nscre_engine.py:79`), which the ETL populates only when the source row's `code_system` is exactly `"sfda"` (`etl_pskg.py:280`). **No medication row in the database uses that code system** — the demo patient's medications are SNOMED CT — so no medication can ever carry an SFDA code and NPHIES necessity validation cannot fire for any patient.

Both fixes require *adding clinical values* (an eGFR result; SFDA-coded medications). Per the project's own principle 1 those must come from a governed source, not be authored into the seed by an agent — so this is a decision for the product owner, not a code change.

**Related (§B7 class):** the manifest's renal-path demo patient — `MRN-0017` "Fatimah Al-Sayed — Hypertension + CKD (renal dose alert path)" — **does not exist in this database**. The demo script currently depends on a patient that was never seeded, which is very likely why no cohort patient has an eGFR.

### Recommended next step

Choose the renal-path demo patient, seed its eGFR and SFDA-coded medications from an approved source, then assert the manifest counts inside `just demo-setup` so a clean bring-up proves itself.

---

## 12. The login failure — root-caused and fixed (17 September)

**Reported symptom:** after submitting credentials the UI returned to the login page ("السيستم مش بيفتح واقف على الصفحه دى"), i.e. the SPA bounced back to `/login` in a loop.

### Root cause — the M02 live-authorization check queried a column that does not exist

`session.service.ts:133` selected `u.enabled`. `app."user"` has **no `enabled` column** — its columns are `id, tenant_id, external_subject, email, display_name, preferred_language, disabled_at, created_at, updated_at`; disablement is modelled as `disabled_at`. Reproduced verbatim against the live database:

```
ERROR:  column u.enabled does not exist
LINE 1: SELECT u.enabled, r.role FROM app."user" u LEFT JOIN app.use...
```

The query threw on **every** authenticated request, the `catch` fails closed, and `/api/v1/auth/me` answered **401** forever — the running log shows the loop directly:

```
context: "SessionService", event: "session_revocation_check_failed"
GET /api/v1/auth/me -> 401   (repeating)
```

So login itself succeeded; the session was then rejected on the very next call.

**Why it shipped:** `session.service.spec.ts` injects a fake pool whose rows the test authors choose (`{ enabled: true, role: "physician" }`). A mock cannot disagree with the schema, so the phantom column passed CI.

### Fixes applied

1. `session.service.ts` — `SELECT (u.disabled_at IS NULL) AS enabled, r.role`, keeping the column alias so the row contract is unchanged.
2. `session.service.spec.ts` — new regression guard asserting the SQL reads `disabled_at` and never a bare `u.enabled`, because mocked rows can never catch this class of bug.
3. `admin/admin.controller.ts` — **same class, second site.** Role updates ran `UPDATE app."user" SET roles = $1`; `roles` does not exist either (roles live in `app.user_role (user_id, role)`). Replaced with a transactional delete + `unnest` insert. This path had **no test at all** (`src/admin/` holds only `admin.controller.ts` and `admin.module.ts`), which is why it went unnoticed.

### Verification

- The failing SQL reproduced before the change and returns `t` after it.
- `pnpm --filter @app/core run test` → **29 suites / 211 tests passed** (210 before; +1 new guard).
- `pnpm --filter @app/core run typecheck` → clean; nest recompiled with `Found 0 errors`.
- The dev-session bypass closed in §10 is **not** implicated: the UI authenticates through Keycloak only (`apps/web/src/hooks/useAuth.ts:48` fetches `auth_url` from `api.auth.login`), and nothing under `apps/web/src` references `dev/session`.

### Also wired: the NSCRE reference rules were never loaded

`nscre_engine.py` has a working `main()` that loads `data/ontologies/nscre_contraindications.json` and `nscre_renal_dose_limits.json`, but **no recipe or script called it** — so no `CONTRAINDICATED_WITH` edges or `DoseRule` nodes existed. Added `just graph-nscre-rules` and wired it into `just demo-setup` (after `graph-pskg`, which must run first since the loader MATCHes existing medication keys).

Honest result of running it:

| | Outcome |
|---|---|
| Metformin renal rule | **Live** — `RENAL_DOSE_LIMIT` edge carrying `egfr_threshold=30.0`, `max_dose`, `flag=CRITICAL_OVERRIDE` |
| Contraindication edges | **0** — the file's 4 pairs all pair `warfarin` with ibuprofen/naproxen/meloxicam/diclofenac, and **none of those NSAIDs exist as Medication nodes**, so both MATCH clauses fail and no edge is created |
| Reported count | "Ingested 4 contraindication pairs" — **misleading**: the counter increments per file entry, not per edge created (the function's own docstring warns of this) |

**Consequence, stated plainly:** all three NSCRE modules currently return **zero findings for every patient** — `drug_interaction` (no reference pair matches a prescription), `dose_safety` (no eGFR value), `necessity` (no SFDA-coded medication). The engine runs, returns 200, and reports honest evidence gaps; it just cannot produce a positive finding from the data that exists. The demo should present "no findings + explicit gap" as the expected state, or the seed needs a patient the shipped rules can actually match.

---

## 13. "Save note to record" returns 400 — diagnosed (17 September)

**:white_check_mark: Both defects fixed and verified live on 17 September — see §14.**

### 13.1 What the button does

`StageDocument.tsx` (`SaveToRecord`, added by `18ca969` for C10) posts the SOAP editor's note to the drafts API:

```json
{ "document_type": "encounter_note", "language": "en", "specialty": "general",
  "transcript": "<joined transcript>",
  "prefill_sections": [ {"key":"subjective",...}, {"key":"objective",...},
                        {"key":"assessment",...}, {"key":"plan",...} ] }
```

### 13.2 Root cause — reproduced against the real service

```
BadRequestException: Section 'assessment' prefill is not a verbatim substring of the source transcript
```

`draft.service.ts:361-364` requires every prefill section to be a **verbatim whitespace-normalised substring of the transcript** (the anti-hallucination guarantee). But the section text sent here is the *LLM-structured* SOAP note, which by definition reorganises and rephrases its source — `docs/prompts/soap-format-prompt.md` says "reorganise only transcript content". A restructured note can essentially never satisfy a verbatim-containment check, so the button fails whenever the model rewords anything.

**The server is behaving as designed.** This is the project's own no-fabrication rule refusing to write unverified text into the record — it just happens to make this button unusable.

### 13.3 Three defects, not one

| # | Defect | Detail |
|---|---|---|
| 1 | **Silent content loss** | The template's `encounter_note` keys are `identity, chief_complaint, history, assessment, plan`. The UI sends `subjective` and `objective` — keys the template does not have, so **both are ignored with no error**. There is also no Objective/Examination section in the template at all. |
| 2 | **The verbatim gate rejects the feature** | Any LLM-restructured section fails containment → 400. Only text the clinician typed that happens to match the transcript would pass. |
| 3 | **The reason never reaches the clinician** | :white_check_mark: **Fixed.** Core installs no exception filter, so it answers with Nest's default shape `{ message, error, statusCode }`. The web client read only `body.error.message`, which never exists in that shape, and fell back to `res.statusText` — hence the bare "Bad Request". `apps/web/src/lib/api.ts` now reads the flat `message` (and joins `string[]` validation messages), so the server's actual reason is displayed. Typecheck 8/8 passes. |

### 13.4 What fixing it actually requires

C10's register entry asks to "fix effective reviewed-state persistence; add non-skippable E2E for the full journey". The button was one attempt at that. Making it work end-to-end needs *both*:

1. a way for the drafts API to accept the clinician's **reviewed** note as clinician-authored content (the API currently accepts only assembled facts, verbatim transcript prefill, or a pre-existing authored note from the record — there is no input path for text the clinician just wrote in this session); and
2. a later journey stage that **reads the draft back** — today none does (§B4: Stage 2 reads only `sully.scribe.<patientId>` from sessionStorage), so even a successful save would not make the note visible downstream.

Item 1 changes the clinical-documentation contract, which `CLAUDE.md` gates behind CTO + Clinical Advisor + Regulatory Consultant sign-off, so it is a product-owner decision rather than a code fix to make silently.

---

## 14. The Document → Diagnose flow, and vitals in the SOAP (17 September)

Reported requirement: as soon as recording finishes or the doctor types the SOAP, the SMART checklist is suggested; the doctor reviews, presses **Save note to record**, and the journey moves on to **Diagnose**. Plus: vitals are taken by the nurse *before* the patient sees the doctor, so how do they get into the SOAP?

### 14.1 The vitals in the UI were fabricated

`SullyContext.tsx`'s `SOAP_STAGES` hardcoded the Objective line **"BP 148/92, HR 78, SpO2 98%."** — invented measurements displayed to a clinician, in a project whose first principle is zero fabrication. Removed; the demo scaffold now carries examination findings only.

### 14.2 Objective is read from the nurse's recorded observations

New tested module `apps/web/src/components/layout/vitals.ts`:

- fetches `GET /patients/:id/observations?category=vital-signs`, keeps the **newest row per LOINC code** (85354-9 BP panel — read from `value_text`, which is where this feed stores "134/69" — 8867-4 HR, 59408-5/2708-6 SpO2, 8310-5 Temp, 9279-1 RR);
- renders `BP 134/69, HR 72, SpO2 95%, Temp 37.1°C, RR 15/min.` — deterministic, no model involved;
- **omits** any vital the record does not hold (never a default "normal" set), and the clinician's own edits still win because the override is applied last.

Live for MRN-009 the Objective section showed the patient's own recorded vitals.

**A bug that only appeared against the real API:** `node-postgres` returns `NUMERIC` as a **string**, so `("72.4" as never).toFixed()` would have thrown in the browser while every mock-based test passed — the tests were feeding numbers the API never sends. Fixed with explicit coercion, and the test fixtures now use the wire shape.

### 14.3 Save → Diagnose works, and the reviewed note is what persists

Three separate defects, all fixed:

| # | Defect | Fix |
|---|---|---|
| 1 | **The save returned 400** (§13.2). | Explicit `authored_sections` input on the drafts API: the clinician's reviewed sections are recorded with `authored: true` provenance instead of being refused by the transcript-containment gate. |
| 2 | **Manual edits were never persisted.** The sessionStorage mirror wrote the *drafted* note (not the merged note), bailed out when there was no transcript, and the restore skipped the note unless transcript lines existed — so a typed or edited note vanished, which is why Stage 2 had no assessment (§B4). | The mirror now writes the **effective** note and the restore loads it independently of the transcript. |
| 3 | **Nothing advanced the journey.** | The button reports success upward; `JourneyView` moves to Diagnose on save. |

**Safety posture unchanged:** the transcript-containment gate, condensation path, and translation allow-list are untouched, and a test asserts the gate still refuses reworded *transcript-derived* prefill. Authored sections are never machine-translated (replacing the words a clinician just reviewed would defeat the review), and the draft still requires sign-off before it becomes documentation. The authored input path is a clinical-documentation contract change, recorded here for the CTO / Clinical Advisor / Regulatory sign-off `CLAUDE.md` requires.

### 14.4 Verification — live, not mocked

- **Real OIDC login in a browser** as the dev physician (`physician1`, fixture from `infra/keycloak/realm-dev.json`) → landed on `/patients`.
- **Document stage for MRN-009** → Objective populated with that patient's recorded vitals; pressed **Save note to record** → no error → the journey **advanced to Diagnose** on its own.
- **The draft written by that click**, read back from Postgres:

```
identity   [record-facts] Sara Fakename-Al-Anazi (MRN: MRN-009, DOB: 1993-04-17, sex: fe...
objective  [authored=true] BP 134/69, HR 72, SpO2 95%, Temp 37.1°C, RR 15/min.
```

- Suites: typecheck **8/8** · core **215** · web **232** · graph **124**.

### 14.5 Still open

- The SMART checklist already proposes from both the transcript and typed SOAP text (`proposeChecklist(transcriptText, soapText)`), so that part of the requirement was met; the catalog still offers "Record vital signs", which is now the nurse's pre-encounter job rather than the doctor's — worth revisiting.
- An `objective`/`subjective` key does not exist in any *document template*; the draft stores the clinician-authored sections alongside the template-derived ones by design (§14.3), which the Drafts card renders as-is.

---

## 9. Method and limits

- **[P]** parent verification: live HTTP probes, `netstat`, `docker ps`, psql/cypher-shell queries, NSCRE invocation, quality-gate runs, migration runner reproduction.
- **[W]** three independent workstreams: C-group (36 API calls), H/L-group (36 calls, including a real `docker build` reproduction), M-group (39 calls, including read-only SQL and a `--dry-run` migration check). Each returned per-item verdicts with file:line evidence; their strongest unfixed items were re-derived by the parent where consequential.
- **Not verified:** the anti-hallucination/clinical-correctness properties of generated prose (no clinical adjudication was performed); PPTX and PDF slide-by-slide equivalence beyond the prohibited-phrase scan; behaviour under load; behaviour on a second host for the exposure findings (loopback reasoning is from bindings plus LAN-interface probes).
- **No application file was modified during this audit.** One scratch vitest file was created and deleted by a workstream; `git status` is unchanged. Documents added by the parent: this audit, and the earlier findings register and market research.
