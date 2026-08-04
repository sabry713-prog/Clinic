# Veritas-Medica — Market Readiness Roadmap

**Date:** 2026-08-03
**Horizon:** prototype → first paying KSA hospital pilot → commercial release
**Factual base:** [`PROTOTYPE_EVALUATION.md`](PROTOTYPE_EVALUATION.md) and
[`STABILIZATION_AUDIT.md`](STABILIZATION_AUDIT.md). Nothing here restates code
findings; this is the commercial and sequencing layer on top of them.

**Method:** RICE prioritisation with strategic overrides, Now/Next/Later
sequencing (roadmap-planning skill), and a channel/messaging/metrics GTM
structure (gtm-strategy skill). Frameworks are theirs; the facts, constraints
and judgements are this codebase's.

---

## 0. The one thing that determines everything else

**Three gates sit between this prototype and revenue, and none of them can be
compressed by engineering effort:**

| Gate | Owner | Typical elapsed | Blocks |
|---|---|---|---|
| CCHI / NPHIES onboarding — real IG profiles, conformance testing, certificates (annual renewal) | CCHI | Months, externally paced | Any real claim submission |
| SaMD-boundary sign-off for DDI + renal-dose + differential features **already built** | CTO + Clinical Advisor + Regulatory Consultant | Weeks–months | Any real-patient clinical use |
| SDAIA authorisation for cross-border health data, **or** in-Kingdom self-hosting | SDAIA / your infra | Weeks (self-host) vs uncertain (authorisation) | Any real patient record |

**Strategic consequence:** the roadmap must be sequenced so engineering work
runs *in parallel* with these gates, not behind them. The single highest-value
technical move — porting the orchestrator to the existing `ModelProvider`
abstraction — is valuable precisely because it **converts gate 3 from an
external dependency into an internal one**. Self-hosting is something you
control; SDAIA authorisation for a China-hosted LLM is not.

**Corollary worth stating to leadership:** a "market launch" date cannot be
committed until gate 1 has a CCHI slot. Everything below is sequenced to make
the company *ready* for that slot, and to generate revenue-adjacent proof in
the meantime.

---

## 1. Corrections to the evaluation

Re-reading the evaluation with a commercial lens surfaces four things it
under-weighted:

**C-1 — "Not pilot-ready" understates what *is* pilot-ready.** The evaluation
judges the whole product against real-patient use. But the **claim-integrity
half** — claim readiness, ICD/SBS coding, rejection-risk analytics, diagnosis
linkage — is administrative, not clinical. It touches no SaMD boundary and
needs no clinical sign-off. It could pilot on real *claims* data far sooner
than the clinical half can pilot on real *patients*. **This is the single
biggest missed opportunity in the current framing** and it reshapes the roadmap
(see §3, Now).

**C-2 — The competitive framing is too pessimistic on ambient, too modest on
claims.** Competing with Nuance DAX on ambient scribing is a losing fight. But
no ambient vendor does NPHIES claim integrity, and no Saudi RCM vendor does
graph-grounded explainability. The wedge is narrower and stronger than the
evaluation states.

**C-3 — No pricing or commercial model exists anywhere in the documentation.**
Not a code gap, but you cannot go to market without one. Addressed in §4.

**C-4 — "515 tests pass" is an engineering metric, not a buyer metric.** No
clinical accuracy evaluation exists: no measured coding-suggestion precision, no
false-positive rate on NPHIES flags, no scribe WER on Saudi-accented Arabic. A
hospital CMO will ask for exactly these. This is a **gap the evaluation did not
name** and is a Priority-1 addition.

---

## 2. Initiatives, scored

RICE over a 12-month horizon. *Reach* = share of the target pilot's daily
workflow touched. *Impact* 0.5–3. *Confidence* reflects both technical and
external-dependency risk. *Effort* in person-weeks.

| # | Initiative | R | I | C | E | RICE | Note |
|---|---|---|---|---|---|---|---|
| E1 | Clinical accuracy evaluation pack (C-4) | 3 | 3 | 90% | 3 | **2.7** | Unblocks every buyer conversation |
| E2 | Port orchestrator to `ModelProvider` + self-host demo | 3 | 3 | 90% | 1 | **8.1** | Converts gate 3 to internal |
| E3 | Claim-integrity pilot package (C-1) | 2 | 3 | 80% | 4 | **1.2** | Revenue path that skips clinical gates |
| E4 | Finish UI wiring (M-1, H-3b, M-7) | 3 | 2 | 95% | 2 | **2.9** | Demo credibility |
| E5 | Resolve ICD-10-AM vs CM + real IG profiles | 3 | 3 | 50% | 3 | **1.5** | Externally gated; start discovery now |
| E6 | Durable queues + multi-replica readiness | 1 | 2 | 90% | 3 | **0.6** | Not needed for single-site pilot |
| E7 | Arabic/dialect ASR improvement | 2 | 2 | 60% | 6 | **0.4** | Expensive; validate demand first |
| E8 | Neo4j PDPL retention/erasure parity | 2 | 3 | 90% | 2 | **2.7** | Compliance blocker for real data |
| E9 | ATC/therapeutic-class data for screening | 1 | 2 | 70% | 2 | **0.7** | Fixes a credibility-damaging output |
| E10 | SOC2 / HITRUST track | 1 | 1 | 70% | 12 | **0.06** | Defer; not a KSA buying requirement |

**Strategic overrides applied:**

- **E5 promoted** above its score. Its low confidence *is* the reason to start —
  discovery is cheap and the answer gates everything downstream.
- **E8 promoted** to Now. It is small, and being unable to delete a patient from
  the graph is a PDPL conversation you cannot afford to lose mid-pilot.
- **E10 demoted** to Later. SOC2 matters for US enterprise; KSA buyers ask about
  NCA/SDAIA alignment instead. Do not spend 12 weeks on the wrong certification.
- **E7 demoted.** The evaluation flags dialect ASR as weak, but if the wedge is
  claims rather than ambient (C-2), this stops being on the critical path.

---

## 3. Roadmap — Now / Next / Later

### NOW — next 6 weeks (committed)

*Outcome: a demo that survives specialist scrutiny, and a defensible answer to
"can you run this in our data centre?"*

1. **E4 — Finish the UI wiring.** Agent action cards (M-1), SOAP generation
   (H-3b), checklist persistence (M-7). Nothing else matters if a specialist
   clicks "Adjust Dosage" and nothing happens.
2. **E2 — Port `deepseek_client.py` to the `ModelProvider` pattern** and
   demonstrate a self-hosted Llama 3 swap. ~1 week. Closes audit H-1 and the
   LLM lock-in simultaneously.
3. **E1 — Build the clinical accuracy evaluation pack.** Coding-suggestion
   precision/recall against a labelled set, NPHIES flag false-positive rate,
   scribe WER on Arabic and English samples. **Publish the numbers even if they
   are unflattering** — a vendor with measured weaknesses outranks one with no
   measurements.
4. **E8 — Neo4j retention + erasure parity** with the existing Postgres DSR.
5. **E5 (discovery only)** — get the ICD-10-AM/CM answer and request the real
   NPHIES IG. No code yet.

**Exit criteria:** demo runs end-to-end with no dead controls; a self-hosted
model swap is demonstrable; an accuracy one-pager exists; erasure works.

### NEXT — 3 months (high confidence)

*Outcome: a signed pilot on the half of the product that has no clinical gate.*

6. **E3 — Claim-integrity pilot package (C-1).** Package claim readiness,
   coding, rejection-risk analytics and pre-auth as a standalone offering that
   pilots on **real claims data with no real-patient clinical exposure**. This
   is your fastest credible path to a paying customer.
7. **E5 (execution)** — real IG profiles, conformance testing, certificate
   lifecycle. Flip `profiles_verified` to true only when genuinely true.
8. **E9 — ATC/class data** so alternative screening stops proposing Warfarin as
   a Metformin alternative.
9. **SaMD sign-off process** started in parallel for the clinical half.
10. **Hijri dates, Arabic patient templates, clinician-gender scheduling** —
    small, visible, and repeatedly requested by Saudi clinicians.

**Exit criteria:** one hospital running claim integrity on real claims; NPHIES
conformance passing; sign-off process underway.

### LATER — 6–12 months (lower confidence)

11. **Clinical pilot** once SaMD sign-off lands and in-Kingdom hosting is live.
12. **E6 — Durable queues** when a second site or a second replica appears.
13. **E7 — Dialect ASR**, only if pilot feedback shows ambient is the wedge.
14. **SMART-on-FHIR launch** for EMR embedding — the main integration-breadth
    gap versus market leaders.
15. **E10 — SOC2/HITRUST** only if pursuing non-KSA or large private groups.

---

## 4. Go-to-Market

### Segment — start narrow

**Primary:** mid-size private Saudi hospital groups (2–8 facilities) already
submitting to NPHIES and feeling claim rejections in cash terms. They have
budget authority, short decision chains, and a quantifiable pain. They are also
small enough that a single-site, single-replica deployment is genuinely
sufficient (which is why E6 can wait).

**Not first:** MOH facilities (procurement cycles measured in years) or single
clinics (no budget, no NPHIES pain at scale).

### Positioning

> **For** Saudi private hospital groups losing revenue to NPHIES claim
> rejections, **Veritas-Medica** is a clinical documentation and claim-integrity
> layer that validates every order against the documented diagnosis *before*
> submission — and shows the exact graph path behind every decision.
> **Unlike** ambient scribes that stop at the note, or RCM tools that catch
> errors after rejection, it is grounded in a deterministic knowledge graph, so
> its claims are auditable rather than generated.

**Three proof points, in the order they land:**

1. **"Click any claim and see the query."** Evidence chains are the demo moment
   and the hardest thing for a competitor to retrofit.
2. **"It refuses rather than guesses."** The system declines to submit without a
   confirmed code, and only an explicit payer approval turns a badge green. In a
   market burned by AI overclaiming, restraint is a feature.
3. **"It runs in your data centre."** Post-E2, on your own hardware, with the
   PHI residency guard fail-closed by default.

### Channels — few, done well

| Channel | Why | First action |
|---|---|---|
| Direct founder-led sales to hospital CFO/RCM directors | Claim rejection is a CFO-visible number | Build a 6-slide rejection-cost model per prospect |
| HIS/EMR vendor partnerships | They own the integration surface you lack | Target vendors already NPHIES-integrated |
| Clinical advisory board | Converts specialists into references | Recruit from the demo audience |
| Vision 2030 / health-transformation events | Where the buyers concentrate | One well-prepared demo beats a booth |

**Deliberately not:** paid digital, content/SEO, product-led growth. Enterprise
healthcare with a months-long cycle rewards none of them at this stage.

### Commercial model (C-3 — currently absent)

Recommended: **per-facility annual licence + per-clinician tier**, with a
**value-linked pilot** — priced against measured reduction in rejection rate, so
the buyer's risk is bounded and your instrumentation becomes the sales asset.
Avoid per-claim pricing: it caps your upside exactly when you succeed.

### Metrics

**Pilot success (the only ones that matter early):**

- NPHIES rejection rate, pre- vs post-, on the same department
- Pre-auth turnaround time
- % of orders reaching submission with a confirmed code first time
- Clinician-minutes per encounter on documentation

**Commercial:** pilots started → converted, ACV, cycle length, reference count.

**Explicitly not:** the -65% / -85% figures in the executive deck. Those are
*targets*, and the pilot exists to replace them with measurements. Presenting
them as achieved would repeat exactly the overclaiming this product is
positioned against.

---

## 5. Recommended new features

Beyond fixing what exists — ranked by buyer-visible value:

| Feature | Rationale |
|---|---|
| **Rejection-cost dashboard** (SAR at risk, by department, by code) | Turns the product into a CFO conversation. Data already exists in the rejection-risk service. |
| **Pre-submission claim simulator** | "Run this claim before you send it" — a natural, high-trust entry wedge. |
| **Coder review queue** | Batch coding surface for RCM teams; today the flow is clinician-first only. |
| **Accuracy transparency panel** | Surface E1's measured precision/recall in-product. Differentiates hard against black-box vendors. |
| **Audit export pack** | One-click evidence bundle for CCHI/NCA review. |
| **Ambient consent capture** | Recording a consultation needs documented patient consent under PDPL. Currently absent and required before any real ambient use. |

---

## 6. Immediate next actions

| # | Action | Owner | When |
|---|---|---|---|
| 1 | Ask coding specialists: ICD-10-AM or CM? | Product | At the demo |
| 2 | Port orchestrator to `ModelProvider`; demo self-hosted swap | Eng | Week 1–2 |
| 3 | Wire M-1 / H-3b / M-7 | Eng | Week 1–3 |
| 4 | Build the accuracy evaluation pack | Eng + Clinical | Week 2–5 |
| 5 | Start SaMD sign-off with Clinical Advisor + Regulatory | Leadership | This month |
| 6 | Request the real NPHIES IG; scope CCHI onboarding | Product | This month |
| 7 | Decide: claims-first wedge (C-1/C-2) or full-product? | Leadership | Before pilot outreach |

**Action 7 is the fork in the road.** Claims-first reaches revenue months
earlier because it sidesteps the SaMD and patient-data gates entirely. It also
narrows the initial story. That is a leadership call, not an engineering one —
but the evaluation's own findings point clearly at claims-first.
