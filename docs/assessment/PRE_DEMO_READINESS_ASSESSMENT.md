# Veritas-Medica — Independent Solution Readiness Assessment

**Assessment date:** 11 September 2026  
**Baseline:** `feat/ui-light-theme`, commit `d0fbf96f94f586785d169c25d4a831df5c03339a`  
**Decision:** **Not yet cleared for the proposed unrestricted specialist demonstration. Conditional GO for a narrowed, explicitly synthetic demonstration after the Phase 1 gate. NO-GO for real-patient clinical use or live payer operations.**

## 1. Executive assessment

### Where are we today?

An **advanced functional prototype**, not a production-grade clinical platform. There is substantial executable software: a React application, modular NestJS backend, Python AI and graph services, patient-scoped APIs, deterministic rules, clinician confirmation flows, audit hashing, and broad unit suites. This is not merely a visual mock-up. However, some polished surfaces mix simulation with live context, some safety claims exceed implemented controls, external integrations are incomplete, and deployment and governance mechanisms lag behind feature development.

Do not assign a formal technology-readiness certification from this review. No hospital acceptance study, independent clinical validation, penetration test, production deployment, or certified payer exchange was established.

### Answers to the eight leadership questions

| Question | Independent answer |
|---|---|
| 1. Current maturity? | Advanced prototype / controlled synthetic-data demonstrator. Unit-test maturity is materially ahead of integration, clinical evaluation, deployment, and operations maturity. |
| 2. Strongest capabilities? | Deterministic claim-rule checks with inspectable evidence; explicit code/link confirmation; patient-context aggregation; a coherent documentation-to-claim journey; conservative factual-QA refusal rules; a useful online audit-chain foundation. |
| 3. Main weaknesses? | Evidence attachment is not factual verification; mixed mock/live UI state; missing-data signals disappear downstream; illustrative reference data; unauthenticated internal services; weak production identity/key configuration; non-durable workflows; incomplete deployment topology and cross-store synchronization. |
| 4. Ready to demonstrate? | Not as currently advertised. A synthetic, limited-scope demonstration can be credible after mandatory containment, truthfulness, data consistency, and rehearsal fixes. This assessment does not constitute a completed demo acceptance test. |
| 5. What must precede it? | Remove unsupported claims, separate simulation from live context, suppress unvalidated clinical advice, lock down the demo network/dev authentication, freeze a verified dataset/build, prove the chosen journey and degraded paths, and disclose payer/ontology limitations. |
| 6. Target architecture? | Stateless authorized Core/BFF, deterministic fact/rule services, constrained AI runtime, separate ASR workload, durable integration workers, PostgreSQL source-of-truth, versioned graph/index projections, and enforced identity/egress/audit controls. |
| 7. Next-phase priorities? | Claims-integrity shadow evaluation, persistent coder workflow, accurate reference data, reliable ingestion/lineage, safety verification, authorization/key management, reproducible deployment, and full release gates. Not additional agents. |
| 8. Risks if ignored? | Specialist loss of trust, unsupported clinical prose appearing authoritative, false-green results on incomplete data, unauthorized access, lost workflow state, unreliable recovery, rejected integrations, and investment in breadth without demonstrated economic value. |

### Recommended business focus

**Primary proposition: pre-submission claim integrity and coder remediation.** Show how a documented encounter becomes a reviewed, traceable claim and how an administrative defect is found before transmission. The buyer hypothesis is RCM/CFO leadership, with clinical, IT, security and compliance approval.

Documentation is a supporting workflow, not proof of autonomous clinical intelligence. Keep differential diagnosis, dose recommendations, alternative-medication screening and other clinical decision-support claims outside the main demonstration until their intended use, knowledge sources and validation are approved.

This is a product recommendation, not a regulatory classification. A deterministic algorithm can still perform clinically consequential decision support. “Graph-based” and “human reviewed” do not establish non-SaMD status or legal compliance.

## 2. Scope, evidence and limitations

Eight independent review workstreams covered architecture/integration, AI/agents, data, security, UX, operations, tests and business alignment. Source and configuration were treated as stronger evidence than historical status documents. Parent review spot-checked key findings and executed additional quality and runtime checks.

Materials included source, migrations, model clients/prompts, ontology assets, CI, Docker/Helm/Terraform, operational runbooks, historical assessments, current manual-test records, and executive/specialist presentation Markdown. The untracked `IDEA.md` contains only a one-line concept. Existing untracked presentation artifacts were not changed. Binary presentation exports were not independently compared slide-for-slide against their Markdown sources.

### Execution evidence

| Check | Result and qualification |
|---|---|
| Git baseline | Commit above; seven pre-existing untracked files; no tracked changes before assessment. |
| `pnpm run typecheck` | Passed; Turbo replayed cached successful tasks. This is not a fresh independent compilation of every target. |
| `pnpm run lint` | Failed. Core reported **842 errors**; Turbo stopped on the Core failure. This is not a complete repository-wide lint count. Some are convention/configuration mismatches, not necessarily runtime defects. |
| `pnpm run build` | Passed: Core and Web rebuilt, shared-package tasks were cached. Web emitted CSS `@import` ordering warnings. This does not validate Docker images or Helm deployment. |
| Unit tests, assessment workstream | Reported 418 Node tests: Core 198, Web 214, Shared Types 6; 649 Python tests across 11 projects. A separate reviewer omitted Retrieval and consequently reported a smaller total; do not combine overlapping runs. |
| Core coverage, assessment workstream | Reported 27.57% statements and 25.82% branches. Important controller/auth/integration areas remain poorly exercised. |
| Classifier evaluation, assessment workstreams | EN 100, AR 101, stress 40 cases reported perfect scores. Default second-pass evaluation is heuristic/stub-based; this is not production-model robustness evidence. |
| Runtime smoke, parent execution | Web and Core plus services on 5001–5006 returned HTTP 200. ASR health reported `faster-whisper:large-v3`. NPHIES health reported `connector_mode: stub`, `profiles_verified: false`. |
| E2E/load/deployment | No fresh authenticated browser acceptance run, k6 run, official payer transaction, clean migration/restore drill, container deployment, Helm render or Terraform apply was completed by this assessment. Reviewers found Playwright dependency/command absent, k6 unavailable, and Helm/Terraform CLIs unavailable. |

Health responses establish process reachability, not correct patient grounding, safe configuration, graph freshness, consent, or successful external integration. Actual credentials and private environment files were not read. No clinical facts or dosage guidance were independently generated or validated in this report.

## 3. Current architecture and domain assessment

### Implemented topology

- **Frontend:** React/TypeScript/Vite SPA, Tailwind, several patient workspaces including Sully three-pane encounter and Journey wizard. It is **not Next.js**, despite the project rule's stated stack.
- **Core:** NestJS REST backend, OIDC/session authentication, RBAC, patient scope, clinical/application persistence, orchestration proxies and integrations.
- **Python:** Narrative, Q&A, transcription, graph/NSCRE, agent orchestrator and NPHIES engine. Active internal calls are largely REST/HTTP; documented gRPC contracts are not the operative end-to-end path.
- **Data:** PostgreSQL clinical mirror and application state; Neo4j patient/reference projections; pgvector/retrieval package; object storage/audit export support.
- **AI:** Hosted or OpenAI-compatible local model adapters, scripted fallbacks, classifier/blocklist, prompt loader, deterministic graph checks and prose generation. The active Q&A endpoint assembles broad PostgreSQL facts rather than invoking the packaged hybrid retriever.
- **Deployment:** Compose provisions infrastructure only; application processes run separately. Helm covers only part of the current service topology. Terraform is substantially scaffolding.

### Assessment by dimension

| Dimension | Assessment |
|---|---|
| Architecture | Modular Core is sound; service fragmentation and duplicated contracts exceed current operational maturity. Keep domain modules, consolidate shared AI plumbing, isolate workloads only where scale/security warrants it. |
| AI/ML | Strong intent to separate facts from language, but weak entailment/fidelity enforcement. Temperature zero, blocklists and unchanged evidence objects cannot prove arbitrary generated text is true. |
| Data | Good normalized schema/FHIR JSON preservation; poor end-to-end freshness, deletion, identity linkage and reference-release governance. |
| Integration | Useful adapters and local workflow seams; real HIS/payer/SMS capability must be demonstrated per connector, not inferred from interface code. |
| Agentic design | Mostly bounded handlers and scripted handoff chains, not an autonomous planning system. This is appropriate. Durable state and explicit evidence completeness matter more than adding agent memory or planning. |
| Accuracy/reliability | Missing/unknown coverage can become apparently reassuring output. Fake source attachment and mixed simulation are more urgent than model selection. |
| Security/governance | Core controls are substantive but bypassable through reachable internal APIs. Production user revocation, keys, tenancy and audit durability are incomplete. |
| Performance | No current production-shaped latency/concurrency evidence. Risks include sequential ingestion, unbounded proxy waits, repeated model calls, DB-pool multiplication and process-local state. |
| UX | Three-pane and Journey concepts communicate value, but competing workspaces, partial translation, cramped panes and inconsistent persistence increase cognitive and demo risk. |
| Operations | Useful metrics/runbooks and Kubernetes skeleton; insufficient dependency readiness, deployed telemetry, durable jobs and verified recovery. |
| Testing | Broad unit success does not establish safety or integration readiness. CI excludes important Python services and lacks non-skippable E2E, real-model eval and deployment gates. |
| Business alignment | A defensible claim-integrity hypothesis exists; realized financial benefit, site-specific accuracy and clinician time savings are not measured. |

### Historical findings that must not be repeated as current defects

The older reports say the orchestrator has no provider abstraction or PHI guard. Current code includes both: `services/orchestrator/model_provider.py:82-153`, `services/orchestrator/deepseek_client.py:57-87`; narrative also gates egress at `apps/narrative/src/narrative/model_client.py:232-279`. These earlier findings are partly resolved. This does **not** prove the live configuration is approved or de-identification complete. Likewise, the currently running ASR reports a real engine; the remaining issue is unsafe stub defaults and API mode enforcement, not a claim that the observed runtime uses stub ASR.

## 4. Prioritized issue and enhancement register

**Priority means sequencing for this proposed demonstration:**

- **Critical — Must fix before demonstration:** fix, safely contain, or remove the affected capability from the demonstrated scope.
- **High — Strongly recommended before demonstration:** increases credibility/reproducibility; all relevant items must close before an operational pilot.
- **Medium — Can be addressed immediately after demonstration:** still a mandatory pre-PHI/pre-pilot gate where stated.
- **Long-term — Enhancement for production/scaling:** not optional before the deployment mode that needs it.

Effort estimates are rough **person-days of engineering**, not elapsed schedules, quotes, or guarantees. Clinical annotation, licenses, hospital onboarding and regulatory review are additional dependencies. Estimates overlap and must not be summed as a project budget.

### A. Critical — Must fix before demonstration

| ID | Current State → Issue/Gap | Impact/Risk | Recommended improvement and acceptance evidence | Effort |
|---|---|---|---|---|
| C01 | Specialist deck says “cannot invent facts,” every statement checked, and “cannot drift”; code does not enforce these promises. `docs/executive-demo/SPECIALIST_DECK.md:122-131,209-219`; `apps/qa/src/qa/synthesis.py:113-132,202-204`. | One counterexample invalidates the central trust pitch. | Replace with “deterministic rule findings are inspectable; generated drafts require validation and clinician review.” Remove zero-liability/blanket compliance/certification assertions. Independently source or remove industry benchmarks. Review all exported decks. | 1–2 |
| C02 | Patient-scoped Sully state retains synthetic initial messages and mock orders alongside real results. `apps/web/src/components/layout/SullyContext.tsx:306-424,815-818,1304-1316`. | Wrong-patient or invented clinical context appears authentic. | Enforce mutually exclusive synthetic and live datasets. No clinical mock fallback once a patient is selected. Test empty record, service failure, patient switch and refresh; all content must identify the same patient/encounter and provenance mode. | 3–5 |
| C03 | Q&A links sources by one overlapping long word, falling back to the first chunks; narrative retains unsupported sentences. `apps/qa/src/qa/synthesis.py:113-132`; `apps/narrative/src/narrative/provenance.py:43-155`. | Unsupported prose obtains misleading citations. | For the demo use deterministic fact rendering or restrict to validated copied facts. Before pilot replace heuristic attribution with typed atomic facts/source fields and unsupported-claim rejection. A citation must support the claim, not merely share vocabulary. | 2–4 containment; 10–20 full |
| C04 | Consultant/Pharmacist code explicitly permits diagnosis/dose-related prose without a verification gate. `services/orchestrator/agent_handlers.py:7-25,93-144`. | Clinically consequential advice is presented beside valid evidence that does not validate the advice. | Disable these prose paths and alternative-medication suggestions in the demo. Retain only approved deterministic administrative checks. Reintroduce clinical functions only through separate intended-use, knowledge-source and validation gates. | 1–3 containment |
| C05 | NSCRE computes `overall_defer`, evidence gaps and limitations, but handlers select findings without preserving them. Reference rules are illustrative. `services/veritas-graph/nscre_engine.py:436-487,611-665`; `services/orchestrator/agent_bus.py:289-315`; `data/ontologies/nscre_contraindications.json:2-7`. | Absence of findings is confused with evaluated safety or payer eligibility. | Propagate completeness/freshness/coverage with every verdict. Unknown, not covered and unavailable must never become green. Watermark illustrative rules; demonstrate one missing-data case. | 3–6 |
| C06 | SOAP/reformat output is accepted as model strings; stub ASR can return fixed text irrespective of audio. `services/orchestrator/deepseek_client.py:192-215`; `apps/transcription/src/transcription/reformat_llm.py:21-44`; `apps/transcription/src/transcription/engine.py:22-43`. | Fabricated/altered clinical content can enter a plausible draft. | Separate scripted playback from real capture at API and UI level. Reject stub on live capture; keep reviewed transcript and explicit source spans. Use verbatim/deterministic formatting in the selected demo if fidelity cannot be proven. | 2–4 containment; 10–20 full |
| C07 | Internal patient APIs bind on all interfaces without caller auth; dev-session API can issue roles from a known subject outside exact production mode; Compose exposes fixed-credential services. `apps/qa/main.py:370-408`; `apps/core/src/auth/dev-session.controller.ts:38-89`; `docker-compose.dev.yml:9-108`. | Network-adjacent users can bypass authorization or manipulate the demo. | Bind internal ports to loopback/remove external publishing; isolate demo network; disable dev-session route in demo builds; use normal OIDC. Verify direct internal access is blocked from another host and no privileged session can be minted anonymously. | 1–3 containment |
| C08 | NPHIES profiles are explicitly unverified; runtime reports stub; separate claim connector live path is unimplemented. `services/nphies-engine/config/nphies_profiles.json:2-8`; `apps/core/src/nphies/connector.service.ts:58-71`. | Simulated acceptance is mistaken for real payer approval or conformance. | Label every simulated response and keep real submission disabled. Show local readiness versus payer outcome as different states. Remove live-sandbox claims unless backed by official transaction evidence. | 1–2 |
| C09 | Graph refresh is manual and demo seed recipes do not fully establish patient projection/safety data. `services/veritas-graph/etl_pskg.py:427-478`; `justfile:37-43`. | A warm laptop succeeds while a clean demo produces missing or stale evidence. | Freeze one manifest linking seed, patient/encounter IDs, reference release, PostgreSQL/Neo4j counts and expected findings. Perform a clean reset rehearsal and verify exact source versions before the meeting. | 3–5 |
| C10 | Stage Document demo-derived SOAP may not persist to later Journey stages; full E2E may skip when prerequisites fail. `apps/web/src/components/layout/SullyContext.tsx:754-763,958-970,1064-1070`; `tests/e2e/document-draft.spec.ts:36-43`. | A fresh session exposes a broken headline journey despite historic manual success. | Fix effective reviewed-state persistence or use a verified alternative path. Add non-skippable E2E for fresh login, document, confirm, code/link, local check, simulated result and audit. Run twice from clean state, including failures. | 3–6 |

### B. High — Strongly recommended before demonstration

| ID | Current State → Issue/Gap | Impact/Risk | Recommended improvement | Effort |
|---|---|---|---|---|
| H01 | Numerous services must be launched manually; Docker contexts miss shared Python dependencies and Core image omits FHIR workspace inputs; Helm lacks newer services. `apps/core/Dockerfile:5-38`; `.github/workflows/ci.yml:242-249`; `infra/helm/values.yaml:13-75`. | Non-reproducible startup; deployment fails away from developer machine. | Ship a complete, pinned demo launcher/Compose service catalog and startup smoke checks. Repair images before claiming container portability. Full production Helm is not required for a contained laptop demo. | 8–15 |
| H02 | `/health` is process-only while DB startup failure can be tolerated. `apps/core/src/health/health.controller.ts:6-20`; `apps/qa/main.py:59-98`. | False-green readiness; failures discovered during presentation. | Separate liveness/readiness/status; expose safe model/connector modes, DB/graph freshness and safety-module availability. Preflight must check a real read-only workflow. | 3–5 |
| H03 | Bare outbound fetches have no consistent deadlines; some UI errors collapse into empty arrays. `apps/core/src/ai-team/ai-team.service.ts:112-135`; `apps/web/src/components/layout/SullyContext.tsx:765-784,1082-1093`. | Hung requests, silent partial output and unclear retries. | Shared bounded HTTP client, cancellation and typed retryable errors; explicit unavailable/stale states and retry actions. Never blindly retry a side-effecting request. | 5–10 |
| H04 | CI covers only QA/Narrative Python apps; E2E/load/eval are not release gates; lint fails; React tests warn about duplicate transcript keys. `.github/workflows/ci.yml:113-118`; `apps/web/src/components/layout/SullyContext.tsx:734-803`. | Passing tests conceal untested critical paths and broken release gates. | Add all workspace suites, real startup/E2E checks and classifier eval; fix duplicate keys/CSS warnings. Triage lint rules versus defects, establish a reviewed baseline and prevent new violations rather than disabling safety rules wholesale. | 5–10 |
| H05 | Multiple workspaces, cramped fixed panes, incomplete encounter i18n and missing keyboard/focus semantics. `apps/web/src/components/layout/SullyShell.tsx:41-66`; `apps/web/src/components/timeline/PreAuthModal.tsx:68-95`. | Specialized users struggle to complete the task or interpret evidence. | Choose one primary Journey; focus/resizable panes, readable text, role-tailored actions, localized strings, accessible verdict text and modal focus handling. Fix preauth “current encounter” versus “exactly as shown” copy. | 5–10 |
| H06 | Historical runbooks and decks disagree with current behavior; branding differs; SAR exposure uses a fixed average. `docs/demo-runbook.md:77-81`; `apps/core/src/claim-integrity/claim-simulator.service.ts:95-100,237-244`. | Conflicting intended-use story and overstated ROI. | One versioned demo truth table: live, scripted, simulated, unavailable. Standardize branding and expected clicks. Label illustrative exposure; use real claim amounts only in an approved pilot. | 2–4 |
| H07 | Backup/env-backup artifacts exist inside the workspace, outside portable ignore protection. `.gitignore:11-15`; file inventory. | Accidental disclosure through archives or support bundles. | Keep backups outside the repo, encrypted and access-controlled; add portable deny patterns and a sanitized export process. Contents were not inspected, so do not assert actual PHI or secret exposure. | 1–2 |

### C. Medium — Immediately after demonstration; close before relevant real-data pilot

| ID | Current State → Issue/Gap | Impact/Risk | Recommended improvement | Effort |
|---|---|---|---|---|
| M01 | Sessions/OIDC state/rate limits are local maps; ingestion runs per process; chart requests multiple replicas. `apps/core/src/auth/session.service.ts:23-46`; `apps/core/src/auth/auth.service.ts:19-25`; `apps/core/src/ingestion/ingestion.scheduler.ts:4-38`. | Intermittent login, duplicate work and bypassable rate limits. | Keep demo single-instance. Before multi-replica pilot, shared TTL session/state store, atomic callback consumption, shared rate limits and singleton/durable scheduling. | 5–8 |
| M02 | Role/disable updates do not reliably revoke session authorization; unknown DB-user login can continue. `apps/core/src/auth/auth.service.ts:119-160`; `apps/core/src/admin/admin.controller.ts:299-356`. | Revoked or unapproved users retain access. | One authoritative enabled-user/tenant/role mapping; fail closed; session revocation/version checks and authorization matrix tests. **Pre-PHI gate.** | 5–8 |
| M03 | Known development master-key fallback is not production-gated; customer provider is a stub. `apps/core/src/security/local-key-provider.service.ts:18-33`; `customer-key-provider.service.ts:27-46`. | Encryption appears present while key protection is ineffective. | Reject missing/known keys outside isolated tests, implement KMS/HSM wrapping, rotation and recovery. **Pre-PHI gate.** | 8–15 |
| M04 | Tenant boundaries are missing from clinical/graph keys; RLS session variables are not populated and owner roles can bypass policies. `apps/core/migrations/1718000000000_initial-schema.ts:143-183,352-391`; `apps/core/src/database/database.module.ts:13-19`. | Application omissions can expose records; multi-hospital collisions. | Prefer single-tenant deployments initially; least-privilege non-owner DB roles, transaction-local scope and tested RLS. Add tenant-qualified keys before shared tenancy. Fix care-team scope invalidation and multi-role handling. | 10–25 |
| M05 | Related FHIR queries swallow failures and read only a page; encounter/attending relationships are dropped; upserts leave flattened fields stale; identity merge only logs. `apps/core/src/ingestion/ingestion.service.ts:228-240,321-470`. | Incomplete/split records silently feed AI and authorization. | Checkpoints, all-page traversal, partial-failure status, reference resolution, complete versioned mappings, transactional patient ingestion and real identity adjudication/alias workflow. | 15–25 |
| M06 | Graph/index refresh lacks deletion, atomic publication and source-version lineage. `services/veritas-graph/etl_pskg.py:330-478`; `services/veritas-graph/graph_client.py:90-113`. | Stale clinical facts survive correction or deletion; evidence cannot be reproduced. | PostgreSQL outbox, idempotent projection consumers, source hashes/versions, watermarks, per-patient reconcile/replace, dead-letter queue and lag monitoring. | 10–20 |
| M07 | DSR service expects columns absent from migrations and only records requests; ambient consent is not a server-enforced receipt. `apps/core/src/dsr/dsr.service.ts:44-139`; `apps/core/migrations/1718000000000_initial-schema.ts:128-138`; `apps/core/src/ambient/ambient.controller.ts:105-191`. | Governance workflows are not operational; request registration is mistaken for erasure. | Forward schema migration and clean-DB integration test; retention/legal-hold-aware lifecycle across SQL, graph, indexes, files and backup expiry; consent receipt and withdrawal enforcement. No blanket deletion contrary to medical-record obligations. **Pre-PHI gate.** | 15–30 |
| M08 | Generic audit writes fail open after response; WORM export may log success without SDK upload; backup script assigns stdin to both dump and passphrase. `apps/core/src/audit/audit.middleware.ts:47-84`; `worm-export.service.ts:146-184`; `infra/scripts/backup-db.sh:41-52`. | Missing access evidence and potentially unusable recovery artifacts. | Transactional critical-event outbox; durable export manifests with object readback/retention verification; separate encryption passphrase FD; isolated SQL restore and graph rebuild/restore drills. Scrub raw search metadata and minimize identifiers. | 8–15 |
| M09 | Coder queue, NPHIES background tasks/SSE and agent history are process-local. `apps/core/src/claim-integrity/coder-queue.service.ts:10-15,68-72`; `services/nphies-engine/tasks.py:13-104`. | Restart loses assignments/results; retry can duplicate operations. | Persist workflow state, idempotency keys, attempt history and terminal states. Transactional outbox/inbox, worker leases and reconciliation; SSE only notifies, durable status is authoritative. | 10–20 |
| M10 | Active Q&A bypasses packaged hybrid retrieval; source IDs identify patient rather than source row; embeddings are stubbed; keyword rank lacks ordering. `apps/qa/main.py:112-180,370-389`; `packages/retrieval/src/retrieval/retriever.py:31-46`; `embedder.py:17-56`. | RAG claims exceed reality; source drill-down and ranking quality are weak. | First establish typed SQL/graph fact contracts with immutable record IDs. Retain lexical retrieval until evaluated multilingual embeddings improve retrieval. Fix deterministic ranking and transactional index replacement before activation. Explicitly amend the Neo4j-only project rule if adopting SQL factual retrieval. | 10–20 |
| M11 | Illustrated/unlicensed reference subsets and unverified payer profiles; ATC slicing does not match intended subgroup. `data/ontologies/sfda_medications.json:2-6`; `services/veritas-graph/ingest_ontologies.py:162-190`. | Wrong coverage and class membership; invalid clinical/payer conclusions. | Govern licensed reference releases with effective dates, checksums, approvers and coverage. Use explicit hierarchy identifiers, not string guesses. Obtain official IG/code-system requirements and conformance evidence; do not guess AM/CM from old documents. | 10–20 plus external lead time |
| M12 | Small internally tuned classifier sets and mostly stub generation tests; recap/translation fidelity not verified; conversation history not used. `packages/classifier/eval/evaluate.py:91-105`; `apps/narrative/src/narrative/interpreter.py:51-82`; `apps/qa/src/qa/qa_service.py:55-81`. | Perfect internal scores obscure unsafe additions, omissions, translation errors and failed follow-ups. | Independent versioned evaluation datasets, adversarial notes, bilingual clinical adjudication, numeric/negation fidelity checks and actual deployed-provider regression. Label Q&A stateless until bounded entity/fact-ID memory is implemented and scope-revalidated. | 15–30 plus annotation |

### D. Long-term — Production/scaling program

| ID | Current State → Issue/Gap | Impact/Risk | Recommended improvement | Effort |
|---|---|---|---|---|
| L01 | Helm injects wrong/missing OIDC/model/DB settings; Terraform does not provision the described full stack; web security context conflicts with conventional nginx runtime paths. `infra/helm/templates/core-deployment.yaml:49-109`; `qa-deployment.yaml:38-43`; `infra/terraform/modules/storage/main.tf:7-76`; `web-deployment.yaml:23-50`. | Broken or silently stubbed deployment despite successful application build. | One selected hosting target, typed configuration contracts, complete images/manifests, migrations/jobs, unprivileged nginx with writable temp mounts, immutable promotion and real deployment/rollback tests. | 15–30 |
| L02 | Internal services trust network reachability; no consistent service auth or packaged ingress/egress policies. `services/veritas-graph/api_router.py:60-107`; `infra/terraform/modules/k8s/main.tf:28-125`. | Lateral movement bypasses patient scope and audit. | Workload identity and authenticated service context; mTLS where required; default-deny networking/egress and private databases. Pilot containment is mandatory before PHI; mesh adoption itself is optional. | 10–20 |
| L03 | Dashboards/runbooks exist but telemetry/alerts are not fully provisioned; Python scrape annotations target absent metrics. `infra/helm/templates/qa-deployment.yaml:22-25`; `docs/ops/02-observability.md:66-115`. | No dependable end-to-end SLO, model-cost or failure visibility. | OTel collector, trace propagation, metrics/log pipeline, PHI-safe event schemas, actionable alerts, synthetic workflows and tested on-call runbooks. Track model/provider/prompt/rule versions and fallback reasons. | 10–20 |
| L04 | CPU-only scaling, uncoordinated DB pools and no measured real-model capacity. `infra/helm/templates/hpa.yaml:1-48`; `apps/core/src/database/database.module.ts:13-19`. | Scaling API replicas can overload DB/model endpoint without reducing latency. | Load-test p95/p99, pool waits, inference concurrency, queue depth and GPU memory. Set global connection/token budgets, bounded contexts, workload-aware scaling, backpressure and per-tenant quotas. | 10–20 |
| L05 | Incomplete CI/security workspace coverage, mutable action/image refs and no signed release chain. `.github/workflows/security.yml:93-106,164-189`. | Supply-chain/config regressions ship outside test coverage. | SHA-pin actions, digest-pin images, least privilege, full dependency/IaC scans, SBOM/signing, admission policy, DAST/authorization testing, canary rollout and rollback. | 8–15 |
| L06 | No demonstrated HA/PITR/DR, hospital change-control or full governance approvals. `infra/terraform/modules/postgres/main.tf:12-70`; `docs/PROJECT-STATUS-FULL-2026-07-22.md:191-203`. | Service/data loss and unmanaged clinical/privacy obligations. | Site-specific RPO/RTO, verified SQL/graph recovery, failover drills, retention, incident ownership, DPIA/legal/regulatory determination, clinical hazard file and hospital acceptance. | Multi-month cross-functional program |

## 5. Target architecture and design alternatives

### Recommended logical topology

```text
Clinical / coding / admin UI — explicit synthetic or live posture
    |
TLS ingress / BFF — identity, rate limits, request policy
    |
Stateless Core modular application
  authorization + patient/tenant scope + workflow state
  clinical approvals + transactional writes + audit/outbox
    |
    +-- Deterministic fact/query service --> PostgreSQL authoritative mirror
    |                                      + versioned Neo4j projection
    +-- AI runtime --> shared provider gateway --> approved local/in-Kingdom model
    |     typed inputs, prompt registry, PHI policy, constrained output validation
    +-- ASR runtime --> approved audio processing + consent/retention
    +-- Durable workers --> hospital FHIR/HIS and official payer adapters

Projection workers: SQL outbox --> graph / lexical or evaluated vector index
Status: durable database record --> notification stream --> UI
Cross-cutting: service identity, private networking, audit, OTel, release/eval registry
```

### Challenge the current design

1. **Do not make Neo4j the mandatory route for every fact.** PostgreSQL is a reasonable authoritative store for patient dates, observations and document metadata. Neo4j is valuable for multi-hop relationships/rules. Forcing simple reads through a manually synchronized graph adds staleness and operational risk. This is a proposed change to the current project rule, requiring explicit owner approval—not an assertion that SQL already complies with that rule.
2. **Do not add a vector database merely to claim RAG.** pgvector is sufficient if measured semantic retrieval helps. Start with typed structured queries plus exact record IDs; add multilingual retrieval only after a blinded relevance benchmark beats the lexical baseline.
3. **Do not solve correctness by upgrading the model.** Use typed facts and deterministic rendering for clinical and coding assertions. Let the model organize language around locked fields. Exact-match validators can protect numbers/codes but do not fully validate semantics; arbitrary prose still requires adjudicated evaluation and human review.
4. **Prefer bounded workflows over autonomous agents.** Define states such as proposed → reviewed → approved → queued → submitted → acknowledged/rejected/unknown. The LLM must not decide patient scope, clinical action approval, billing code validity or whether transmission succeeded.
5. **Use a PostgreSQL outbox before introducing Kafka or a complex agent platform.** It matches the existing source-of-truth and provides durable business state. Add a broker only when throughput or integration topology justifies it.
6. **Consolidate duplicated AI plumbing, not every workload.** Share provider/egress/prompt/validation/telemetry libraries. Keep ASR separate for resource isolation, and workers separate from interactive request handling. Retain the modular Core instead of splitting each module into a service.
7. **Start single-tenant and single-instance where appropriate.** A documented restricted pilot can avoid premature shared tenancy; it cannot avoid patient authorization, secure keys, audit and durability. Do not scale process-local state behind an HPA.
8. **Evidence needs content, completeness and version.** A useful envelope carries patient/encounter ID, source resource/version/field, observed time, rule release, coverage, missing inputs, transformation version, and verdict. UI proof should say what was and was not checked; raw Cypher belongs in technical details.

## 6. Solution enhancement roadmap

The following elapsed ranges are planning hypotheses assuming a small dedicated team with backend, frontend, QA/platform capacity and available clinical/coding reviewers. Re-estimate after fixing scope. External approvals and reference licensing may dominate.

### Phase 1 — Demo Readiness: approximately 2–3 focused weeks

**Objective:** a repeatable, honest, safe synthetic-data demonstration—not production readiness.

1. Product/clinical owner freezes intended use and removes C01/C04/C08 overclaims and unsafe surfaces.
2. Platform owner contains ports/authentication and checks outbound processing posture (C07).
3. Frontend/backend owners eliminate mixed datasets and fix chosen Journey persistence (C02/C10).
4. AI/data owners ensure no unsupported generated statement is presented as verified; propagate unknown states and freeze graph/seed manifest (C03/C05/C06/C09).
5. QA owner establishes a non-skippable golden journey, invalid-scope test, missing-data test, dependency-outage test and clean restart rehearsal.
6. Presenter uses a single revised runbook and fresh exports/screenshots tied to the release commit.

**Exit:** every Critical item is closed by verified fix or documented capability exclusion; no real patient data; no unlabelled simulation; clean-run and failure-run evidence attached; current lint/build/test posture disclosed; product, technical and clinical leads sign the demo checklist.

A full Kubernetes rebuild, official payer certification and clinical-model training are **not** prerequisites for this contained demonstration. They are prerequisites for the corresponding later claims/use cases.

### Phase 2 — Pilot Readiness: approximately 6–12 engineering weeks, plus access/approval dependencies

**Objective:** one hospital, one workflow, controlled shadow use before operational reliance.

- Prioritize claim-integrity batch intake and persistent coder workflow (M05/M09/M11).
- Complete pre-PHI controls: identity revocation, keys, private authenticated services, scope/RLS, consent where applicable, retention/DSR and audited data-flow approval.
- Use governed reference releases and verified source mapping; build independently labeled retrospective claims cohort.
- Implement cross-store reconciliation/freshness and end-to-end source lineage.
- Add durable jobs/status and recovery; validate backup restores and audit-export receipts.
- Execute full CI/E2E, real-provider evaluation if generation is enabled, authorization tests and pilot load tests.
- Start with retrospective/shadow flags only. No automatic claim blocking, order placement, patient messaging or clinical recommendations.
- Official NPHIES onboarding/conformance is required **before live payer exchange**, not before a read-only historical claims study.

**Exit:** approved data agreement and intended use; no unresolved safety/security blocker for the selected workflow; measured quality on untouched holdout; documented errors/limitations; durable workflow recovery; accepted support and rollback plan; hospital clinical/coding, DPO/security and IT sign-off.

### Phase 3 — Production Readiness: multi-month gated program

**Objective:** dependable site-specific operations and controlled scaling.

- Complete secure deployment/IaC/configuration and immutable promotion.
- Production identity/KMS, network/service security and multi-tenant isolation if sharing infrastructure.
- Official integration certification/evidence and certificate/credential lifecycle.
- HA/PITR, graph recovery strategy, restore/failover drills and tested RPO/RTO.
- SLO monitoring, alerting, on-call ownership, cost budgets, capacity tests and workload-aware scaling.
- Prospective shadow validation, staged activation, incident learning and clinical change control.
- Model/prompt/rule/index release registry, drift checks, canary rollout and rollback.
- Separate clinical decision-support program if those features are retained; no inference that administrative readiness validates clinical safety.

**Exit:** site acceptance, security assessment, applicable governance approvals, full integration evidence, recovery and failover evidence, operational ownership and measurable business benefit. Production approval is per workflow/site, not a blanket product label.

## 7. Testing, evaluation and acceptance plan

### Proposed datasets — requirements, not existing evidence

| Dataset | Initial design | What it proves |
|---|---|---|
| Golden demo pack | 50 frozen synthetic scenarios spanning EN/AR/code-switch, empty/stale facts, patient switching, denied scope, outage, duplicate submit and restart | Reproducibility and safe selected workflow |
| Classifier | At least 1,000 independently labeled questions; untouched holdout by category/language; dialect, misspelling, indirect intent and adversarial paraphrases | False-allow and false-refusal behavior of actual deployed configuration |
| Grounded generation | At least 500 patient/question or note cases with atomic required/forbidden facts, negation, values, units, dates and source IDs | Unsupported additions, omissions, contradictions and citation entailment |
| Retrieval | At least 300 bilingual queries with graded source relevance and exact record IDs | Recall@k, nDCG and whether embeddings improve the current baseline |
| ASR/SOAP | Representative approved audio across speakers, dialects, noise and specialties; initial target 20 hours with adjudicated transcripts | WER plus clinical entity/negation/number error and edit burden |
| Claims/rules | At least 500 adjudicated orders/claims, including clean and defective examples, payer/date strata, unseen pairs and uncovered codes | Flag precision/recall, abstention/coverage, coder workload and financial relevance |
| Stateful integration | At least 200 cases spanning duplicates, timeout-after-send, out-of-order events, restart, retry and stale approval | No lost work, duplicate effect or false terminal success |

Dataset sizes are initial planning targets, not guarantees of statistical power. Choose sample sizes and confidence intervals with the clinical/statistical owners; preserve an untouched external holdout and report subgroup uncertainty.

### Acceptance metrics

**Demo hard gates:** zero observed unauthorized disclosures, mixed-patient content, unlabelled simulations, fabricated payer successes or unsupported clinical assertions in the selected scenario pack. Every demonstrated deterministic verdict must have the correct source/rule and completeness state. Every required E2E executes rather than skips. Passing a finite set is not a proof of zero risk.

**Pilot proposed quality gates:** agree before running the holdout, then do not tune on it.

- Factual-QA classifier: refused recall target ≥99%, allowed specificity ≥92%; report per-category confidence intervals. Escalate any safety-critical false allow.
- Clinical numbers/codes/medications: **no observed critical fabrication or contradiction**; block/review outputs that cannot be verified. Do not adopt a tolerable hallucination percentage as permission to emit unsafe claims.
- Citation precision target ≥99%, citation recall ≥98%, with adjudicated entailment—not source attachment counts.
- Retrieval Recall@10 target ≥95%; evaluate language parity and abstention on uncovered material.
- Claim-defect flags: initial negotiated target ≥95% precision and ≥90% recall on in-scope adjudicated defects; separately measure uncovered codes and false-positive workload. These targets are not proven current performance or a universal clinical standard.
- ASR: report WER by dialect/acoustic setting plus clinical entity/negation errors, speaker attribution and clinician editing time. Aggregate WER alone is insufficient.
- Repeat actual model cases multiple times; assert invariant safety decisions, not identical prose. Pin model, prompt, provider settings and rule versions.
- Critical auth/workflow branches: proposed ≥80% branch coverage plus adversarial integration tests. Coverage is a floor, not evidence of correctness.

**Operational gates:** successful restart/replay and idempotency tests; validated audit-event completeness; tested restore and rollback; no unresolved critical security findings. Measure p50/p95/p99 per workflow with concurrency, dataset size and model hardware reported. Adopt existing k6 budgets only after confirming they reflect the selected workflow; no new latency claims are made here.

### Business KPIs and measurement design

| KPI | Definition / measurement |
|---|---|
| Defect precision | Adjudicated true defects divided by all flags; track by rule/payer/department. |
| Defect recall | In-scope adjudicated defects detected divided by all in-scope defects; report knowledge coverage separately. |
| First-pass acceptance | Accepted first submissions divided by first submissions; only meaningful after real payer outcome access. |
| Coder productivity | Reviewed claims per staffed hour and median time-to-resolution; compare matched baseline/shadow cohorts. |
| Financial impact | Actual avoided/recovered paid value minus review/integration/operating cost; do not use all rejected value as permanently lost revenue. |
| Documentation burden | Median total capture-plus-review/edit time and after-hours completion versus baseline; not generation latency alone. |
| Evidence usability | Time to verify a finding, disagreement/escalation rate and user confidence after errors are shown. |
| Reliability/cost | Lost/duplicate workflow items, error rate, tail latency, fallback rate, cost per completed encounter/claim, token/GPU utilization. |

The existing percentage-improvement figures are hypotheses, not measured outcomes. Use a retrospective baseline, blinded adjudication, shadow period and then a limited prospective comparison. Account for case mix, payer policy changes and additional coder workload before attributing savings to the product.

## 8. Recommended specialist demonstration

### Story: “One documented encounter, one prevented administrative defect, one accountable resolution”

**Duration:** approximately 12–15 minutes. Use a single synthetic patient and encounter approved by the clinical/coding reviewers. Do not manufacture clinical values or code pairings for the presentation; select them from the frozen validated fixture manifest.

| Sequence | What to show | Business proof |
|---|---|---|
| 1. Scope and honesty | Persistent synthetic-data banner; identify live local checks, scripted audio if used, and simulated payer boundary. | Trust before feature claims. |
| 2. Patient context | Physician login, correct assigned patient, source timestamps and documented record. | Less searching; authorized, coherent context. |
| 3. Reviewed documentation | Brief prepared transcript, explicitly marked playback or real ASR; editable draft; clinician corrects one phrase and confirms. Use constrained/verbatim output if full fidelity gate is not ready. | Reduced clerical work without surrendering authorship. |
| 4. Clinical intent to administrative work | Show existing clinician-documented order and diagnosis; suggest codes only from approved reference fixture; user confirms code and association. | Fewer disconnected handoffs, explicit accountability. |
| 5. Pre-submission defect | Run local claim-integrity check; show one deliberate administrative defect and its source/rule. | Catch correctable issues before external submission. |
| 6. Resolve and re-check | Coder/physician fixes the actual artifact; re-run shows local readiness. Label this “passes configured local checks,” never “payer guaranteed.” | Closed-loop remediation, not a decorative badge. |
| 7. Integration seam | Inspect reviewed payload and explicitly simulated response only if the path is verified. Keep pended distinct from approved. A local simulator-only path is acceptable and should not pretend to transmit. | Integration contract and honest system boundary. |
| 8. Negative case | Missing reference rule or unavailable graph returns unknown/unavailable, never green. Optional patient-scope denial. | Reliability and limits demonstrated deliberately. |
| 9. Audit and value | Show actions from this session and audit-chain verification; show measured clicks/time/defects, followed by pilot measurement plan. | Traceability and a testable economic hypothesis. |

### Prepared data and rehearsal checklist

- Canonical synthetic patient/encounter IDs aligned across SQL, Neo4j, UI and audit.
- One clean administrative case, one correctable defect, one uncovered/missing-data case; approved expected outcomes and reference-release IDs.
- One reviewed transcript with known source spans; no clinical recommendation demo.
- Physician and coder/admin role accounts with verified scope; no dev-session bypass.
- Known initial queue/draft state and reset procedure; no dependence on pre-existing browser session storage.
- Explicit simulation status in every transaction and UI surface; no automatic fallback from live data to canned content.
- Rehearse on exact release build, display resolution and language; execute fresh-session and failure paths.
- Record a current fallback video/screenshots and timestamped evidence pack. If live processing fails, say so and switch visibly to the recording. Never simulate a success as if it happened live.

### Keep behind technical details, not concealed

Raw SQL/Cypher, prompts, ports, model tuning, FHIR JSON and deployment diagrams should be available in an appendix or optional technical deep dive. **Limitations must not be hidden:** simulation, unverified profiles, reference coverage and clinical scope belong in the main disclosure. Exclude unrelated agent tabs, alternative-medication suggestions, unvalidated dose/differential advice and unwired controls from the selected path.

### Questions to ask the specialists

- RCM: Which rejection categories justify intervention, and how much false-positive review can the team absorb?
- Coding: Which official code-set/IG releases and local policies govern this hospital, and who approves mappings?
- Clinical: Where should documentation assistance stop, and what evidence is needed for any future clinical module?
- IT/security: Can a read-only shadow integration be provisioned in the approved hosting boundary, with agreed identity and retention controls?
- Leadership: Who owns the pilot outcome, baseline dataset, decision date and acceptance threshold?

## 9. Final recommendation

**Pause feature expansion and fund a readiness increment.** The project already has enough visible functionality to tell a strong story. More agents or a larger model will not resolve the primary risks.

Proceed to the specialist meeting only after the Phase 1 gate, framing it as a **synthetic demonstration of reviewed documentation and deterministic administrative claim checks**. Use the meeting to validate workflow, evidence usability, integration requirements and pilot economics—not to claim clinical safety, regulatory compliance or payer certification.

The next investment should buy **truthful outputs, reliable data, durable workflows and measurable customer outcomes**. Those capabilities are the bridge from the current prototype to a credible pilot and then to production.
