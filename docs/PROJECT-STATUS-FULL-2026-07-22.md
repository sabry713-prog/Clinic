# Clinical Copilot ("Cortex.ai") — Complete Project Status

**Snapshot date:** 2026-07-22
**Prepared for:** CTO/Founder — full lifecycle status, day one → present
**Repository:** `sabry713-prog/Clinic` · branch `main` · HEAD `a01e8db`
**History:** 114 commits · 2026-06-10 → 2026-07-10 · ~29,000 lines of app code + 6 shared packages
**Regulatory class:** non-SaMD Health IT (SFDA MDS-G027)

> This is the complete project status. Section 12 covers the recent office-PC additions (previously reported separately); everything before it describes the system built from the initial spec bundle onward.

---

## 1. Executive summary

The product is a hospital-deployed clinical **copilot** for the Saudi market that helps authenticated clinicians work with a patient's existing record — **without ever interpreting clinical data**, which is what keeps it Health IT and not a regulated medical device (SaMD).

**Status: MVP running end-to-end locally; Phase E0 (verification & gate-closure) essentially complete; several post-MVP capabilities added.** All four originally-specified capabilities work against a live local stack (Postgres + Keycloak + MinIO + Jaeger, dev seed of 50 patients). Auth/RBAC, audit hash-chain, classifier, and blocklist are all green on their test suites.

The four core capabilities (CLAUDE.md §1) are all built:
1. **Aggregated patient view** — read-only chronological record.
2. **Factual narrative summary** — grounded prose, no interpretation.
3. **Factual Q&A** — classifier refuses interpretive questions; allowed ones answered from the record.
4. **Shift-change handoff** — factual reproduction of recent events.

Beyond those, the team has added (and must have ratified for scope): NPHIES insurance coding/claims, ambient dictation capture, a medical interpreter (translation) mode, specialty draft templates, and a patient-facing recap. These are engineered to stay behind the SaMD line (deterministic / doctor-confirms-everything / restyle-only) but are **new product surfaces beyond the original four** and are the main things to ratify (Section 13).

---

## 2. What the product is — and is not

**Is:** aggregated view, factual narrative, factual Q&A, shift handoff — "and only these four" per the operating contract.

**Is NOT (forbidden, enforced in code + prompts + blocklist):** diagnosis / differential, treatment or dose recommendations, drug-interaction checking, severity flagging or prioritization, alerts/warnings on clinical content, risk scoring or prediction, interpretation of labs/imaging/vitals, triage, trend characterization ("worsening/improving"), cross-patient/cohort analysis.

**The boundary rule for generated text:** never emit interpretive verbs. Allowed: *"Creatinine: 138 (Mar), 141 (Apr), 168 (24 May)."* Forbidden: *"Creatinine has risen, suggesting worsening renal function."* The **blocklist filter is the mandatory final gate** before any generated text is displayed.

---

## 3. Architecture & technology

**Topology (all in-Kingdom):**

```
Clinician browser → API gateway (OIDC, rate limit, logging)
   → Core service (NestJS/TS)  — patient view, auth/RBAC, audit, handoff, orchestration
   → Narrative service (Python/FastAPI) — prompt assembly, model call, blocklist, provenance
   → Q&A service (Python/FastAPI) — classify → retrieve → synthesize → blocklist
   → Transcription service (Python/FastAPI) — dictation/ambient capture
Data layer: PostgreSQL (relational + FHIR JSONB + pgvector) · S3-compatible object store · append-only hash-chained audit + WORM replica
Integration: FHIR R4 client (outbound) · HL7 v2 (fallback) · identity reconciliation w/ quarantine
```

**Stack:** pnpm workspaces + Turborepo monorepo; NestJS/TypeScript core (`:4000`, prefix `/api/v1`); Python 3.12 + FastAPI (uv) for narrative (`:5001`), qa (`:5002`), transcription (`:5003`); React + TypeScript + Vite web (`:3000`); Keycloak OIDC; OpenTelemetry → Jaeger; structured JSON logs (no PHI).

**Model-provider abstraction:** every AI call goes through a provider interface with `stub | local` modes — the `local` mode targets an OpenAI-compatible **on-prem** endpoint so PHI never leaves the premises (§7). See Section 11.

**Code footprint:** core ≈ 14.6k LOC, web ≈ 9.3k, qa ≈ 2.4k, narrative ≈ 2.2k, transcription ≈ 0.8k, plus 6 shared packages.

---

## 4. Development timeline (build slices)

The MVP was planned as 6 sequential slices (`docs/build/03-slices.md`); here is what actually landed.

| Slice | Goal | Status |
|---|---|---|
| **0 — Foundation** | Deployable empty stack: monorepo, docker-compose infra, health endpoints, OIDC round-trip, DB schemas, audit middleware w/ hash chain, OTel tracing, CI | ✅ Done |
| **1 — Ingestion + patient view** | FHIR R4 client, scheduled ingestion, identity reconciliation + quarantine, RBAC + patient scope, patient list/detail, observations/medications/documents endpoints | ✅ Done |
| **2 — Narrative + retrieval** | `packages/retrieval` (chunk/embed/hybrid vector+BM25), narrative service w/ prompt assembly + provenance, `packages/blocklist`, narrative panel with hover-to-source | ✅ Done |
| **3 — Factual Q&A** | `packages/classifier` (rule + model layers), qa pipeline classify→retrieve→synthesize→filter, per-category refusals, conversational UI w/ source attribution, EN/AR/code-switch | ✅ Done |
| **4 — Handoff + governance** | Patient & ward handoff, admin audit search, user management, identity-quarantine resolution, DSR access/erase endpoints, hourly hash-chain verify | ✅ Done |
| **5 — Hardening** | Pen test, load/perf tuning, fine-tuned classifier, PDPL DPIA, NCA ECC register, DR tabletop, Helm/production deploy, full sign-offs | ⏳ **Not started** (see Section 13) |

**Post-slice "E-phase" enhancement work** then added medication reconciliation, procedures, service-request extraction, drafts, and the Section 12 features.

---

## 5. Core capabilities — feature-by-feature

### 5.1 Aggregated patient view ✅
Read-only chronological record: identity/allergies/conditions header, labs panel, medications panel, medication **reconciliation** (factual source-feed comparison across EHR/pharmacy), procedures, record search, and a factual **Patient Brief** strip (active condition names, active med names, most recent lab verbatim with reference range — no severity, no flags). Backed by `hospital.*` tables populated from FHIR.

### 5.2 Factual narrative ✅
`POST /patients/:id/narrative`. Retrieval-grounded prose; every claim traceable to source (hover-to-source UX); **blocklist scan + retry-then-fallback** before display. Recent: markdown rendering, and a patient-facing plain-language recap (restyle-only, §12).

### 5.3 Factual Q&A ✅ (headline feature)
`POST /patients/:id/qa`. Pipeline: **classify → (refuse | retrieve → synthesize → blocklist)**. Interpretive questions are refused deterministically with per-category templates that still offer the underlying facts. Works in EN, AR, and code-switched queries (extensive Arabic clinical-term aliasing). Refusal path is deterministic and fast (~16–20 ms, no model call).

### 5.4 Shift-change handoff ✅
`POST /patients/:id/handoff` and `/wards/:ward_id/handoff`. Factual reproduction grouped into sections (identity/admission, documented today, current meds, recent vitals/labs, pending orders). Same defense-in-depth as narrative. No recommendations.

### 5.5 Documentation-support extensions ✅
- **Service-request extraction:** extracts documented orders from the clinician's own notes and presents them as an action queue — **doctor confirms each**, never auto-executes.
- **Add diagnosis:** physician documents a condition to the problem list (`condition:write`).
- **Drafts:** document-drafting (discharge summary etc.) with specialty templates; Assessment/Plan start blank (doctor authors).

---

## 6. Backend modules (`apps/core/src`)

`admin` · `ambient` · `audit` · `auth` · `common` · `condition` · `database` · `draft` · `dsr` · `feature-flags` · `handoff` · `health` · `ingestion` · `interpreter` · `metrics` · `narrative-proxy` · `nphies` · `patient` · `qa-proxy` · `rbac` · `seed` · `service-request`

**Shared packages:** `audit` (hash-chain), `blocklist` (interpretive-language gate), `classifier` (rule + model layers), `fhir-client` (FHIR R4), `retrieval` (chunk/embed/hybrid), `shared-types` (branded IDs, RBAC map, envelopes).

---

## 7. Data layer & schema

Three PostgreSQL schemas with **15 migrations** (`1718000000000_initial-schema` → `1719300000000_draft-specialty`):

- **`hospital.*`** (ingested clinical facts): `patient`, `encounter`, `condition`, `observation`, `medication_request`, `allergy_intolerance`, `document_reference`, `procedure`, `retrieval_chunk`.
- **`app.*`** (product state): `tenant`, `user_role`, `patient_scope`, `qa_conversation`, `qa_interaction`, `narrative_output`, `handoff_output`, `document_draft`, `identity_quarantine`, `ingestion_run`, `indexing_run`, `dsr_request`, `service_request` (+ `_diagnosis_link`), plus NPHIES tables: `condition_icd_coding`, `service_request_sbs_coding`, `snomed_icd`, `order_sbs_map`, `diagnosis_procedure_compat`, `nphies_claim`, `nphies_eligibility_check`.
- **`audit.event`** — append-only, hash-chained, with a DB-level `prevent_modification` guard.

Dev data is generated by a **deterministic mulberry32-seeded** `seed:all` (identical across machines): 50 patients, 5 in-scope encounters, symptom histories, reconciliation, 791 retrieval chunks, 60 historical NPHIES claims, and dev physician + admin users.

---

## 8. Safety & compliance architecture

- **Query classifier** (`packages/classifier`): rule layer (deterministic patterns per `docs/classifier/02-rules.md`) + model layer fallback. Refuses interpretive questions before any retrieval. Rules-only sensitivity **1.00** on holdout EN/AR and stress corpora.
- **Blocklist** (`packages/blocklist`): mandatory final gate on all generated text; **107/107** corpus+unit tests, 100% block, 0 false positives.
- **Audit**: every clinical-data access logged append-only with `hash_prev`/`hash_self` chaining; tamper-break detection; daily WORM export for off-system integrity checks.
- **AuthN/AuthZ**: Keycloak OIDC; RBAC with role→permission map (physician / pharmacist / nurse / hospital_admin / sysadmin); **patient scope** enforced (out-of-scope access returns 403 `PATIENT_OUT_OF_SCOPE`, verified live).
- **PHI discipline**: no PHI in logs (IDs/codes only); no PHI to external models; no PHI in URLs; encrypted at rest; in-Kingdom processing.
- **DSR**: access + erase endpoints for the hospital DPO workflow.
- **Ops**: 9 incident runbooks (audit-chain violation, break-glass spike, classifier-confidence drop, external-model-unreachable, FHIR-ingestion stalled, high-error-rate, identity-quarantine building, qa-blocklist surge, service-down).

---

## 9. Frontend (`apps/web`)

React/TS SPA. **App shell** with icon sidebar + Ctrl+K command palette (RTL-aware), rebranded **"Cortex.ai"**. Patient page restructured into a **Sully-style unified Copilot workspace** (one composer + accumulating card feed) with a separate read-only **Patient File** chart view.

**Components:** PatientHeader, PatientBrief, LabPanel, MedicationPanel, ReconciliationPanel, RecordSearch, NarrativePanel, QAConversation, HandoffView, AddDiagnosis, DraftPanel, ServiceRequestPanel, ClaimReadinessPanel (+ CodingQueue, ClaimActions, RejectionRiskPanel), NphiesRejectionAnalytics, AmbientPanel, InterpreterPanel, SinceLastVisitPanel, ComplianceReport. Full **Arabic (RTL) / English (LTR)** i18n.

**Admin surfaces:** audit search/AuditPage, compliance report, NPHIES rejection-analytics dashboard.

---

## 10. Testing & Phase E0 evidence

`docs/evidence-pack-e0.md` (regenerated live 2026-07-09):

| Suite | Result |
|---|---|
| `packages/classifier` unit | 73/73 pass |
| `packages/blocklist` unit + corpus | 107/107 pass (100% block, 0 FP) |
| `apps/core` (Nest/Jest) | 72/72 pass |
| `apps/qa` (pytest) | 48/48 pass |
| `apps/narrative` (pytest) | 33/33 pass |
| `apps/web` (Vitest) | 43/43 pass |
| Classifier EN holdout sens/spec | 1.00 / 1.00 (100 items) |
| Classifier AR holdout sens/spec | 1.00 / 1.00 (101 items) |
| Classifier stress corpus | 1.00 sensitivity (gap found→closed, §13) |
| Refused-path latency | 16 ms (budget 1 s) |
| Audit hash-chain | 5/5 (verify + tamper detection) |
| Out-of-scope access | 403 verified live |

**E0 honest gaps still open:** combined rules+**model** sensitivity ≥0.98 not yet measurable (no live model key was configured — now being addressed by the on-prem LLM work, §11); IUS Addendum 1 regulatory sign-off still open.

---

## 11. On-prem LLM integration (in progress, this laptop)

Wiring Q&A / narrative / dictation-reformat to a **local LM Studio** server (Gemma 3 12B, OpenAI-compatible, `127.0.0.1:1234`) so a real on-prem model replaces the stub — PHI stays in-Kingdom (§7).

- ✅ Env wired (`QA_MODEL_PROVIDER=local`, `NARRATIVE_MODEL_PROVIDER=local`, `TRANSCRIPTION_REFORMAT=llm`), endpoint/model/timeout set.
- ✅ Refusal path verified deterministic through the local path (~20 ms, no LLM call) — boundary holds.
- ✅ Fixed a context-overflow (400): slimmed the Q&A prompt (`_project_chunk`, compact JSON) — cut ~4,383 → ~2,538 tokens; chunk cap by question relevance.
- ✅ Reduced latency (retries=1, max_tokens=256).
- ⏳ **Blocked:** LM Studio must be reloaded with a larger context and be reachable; final Gemma Q&A verification pending. (Gemma 12B ≈ 41 s/call on this Mac; a smaller model would be faster.)
- These edits are local and uncommitted; they don't conflict with the merged branch.

---

## 12. Post-MVP additions (office PC, merged 2026-07)

Merged clean (fast-forward `a98d6cd → a01e8db`, 112 files). New product surfaces:

- **NPHIES insurance coding & claims (6 commits, `apps/core/src/nphies/`):** claim-readiness checks (deterministic admin checks), ICD-10-AM + SBS coding **suggest→confirm** (reference-table lookups; only clinician confirmation persists), clinician-captured order→diagnosis linkage (no system suggestions), stub-mode connector (assembly/eligibility/submission from confirmed artifacts only), rejection-analytics dashboard (counts only), rejection-risk validator (pairing set-membership + retrospective frequency).
- **Ambient / dictation capture:** structured-transcription segmentation for encounter recording.
- **Medical Interpreter mode:** clinician↔patient language translation (terms preserved verbatim).
- **Draft specialty templates.**
- **Patient-facing plain-language recap:** restyle of an already-blocklist-passed narrative.
- **UI:** Sully-style workspace, Cortex.ai rebrand, sidebar + command palette, "Since Last Visit" panel (added then removed), markdown rendering.
- **Infra/quality:** deterministic seed, repaired jest suite (incl. an identity-reconciler quarantine fix), regenerated E0 evidence pack, classifier LAB_INTERPRETATION gap closed.

---

## 13. What is NOT done / open items

**Slice 5 (Hardening) — not started:** independent penetration test; load/performance tuning to NFR budgets (50 concurrent users); **fine-tuned classifier** to replace the few-shot model layer; PDPL **DPIA**; NCA **ECC** control register; backup/restore + DR tabletop; production Helm charts + deployment guide; full sign-off from CTO, Clinical Advisor, Regulatory Consultant, DPO.

**Verification gaps:** combined rules+model classifier sensitivity not yet measured live (pending the on-prem model, §11); on-prem Gemma Q&A not yet verified end-to-end.

**Governance / audit items for the CTO (from the merge):**
1. **Confirm or repudiate claimed sign-offs** recorded in commits — ICD coding "CTO-signed 2026-07-08" and the classifier rule change "CTO + Clinical Advisor sign-off." You are the §6 human gate; only you can validate these.
2. **Rule on NPHIES** (and interpreter, ambient, recap, specialty templates) as product scope vs. the "only these four" clause.
3. **Review the 4 new/changed prompts** (§6-gated): interpreter, patient-recap, specialty-templates, ambient-segmentation — several marked "pending sign-off."
4. **Review the identity-reconciler quarantine change** (§6 item 6).
5. **Verify boundary claims in code**, not just commit messages, for interpreter (translation-only) and ambient (transcribe/segment-only).

---

## 14. Current runtime state (this laptop, 2026-07-22)

- Infra up: `cc-postgres`, `cc-keycloak`, `cc-minio`, `cc-jaeger`, `cc-mailpit`.
- All 15 migrations applied; `seed:all` loaded (50 patients, admin1, 60 NPHIES claims).
- Services healthy: core `:4000`, narrative `:5001`, qa `:5002`, transcription `:5003`, web `:3000`. New NPHIES/interpreter/ambient routes mapped and smoke-tested.
- LM Studio `:1234` unreachable — awaiting model reload for the final on-prem Q&A verification.

---

*Full-lifecycle status compiled from the repository, git history (114 commits), the design docs, and the live running stack.*
