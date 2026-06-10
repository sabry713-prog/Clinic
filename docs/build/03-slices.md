# 03 — Build Slices

The MVP is built in 6 sequential slices. Each slice has a goal, exit gate, and recommended Claude Code prompts. Do not start slice N+1 before slice N's exit gate is met.

## Slice 0 — Foundation

**Duration:** 1–2 weeks
**Goal:** an empty-but-deployable system. No clinical features. Everything below is ready.

**Deliverables:**
- Monorepo layout per `docs/architecture/02-components.md`
- `docker-compose.dev.yml` runs PostgreSQL + Keycloak + MinIO + Jaeger
- `apps/core` boots, exposes `GET /api/v1/health` returning 200
- `apps/narrative` boots, exposes gRPC `Health.Check` returning SERVING
- `apps/qa` boots, exposes gRPC `Health.Check` returning SERVING
- `apps/web` boots, displays a login screen
- OIDC login round-trip works end to end (`auth/login` → Keycloak → `auth/callback` → cookie set → `auth/me` returns user)
- PostgreSQL schemas (`app`, `hospital`, `audit`) created via migrations
- Audit middleware writes a row on every request (with hash chain)
- CI pipeline runs on every PR: lint, type check, unit tests, build, container image push
- OpenTelemetry tracing across all services, visible in Jaeger
- Structured logs (JSON) with no PHI

**Exit gate:**
- A new developer can `git clone`, follow `docs/build/02-bootstrap.md`, and reach a working local stack within 30 minutes
- The smoke test passes
- `pnpm test` and `uv run pytest` both pass with at least 1 test per service
- A test PR cycles through CI green

**Suggested Claude Code prompt:**
> "Implement Slice 0 per docs/build/03-slices.md. Use the stack from docs/build/01-stack.md and the component layout from docs/architecture/02-components.md. Follow docs/build/05-coding-standards.md. Stop after the exit gate is met."

---

## Slice 1 — Data ingestion + patient view

**Duration:** 3–4 weeks
**Goal:** a clinician can log in, see a patient list (their scope), open one patient, and view the aggregated record. Data comes from a real FHIR endpoint.

**Deliverables:**
- `packages/fhir-client` reads from a FHIR R4 server (HAPI public sandbox during dev)
- Ingestion job runs on schedule and updates `hospital.*` tables
- Identity reconciliation: deterministic matcher per `docs/data/02-fhir-mapping.md`
- Identity quarantine table populated when confidence < 95%
- RBAC + patient scope: physician role can only access patients on their care team / ward
- `GET /api/v1/patients` returns scoped list
- `GET /api/v1/patients/:id` returns full aggregated view
- `GET /api/v1/patients/:id/observations`, `medications`, `documents` endpoints
- Web: patient list page, patient detail page, no interpretation in UI
- Admin: quarantine queue UI

**Out of scope for Slice 1:** narrative, Q&A, handoff

**Exit gate:**
- AC-1 (FHIR ingestion completes for 100 patients), AC-2 (identity reconciliation), AC-3 (patient view loads ≤ 2s P95) per the product spec
- E2E test: dev user logs in, opens 5 patients in scope, attempts and is denied access to 1 patient out of scope
- No interpretation language anywhere in the UI

**Suggested Claude Code prompt:**
> "Implement Slice 1: FHIR ingestion, identity reconciliation, patient view. Follow docs/api/03-patient.md for endpoints, docs/data/02-fhir-mapping.md for mapping, docs/data/01-schema.md for tables. Use the HAPI FHIR public sandbox for dev. Add tests including the OUT_OF_SCOPE permission case. Exit gate is AC-1 + AC-2 + AC-3 from the product spec."

---

## Slice 2 — Narrative + retrieval foundation

**Duration:** 3–4 weeks
**Goal:** clinician can generate a factual narrative; the retrieval infrastructure is in place (used by both narrative and Q&A).

**Deliverables:**
- `packages/retrieval`: chunking, embedding, hybrid retrieval (vector + BM25)
- Background indexing job: rebuilds chunks after FHIR ingestion
- `apps/narrative`: full prompt assembly, model call, provenance verification, blocklist filter
- `packages/blocklist`: implementation per `docs/prompts/blocklist.md`
- `POST /api/v1/patients/:id/narrative` returns grounded narrative with provenance
- Web: narrative panel with hover-to-source UX
- Fallback path when blocklist fails

**Decisions made in this slice (close open questions):**
- Foundation model vendor and endpoint
- Embedding model and dimension
- Vector index strategy (pgvector ivfflat / hnsw / dedicated)

**Exit gate:**
- AC-4 (narrative on 30 test cases reviewed by clinical panel; zero outputs contain blocklisted language; all factual claims traceable)
- Blocklist test corpus: 100% pass on `should_block.txt`, 0 false positives on `should_allow.txt`
- Narrative P95 latency ≤ 8 s

**Suggested Claude Code prompt:**
> "Implement Slice 2: retrieval pipeline and narrative service. Follow docs/data/03-retrieval-index.md, docs/prompts/narrative-prompt.md, docs/prompts/blocklist.md. The foundation model abstraction in apps/narrative/model_client.py must support stub mode for tests and a configurable real provider. Exit gate is AC-4."

---

## Slice 3 — Factual Q&A

**Duration:** 4 weeks
**Goal:** the headline feature. Clinicians ask factual questions; the classifier refuses interpretive ones; allowed ones get grounded answers.

**Deliverables:**
- `packages/classifier`: rule layer (full set from `docs/classifier/02-rules.md`) + model layer (start with few-shot LLM classifier; plan to migrate to fine-tuned model in Slice 5)
- `apps/qa`: classify → retrieve → synthesize → filter → respond
- Refusal generator with per-category templates + fact-offering (`docs/prompts/qa-refusal-prompt.md`)
- `POST /api/v1/patients/:id/qa` returns allowed answers or refusals
- Web: conversational Q&A UI with source attribution, refusal handling, language toggle
- Q&A interaction logging to `app.qa_interaction`

**Exit gate:**
- AC-5 (classifier ≥98% sensitivity on REFUSED)
- AC-6 (Q&A factual answers ≥95% factual accuracy on 100 test queries; 100% source attribution; zero blocklist violations)
- AC-7 (refusals are conversational + helpful, panel rating ≥4/5)
- Q&A allowed latency: median ≤4 s, P95 ≤7 s
- Q&A refused latency: ≤1 s

**Suggested Claude Code prompt:**
> "Implement Slice 3: Q&A service with classifier and refusal flow. Follow docs/classifier/01-design.md, docs/classifier/02-rules.md, docs/prompts/qa-answer-prompt.md, docs/prompts/qa-refusal-prompt.md, and docs/api/05-qa.md. The classifier rule layer is the first line of defense — implement all rules from 02-rules.md with their positive and negative test examples. Exit gate is AC-5, AC-6, AC-7."

---

## Slice 4 — Handoff + governance

**Duration:** 2–3 weeks
**Goal:** complete the four MVP features and the administrative surfaces.

**Deliverables:**
- `POST /api/v1/patients/:id/handoff` and `POST /api/v1/wards/:ward_id/handoff`
- Handoff prompt and formatter (factual reproduction, no recommendations)
- Admin: audit search UI with filters per `docs/api/07-admin.md`
- Admin: user management UI
- Admin: identity quarantine resolution
- DSR endpoints (`/api/v1/dsr/access`, `/api/v1/dsr/erase`) with hospital DPO workflow
- Audit hash chain integrity verification job (scheduled hourly in dev)

**Exit gate:**
- AC-8 (handoff for 20-patient ward in ≤60s)
- AC-9 (audit captures every event type with zero gaps over 1 week)
- DSR access request fulfilled end-to-end in test

**Suggested Claude Code prompt:**
> "Implement Slice 4: handoff feature and governance surfaces. Follow docs/api/06-handoff.md and docs/api/07-admin.md. Handoff uses the same defense-in-depth as narrative (prompt + blocklist + provenance). Exit gate is AC-8, AC-9, plus a passing DSR fulfillment E2E test."

---

## Slice 5 — Hardening

**Duration:** 2–3 weeks
**Goal:** pilot-ready system.

**Deliverables:**
- Penetration test by independent third party; all high/critical findings closed
- Performance tuning: every endpoint hits its budget under load test (50 concurrent users)
- Classifier upgrade: replace few-shot LLM classifier with fine-tuned model trained on labeled corpus; retain rule layer
- PDPL DPIA finalized and signed
- NCA ECC control register completed
- Backup/restore test on a clean environment, meeting RTO/RPO
- Documentation: API docs published, runbook complete, onboarding deck for hospital IT
- Pilot deployment guide and Helm charts production-ready
- Disaster recovery tabletop exercise complete

**Exit gate:**
- AC-10 through AC-15 from the product spec
- Live deployment to a non-production hospital environment, smoke tests green
- Sign-off from CTO, Clinical Advisor, Regulatory Consultant, DPO

**Suggested Claude Code prompt:**
> "Slice 5 — hardening. Run a security review per docs/architecture/05-security.md. Address any third-party pen test findings. Optimize performance against the budgets in the product spec NFRs. Add load tests and CI gates. Document deployment per docs/architecture/03-deployment.md."

---

## Slice gating philosophy

- **No slice skips ahead.** Slice 3 cannot start before Slice 2 exit gate is met because Q&A depends on retrieval.
- **Slices can overlap on independent surfaces.** UI polish for Slice 1 features can continue while Slice 2 is in progress.
- **The exit gate is a checklist, not a vibe.** Run the tests. Get the panel review. Don't paper over a missing gate criterion.
- **If a slice falls behind, descope before delaying.** Better to ship a smaller Slice 3 (fewer refusal categories, narrower language coverage) than to push the pilot date.
