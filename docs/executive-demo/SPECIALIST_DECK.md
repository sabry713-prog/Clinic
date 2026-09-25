---
marp: true
theme: gaia
paginate: true
---

<!-- =====================================================================
SOURCE MAP — every factual claim below traces to a repo document.
(Not speaker notes. Verify before editing any slide's content.)
VALUE-FIRST EDITION (2026-08-13): technical machinery removed from audience
copy; the same facts, stated as outcomes.

S1  title/product framing ......... README.md ("clinical documentation ... Saudi market"),
                                    docs/TECHNICAL_ONBOARDING_BRIEF.md §1
S2  problem statements ............ docs/executive-demo/EXECUTIVE_PRESENTATION.md Slide 2
                                    (3+ h EHR/day and 12–18% NPHIES rejection are
                                    industry benchmarks, marked *(target)* there)
S3  the promise ................... docs/TECHNICAL_ONBOARDING_BRIEF.md §1 ("Reasoning is
                                    separated from language ... The LLM is only ever
                                    allowed to reword facts it was handed")
S4  proof panels .................. services/veritas-graph/nphies_queries.py + nscre_engine.py
                                    (live output verified on this branch: I10 → 11700-00-00
                                    GREEN verdict; renal-dose alert Metformin/eGFR);
                                    UI cutaway: apps/web EvidenceChainPopover + tests
S5  time value .................... EXECUTIVE_PRESENTATION.md Slides 6+9 (ambient scribe,
                                    −65% time per encounter marked *(target)*)
S6  revenue value ................. EXECUTIVE_PRESENTATION.md Slides 5+9 (point-of-care badge
                                    model, −85% rejections marked *(target)*);
                                    Arabic: apps/web i18n ar.json (claim simulator)
S7  safety by design .............. EXECUTIVE_PRESENTATION.md Slide 4 + 9 ("structural, not
                                    statistical"; zero-hallucination by architecture);
                                    CLAUDE.md (human sign-off, blocklist final gate)
S8  Kingdom value ................. EXECUTIVE_PRESENTATION.md Slide 8 (in-Kingdom deployment,
                                    PDPL, self-hosted LLM); localization: apps/web dates.ts
                                    (Hijri), reminder templates (Arabic patient messages)
S9  a day changed ................. EXECUTIVE_PRESENTATION.md Slide 6 (one screen, three
                                    panes, no context-switching / end-of-day backlog)
S10 why us ........................ own capabilities per README.md + docs/api/08-nphies.md;
                                    "typically" hedging — no unverifiable competitor claims
S11 honesty ....................... docs/TECHNICAL_ONBOARDING_BRIEF.md §4+§5 (synthetic seed,
                                    stub payer connector, profiles unverified)
S12 30-day pilot .................. EXECUTIVE_PRESENTATION.md Slide 10 (week-by-week plan)
S13 asks .......................... EXECUTIVE_PRESENTATION.md Slide 10 (department, two
                                    clinician champions, read-only endpoint)
S14 closing ....................... product line from README.md; name removed per deck owner
                                    request (2026-08-14)
====================================================================== -->

<style>
  :root { --vm-bg: #0B1220; --vm-card: #141F35; --vm-line: #263A5C; --vm-accent: #3E8BFF;
          --vm-soft: #8FC1FF; --vm-green: #3FD68F; --vm-amber: #F5B84C;
          --vm-text: #F4F7FC; --vm-sub: #A9B6CC; --vm-muted: #6B7A93; }
  section {
    background: var(--vm-bg);
    color: var(--vm-text);
    font-family: "Segoe UI", "IBM Plex Sans Arabic", "Helvetica Neue", Arial, sans-serif;
    size: 1280px 720px;
    padding: 60px 80px;
  }
  section h1, section h2 { color: var(--vm-text); font-weight: 700; border: none; }
  section h1 strong, section h2 strong, section h3 strong, section td strong { color: var(--vm-accent); }
  section h2 { font-size: 0.92em; color: var(--vm-sub); text-transform: uppercase; letter-spacing: 0.12em; }
  section.lead { display: flex; flex-direction: column; justify-content: center; }
  section.lead h1 { font-size: 1.5em; }
  section p, section li { color: var(--vm-sub); font-size: 0.82em; }
  section strong { color: var(--vm-text); }
  section em { color: var(--vm-muted); font-style: normal; font-size: 0.78em; }
  section table { font-size: 0.78em; width: 100%; border-collapse: separate; border-spacing: 0 6px; }
  section th { color: var(--vm-muted); border: none; text-transform: uppercase; font-size: 0.85em; }
  section td { background: var(--vm-card); border-top: 1px solid var(--vm-line); border-bottom: 1px solid var(--vm-line); color: var(--vm-text); }
  section td:first-child { border-left: 1px solid var(--vm-line); border-radius: 8px 0 0 8px; }
  section td:last-child { border-right: 1px solid var(--vm-line); border-radius: 0 8px 8px 0; }
  section pre { background: #0A0F1A; border: 1px solid var(--vm-line); border-radius: 10px; font-size: 0.6em; color: var(--vm-green); padding: 14px 18px; }
  section code { font-family: "Cascadia Code", Consolas, "Courier New", monospace; }
  section footer, section::after { color: var(--vm-muted); }
  section .ar { direction: rtl; text-align: right; color: var(--vm-soft); }
  section .ok { color: var(--vm-green); }
  section .warn { color: var(--vm-amber); }
</style>

<!-- S1 · Title — the one-line promise ---------------------------------->

<section class="lead">

# Clinical AI you can **trust**.

## Veritas-Medica

Documentation and claim protection for Saudi hospitals.

`Your records → Verified facts → Your clinicians`

<!-- Open on trust, not features. This deck answers one question: why can
     this AI be believed? Everything else supports that answer. -->

</section>

<!-- S2 · The problem --------------------------------------------------->

<section>

## The problem

# Medicine's hardest problems aren't medical.

| | | |
|---|---|---|
| **01 — 3+ hours lost every day**<br>Clinicians spend more time documenting than treating. | **02 — 1 in 7 claims rejected**<br>Errors surface after submission — the revenue is gone. | **03 — AI you can't verify**<br>Generative tools can sound confident and still be wrong. |

*3+ hours and 1-in-7 are published industry figures (US/EU studies), not our measurements and not Saudi-validated — our pilot establishes local rates.*

<!-- Three pressures every Saudi hospital knows firsthand. Land on the
     third last — it is the fear that greets any clinical AI purchase,
     and it sets up our promise. -->

</section>

<!-- S3 · Our promise (the main selling point) -------------------------->

<section class="lead">

# AI grounded in **your patient's record**.

Rule findings are deterministic and inspectable; generated drafts cite
their sources and always require clinician review.
**The clinician confirms before anything enters the record.**

*The architecture separates deterministic fact retrieval from language
formatting — a design commitment enforced by our own test suite.*

<!-- THE slide. Say it slowly. The differentiation: deterministic rule
     findings with inspectable evidence chains, and a formatting-only
     LLM that requires clinician confirmation. The next slide proves
     the inspectability live. -->

</section>

<!-- S4 · Proof ---------------------------------------------------------->

<section>

## Seeing is believing

# Don't take our word for it. **Check us.**

```
✓ Diagnosis on file:    Hypertension (I10)
✓ Service covered:      Consultation 11700-00-00
✓ Necessity rule:       Matched
▸ VERDICT: READY — submit with confidence
```

```
✓ Patient record:       kidney function 28% — this week
✓ Active medication:    Metformin 1000mg
✓ Safety rule:          renal threshold crossed
▸ ALERT: dose review recommended
```

Proof follows every answer — notes, drug alerts, orders, claims.

<!-- Live demo moment: click any statement, the proof appears. No technical
     skill needed to read it — it is a checklist of facts from the record,
     not a query. Trust becomes verification, not faith. -->

</section>

<!-- S5 · Value 1 — time ------------------------------------------------->

<section>

## More medicine, less keyboard

# The note **writes itself**.

- **Arabic & English** — real consultation language, both, in one visit.
- **The doctor stays in charge** — nothing is applied without review and signature.
- **Hours back, every day** — target: −65% documentation time, measured in your pilot.

<!-- The doctor talks; the note appears, structured and ready to sign.
     Every field stays editable. The time saving is a target the pilot
     measures — we do not quote it as fact. -->

</section>

<!-- S6 · Value 2 — revenue ---------------------------------------------->

<section>

## Protect the claim

# Find the error **before the payer does**.

<p class="ar">تحقق قبل الإرسال</p>

- **Check before you send** — every claim is verified, verdict before submission.
- **Fix it on the spot** — the right code is suggested while the doctor is still there.
- **Revenue that stays** — fewer rejections, found by you, not by the payer. <em>target: −85% rejections</em>

<!-- Rejections today are discovered weeks later, after the revenue is
     lost. We move that discovery to the moment of care, where it costs
     one click instead of one claim. -->

</section>

<!-- S7 · Value 3 — safety ----------------------------------------------->

<section>

## Safety by design

# **Deterministic facts.** Clinician-confirmed.

- ✅ **The record decides what's true** — rule findings come from deterministic graph queries against your data, never from the language model.
- ✅ **Doctors sign everything** — no note, order, or code is ever applied automatically.
- ✅ **Rule evidence is one click away** — every deterministic finding shows the exact query and source facts behind it.
- ✅ **Reviewed outputs are versioned** — drafts, codes and links carry reviewer identity and timestamps.

*Generated text always requires clinician review; deterministic findings are inspectable but reflect the data and rules loaded — they do not replace clinical judgement.*

<!-- For the risk officer: the architecture separates fact retrieval
     (deterministic, testable) from language formatting (LLM, always
     reviewed). Neither claims to replace clinical judgement or
     regulatory compliance. -->

</section>

<!-- S8 · Value 4 — the Kingdom ------------------------------------------>

<section>

## Built for the Kingdom

- **Arabic first** — full RTL interface, Hijri dates, Arabic patient messages.
- **NPHIES-native** — built for the national claims platform from day one.
- **Your data stays home** — in-Kingdom by design; inside your hospital, even.
- **Your AI, your walls** — the language engine can run on your own servers.

```
WHERE PATIENT DATA LIVES
Location    inside your hospital
Leaves      not in this configuration
AI engine   your servers — optional
```

<!-- Data residency is a board-level concern. The deployment
     configuration keeps data in-Kingdom; actual PDPL compliance
     requires a site-specific privacy assessment (planned for the
     pilot phase). Not a blanket compliance claim. -->

</section>

<!-- S9 · A day changed -------------------------------------------------->

<section>

## A day changed

# One visit. **Everything done.**

| | | |
|---|---|---|
| **DURING THE VISIT**<br>The note writes itself<br>The doctor just talks — in Arabic or English. | **AT THE ORDER**<br>The claim gets checked<br>Issues surface instantly, fixed on the spot. | **BY EVENING**<br>Everything is signed<br>Notes done. Claims ready. No backlog. |

The documentation, the order, and the claim — finished in the same minute.

<!-- The whole product in one day-in-the-life. No context-switching, no
     separate billing portal, no end-of-day note backlog. -->

</section>

<!-- S10 · Why us -------------------------------------------------------->

<section>

## Why us

# Others write notes. **We guard the encounter.**

| Capability | Ambient vendors * | **Veritas-Medica** |
|---|---|---|
| Notes written during the visit | ✓ | ✓ |
| Pre-submission claim review | — | **✓** |
| Deterministic rule evidence, inspectable | — | **✓** |
| Runs inside your hospital | — | **✓** |

*typically — characterization, not a claim about any specific product*

Notes are where it starts. **Reviewable evidence and administrative claim checks are the difference.**

<!-- Respectful and specific: notes are table stakes; the defensible
     difference is verifiable correctness plus claim protection plus
     data residency. -->

</section>

<!-- S11 · Honesty ------------------------------------------------------->

<section>

## Our honesty commitment

| What you saw is real | What is simulated |
|---|---|
| Every answer — and its proof | Patient data — synthetic |
| Notes, alerts and dashboards | Payer connection — simulated |
| Tamper-proof audit trail | No real claim has been sent |
| Arabic + English, end to end | |

## A real product, shown on synthetic data.

<!-- We will not pitch fiction. The engines are real; the patients are
     synthetic and the payer link is simulated until conformance and
     sign-off complete. A product whose pitch is "we don't guess facts"
     does not guess its own readiness. -->

</section>

<!-- S12 · The 30-day pilot ---------------------------------------------->

<section>

## The 30-day proof

# Prove it **in your hospital**.

| | | | |
|---|---|---|---|
| **WEEK 1**<br>Connect<br>Read-only. Zero disruption. | **WEEK 2**<br>Shadow<br>Runs alongside your workflow. | **WEEK 3**<br>Live<br>Opt-in doctors, real encounters. | **WEEK 4**<br>Measure<br>Time + rejections vs your baseline. |

**One department. Two champions. Thirty days to proof.**

<!-- The pilot measures us against the hospital's own baseline — time per
     encounter and rejection rate. The numbers in this deck are targets;
     the pilot is where they become facts or get corrected. -->

</section>

<!-- S13 · The ask ------------------------------------------------------->

<section>

## What we ask of you

- **01 — Meet the product.** A working session, live on synthetic data.
- **02 — Pick a department.** Internal medicine or cardiology to start.
- **03 — Name two champions.** Clinicians who shape the workflow with us.
- **04 — Grant the pilot.** Thirty days — read-only first, measured together.

<!-- Small, concrete, reversible. Every ask is an invitation to verify,
     never to take anything on faith. -->

</section>

<!-- S14 · Closing ------------------------------------------------------->

<section class="lead">

# Medicine deserves AI it can **trust**.

## Veritas-Medica

Documentation and claim protection for Saudi hospitals.

<!-- Close where we opened: trust, provable in one click. Then the single
     next step — book the working session. -->

</section>
