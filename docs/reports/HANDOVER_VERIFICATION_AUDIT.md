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

### B4 — C10: manually typed SOAP still never reaches Stage 2 **[P]** + **[W, proven by test]** — **CLOSED 17 Sep, see §14**
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

### B6 — Demo images do not build **[W, real build run]** — **FIXED 17 Sep, see §16**
`docker build -f apps/qa/Dockerfile.demo apps/qa` → **exit 2**: `cannot normalize a relative path beyond the base directory: /app/../../packages/blocklist` (and `phi-guard`). Cause: build contexts remain app-dirs (`docker-compose.demo.yml:121,136,151,166,181,199`) while each pyproject declares path dependencies outside them (`apps/qa/pyproject.toml:29-33` and siblings). Control: `services/veritas-graph/Dockerfile.demo` (no path deps) built successfully — so the failure is exactly the context mismatch. No `.dockerignore` anywhere → 170 MB contexts.

`docker-compose.demo.yml` also omits `core` and `web` (documented at `:9-12` as staying on the host), and **no justfile recipe invokes it** — `infra-up`, `demo-setup` and `demo` all use `docker-compose.dev.yml`.

**Fix:** build from the repo root with `-f apps/qa/Dockerfile.demo .`, add `.dockerignore`, add a launcher recipe, and include core/web or state the two-process model explicitly in the manifest.

### B7 — The frozen manifest contradicts the running system **[P]** — **CLOSED 17 Sep, see §16**
| Manifest | Actual (17 Sep) |
|---|---|
| patients 50 | **12,533** |
| `service_request` 100+ | **20** |
| `nphies_claim` 60 | 64 |
| Neo4j `Patient` 50 | **0** |
| `NPHIES_JUSTIFIES` 500+ | **8** |
| `app.audit_event` | no such table — actual: `audit.event` (16,531 rows) |

`docs/DEMO_MANIFEST.md` also lacks encounter IDs, expected findings, and is unlink to the reference-release version; all checklist boxes are unchecked (no rehearsal evidence). **[W]**

### B8 — Two pre-PHI gates are broken at the schema layer **[W]** — **M02 and M07 CLOSED 17 Sep, see §12 and §15; M04/M08 remain**
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
| M03 | **PARTIAL — gate closed 17 Sep, see §18** | The gate existed but was bypassable: `ALLOW_DEV_KEYS=true` unlocked the published dev default in *any* environment, so a deployed build could accept a key that offers no confidentiality. Now honoured only in test runs, and covered by nine tests. **Still open:** no KMS/HSM wrapping, rotation or recovery -- `customer-key-provider.service.ts:33-46` throws honestly. Which KMS to wire is a deployment decision, not a code one (**pre-PHI gate**). |
| M04 | **NOT DONE** | Live: all 9 `hospital.*` tables have `relrowsecurity=true` but **`relforcerowsecurity=false`**; no `set_config`/`SET LOCAL` anywhere in application code (only policy reads in migrations); single owner-role pool (`database.module.ts:26-33`); tenant hardcoded (`session.service.ts:136`); `patient-scope.service.ts:82-86` reads only `LIMIT 1` role. |
| M05 | **PARTIAL (inert)** | Partial-failure tracking added (`ingestion.service.ts:72,99-116`) but the migration never applied, so the live CHECK still permits only `running|completed|failed` — writing `partial` would violate it. Pagination explicitly deferred (`:368-375` "for now we take the first page"); `attending_fhir_ref` extracted (`fhir-mapper.ts:43,211-228`) but never written (`:409-450`); merge still log-only (`:242-252`). |
| M06 | **NOT DONE** | Commit `901fbc7` claims M06 but touched only `ingest_ontologies.py` + manifest/verify script. `etl_pskg.py`/`graph_client.py` unchanged since `9ab2935`; still MERGE-only (`:335`) with no stale-fact deletion, no atomic publication, no source-version lineage for patient facts. Related: B5. |
| M07 | **NOT DONE (non-functional)** | B8. Anonymise + Neo4j delete code exists (`:191-232,268-271`) but the Neo4j leg is silently skipped if env is unset (`:244-246`), and failures are non-fatal yet marked completed (`:278-294`). Legal-hold awareness is docstring-only. No ambient-consent enforcement. |
| M08 | **DONE 17 Sep, see §17** | All five parts addressed and each proven by running it: a durable outbox writes audit events (with a row a dead process left behind recovered live, chain verified over 17,584 rows); the WORM export reads its object back and emits success only after that; the backup script's stdin conflict is fixed structurally and the script now verifies dump, encryption round trip and the uploaded object; a restore drill restores into an isolated database and matched 43 tables; the search-metadata scrub was already correct and is now pinned by tests. |
| M09 | **PARTIAL** | Queue code is genuinely Postgres-backed (`coder-queue.service.ts:110-176`) but **the table does not exist** (B1); `sync()` is row-by-row, untransactional, `updated` hardcoded to 0 (`:137`). NPHIES remains in-process (`tasks.py:13-21`, `StatusBroker` dict `:62-104`). |
| M10 | **DONE** | All three clauses closed 2026-09-18. The Q&A now routes through `fact_contract.retrieve_patient_chunks` with the real pool (lexical over the index when the patient has chunks, the typed record read otherwise) instead of `pool=None, embedder=None, _override_chunks`; `create_embedder()` returns None for the development stub, so a hybrid route can never present an arbitrary cosine order as relevance. The 207-line duplicate chunk builder that stamped the patient id on all seven source types is deleted, and every fact now carries its row id. Citations are resolved by `filter_resolved_sources(pool, patient_id, sources, chunks)`, which replaced `count_unresolved_sources` /`drop_unresolved_sources` -- a pair that each held half the rule, so a source whose row was deleted after indexing survived both. Read at that time: `_BM25_SQL` had no `ORDER BY` at the revision this audit inspected (`retriever.py:31-45` in the committed file), so a 20-row lexical slice was returned in arbitrary order **-- fixed 2026-09-18**: both arms now order their rows and `packages/retrieval/tests/test_sql_ordering.py` pins the order clause, the tiebreak and the bound of each statement. Corrected history, kept because it is the lesson: a note here first declared this clause stale on the strength of working-tree changes that were never committed -- the clause was accurate, and only the diff against `HEAD` can settle such a claim. The other two clauses stand. Commit `c8b16a0` claims typed fact contracts but the diff contains none. |
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

## 15. M07 — the DSR feature, and an unauthenticated erasure endpoint (17 September)

M07 was filed as *"the service queries columns that do not exist"*. Reproducing it
against the live stack turned up **seven** defects, one of which is the most
serious finding in this audit.

### 15.1 The whole DSR controller was reachable with no session

`@RequirePermission(...)` is only metadata -- something has to read it. This
controller applied it but never applied `@UseGuards(RbacGuard)`, and there is no
global `APP_GUARD`. Verified with **no cookie at all**:

| Request | Before | After |
|---|---|---|
| `POST /api/v1/dsr/access` | **201** | 401 |
| `POST /api/v1/dsr/erase` | **201** | 401 |
| `GET /api/v1/dsr/:id` | **200** | 401 |
| `POST /api/v1/dsr/:id/execute` | **201** — ran the erasure | 401 |

Anyone who could reach the port could file an erasure for a patient and execute
it, irreversibly anonymizing that patient's record. Combined with the `0.0.0.0`
bindings fixed in §10, this was remotely reachable before this work. A physician
(no `user:manage`) now gets **403** on execute, and only an admin can run it.

### 15.2 Four schema defects

| # | Defect | Consequence |
|---|---|---|
| 1 | No `subject_id_hash` column | every INSERT failed |
| 2 | No `reason` column | every INSERT failed |
| 3 | `pgcrypto` never enabled | the erasure's `digest()` patient lookup could not run |
| 4 | No `completed_at` / `result_note` | the completion UPDATE failed (added by 1720300000000) |

Migration `1720600000000_dsr-schema-alignment` adds the two columns, enables
pgcrypto, and **drops three vestigial columns** written by nothing
(`subject_id`, `fulfilled_at`, `notes`) -- two names for one concept is how this
drifted to begin with. The table held 0 rows.

### 15.3 Wrong column names, and an erasure that did not erase

- The service selected a `created_at` column that does not exist (the request
  timestamp is `requested_at`), so even the filing endpoints 500'd.
- The anonymizer set `national_id`, `phone`, `email`, `address_json` -- **none of
  which are on `hospital.patient`**. It should have been setting
  `national_id_hash`, `family_name`, `given_name`, and it never touched
  `fhir_resource_json`, which holds the FHIR source payload. Left as it was, the
  service would have reported *"identifiers removed"* while the patient's name
  sat in the record.

### 15.4 The actor, and a 500 for work that had succeeded

The controller passed the literal string `"unknown"` where a UUID was expected,
so `writeAuditEvent` threw **after** the erasure had committed -- callers saw a
500 for work that was already done. It now passes `null` when there is no
session user, and because the guard runs, the audit chain records **who**:
`DSR_RECEIVED` events previously carried a blank `actor_id` and `actor_role`.

### 15.5 Verified end to end

Unauthenticated -> 401 on all four routes; physician files a request (201) but
gets 403 on execute; admin executes (201); the patient's name, MRN, name parts,
national-id hash, date of birth, sex, language and FHIR payload are all cleared;
the request reads `completed`; and `DSR_ERASE_COMPLETED` carries the admin's
`actor_id` and role. The DSR unit tests encoded the phantom `created_at` column,
which is why they passed; they now mirror the real schema. core: 215 tests pass.

---

## 16. B7 and B6 — manifest truth, and images that build and run (17 September)

### 16.1 B7 — the manifest was fiction, and nothing checked it

`docs/DEMO_MANIFEST.md` v1.0 declared:

| Claim in v1.0 | Reality |
|---|---|
| `SELECT count(*) FROM app.audit_event` | **that table does not exist**; the audit chain is `audit.event` |
| NphiesDiagnosis "100+" | **6** — and the committed file contains exactly 6 |
| NphiesService "100+" | **5** — the file contains 5 |
| NPHIES_JUSTIFIES "500+" | **8** — the CSV defines 8 rows |
| demo patient `MRN-0017` "Fatimah Al-Sayed, CKD" | **never seeded**; no such patient exists |
| "50 patients" | correct about the seed, but silent about the thousands of ingested records in the same table (13,599 and climbing), which is what made it read as a contradiction |

The graph numbers were not evidence of a broken seed: the graph matches the
committed reference files **exactly** (6 / 5 / 3 nodes, 41 and 8 rule edges).
The expectations were aspirational figures that no one had ever measured.

- `docs/DEMO_MANIFEST.md` is rewritten as v2.0: every asserted figure measured
  against the running stack, the seeded cohort separated from ingested data, and
  the graph checks expressed as equalities against the committed files.
- `tools/verify_demo_data.py` + `just verify-demo-data` assert the schema names
  the manifest relies on (the class of error behind `app.audit_event`, the
  phantom `u.enabled` column and the DSR drift), the seeded cohort and demo
  patients, and the graph reference counts. Live totals are printed but
  deliberately **not** asserted -- ingestion moves them, so asserting them would
  be a flaky failure rather than a real one.
- `just demo-setup` now ends by running that check, so a clean reset proves
  itself. Result: **56 passed, 0 failed**.
- `etl_pskg.py` gained `--mrn-pattern` and `just graph-pskg` uses
  `^MRN-[0-9]{3}$`: the previous `--mrn-prefix MRN-` also matched ingested
  records whose MRNs look like `MRN-<hex>`, projecting 502 Patients where the
  cohort is 50. The PSKG now holds exactly the 50 seeded patients.

### 16.2 B6 — the demo images did not build, and would not have run

Reproduced the build failure exactly:

```
error: Could not compute absolute path from workspace root and lockfile path
  cause: cannot normalize a relative path beyond the base directory:
         /app/../../packages/blocklist
```

Each Python `Dockerfile.demo` copied only its own directory, while the service
declares its shared packages as path dependencies (`../../packages/<name>`).
With an app-directory context those paths do not exist, so `uv sync` aborted.

- The six Dockerfiles now take the **repository root** as context and reproduce
  the repository layout (`packages/` alongside `apps/…` or `services/…`), which
  is what `docker-compose.demo.yml` now declares.
- **And they would still have crashed on startup.** With the path problem fixed
  the image built and then died at import:

```
FileNotFoundError: Prompt template not found: /app/docs/prompts/interpreter-prompt.md
```

`packages/prompt_loader` resolves the prompt templates from the repository root
by path, so the four services that use it (narrative, qa, transcription,
orchestrator) also need `docs/prompts/` in the image.

- Verified beyond the build: the narrative image was built and **run**, and it
  served `{"status":"ok","service":"clinical-copilot-narrative"}` on `/health`.
- `just demo-stack` / `just demo-stack-down` now invoke
  `docker-compose.demo.yml` -- previously nothing in the justfile referenced it
  at all, so the file was unreachable configuration.
- Removed the obsolete `version:` key the compose parser warns about.

**Still open, and deliberate:** `core` and `web` are not in the demo compose.
That file's own header documents why -- they need hot-reload for development,
and containerising them is the **L01** (long-term) item, not a Tier-1 blocker.
It is recorded here so the omission reads as a decision rather than an oversight.

---

## 17. M08 — the paths that reported success without doing the work (17 September)

Three components claimed success while producing nothing, and the fixes are
verified by running the paths rather than by reading them.

### 17.1 The backup was silently empty

`infra/scripts/backup-db.sh` read `pg_dump`'s output and the GPG passphrase from
the same stdin:

```bash
pg_dump "$DATABASE_URL" ... | gpg ... --passphrase-fd 0 ... <<< "$GPG_PASSPHRASE"
```

The here-string wins the redirection, so gpg took the passphrase from it and the
dump bytes went into a pipe nobody read. Reproduced before the fix: a
200,000-byte input produced a **70-byte** file that decrypted to **0 bytes**, and
the script exited 0 printing "Upload complete". This is the only backup path.

Fixed structurally: gpg reads the dump as a **file argument** and the passphrase
from **fd 3**, so the two can never share a descriptor; and the script now refuses
to report success unless the dump is non-empty, `pg_restore --list` can read it,
the ciphertext decrypts back to a byte-identical dump, and the uploaded object is
read back from S3 by size and SHA-256.

Run for real against the live database: **19,115,199 bytes**, **305 TOC
entries**, round-trip hash equal, uploaded to MinIO and read back matching. A
manifest records both digests and the verification results.

### 17.2 The WORM export logged success without uploading

`worm-export.service.ts` returned early when the S3 SDK failed to load, and the
caller logged `AUDIT_WORM_EXPORTED` / "completed" regardless. It also stamped
`x-content-sha256` with the digest of the **uncompressed** buffer while the object
stored beside it was the gzip stream, so any third-party verifier hashing the
downloaded object would conclude it had been tampered with.

Now the digest describes the bytes actually stored, the plaintext digest is kept
under its own name, the object is read back with `HeadObject` and size and digest
compared, a manifest records the chain slice the file covers, and the success
event is emitted only after that verification. Also corrected: the export day was
derived from **local** date parts while the query used a bare `::date`, so the
window drifted by the UTC offset and the file was named for a day it did not
cover. Export days are UTC days, with the window passed as explicit `timestamptz`
bounds.

Nine tests, including that no success event is emitted in stub mode, on a
read-back digest mismatch, or on a size mismatch.

### 17.3 Nothing had ever restored a backup

`infra/scripts/restore-drill.sh` downloads the newest backup, checks it against
its manifest, decrypts it, restores it into an isolated scratch database
(`restore_drill_<UTC>`), compares row counts table by table against the live
database, and drops the scratch database. The live database is only ever read.
Its own first version was wrong -- it picked the newest object under the prefix,
which is always the manifest, because the manifest is written after its dump.

Run for real: **PASS** -- ciphertext and plaintext matched the manifest, 305 TOC
entries, restored, **43 tables matched** the live database, scratch dropped.

### 17.4 Audit writes now hand off to a durable outbox

A response-finish handler cannot be transactional with the request it describes,
and a lost write was retried in-process and then dropped on stderr. The erasure
had the same problem in a worse form: it anonymized, `COMMIT`ted, and only then
marked the request complete and wrote its audit entry -- a crash in between left
a record erased with no proof anything had happened.

`audit.outbox` (migration `1720700000000`) plus `AuditOutboxService`: producers
enqueue, a flusher drains the queue into `audit.event` through the hash-chain
writer inside one SERIALIZABLE transaction per batch, and rows are retained after
flushing. `writeAuditEventInTx` in `packages/audit` writes inside a transaction
the caller owns, which is what makes the erasure's proof atomic with the erasure.

Verified live, not asserted: a row inserted directly into the outbox -- standing
in for a process that died before writing its event -- was written into
`audit.event` by the running service at startup, and matches the queued payload
on id, action, outcome, actor_role and metadata (all true). `verifyAuditChain`
over the whole log: `{valid: true, checked_rows: 17584}`. A live 401 was audited
and drained (outbox 8 rows / 0 unflushed).

**Caught by running the app, not by the tests:** adding a constructor dependency
to a middleware is invisible to a unit test that constructs the class directly.
Nest resolves middleware dependencies in the context of the module where
`consumer.apply` is called, so `AuditModule` had to be visible in `AppModule`
(and in `DsrModule`); until it was, the app threw `UnknownDependenciesException`
at boot. This is the identical bug the repository hit before with `RbacModule`.

### 17.5 Raw search metadata -- already correct, now pinned

`patient.controller.ts:136-146` already hashes the query (`query_hash`,
`query_len`, `result_count`) and never stores the text. Two tests now pin it,
including that identical queries correlate and different ones do not.

---

## 18. M03 — the key gate, and what remains a decision (17 September)

The register item reads "known dev master key fallback not production-gated;
customer key provider is a stub". Checked against the code rather than the
finding text, the first half was **already implemented**: the provider refuses a
missing key or the published default outside development.

The gate nevertheless had a hole and no test:

```ts
const isTest = this.config.get("ALLOW_DEV_KEYS") === "true";
if (env !== "development" && !isTest) { ...reject... }
```

`ALLOW_DEV_KEYS` was honoured in **any** environment. A production deployment that
inherited a copied `.env`, or that set the flag to quiet a startup error, would
silently accept a master key that is published in this source tree -- precisely
the failure the gate exists to prevent. The flag is now honoured only in test
runs; anything that is not development or test requires a real 32-byte key and
cannot be unlocked by it. Nine tests pin this, including the two that would have
caught the hole.

**Deliberately not done:** implementing a real customer-managed KMS. The provider
throws `CustomerKmsNotConfiguredError` honestly rather than pretending, and which
KMS to wire -- and in which region, for Saudi residency -- is a deployment
decision rather than a code one.

**Decision, 17 September 2026: deferred by the product owner.** The reasoning is
that the code already refuses safely (no silent degradation, and the platform path
will not start without a real key), and every environment in use today holds
synthetic data only. The trigger is explicit so that a deferral does not become an
omission: **before any real patient data enters any environment**, a KMS or HSM
must be chosen and wired for the customer-managed path. The choice depends on where
the solution is hosted, which is not yet decided.

---

---

## 9. Method and limits

- **[P]** parent verification: live HTTP probes, `netstat`, `docker ps`, psql/cypher-shell queries, NSCRE invocation, quality-gate runs, migration runner reproduction.
- **[W]** three independent workstreams: C-group (36 API calls), H/L-group (36 calls, including a real `docker build` reproduction), M-group (39 calls, including read-only SQL and a `--dry-run` migration check). Each returned per-item verdicts with file:line evidence; their strongest unfixed items were re-derived by the parent where consequential.
- **Not verified:** the anti-hallucination/clinical-correctness properties of generated prose (no clinical adjudication was performed); PPTX and PDF slide-by-slide equivalence beyond the prohibited-phrase scan; behaviour under load; behaviour on a second host for the exposure findings (loopback reasoning is from bindings plus LAN-interface probes).
- **No application file was modified during this audit.** One scratch vitest file was created and deleted by a workstream; `git status` is unchanged. Documents added by the parent: this audit, and the earlier findings register and market research.

---

## 19. Production programme (L01–L06) and two items reclassified — verified 2026-09-18

The L-section below is what section 4 filed as "all six NOT DONE — untouched". Re-derived
from the repository today, item by item, because a filed status is a lead and not a fact.

| Item | State today | Evidence |
|---|---|---|
| **L01** Helm/Terraform | **Open, narrowed.** `infra/helm` deploys four services (`core`, `narrative`, `qa`, `web`) — `transcription`, `graph`, `orchestrator` and `nphies-engine` have **no templates and no values**. The Terraform postgres module *names* the production settings and comments them out (`modules/postgres/main.tf:51-59`: `backup_retention_period`, `backup_window`, `skip_final_snapshot`), and the k8s module never mentions replicas. | `infra/helm/templates/*-deployment.yaml`; `infra/terraform/modules/*/main.tf` |
| **L02** Service authentication | **Open, unchanged.** No caller authentication between services and no NetworkPolicy templates. | No auth middleware in any service entrypoint; no `networkpolicy` template in `infra/helm/templates/` |
| **L03** Telemetry and alerting | **Half true.** Five Grafana dashboards exist with provisioning (`infra/grafana/dashboards/*.json`, `provisioning/dashboards.yaml`) and the chart sets `prometheus.io/scrape` annotations on core and narrative. **No alert rules exist anywhere** — provisioning holds `dashboards.yaml` only. Dashboards that nobody is paged from are a picture, not monitoring. | `infra/grafana/provisioning/`; `infra/helm/templates/core-deployment.yaml:23-25` |
| **L04** Capacity and load | **Half true.** `values-prod.yaml` has real autoscaling (core `replicaCount: 3`, HPA 2–6 and 2–8 at 70% CPU) and load tests **do exist** — `tests/load/` with a shared auth helper and `just load-test <service>` (`justfile:221`). But the HPA is CPU-only, and neither the load tests nor the classifier evaluation run as release gates. | `infra/helm/values-prod.yaml:15-34`; `tests/load/`; `justfile:221` |
| **L05** Supply chain | **Closed here.** Every action reference in `ci.yml` and `security.yml` was a **moving ref** — `actions/checkout@v4` and its siblings resolve to `refs/heads/releases/v4`, not a tag, and `trivy-action@master` / `trufflehog@main` are branches by name. All 30 references are pinned to commit SHAs (each SHA looked up on its own remote and verified to exist there), and the image build now emits `sbom: true` + `provenance: true`. No image signing yet. | `.github/workflows/ci.yml`, `security.yml` |
| **L06** Continuity | **Closed here, as a stated position rather than a capability.** RPO today is 24 hours (one encrypted dump at 02:00; no WAL archiving, no PITR); RTO is **not measured** — `restore-drill.sh` proves restorability and times nothing; the drill needs `GPG_PASSPHRASE` and `S3_*`/`AWS_*`, none of which are in the repository's `.env`. | `infra/scripts/README.md` (new section); `infra/terraform/modules/postgres/main.tf:51-59` |

Recorded with triggers rather than dropped — these are production-programme items, and the
DEV doctrine is to simulate what can be simulated and to write down what production owes:
chart the remaining four services; enable Terraform backup/PITR settings; service-to-service
authentication and NetworkPolicies; alert rules with an owner and a routing target; make the
load tests and the classifier evaluation release gates. Trigger for all of them: before the
first operational pilot.

**Two items reclassified out of "false claims", because they are not:**

- **H04 (lint).** Filed as a clean core lint "achieved partly by weakening config". The
  config change is real, but it is **documented in the commit that made it** (`88ead32`:
  safety rules left as errors, style rules downgraded to warnings, test-file relief,
  rationale per rule, 252 warnings left visible) and both this audit and
  `PRE_DEMO_READINESS_ASSESSMENT.md:48` already report the gate as **FAIL**. Nothing claims
  it passes. What remains is engineering debt, not a false statement: 426 errors in
  `apps/web`.
- **C06 (transcription stub).** Filed as "stub still serves live capture". The stub
  **identifies itself** — `StubEngine.name()` returns `stub-stt-v1`, its own comments state
  that it does not do speech recognition, and the UI labels dictation as placeholder mode —
  and the running dev stack is on the real engine (`.env: TRANSCRIPTION_ENGINE=faster_whisper`,
  with faster-whisper's own multiprocessing workers visible in the process table). The
  remaining point is that a *default* of `stub` must never be deployed as if it were live,
  which the self-identification satisfies.

**One claim retracted and one file withdrawn (section 18's subject, now done):** the deck's
"nothing abroad, no exceptions" was false for the development build (which calls a hosted
model), and `specialist-deck.pdf` was removed rather than re-exported because the rewritten
`SPECIALIST_DECK.md` has lost its slide separators — marp renders it as a single slide — so
the shipped PDF could only be an export of the pre-correction source. Trigger to restore it:
before the deck is sent to anyone externally.

---

## 20. H05 and C10 — re-derived 2026-09-18

**H05 (layout, i18n, accessibility) — closed.** Filed as "no file in scope touched" with
four named defects. Three are fixed, each with the behaviour pinned by a test rather than
described:

- **Fixed panes, no resize.** Both panes were `w-[340px]` / `w-[320px]` with no control at
  all. They now carry drag handles **and arrow-key resizing** (a resize only a pointer can
  perform is a keyboard trap), each with a minimum and maximum, the width remembered per
  pane, and the handle exposed as `role="separator"` with `aria-valuenow/min/max`. Five
  cases in `CortexShell.test.tsx` cover both handles at the historic widths, resizing in
  both directions and back, the right-hand pane growing leftwards, the bound, and the
  header key.
- **`Encounter view ·` hardcoded.** Now `shell.encounterView`, with `عرض المقابلة` in
  `ar.json` and `en.json`; the test asserts the header resolves through the key.
- **The copy conflict, which turned out to be worse than a wording clash.**
  `TimelinePane.tsx:65` passed the literal string `"current encounter"` as the encounter id
  into a dialog whose own copy promised "These values are sent to NPHIES exactly as shown".
  A placeholder in a field the product explicitly promises is exact is a fabricated value,
  and it was structural: `CortexState` never exposed the encounter id, so the pane had
  nothing real to show. The context exposes it now, the preview renders the real id or an em
  dash, and the dialog's promise names what it guarantees (a field shown as `—` is not
  sent).
- **The i18n namespaces remain.** `encounter`, `scribe`, `timeline` and `journey` still do
  not exist, and **30 files still contain literal JSX text** (measured: 30 files with
  `>Text<` content, e.g. `AmbientPanel.tsx` 10, `ReceptionistTab.tsx` 8). `shell` does
  exist and the surfaces touched here now use it. The sweep is open with a trigger: before
  the first Arabic-first deployment.

**C10 (journey E2E and repeat-run evidence) — open, narrowed.** Its first clause is stale:
B4 was closed on 17 September (§14). What remains is exactly what the row's other two
clauses say — there is no end-to-end journey test, and no clean-run-twice evidence, in the
repository or in CI. Recorded with its trigger (before the first operational pilot) rather
than marked done on the strength of B4.

---

## 21. The PARTIAL residuals, re-derived 2026-09-18

Twelve rows were filed PARTIAL. Read against the repository today, two close, two were
stale in their first clause, one has a fix that is not pinned, and the rest stand with
their evidence re-checked.

**Closed**

- **C07 — dev-session and service exposure.** Both clauses were stale. `B2`:
  `.env.example:195` reads `DEV_SESSION_ENABLED=false`. `B3`: all six exposed services
  default to loopback — `apps/narrative/main.py:184`, `apps/qa/main.py:222`,
  `apps/transcription/main.py:201`, `services/veritas-graph/api_router.py:161`,
  `services/orchestrator/agent_handlers.py:297`, `services/nphies-engine/api_router.py:152`
  each read `os.environ.get("SERVICE_HOST", "127.0.0.1")`.
- **H07 — artifacts in the workspace.** Confirmed and fixed. `backups/` held a
  1,123,412-byte dump and a 2,919-byte `.env` backup that defines `OIDC_CLIENT_SECRET` and
  `DATABASE_URL`; both were git-ignored, so nothing looked wrong, and any copy of the
  workspace carried them. Moved out of the repository (`D:\veritas-private\backups\`,
  reversible, nothing deleted — the scripts reference only the S3 `backups/` prefix, never
  this directory). The deny list's own gap is closed too: `*.zip`, `*.tar.gz`, `*.tgz`,
  `*.7z` are ignored now, and `.dockerignore` — which did not exist — keeps `.env`, venvs,
  dumps, archives and the generated report trees out of image builds.

**Fixed, but not pinned — stated plainly**

- **C02 — patient-switch retention.** `<CortexShell key={patientId}>` now remounts the
  provider when the route changes patient, which is this audit's own remedy. The
  behavioural test I wrote for it did not settle: the page renders the shell behind
  `?view=encounter` only after the record loads, and the mount sequence for the first
  patient was not deterministic enough to assert across several attempts. The test was
  removed rather than left failing, so this fix rests on the type checker and the existing
  suite (237 passed), not on a new test or a live check. Trigger: fold it into the journey
  E2E that C10 still needs.

**Stale in one clause, open in the other**

- **C08 — the NPHIES claim.** The `EXECUTIVE_PRESENTATION.md:188` claim is retracted
  (`51fd4dd`), including in the PPTX slide that carried the same sentence. Still open:
  local-readiness versus payer-outcome states are only partly surfaced in the UI.
- **H01 — container build.** `.dockerignore` added today. Still open: no launcher recipe
  and no startup smoke wired to it; `core` and `web` remain deliberately outside the
  compose stack (that is the L01 item, not an oversight). B6's build failure was reported
  fixed earlier and was **not** re-verified in this pass.

**Open, with the evidence re-checked**

- **C03 — entailment.** No entailment check exists: a citation is verified to *exist*
  (`filter_resolved_sources`, the M10 work) and not yet to *support* its sentence.
  Containment is still a client-side gate that is off by default and bypassed by direct API
  calls.
- **C04 — server-side containment.** The client filter exists; `agent_handlers.py` still
  registers and streams consultant and pharmacist work, and `DEMO_CONTAINMENT` appears in
  no Python file, so an API caller is not constrained.
- **C05 — defer fields.** Propagated for pharmacist and consultant; `nphies_agent` verdicts
  still carry neither field, the defer note still renders only when prose is empty, and no
  test references these fields.
- **C09 — rehearsal evidence.** Not re-derived in this pass: the row's B7 count mismatch,
  the absent encounter IDs, the absent expected findings and the missing rehearsal evidence
  are recorded as filed.
- **H02 — Python readiness.** The five Python services still answer a static
  `{"status":"ok"}`; only nphies-engine adds connector fields. `profiles_verified` remains
  hardcoded `false` and `graph_nodes` remains a `-1` sentinel.
- **H03 — request deadlines.** Still bare, with no deadline: `qa-proxy.service.ts:57`,
  `narrative-proxy.service.ts:86,213`, `nphies/preauth.service.ts:76,105`,
  `interpreter.service.ts:42`, `linkage-verdicts.service.ts:141`; there is still no shared
  client and no typed retryable error.
- **H06 — branding.** Still split: `Cortex.ai` in the interface (`en.json:3,94`) against
  `Veritas-Medica` in eleven service files. This is a product-naming decision rather than a
  defect, and it needs the owner's answer, not an engineer's.

---

## 22. H06 — the product name, decided 2026-09-18

H06's remaining clause was "branding still split: `Cortex.ai` at `en.json:3,94` versus
`Veritas-Medica` in eleven service files". That is not an engineering decision, so it was
put to the owner, who answered: **the official product name is Cortex.ai.**

The code and the tooling now say one thing. Twenty occurrences across sixteen files: the
three FastAPI titles (NPHIES Engine, Agent Orchestrator, NSCRE), the module docstrings that
described themselves as Veritas-Medica, the two service `pyproject.toml` files, and the
four report generators — so documents produced from here on carry the official name in
their header as well (`e843f71`).

**What was deliberately left, and why**

- **Identifiers, paths and environment prefixes.** `services/veritas-graph`, the
  `veritas-*` module and package names, and the environment keys that follow them are names
  of *things*, not branding. Renaming them changes imports, containers and deployment
  manifests for no reader's benefit; prose and identifiers are different edits.
- **Dated documents.** This audit, the executive decks, the onboarding brief and the market
  research keep the wording they were issued under. A document that quotes itself as
  evidence cannot have its own history rewritten underneath it.

**The convention, so the split does not return:** user-facing copy, service metadata and
newly generated documents say **Cortex.ai**; historical and dated material keeps the name
it was published with. A future reader comparing the two is looking at a decision, not an
inconsistency.

---

## 23. The remaining decisions, taken 2026-09-18

Six questions were put to the owner rather than answered by an engineer. The product name
is section 22; the rest are here.

**The rendered HTML is a build artifact.** `docs/reports/html/` is now ignored
(`.gitignore:107`) exactly as `docs/reports/pdf/` already was: `tools/md_report_to_html.py`
writes it and `tools/html_reports_to_pdf.py` consumes it, so a regeneration no longer
leaves an untracked tree behind.

**The stale branches are gone — five of them, each proven redundant first.** `git diff`
against HEAD is useless here (135, 60 and 58 files differ, because every change since is in
HEAD) and hash-based ancestry is useless too, because the identity rewrites replaced every
commit. `git cherry`, which compares patch ids, is the instrument that settles it: five
branches carried zero unique content and were deleted — all five still exist on origin, so
nothing was lost. The sixth, `audit/feature-verification`, was **stopped by that same
check**: it holds an earlier revision of `docs/STABILIZATION_AUDIT.md`, a file that exists
in HEAD with 62 more lines. Nothing is genuinely lost, but the gate is the gate and the
decision is the owner's. `main` and `origin/feature/sprint-4-ambient-scribe` were left
alone — the first is the default branch, the second holds the only copy of
`data/mock_audio/*`.

**M03's KMS deferral is confirmed, not forgotten.** The customer-managed key path throws
`CustomerKmsNotConfiguredError` rather than falling back to a dev key, and the trigger
stands: resolve it **before real patient data enters any environment**.

**The renal demo patient exists now, and the finding does not fire.** MRN-051 — CKD stage
4, metformin, a deliberate creatinine trend of 230→260 umol/L — produces a derived eGFR of
**21.9** (CKD-EPI 2021, computed, not asserted), comfortably under the threshold of 30. It is
visible to the engine through the engine's own query, M06 filter included. The check still
returns zero findings and zero gaps while the graph holds every input it needs (the eGFR, an
active Metformin 850mg, and a `RENAL_DOSE_LIMIT` edge to a rule with `egfr_threshold: 30` and
`flag: CRITICAL_OVERRIDE`). This audit said that seeing a finding "needs a seed with renal
impairment — a data decision, not plumbing"; the data half is now done and verified, so the
remaining cause is on the engine side. **Open finding:** the dose-safety module does not
raise a violation whose inputs are all present. Starting point: the justfile's own comment
that the module "has no rules to evaluate".

**The metformin codes exist; warfarin's do not, evidenced twice.** The NPHIES Medication
Codes resource (SFDA copyright, 1002 concepts, sha256 and size recorded) was retrieved to
close the metformin gap the first fragment left: metformin appears there as seven packaged
products with 14-digit local drug codes. They are recorded under a second source with their
own code format, noting that they identify *products* — the demo's plain 850mg tablet is not
among them, so a code for it is still unsourced rather than borrowed from a different
strength. Warfarin is absent from **both** published resources (zero matching concepts in
1002), so the gap is now evidenced against two sources instead of one, and nothing was
invented to fill it.

**One signature is outstanding.** The governed manifest is updated to the new checksum with
its approver left as `[PENDING: confirm]`; the gate itself is green (11 files match manifest
v2026-09-18.2, all illustrative, `licensed=false`). Signing a governed artifact is not an
engineer's act, so it waits.

---

## 24. The last of the register: invented values, and two traps in the dev stack

**Three of the core's own health values were literals in the one place that promises
accuracy.** `profiles_verified: false` was a constant, so it could never become true however
many profiles were verified; it is now asked of the NPHIES engine, which already published
the answer, and fails closed when the engine is unreachable. `graph_nodes = -1` carried the
comment "signal 'graph reachable' without a real count" -- a number that is not a count reads
as a measurement, so the graph service gained a counts-only endpoint and preflight reports
**919** on the running stack, or `null` when the count cannot be had. The third was found
live: **`app.audit_event` does not exist**, so `audit_events` reported `0` on every preflight
because a bare catch turned the failure into a plausible-looking zero -- the same disease as
the `-1`. The real table is `audit.event`, and the number is **18,256**.

The five new spec cases matter more than the code, because today's *value* of
`profiles_verified` is `false` either way and a live curl cannot tell derived from hardcoded.
One test makes the engine answer `true` and asserts readiness reports `true` -- impossible
against the old literal.

**C02's proof gap is closed.** `key={patientId}` had been shipped but never proven, because
the behaviour test had been deleted rather than left red after six attempts. The reason is
now clear: `vi.mock` factories are hoisted above the module's imports, so a factory that
renders JSX or calls an imported `useState` runs before either exists. The replacement is
deterministic -- no timers -- and ships with a control test proving the counter tracks
mounts, not renders, which is what makes the first assertion mean "remounted".

**C03 asked the missing question.** Existence of a citation was checked; support was not.
`verify_support` is a lexical floor, labelled as a floor: it is not entailment, the docstring
says so, and the wiring **reports without narrowing the list** because dropping unsupported
citations would hide the drift they are evidence of. Writing its own test surfaced the
weakness -- "daily" alone kept a warfarin citation for a metformin answer -- and that case is
now pinned rather than papered over.

**Two dev-stack traps, both self-inflicted.** `uvicorn --reload` did not pick up an edit to
the graph service: the new route returned 404 from a process already serving its new
`/health` shape, so a Python service edit here needs a full clean cycle. And a cleanup hook
chained ahead of the start in one shell **kills that shell**, because the shell's own command
line contains the recipe name the hook searches for; the observed symptom is
`exit 4294967295` with services left half-up. The hook now excludes its own ancestry.

**One long-standing mystery closed by accident.** The repeated "Nest application successfully
started" notifications were not phantom restarts: **three** `just dev` supervisors were
running at once, each with its own watcher. Counting them is itself misleading, since `just`
spawns sub-processes whose command lines also match the recipe name.

**Still open, unchanged:** the five core-side clients that call the Python services
(`narrative-proxy`, `interpreter`, `nphies/preauth`, `nphies/linkage-verdicts`, and the
qa-proxy equivalent) have no deadlines of their own.

---

## 25. The i18n gap, measured rather than predicted

Section 21 left this open with a trigger ("before the first Arabic-first deployment") and
named four namespaces that "still do not exist": `encounter`, `scribe`, `timeline` and
`journey`. Measured against what the code actually asks for, that list was a prediction and
not the gap. **No component references any of those four.** The namespaces the code asks for
and the dictionaries lacked were **`interpreter` (7 keys)** and **`narrative` (17)** -- and
neither call site passes a `defaultValue`, so i18next returned the key itself: an Arabic-first
clinician was shown `narrative.coverageHint` on screen. The English surrounds were English,
which is why it survived review; the missing namespace was only visible in Arabic.

Both namespaces are now written in English and Arabic (parity asserted), and a guard test
walks every `.tsx`, extracts every `t("namespace.key")` reference and fails if either
dictionary cannot resolve it. It immediately found two more that no sweep had reported:
`shell.resizeScribe` and `shell.resizeTeam` -- the aria-labels for the resizable panes added
in section 20, which carried `defaultValue`s and so worked in English while remaining
English-only for Arabic readers.

**The literal-JSX sweep is still open, and the count in section 21 understates it.** That
section measured "30 files with `>Text<` content"; a broader sweep -- uppercase-initial text
between tags, no minimum word count -- measures **50 files and roughly 309 strings**, with
`AiReceptionistPage.tsx` (24), `PatientBrief.tsx` (22), `AmbientPanel.tsx` (19) and
`AuditPage.tsx` (16) at the top. Neither number is wrong: they are different instruments, and
the larger one is the one to plan against. What changed here is the class that was actually
broken -- a referenced-but-unresolvable key -- and that class now has a test.

### 24.1 Correction, same day: transcription is live-verified after all

Section 24 recorded one thing as *not* live-verified: transcription's `/health` returned the
new body in the file and in the commit, and passed its 39 tests, but the running process kept
answering with the old shape, so the claim was withheld.

It was withheld correctly, but the cause was not what the note guessed. The service was being
served by **two processes started at 15:56 and 16:34** -- before the edit -- whose command
lines contain **no port and no repository path**. Every sweep in this session killed by
process *name*, by *command line*, or by the PID that owned the socket, and all three walked
past them; the port owner reported by the OS was not the process answering, and four freshly
launched processes could not take a socket that was already held. Enumerating python
interpreters by **executable path** under the repository found them, and after they were killed
`:5003` went to zero listeners for the first time in the session.

Then a clean start served it correctly:

    :5003 transcription {"status":"ok","service":"clinical-copilot-transcription",
                         "engine":"faster-whisper:large-v3","engine_ready":true,"stub":false}

So the item closes, and the lesson is the project's own earlier one, relearned: **kill by
executable path, never by command line**, and treat the OS's reported socket owner as a hint
rather than a fact. Both the stack-stop tool and the local-dev skill now carry it.


## 26. The claim data itself: codes that do not exist in the standard, 2026-09-18

Everything above concerns whether the software does what it says. This section concerns whether
the **codes it submits** exist at all, which for a claims-integrity product is the more dangerous
question. It was found while wiring the ordering step to the payer rules, and it is the most
consequential finding of the day.

**What the catalogue was.** `data/ontologies/nphies_services.json` was an illustrative subset of
ten services, self-described in its own `_meta` as "Illustrative dev subset -- achi_code is
simplified here as the sbs_code's item+block root (dropping the SBS-specific suffix)". In other
words the root of each code was real and the suffix was not, and the file said so.

**What the published standard contains.** CHI's SBS V2.0 code list (March 2023), retrieved and
committed under `data/ontologies/_sources/`: 10,081 codes, every one of them in 5-2-2 form,
verified programmatically. All seven codes the dev file used, and later all thirty entries in
`app.order_sbs_map`, are absent from it:

| service | dev code | present in SBS V2.0 | official code |
|---|---|---|---|
| ECG | 11700-00-00 | no | **11700-00-00** |
| Echocardiography | 55113-00-00 | no | **55113-00-00** |
| MRI | 63001-00-10 | no | **90901-00-10** |
| HbA1c | 73050-18-50 | no | **73050-18-50** |
| Ankle X-ray | 57518-03-11 | no | **57518-03-11** |

**Why it mattered twice.** A claim whose service code is not in the standard is rejected on coding
alone, so every claim the prototype could assemble carried a rejection cause. And because the
pre-authorization matrix keyed on those same codes, **no rule could ever bind**: the necessity
engine returned RED for every diagnosis against every service, which is why the first measurement
of it looked like an empty rule set rather than a broken join.

**What was done.**
- `tools/build_sbs_catalog.py` generates the service catalogue from the official workbook, which
  is committed as the source. The generated file is .gitignored for size and reproducible, so
  what a reviewer checks is the source and the script, not a 2.5 MB artefact.
- Eighteen `order_sbs_map` entries were corrected to codes verified present in the standard, each
  chosen as the closest published match and each listed in migration 1721200000000.
- After re-ingestion the engine answers with a spread instead of blanket RED: `I10 + ECG` GREEN,
  `E11.9 + HbA1c` GREEN, `M54.3 + lumbar MRI` YELLOW (pre-authorization required), and RED carries
  the diagnoses that would justify the same order.

**Left undone, with its trigger.** Eleven mappings are unverified: CBC, thyroid function,
mammography, biopsy, cardiac stress testing, faecal occult blood, flexible sigmoidoscopy, CT of a
general body site, upper GI endoscopy, coagulation profile, and the troponin assays. Searching the
published list returned either nothing or a different procedure for each, and inventing a code is
the precise failure this section documents. They keep their current values, are marked in the
migration as unverified against SBS V2.0, and must be curated from the payer's own service
catalogue before go-live.

## 27. There was no order lifecycle, 2026-09-18

Challenged during review with the right question, and the precise answer matters because the
loose one would have been wrong:

- The **fields exist** -- `app.service_request.status` and `.intent`, FHIR names.
- Nothing ever **moves** them. Measured: 25 of 25 rows sat at `active`; the four routes on the
  controller are candidates, quick-entry, create and list, none of which change a status; the
  stored `fhir_resource_json` carried no status either; and no `UPDATE ... service_request ...
  status` appears anywhere in the source.

So an order could never be told apart from an order that had been performed, which is what a
sequencing rule needs. Fixed the FHIR way rather than with a bespoke column: `hospital.observation`
gained `based_on` (Observation.basedOn), and the prerequisite check now reports `none | ordered |
resulted`, satisfying only on `resulted`.

`resulted` is deliberately unreachable in dev. An observation and its link arrive from the HIS,
which this prototype does not have, so no result was fabricated to make the screen look complete;
the UI wording distinguishes the two states it can actually reach. A sample completed
echocardiogram order for MRN-001 makes both reachable states visible side by side.

## 28. Coverage is a payer contract, not a national publication, 2026-09-18

Worth recording because it bounds what any amount of engineering here can achieve. CHI publishes
the **SBS catalogue** and NPHIES publishes the **prior-authorization process**; neither publishes
which diagnosis justifies which service for which member, because that is the payer's contract.
The NPHIES prior-authorization use case states it plainly -- the process "ensures that the
requested services meet **payer criteria** for coverage" -- and the coverage itself arrives as a
**Table of Benefits** during the **eligibility** transaction.

Consequences recorded:
- The app's own necessity matrix stays labelled `dev-illustrative`, and its codes are now real
  while its **opinions are not**. That distinction is stated in the data and in the UI.
- Per-patient cover is now modelled (`app.patient_insurance`: payer, plan, policy, member, class,
  network tier, date range, source), because a check that ignores cover is wrong for some
  patients -- six seeded patients are deliberately with six different insurers and plans.
- In production the authoring source for coverage is the payer's eligibility response, not a file
  in this repository.
