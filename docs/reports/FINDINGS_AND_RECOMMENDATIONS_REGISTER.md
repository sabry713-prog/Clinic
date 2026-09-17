# Veritas-Medica — Findings, Corrections & Recommendations Register

**Date:** 11 September 2026
**Purpose:** one consolidated answer to "what must be corrected, what should be enhanced, and where is it written down". This register does not add new analysis — it indexes and condenses the two bodies of work already produced, with exact source locations.

**Baseline:** `feat/ui-light-theme`, commit `d0fbf96f94f586785d169c25d4a831df5c03339a`

**Source documents:**

| Document | What it contains | Where |
|---|---|---|
| Independent Solution Readiness Assessment | 35 technical findings (C01–C10, H01–H07, M01–M12, L01–L06), target architecture, roadmap, testing plan, demo script | `docs/assessment/PRE_DEMO_READINESS_ASSESSMENT.md` §4 lines 90–155; §5 lines 156–195; §6 lines 196–240; §7 lines 241–288; §8 lines 289–329; §9 final recommendation line 330 |
| Saudi Market Opportunity Report (consolidated) | Verified market evidence, market→engineering implications, pilot design, KPIs, risks, decision | `docs/market-research/SAUDI_MARKET_OPPORTUNITY_REPORT.md` §10 lines 155–168; §11 lines 169–182; §12 lines 183–192; §13 lines 193–205; §14 lines 206–218 |
| Global West Innovation Research | 11 vendor profiles, controlled-evidence caveats, **8-row incorporation priority matrix (P0–P3)** | `docs/market-research/global-west-research.md` §6 lines 225–240 |
| Saudi Competitor Landscape | Verified competitor set, comparison matrix, **6 positioning/acceptance tests** | `docs/market-research/saudi-competitors-research.md` §4b lines 103–124; §7 lines 171–181 |
| Global East & Regional Ecosystem | Hosting/model evidence, **differentiation hypotheses** | `docs/market-research/global-east-ecosystem-research.md` §6 lines 154–164; §7 lines 165–175 |
| Saudi Regulatory & Market Research | Verified regulatory scope, buyer segments, compliance obligations | `docs/market-research/saudi-regulatory-research.md` §4 (regulatory), §5 (buyers) |
| Verification changelogs ×4 | What source-checking corrected in each report, and what remains unverified | `docs/market-research/verification/{regulatory,competitors,west,east}/CHANGELOG.md` |

---

# Part A — Findings that need to be corrected (technical)

Effort figures are rough person-days of engineering, as stated in the assessment. They overlap and must not be summed as a budget.

## A1. Critical — fix, contain, or remove from scope before any demonstration

| ID | What is wrong | Required correction |
|---|---|---|
| C01 | Deck claims "cannot invent facts", every statement checked, "cannot drift" — code does not enforce this | Restate as "deterministic rule findings are inspectable; generated drafts require validation and clinician review"; remove zero-liability/blanket-compliance assertions; re-source or drop benchmark numbers |
| C02 | Patient-scoped UI keeps synthetic messages and mock orders alongside real results | Make synthetic and live datasets mutually exclusive; no clinical mock fallback once a patient is selected; test empty/failed/switch/refresh |
| C03 | Q&A links sources by one overlapping long word (falls back to first chunks); narrative keeps unsupported sentences | Demo: deterministic fact rendering or validated copied facts only. Pre-pilot: typed atomic facts, reject unsupported claims — a citation must support the claim, not share vocabulary |
| C04 | Consultant/Pharmacist code permits diagnosis- and dose-related prose with no verification gate | Disable these paths and alternative-medication suggestions; keep only deterministic administrative checks |
| C05 | NSCRE computes `overall_defer`/evidence gaps but handlers drop them; reference rules are illustrative | Propagate completeness/coverage with every verdict; unknown/not-covered/unavailable must never render green; demonstrate a missing-data case |
| C06 | SOAP/reformat output accepted as raw model strings; stub ASR returns fixed text regardless of audio | Separate scripted playback from live capture at API and UI; reject stub on live capture; use verbatim/deterministic formatting if fidelity can't be proven |
| C07 | Internal patient APIs bind all interfaces with no caller auth; dev-session API mints privileged roles; Compose exposes fixed-credential services | Bind internal ports to loopback, isolate the demo network, disable the dev-session route, use normal OIDC; verify from a second host |
| C08 | NPHIES profiles explicitly unverified; runtime reports stub; live claim path unimplemented | Label every simulated response; keep real submission disabled; distinguish local readiness from payer outcome; drop live-sandbox claims |
| C09 | Graph refresh is manual; demo seed recipes don't fully establish patient projection/safety data | Freeze one manifest (seed, patient/encounter IDs, reference release, DB/graph counts, expected findings); rehearse a clean reset |
| C10 | Journey Stage Document SOAP may not persist to later stages; E2E can silently skip | Fix effective reviewed-state persistence; add non-skippable E2E for the full journey; run twice from clean state including failures |

## A2. High — strongly recommended before demonstration

| ID | What is wrong | Required correction |
|---|---|---|
| H01 | Services launched manually; Docker contexts miss shared Python deps; Core image omits FHIR inputs; Helm lacks newer services | Ship a complete pinned demo launcher/Compose catalog and startup smoke checks; repair images before claiming container portability |
| H02 | `/health` is process-only; DB startup failure tolerated | Separate liveness/readiness/status; expose model/connector mode and dependency freshness; preflight must exercise a real read-only workflow |
| H03 | Bare outbound fetches lack deadlines; UI errors collapse into empty arrays | Shared bounded HTTP client with cancellation and typed retryable errors; explicit unavailable/stale states; never blind-retry side-effecting calls |
| H04 | CI covers only QA/Narrative Python; E2E/load/eval not gates; lint fails; React duplicate-key warnings | Add all workspace suites, real startup/E2E, classifier eval; fix duplicate keys/CSS; triage lint rules vs defects and prevent new violations |
| H05 | Cramped fixed panes, incomplete encounter i18n, missing keyboard/focus semantics | One primary journey; focus/resizable panes; readable type; role-tailored actions; localized strings; accessible verdict text; modal focus handling; fix the pre-auth "current encounter" copy |
| H06 | Runbooks/decks disagree with behavior; branding differs; SAR exposure uses a fixed average | One versioned demo truth table (live/scripted/simulated/unavailable); standardize branding; label illustrative exposure |
| H07 | Backup and env-backup artifacts inside the workspace outside portable ignore rules | Move backups out of the repo, encrypted and access-controlled; add portable deny patterns; contents were not inspected — do not assert exposure |

## A3. Medium — close before any real-data pilot

| ID | What is wrong | Required correction |
|---|---|---|
| M01 | Sessions, OIDC state, rate limits are in-process maps; ingestion runs per replica | Demo stays single-instance; before replicas: shared TTL session/state store, atomic callback consumption, shared rate limits, singleton scheduling |
| M02 | Role/disable changes don't revoke sessions; unknown DB-user login can proceed | Authoritative enabled-user/tenant/role mapping; fail closed; revocation checks; authorization matrix tests (**pre-PHI gate**) |
| M03 | Known dev master key fallback not production-gated; customer key provider is a stub | Reject missing/known keys outside isolated tests; implement KMS/HSM wrapping, rotation, recovery (**pre-PHI gate**; dev-key gate closed and tested 17 Sep — the KMS/HSM choice itself is deferred by the owner until the hosting target is chosen, and must be resolved before real patient data) |
| M04 | Tenant boundaries absent from clinical/graph keys; RLS variables never populated; owner roles bypass policies | Single-tenant first; non-owner least-privilege roles, transaction-local scope, tested RLS; tenant-qualified keys before shared tenancy |
| M05 | FHIR related-resource queries swallow failures and read one page; encounter/attending links dropped; identity merge only logs | Checkpoints, full pagination, partial-failure status, reference resolution, complete versioned mappings, real identity adjudication |
| M06 | Graph/index refresh lacks deletion, atomic publication, source-version lineage | Outbox, idempotent projections, source hashes/watermarks, per-patient reconcile, dead-letter queue, lag monitoring |
| M07 | DSR service expects columns absent from migrations and only records requests; ambient consent not server-enforced | Forward migration + clean-DB test; retention/legal-hold lifecycle across stores; consent receipt and withdrawal (**pre-PHI gate**) |
| M08 | Audit writes fail open after response; WORM export can log success without upload; backup script assigns stdin to both dump and passphrase | Transactional critical-event outbox; export manifests with read-back verification; separate passphrase FD; isolated restore drills; scrub raw search metadata |
| M09 | Coder queue, NPHIES tasks/SSE and agent history are process-local | Persist workflow state, idempotency keys, attempt history, terminal states; outbox/inbox, worker leases; SSE notifies only |
| M10 | Q&A bypasses packaged hybrid retrieval; source IDs identify the patient not the row; embeddings stubbed; keyword rank unordered | Establish typed SQL/graph fact contracts with immutable record IDs; keep lexical retrieval until evaluated; fix deterministic ranking; amend the Neo4j-only rule explicitly if changed |
| M11 | Unlicensed illustrative reference subsets; unverified payer profiles; ATC slicing mismatches intended subgroup | Governed licensed releases with effective dates, checksums, approvers, coverage; explicit hierarchy identifiers; official IG conformance — do not guess AM/CM |
| M12 | Small internally tuned classifier sets; stub generation tests; recap/translation fidelity unverified; conversation history unused | Independent versioned datasets, adversarial notes, bilingual adjudication, numeric/negation checks, deployed-provider regression; label Q&A stateless until bounded memory exists |

## A4. Long-term — production and scaling program

| ID | What is wrong | Required correction |
|---|---|---|
| L01 | Helm injects wrong/missing OIDC/model/DB settings; Terraform doesn't provision the described stack; web security context conflicts with nginx paths | One hosting target, typed config contracts, complete images/manifests, migration jobs, unprivileged nginx with writable temp mounts, real deploy/rollback tests |
| L02 | Internal services trust network reachability; no service auth or packaged network policies | Workload identity and authenticated service context; default-deny ingress/egress; private databases |
| L03 | Telemetry/alerts not provisioned; Python scrape annotations target absent metrics | OTel collector, trace propagation, PHI-safe log schemas, actionable alerts, synthetic checks, tested runbooks; track model/prompt/rule versions |
| L04 | CPU-only scaling, uncoordinated DB pools, no measured model capacity | Load-test p95/p99, pool waits, inference concurrency, queue depth; global connection/token budgets, backpressure, quotas |
| L05 | Incomplete CI/security coverage; mutable action/image refs; no signed release chain | SHA-pin actions, digest-pin images, full dependency/IaC scans, SBOM/signing, admission policy, DAST, canary + rollback |
| L06 | No demonstrated HA/PITR/DR, hospital change control or governance approvals | Site-specific RPO/RTO, verified SQL/graph recovery, failover drills, DPIA/legal determination, clinical hazard file, hospital acceptance |

---

# Part B — Enhancements to build (market-informed)

## B1. Product capabilities, priority-gated — `global-west-research.md` §6 (lines 225–240)

| Priority | Capability | Acceptance gate |
|---|---|---|
| **P0** | Reviewed evidence and rule provenance | Every clinical statement/code has a reviewed source and applicable rule version; test contradiction, negation, missing evidence, wrong-patient attribution; unsupported content cannot pass |
| **P0** | Independent evaluation harness | Prespecified outcomes; blinded clinician/coder adjudication where feasible; report uncertainty, nonuse, external editing time, false passes and false blocks by specialty/language |
| **P0** | Deterministic simulation and remediation | Code decisions stay in Neo4j; insufficient/conflicting evidence routes to reviewers; no model-confidence-only auto-pass, code creation or live submission |
| **P1** | Deployment governance and reviewed SOAP formatting | Named owners for rules, clinical review, security, incidents; output-fidelity regression tests; traceable reviewer approval and rollback |
| **P1** | Local coding/claims measurement | Verify local mappings and contracts; assess correct coding, actual adjudication, review effort and cost; **do not target higher code levels** |
| **P2** | Optional ambient input pilot | Validate Arabic/bilingual transcription, consent and privacy separately; extracted content stays untrusted until reviewed and cannot change graph facts/codes |
| **P2** | Reviewed appeal formatting | Format approved facts/codes and approved citations only; no invented rationale or autonomous submission |
| **P3** | Prior-authorization transaction assistance | Verify NPHIES interfaces, authorization, idempotency, auditability; require explicit approval for consequential submissions |

## B2. Differentiation hypotheses to test — `global-east-ecosystem-research.md` §7 (lines 165–175)

| Hypothesis | Test |
|---|---|
| Arabic/English evidence formatting plus deterministic integrity flags may reduce reviewer work | Measure on a defined pilot against a stated baseline |
| Bilingual factual fidelity and editing burden are unproven locally | Measure fidelity and editing burden in the pilot |
| Explicit graph provenance and validated terminology mappings may improve traceability | Compare provenance quality against competitors on identical encounters |
| Constrained documentation outputs should be evaluated before any expansion | Evaluate constrained outputs first |

These are hypotheses. No claim is made that the categories are absent in Saudi Arabia or that this project would be first.

## B3. Competitive acceptance tests — `saudi-competitors-research.md` §7 (lines 171–181)

1. Benchmark against integrated competitors first — include Glance, Santechture, Nano Health and Solventum, not only clearinghouses and standalone scribes.
2. Demonstrate provenance rather than claim uniqueness — same consented/de-identified encounters, comparing source-note links, coding edits, necessity rationale, policy versions, reviewer actions and exportable audit records.
3. Separate modules and geographies — confirm Saudi availability, named deployments, NPHIES integration status, code-set licences and contracted functionality per product.
4. Measure incremental benefit — predefined documentation/coding errors, false-positive alerts, coder time, rejection outcomes and total implementation cost.
5. Validate prices contractually — period, inclusions, transaction definitions, user/site limits, setup costs; no assumed monthly prices.
6. Treat ambient partnerships as an option — test integrate-vs-build rather than assuming.

## B4. Compliance and localization workstreams — `saudi-regulatory-research.md` §4–§5

| Workstream | Requirement basis |
|---|---|
| Per-component residency and transfer analysis (storage, backup, logs, support access, subprocessors, external model calls) | PDPL conditional transfer regime; sectoral health requirements layer on top |
| Impact assessment for sensitive-data processing | Implementing Regulation — mandatory trigger, not a substitute for lawful processing |
| NCA ECC mapping incl. cloud subdomain 4-2; CCC allocation if acting as or using an in-scope CSP/tenant | Controls bind in-scope entities; duties are shared, not transferred to a host |
| SFDA intended-purpose and module-separation documentation | Classification turns on actual function; a billing label does not decide it |
| NPHIES vendor-certification path and official IG / code-set conformance | Required before any integration claim |
| Bilingual (Arabic/English) UI, documentation and terminology layer | Buyer requirement and clinical-workflow reality |
| DRG-readiness positioning: shadow billing, external audits (1 Jan 2027), CDI | CHI DRG guideline obligations on providers |

---

# Part C — Corrections already applied during verification

These are no longer open; they record what changed so no one re-asserts the earlier version.

| Original claim | Status now |
|---|---|
| "No competitor connects documentation, submission and adjudication"; "underserved"; "12–24 month window" | **Withdrawn** — Glance, Santechture, Solventum and Nano Health advertise overlapping capability; no timing window is estimated |
| 46% of PAs rejected for clinical justification | Corrected to **46.14% of rejected PA items**, not all PAs, claims or preventable denials |
| HIT carve-out ⇒ not a medical device | **Withdrawn** — SFDA classification undetermined; MDS-G027 lists "a voice scribe … and generates diagnostic suggestions" as regulated |
| CHI as dominant payer / single-payer NPHIES | Corrected — CHI is the **regulator**; insurers are payers; NPHIES does not adjudicate |
| Waseel 1,499/1,999 SAR **per month** | Period is **not stated** on the page; monthly inference and USD conversion are unsupported |
| AWS/Azure Saudi regions available | **Announcements** at the cutoff, not operational |
| "Zero clinical validation" for Arabic LLMs | Narrowed to the specific checkpoints, paper version and tasks examined |
| Coding AI is "no new AI risk"; autonomous coding by confidence; universal human sign-off | **Withdrawn** — confidences do not authorize coding; project boundary restated (Neo4j facts/codes, LLM formatting, human review) |
| Sahl AI "119 encounters" | 64 simulated feasibility assessments + 55 real consultations — stages must not be merged |
| Oracle "shipped nothing relevant to claims" | Retracted — only a subset of functions is labelled planned |

Full detail and residual gaps: the four changelogs under `docs/market-research/verification/`.

---

# Part D — Sequencing

| Phase | Focus | Duration basis |
|---|---|---|
| **Phase 1 — Demo readiness** | All Part A1 items; the credibility-affecting Part A2 items; freeze dataset and rehearsal | ~2–3 focused weeks |
| **Phase 2 — Pilot readiness** | Part A3 items (pre-PHI gates in particular), Part B1 P0/P1 gates, Part B4 compliance workstreams, shadow evaluation with pre-registered endpoints | ~6–12 engineering weeks plus external dependencies |
| **Phase 3 — Production readiness** | Part A4 items, official integration, HA/DR, operations, release governance, site acceptance | Multi-month gated program |

**Decision status unchanged:** conditional GO for a narrowed synthetic demonstration; NO-GO for real-patient or live-payer operation. The market case remains a set of testable hypotheses — the differentiated claim must be demonstrated head-to-head, not asserted.
