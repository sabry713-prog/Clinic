# Unified Demo-to-Pilot Plan

**Synthesizes:** `docs/assessment/PRE_DEMO_READINESS_ASSESSMENT.md` (engineering gaps) and `docs/market-research/global-west-research.md` (evidence discipline + market positioning)
**Date:** 15 September 2026 · **Baseline:** `feat/ui-light-theme` @ `d0fbf96`
**Status:** Proposed for product-owner approval

## Why one plan

The two documents arrive at the same architecture, the same wedge, and the
same honesty discipline from independent directions — the readiness
assessment from code-level gaps, the market research from competitive
evidence review. Where they overlap is the strategy. Where they differ
(engineering detail vs. positioning) they complement rather than conflict.

### The five convergences (both documents, independently)

1. **Evidence honesty IS the product.** The readiness assessment's C01
   (deck overclaims) and the market research's entire §2 (every competitor's
   numbers are endpoint-specific or vendor-hosted) point at the same
   opportunity: be the one vendor whose claims match its controls. The
   zero-fabrication architecture is the moat — but only if the claims
   match the code.
2. **Deterministic core, LLM formatting only.** Readiness demands it
   operationally (C04, C05); market research endorses it strategically
   (CodaMetrix profile: "model confidence is not evidence"; P0 table).
   Neither document permits autonomy without adjudicated validation.
3. **Pre-submission claim integrity is the wedge.** Readiness names it the
   primary proposition; market research validates the category
   (CodaMetrix/SmarterDx/AKASA) while showing nobody serves NPHIES and
   nobody proves causal ROI — the opening is rigorous local measurement.
4. **Traceability is not entailment.** Readiness C03 (heuristic source
   linking) and market research §3.2 (Abridge's Linked Evidence is a
   design reference, not a proof) — citations must support the claim.
5. **No Saudi transfer without local validation.** Readiness M11
   (reference-data governance) and market research §5 (CHI is not a payer;
   NPHIES is an exchange; no Arabic RCT evidence exists) agree: local
   adjudicated measurement or silence.

### What each document adds that the other lacks

| Readiness assessment | Market research |
|---|---|
| Concrete engineering gap register (C/H/M/L) with effort estimates | Evidence-grade framework for every external claim we make |
| Demo script and rehearsal checklist (§8) | Competitive design patterns worth adopting (Abridge provenance, Ambience onboarding governance, CodaMetrix audit trails) |
| KPI/measurement design (§7) | The warning that everyone else's KPIs are untrustworthy — ours must be adjudicated, not self-reported |
| Phased roadmap skeleton | Priorities P0–P3 that map onto those phases |

## The plan

### Phase 1 — Demo Readiness (~2–3 focused weeks)

**Objective:** a repeatable, honest, synthetic-data specialist demonstration.

**Engineering (from readiness, in priority order):**

| Order | Item | Why first |
|---|---|---|
| 1 | C02 — eliminate mixed mock/live state in SullyContext | Wrong-patient content is the demo-killer |
| 2 | C07 — bind internal ports to loopback; disable dev-session in demo builds | Cheapest critical; security embarrassment avoided |
| 3 | C01 — rewrite deck claims to match implemented controls | The trust pitch is the product |
| 4 | C08 — label every simulated response; pended ≠ approved everywhere | Already partially done (demo chip); finish it |
| 5 | C10 — journey persistence: reviewed SOAP reaches the record | The headline journey must survive a fresh session |
| 6 | C05 — propagate unknown/defer/coverage with every NSCRE verdict | Unknown must never render as green |
| 7 | C03 (containment) — restrict demo Q&A to the validated question set | Full typed-fact rebuild is Phase 2 |
| 8 | C04 (containment) — disable clinical prose paths in the demo build | Differential/dose prose stays out of scope |
| 9 | C06 (containment) — scripted playback visually distinct from live capture | Already labeled; verify UI separation |
| 10 | C09 — freeze seed/graph manifest; one clean-reset rehearsal | Reproducibility |
| + | Core DB-reconnect resilience (my addition; ~0.5d) | Prevents mid-demo crash on infra hiccup |

**Story (from market research):**
- Remove every borrowed benchmark from the deck ("12–18% rejection" is
  exactly the untransferable US figure the research warns about). Replace
  with: "measured on our synthetic seed; pilot will establish local rates."
- Frame the differentiation honestly: competitors cite sources (Abridge);
  we show the query. The evidence-chain cutaway is the demo's center of
  gravity — it is also the one thing no reviewed competitor can replicate
  without our deterministic core.
- Demo script = readiness §8 unchanged (it already matches the research's
  evidence discipline), plus the negative case (unknown ≠ green) kept
  deliberate.

**Exit gate (both documents):** all Criticals closed or excluded in
writing; no unlabelled simulation; no borrowed numbers; clean-run and
failure-run evidence; product/clinical sign-off.

### Phase 2 — Pilot Readiness (~6–12 engineering weeks + external dependencies)

**Objective:** one hospital, one workflow, shadow-mode, measured.

**Engineering (readiness Mediums, ordered by risk):**
1. **Pre-PHI gates first:** M02 (session revocation), M03 (key management),
   M07 (DSR/consent) — mandatory before any real data.
2. M09 (durable coder-queue/workflow state) + M05 (ingestion completeness)
   — the claim-integrity workflow must not lose work on restart.
3. M11 (governed reference releases: versioned, checksummed, dated).
4. M06 (graph projection freshness/lineage), M08 (audit durability),
   M10 (typed fact contracts for Q&A), M12 (independent evaluation sets).
5. H-series as capacity allows (launcher reproducibility, health checks,
   timeouts, CI gates).

**Evaluation (market research P0/P1 — the part competitors fake):**
- Build the independent evaluation harness: prespecified outcomes,
  blinded coder/clinician adjudication, untouched holdout, false-pass and
  false-block both reported (readiness §7 dataset specs are the blueprint).
- Measure local coding correctness and defect precision/recall against an
  adjudicated retrospective claims cohort. **Never target higher code
  levels** (market research §3.4: an upward coding shift is not a success
  metric).
- Arabic/bilingual validation is its own gate before any ambient claims
  (market research §5: zero Arabic RCT evidence exists — that's an
  opportunity to publish the first).

**Business measurement (readiness KPIs + research discipline):**
- Defect precision/recall, coder time-to-resolution, documented
  review/edit burden — measured against the hospital's own baseline,
  not vendor before/after selections.
- Financial impact = avoided paid value minus costs; rejected-value-saved
  is not revenue (research §7 KPI table).

**Exit gate:** approved data agreement; pre-PHI controls verified;
holdout quality measured and reported with uncertainty; durable workflow
recovery demonstrated; hospital clinical/coding + DPO/security sign-off.

### Phase 3 — Production Readiness (multi-month, gated)

- Readiness Long-term register (L01–L06): deployment/IaC, service
  identity, telemetry, load-tested capacity, supply chain, HA/DR.
- Market research P2/P3 unlock here: reviewed appeal formatting
  (approved facts only), then prior-auth transaction assistance — only
  after the claims core is validated and NPHIES interfaces are verified
  with the payer.
- Clinical decision-support features (differential, dosing) remain a
  separate program with their own intended-use and validation gates —
  both documents place them outside every current phase.

## Standing principles (both documents, non-negotiable)

1. **Claims match code.** Every public statement is traceable to an
   implemented, tested control.
2. **Deterministic facts; the LLM formats.** No model-confidence decisions,
   no autonomous codes, no auto-submission.
3. **Unknown ≠ green.** Completeness, coverage and freshness propagate
   with every verdict.
4. **Measured locally or silent.** No borrowed benchmarks, no
   vendor-transferable ROI, no untransferable US figures.
5. **The clinician signs everything.** Full-review workflow, audit trail,
   reviewer identity preserved.
6. **Evidence links must entail.** A citation supports the claim or it
   doesn't ship.

## Immediate next step

Approve this plan, then start Phase 1 items 1–2 (C02 mock/live separation,
C07 port containment) — the two cheapest items that remove the largest
demo-credibility risks.
