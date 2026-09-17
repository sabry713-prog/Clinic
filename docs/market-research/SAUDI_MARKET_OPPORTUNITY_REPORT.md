# Veritas-Medica — Saudi Market Opportunity & Innovation Report

**Date:** 11 September 2026 (verification pass: 11 September 2026)
**Baseline:** `feat/ui-light-theme`, commit `d0fbf96f94f586785d169c25d4a831df5c03339a` (product state); retrieved sources current as of 11 Sep 2026
**Inputs:** Four research reports in this directory, each independently re-verified against primary sources with evidence ledgers in `verification/`:
- `saudi-regulatory-research.md` (+ `verification/regulatory/CHANGELOG.md`) — **verified**; citation/evidence gate exit 0
- `global-west-research.md` (+ `verification/west/CHANGELOG.md`) — **verified**; citation/evidence gate exit 0
- `global-east-ecosystem-research.md` (+ `verification/east/CHANGELOG.md`) — **verified**; citation/evidence gate exit 0
- `saudi-competitors-research.md` (+ `verification/competitors/CHANGELOG.md`) — **verified**; citation/evidence gate exit 0

**Companion volume:** `../assessment/PRE_DEMO_READINESS_ASSESSMENT.md` (technical readiness, 35 findings)

> **Status: verification complete; cleared for internal decision use, not for external citation as market fact.** This summary was rewritten to remove overstatements found during verification — competitor-absence claims, market-timing windows, regulatory exemptions, cloud-availability and transferability assumptions. The original version's headline conclusions on those points are withdrawn. A citation match verifies that a quote appears in a source; it does not make the source's assertion true, it does not establish vendor claims or feature absence, and it is not legal, regulatory, clinical or commercial advice. The residual diligence gaps listed in §15 apply to any external use.

---

## 1. Executive summary

**Verified position:** the Saudi claims environment contains a large, officially documented volume of prior-authorization rejections attributed to clinical-justification grounds, and the DRG transition imposes dated coding-audit and documentation obligations on providers. Whether the Veritas-Medica prototype can profitably reduce those rejections is an open question that only a measured pilot can answer; it is not established by the available data.

What the sources do support:

1. **A documented rejection pattern, with a specific denominator.** NPHIES Q3-2025 reports that "46% of rejected items in prior authorizations were rejected for not being justified clinically," with the leading reason at 46.14% of *rejected PA items* (versus 38.84% in Q3-2024) [20]. This is not a share of all PAs, all claims, lost revenue or preventable denials, and the report does not measure whether any software could reverse such a rejection.
2. **Dated, scoped provider obligations.** CHI's DRG guideline specifies shadow billing 2026–2027, DRG-based reimbursement from 1 January 2028, quarterly internal coding audits, annual external coding audits from 1 January 2027, and CDI arrangements for private-sector hospitals submitting DRG claims [16]. These are obligations on providers; none of them requires purchasing this product.
3. **Regulatory applicability is conditional and partly unresolved.** PDPL governs applicable processing of health data as sensitive data and permits conditional cross-border transfer rather than imposing a blanket residency ban; NCA ECC covers government entities and affiliates plus relevant private CNI entities, and CCC allocates cloud duties across in-scope tenants and providers [2][6][7][8]. SFDA classification of this prototype's actual modules is **not determined** by its billing label or clinician sign-off [3].
4. **The competitive picture is more crowded than the first draft implied.** Verified primary pages show Glance (Saudi-developed SOAP Builder, ICD-10-AM Quick Coder, pre-audit and audit-trail positioning), Santechture (pre-submission rules, medical-necessity checks, CDI and coder task lists with SBS/ICD-10-AM localisation), Solventum (Saudi coding/CDI tools plus a global prebill review product) and Nano Health (Arabic/English notes with coding, CDI and claims) describing functions the earlier synthesis treated as unoccupied. No verified "open flank" or timing-window claim survives in this version.
5. **Foreign results establish patterns, not local outcomes.** Controlled trials and independent evaluations exist for ambient documentation and coding, but their settings, code sets, payer structures and endpoints are not Saudi ones, and their vendor-reported figures are labeled as such. They justify hypotheses to test locally, not transferable ROI.

**Working hypothesis (to be tested, not a conclusion):** a provider-side integrity layer that links reviewed documentation to coded, necessity-checked claims may reduce avoidable rejections for some providers. The pilot design in §11 exists to falsify that, with rejection-mix separation, per-unit denominators and measured baselines.

**Product constraint (unchanged).** The technical assessment still governs: conditional GO for a narrowed synthetic-data demonstration; NO-GO for real-patient or live-payer operation. Market work does not change that gate.

---

## 2. Market and platform context (verified figures, with units)

| Indicator | Published value / period | Note |
|---|---|---|
| Beneficiaries served | 14.1M+ employer insurance; 18.8M+ visitor insurance | NPHIES IG snapshot labeled October 2025 [1] |
| Onboarded provider facilities | 6,419+ | IG KPI table; distinct from the ~6,600 *regulated* organizations and ~18,000 total organizations [1] |
| Onboarded insurers / vendors | 25 / 60+ | IG KPI table [1] |
| "Market Share of Claims" | 98% | IG label; not a share of software spending [1] |
| Transaction volume | 143M (2023); 292M (2024); 96M (Q1 2025) | IG; do not present as September 2026 live measurement [1] |
| Q3-2025 activity | 52.3M eligibility; 13.3M PAs; 32.8M claims; 99.77% availability | Q3-2025 report; the report warns aggregate ratios are not per-transaction correlations [20] |
| Health-insurance GWP | SAR 42.2B (2024) vs SAR 38.6B (2023); 55.5% of sector premiums; 23 companies writing health | SPA quoting the Insurance Authority, 27 Oct 2025 [12]; premiums are not software revenue |

**Explicit limits:** these sources describe platform activity and insurance scale. They do not establish unique active patients, independent purchasing units, software budgets, willingness to pay, or a serviceable market for this prototype. No software-market valuation is asserted. The earlier "unserved tail" framing of non-onboarded organizations is withdrawn — the difference between total and onboarded organizations is not evidence of an accessible commercial segment, and public providers do not share one purchasing route [1].

---

## 3. What the rejection data does and does not show

**Verified (NPHIES Q3-2025, p. 22):** rejection reasons as a share of rejected PA items — clinical justification 46.14%; duplicate service/procedure code by date 8.00%; contract non-compliance 5.23%; inadequate/missing history of present illness 5.22%; service not covered 5.01%; out-of-network provider 4.51%; refill too soon 3.98%; inadequate/missing investigation result 2.57%; annual limit exceeded 2.56% [20].

**Separate denominators, not to be pooled:** 172K+ transactions blocked for wrong National ID; 150K+ duplicate PA requests and 179K+ duplicate claim requests prevented (Q3-2025); 4.02% of requests requiring correction; 3.16% of requested PAs returned with payer-side errors, duplicate accounting for 41.30% of those [20]. The eligibility chart labels 81.2% *eligible* and 18.8% *not eligible*, with a separate 5.8% "no member found" label — the earlier reading of that chart as an ineligible-only denominator is withdrawn [20].

**Not established by these sources:** that supporting clinical evidence was absent in the rejected cases; that documentation was the sole cause; that any rejection was financially recoverable; that provider systems lack adjudication analytics; or that this product could convert a rejection into payment. NPHIES describes itself as validating formats and coding standards and explicitly not taking the provider, payer or TPA role, so technical acceptance is not evidence of payment [1].

**Prior evidence removed from the argument:** vendor rejection-rate ranges, coder-scarcity figures, third-party market estimates, and small observational CDI studies are no longer used as quantified evidence of this product's impact. An observational difference between hospitals with and without a CDI program does not establish causality, generalize to Saudi Arabia, or attribute any effect to this software.

---

## 4. Regulatory map — scope first, classification second

This is source verification, **not legal advice, an SFDA classification, certification, or authorization to deploy**. "Provider-side," "non-diagnostic" and "human reviewed" describe design intent, not verified exemptions.

| Regime | Source-backed scope / status |
|---|---|
| PDPL + Implementing Regulation | Applicable personal-data processing; health data is sensitive; controller/processor duties follow the actual role; sensitive-data processing triggers a documented impact assessment [8][9] |
| Cross-border transfer | Conditional Article 29 route plus Transfer Regulation; three safeguard types (SCCs, binding common rules, accreditation certificate) apply in specified cases; a transfer risk assessment is required in defined circumstances [2][8] |
| Residency | PDPL is not by itself a blanket ban on transferring Saudi health data; separate health-sector, NCA, public-sector, classification and contract conditions must be assessed independently, and transfer safeguards do not override a separate localization restriction [8][9] |
| NPHIES | Exchange standards apply to production NPHIES transactions; a standalone documentation module does not necessarily need its own direct integration [1] |
| CHI DRG framework | Private-insurance admitted-care framework; shadow billing 2026–2027; reimbursement from 1 Jan 2028; audit and CDI obligations as listed above [16] |
| NCA ECC-2:2024 | Government agencies and affiliates, plus private entities owning, operating or hosting CNI; cloud subdomain 4-2 binds entities using or planning cloud; other entities strongly encouraged [6] |
| NCA CCC-2:2024 | In-scope cloud service providers and in-scope cloud tenants; duties apply to both, and are not transferred to the host [7] |
| CST cloud framework | Cloud-service provisioning and provider-registration framework, in force 10 Oct 2023; service and provider applicability must be established case by case — no blanket healthcare-SaaS residency rule is established by the retrieved documents [4] |
| SFDA MDS-G027 | Distinguishes purely administrative HIT (scheduling, admission, billing processing, secure messaging; store/transfer/format/display-only systems) from software intended to analyze or interpret medical information for diagnosis, treatment, mitigation, cure or prevention — the latter is regulated. Actual functions, technical specifications, intended purpose and outputs decide; a module may be regulated individually within a mixed product [3] |
| DGA | Government entities and private developers/operators of digital-government activities; public-sector supply flows through Ministry of Finance tender rules and ICT framework agreements [5] |

**Institutional roles (verified):** CHI provides regulatory oversight; insurers are payers; TPAs administer claims; NPHIES validates and exchanges non-adjudicated transactions. Neither CHI nor NPHIES should be described as the payer [1][16].

**The one boundary that matters most for product and marketing:** MDS-G027's own examples place a "voice scribe system that transcribes clinician-patient interactions **and generates diagnostic suggestions**" on the regulated side, and billing-processing/administrative documentation on the non-regulated side [3]. Any feature that moves from recording and formatting into clinical suggestion, dosing or differential reasoning changes the classification analysis. This aligns with the technical assessment, which already requires disabling that agent prose on safety grounds.

---

## 5. Buyers and procurement (qualified)

Segments observed in sources: large private hospital groups and modernizing facilities (for example TrakCare/IntelliCare go-lives and agreements); MOH clusters and public providers, which the IG says are joining NPHIES as the public system transforms; private clinics and polyclinics, including small-facility price points evidenced by Waseel's published tiers; and insurers/TPAs as secondary or indirect buyers. Each segment's purchasing route is not established by the retrieved sources, and the earlier claim that public software procurement runs universally through NUPCO is withdrawn.

**Procurement requirements reported by buyers** (commercial research, not primary official documents): NPHIES integration, PDPL compliance, NCA controls, bilingual clinical workflows, local delivery capacity and measurable post-live value; government supply additionally involves Finance tender rules and ICT framework agreements [5]. Saudization and localization preferences are policy context, not verified contract terms for this product category.

---

## 6. Competitive landscape — verified

The first draft asserted that no competitor connects documentation, submission and adjudication, that the position was "underserved," and that a 12–24 month window existed. Those claims are **withdrawn**: they were inferences from an incomplete vendor set, and missing public evidence is not evidence of absence. No market-entry timing window is estimated anywhere in the verified evidence.

**Substantive comparators found and now included** (each cited in `saudi-competitors-research.md`):
- **Glance Care** — Saudi-developed; SOAP Builder turns notes into SOAP templates; Quick Coder (Moramiz AI) codes clinical notes in ICD-10-AM; its own article recommends pre-audit engines before submission tying codes to documentation and CHI standards, and describes embedded audit trails. Caveat: vendor positioning, and its FAQ describes English-based documentation standards. It directly contradicts the withdrawn claim.
- **Santechture** — "4 million+ rules … ensuring every claim is compliant and accurate before it leaves your facility", encounter to final settlement; Thynk offers pre-submission rules-based validation with eligibility and medical-necessity checks; Verity offers AI CDI and coding with coder/CDI task lists and explicit SBS/ICD-10-AM/ACHI localisation. Rule counts and outcomes remain vendor claims.
- **Solventum** — Saudi Codefinder (ICD-10-AM/ACHI, SBS) and Saudi 360 Encompass (coding, CDI, audit, worklists), plus a global Revenue Integrity Prebill Review product that flags high-risk claims before submission. A Saudi prebill deployment was **not** established; the global factsheet and Saudi brochures must be read separately.
- **Nano Health** — encounter-to-record-to-code-to-claim platform; NANO AI CDI 360 documentation validation and gap detection; DoctorSense Arabic/English conversational notes; Riyadh address and vendor-reported Saudi regulatory activity, not independently validated adoptions.
- **Waseel** — its OTD engine performs real-time validation against insurers' medical policies with automated service validation and smart rule checks, so it is directly relevant to claim integrity rather than transport only. Published tiers Basic 1,499 SAR (≤500 transactions) and Premium 1,999 SAR (≤1,500 transactions) carry **no stated billing period**; the earlier "per month" reading and any monthly-USD conversion are unsupported.

**Other corrections carried into the competitor report:** Oracle's "planned" label applies only to a subset of functions (draft prior authorisations, proactive denial management, charge capture/validation) while documentation drafting and context-based coding suggestions are advertised in the present tense — so "Oracle has shipped nothing relevant to claims" is retracted; Lean, Selat, TachyHealth, Elm, OASIS and Clinicy are re-scoped to their actual retrieved evidence instead of being classed as aggregate-only, services-only or technology-free; InterSystems evidence is limited to the TrakCare upgrade releases and the signed IntelliCare transition agreement (not a go-live); Dedalus→ENTOMO is confined to the primary transfer notice; Sahl AI is recast as Saudi pilot evidence rather than market leader; and the secondary regional aggregates (hospital counts, vendor-consolidation counts, spend projections) are removed as market facts.

**Status of the comparison set:** the report's matrix uses "unresolved" to mean the reviewed evidence does not answer the question — explicitly **not** "not offered". Advertising is separated from confirmed implementation throughout, and each player carries a stated principal diligence gap (named Saudi references, rule-set validation, licensed module boundaries, evidence/provenance export behaviour, and comparable contract terms with period).

---

## 7. What the global evidence supports (and what it does not)

Each vendor profile in `global-west-research.md` now separates peer-reviewed trials, independently conducted or commissioned evaluations, system announcements, and vendor claims. Verified corrections that change how the evidence should be used:

- **Trial endpoints are narrower than headline claims.** Reported time-in-note effects come with late registration, English-only settings, unmeasured in-platform editing time and practitioner-entered/coder-reviewed compliance endpoints. Time savings are modest and contested; the "money comes from coding, not time" framing is a hypothesis to measure locally, not a transferable result.
- **Coding-compliance improvement is a documentation-alignment endpoint, not autonomous coding, revenue or Saudi reimbursement.**
- **Quality scores were produced with an LLM judge on unedited notes**, with the citation domain excluded; the number-needed-to-treat figure is model-derived. Drift-window descriptions conflict within the source.
- **Linked Evidence** is a stated product principle; it is neither entailment proof nor an RCT-validated mechanism. It supports the *direction* of the product's evidence-chain design, nothing stronger.
- **Autonomous coding cannot be authorized by model confidence alone**, and adding coding AI is not "no new AI risk." The project's own boundary stands: clinical facts and codes from deterministic graph queries; the LLM for formatting and prose; human review retained.
- **No universal human-sign-off requirement** could be derived from the sources, and the earlier claim that sign-off is globally non-negotiable is removed.

**Useful, evidence-backed patterns worth adapting:** mapping a documentation change to a coded outcome and measuring both; instrumenting utilization rate rather than assuming benefit; deployment governance and staged rollout with per-setting workflow analysis (an independent evaluation found an adult-social-care setting ended early for implementation reasons); and publishing evaluation results including failures as a credibility strategy in a compliance-sensitive market.

---

## 8. Hosting, models and regional ecosystem

Corrections that must carry into any architecture or marketing statement:

- **Cloud availability:** primary provider documentation supports specific Oracle Jeddah/Riyadh region entries and Google's Dammam access path; Amazon's Saudi region target (December 2026) and Microsoft's announced November 2026 availability remain **announcements at the cutoff, not operational regions**. Removing aggregator-derived counts, exact region totals, GPU-catalogue claims and a single-provider GPU exclusivity claim. Provider wording must be checked against the dated launch text, and region availability must not be confused with service-SKU or compliance availability.
- **Arabic model benchmarks:** the reported figures bind to specific checkpoints (ALLaM-7B-Instruct-preview, Fanar-1-9B-Instruct, Falcon3-7B-Instruct), a specific paper version and table, and separate Task-1 answer accuracy from Task-2 BERTScore. They do not extend to ALLaM 34B, later Fanar releases or Jais, and they do not establish a clinical-safety threshold. **No universal "no clinical validation anywhere" claim is made**; the verified statement is narrower — no such validation was found for those specific models in the sources examined.
- **Sahl AI sample corrected:** feasibility assessments in a simulated/control setting (64) and a real-world new-patient deployment (55 consultations: 40 Arabic, 15 English) are distinct; they must not be merged into a single encounter count. The modified PDQI-9 domains were not formally validated, and perceived time savings are not measured causal outcomes.
- **Institutional deployments:** Note Buddy's rollout is a progressive SingHealth rollout beginning September 2024, not universal national adoption; national platform availability is not product adoption. PEACH's figures and approvals are hospital-reported. Prudential's claims work is company-reported proof-of-concept plus a selected-claims comparison rollout, not established industrial outcomes. Ping An's accident/health automation is kept separate from auto-insurance expense-ratio movements, and iFLYTEK/Yidu procurement and efficiency figures are secondary diligence leads, not audited ROI.
- **Architecture implication for a Saudi deployment:** local residency and sectoral obligations must be assessed per component (storage, backup, logs, support access, subprocessors, any external model call) rather than assumed from a product label. No architecture is approved by these reports.

---

## 9. Positioning — hypotheses, not conclusions

**Withdrawn:** "nobody combines documentation AI, NPHIES-shaped claim-integrity reasoning and in-Kingdom hosting," and the derived differentiation thesis. It was an argument from absence; the completed competitor review found substantive advertised overlap (Glance, Santechture, Solventum, Nano Health) and no timing window can be estimated from the evidence.

**Testable hypotheses for the pilot:**

1. H1 — For a defined provider cohort, a documentation-linked necessity check identifies a materially higher share of clinical-justification rejections than the provider's current pre-submission process, at a measured precision.
2. H2 — Coder remediation time per corrected claim falls without increasing documentation burden on clinicians.
3. H3 — The evidence chain (claim → coded item → patient fact → rule → source) is usable by coders and auditors in practice, measured by whether reviewers accept findings without escalation.
4. H4 — Buyers will pay for the integrity layer at or above the incumbent RCM price anchor for the equivalent transaction volume.

**Audience framing that stays inside the evidence:** for a CFO/RCM lead, claim defects surfaced before submission with visible sources; for a coding lead, NPHIES-shaped outputs and audit-ready provenance for the 1 January 2027 external-audit obligation; for a CMO, the clinician authors and confirms, and the system does not recommend diagnosis or treatment; for a CISO/DPO, in-Kingdom hosting options and a documented DPIA — stated as design intent and outstanding work, not as achieved compliance.

**Claims to avoid entirely:** zero hallucination, zero liability, production-ready, sandbox-certified, PDPL-compliant, NPHIES-certified, "no competitor does this," and any realized-savings figure.

---

## 10. Market-to-engineering implications

| Market/buyer requirement | Prototype gap (technical assessment) | Priority |
|---|---|---|
| Evidence chain usable by coders and auditors | Provenance must verify claims, not decorate them (AI findings on Q&A/narrative grounding) | P0 |
| NPHIES-shaped outputs and rejection taxonomy | NPHIES engine is stub with unverified profiles; profile URLs are placeholders | P0 before any integration claim |
| Audit-ready by Jan 2027 | Coder queue is in-memory and loses state on restart | P0 |
| DRG pathway participation | CHI-licensed groupers are a distinct vendor category — integration, not competition | P1 |
| Bilingual Arabic/English workflow | Hardcoded English strings in encounter panes; Arabic retrieval stubbed | P1 |
| Deployment and residency posture | Incomplete deployment topology; configuration drift | P1 for a pilot bid |
| Measured outcome, not estimates | Fixed SAR estimate in the claim simulator; needs hospital-specific values | P1 — pilot design input |

---

## 11. Pilot design and economics (to be measured, not asserted)

**Phase 0 (now → Oct 2026):** complete the technical Phase 1 gate; prepare a truthful demonstration set; document the deployment/residency analysis per component. No external compliance or integration claims before evidence exists.

**Phase 1 — shadow evaluation (Q4 2026 → Q1 2027):** one design-partner provider; de-identified historical claims; pre-specified flag precision/recall and false-positive rate against adjudication outcomes; separate denominators for requests, items, claims and payments; publication of the result including failure modes. The 1 January 2027 external-audit obligation is a legitimate reason for a provider to run this evaluation; it is not evidence that the product satisfies it.

**Phase 2 — paid pilot (H1 2027):** persistent coder workflow, integration posture established, residency analysis completed and implemented, measured baselines before any value statement.

**Phase 3 (H2 2027 → 2028):** DRG-pathway integration and payer-side analytics, contingent on Phase 1 results.

**Economics:** value must be derived from the design partner's own submitted/paid/rejected values and per-unit denominators. The Waseel published tiers (1,499 and 1,999 SAR, period unspecified) are the only pricing evidence in the source set and serve as a price anchor of unknown periodicity, not a validated market rate. Foreign per-provider revenue figures are vendor- or context-specific and must not be presented as Saudi economics.

---

## 12. KPIs and falsification criteria

Primary: flag precision and recall against adjudication outcomes; false-positive rate; rejection-mix movement by reason, payer and code pair; coder throughput per corrected claim; evidence-chain acceptance without escalation.
Secondary: documentation completeness; notes open beyond filing windows; utilization rate of the documentation workflow (benefits scale with utilization in the published evaluations, which must be measured, not assumed).
Platform: p95 latency; audit-event coverage and hash-chain verification; data-subject-request completion; PHI egress violations (zero).

**Falsifiers to pre-register:** if clinical-justification rejections are not separable from coverage/contract decisions in the data, or if measured precision is low, or if coder throughput does not move, the integrity-layer hypothesis fails for that cohort and the pilot should say so explicitly.

---

## 13. Risks

| Risk | Basis | Mitigation |
|---|---|---|
| Competitive position stronger than assumed | Glance and Santechture primary pages already contradict the first draft's core claim | Complete the competitor verification before any positioning statement |
| Regulatory classification shifts toward medical device | MDS-G027 treats diagnostic-suggestion scribes as regulated; the prototype contains clinical-reasoning surfaces | Keep those features disabled and out of marketing; document intended purpose and module separation |
| Residency/transfer assumptions do not survive scrutiny | PDPL transfer is conditional; sectoral and contract conditions apply separately | Per-component legal analysis before architecture commitment |
| Measurement gap: no local evidence of benefit | Only foreign, often vendor-reported outcomes exist | Shadow evaluation with pre-registered endpoints first |
| Product credibility gap | Technical assessment: 35 findings; demo/real-use boundary | Phase 1 gate before any external demonstration |
| Payer/Buyer confusion | CHI is regulator, insurers are payers, NPHIES is not the payer | Correct institutional framing in all materials |

---

## 14. Decision status

| Gate | Status |
|---|---|
| Specialist demonstration (synthetic, narrowed) | GO after the technical Phase 1 gate |
| Shadow evaluation with a design partner (de-identified claims) | GO — pre-registered endpoints required |
| Paid operational pilot | Pending: persistent workflow, residency analysis, measured precision, privacy work |
| Real-patient ambient or clinical decision support | NO-GO |

The market case is a set of testable hypotheses with dated demand drivers. It is not a validated opportunity, and no timing advantage should be asserted until the competitor verification completes.

---

## 15. Verification status and remaining gaps

| Report | Verification | Artifacts | Notable residual gaps |
|---|---|---|---|
| `saudi-regulatory-research.md` | Corrected; evidence gate exit 0 | `verification/regulatory/CHANGELOG.md`, `ledger.json`, normalized sources | SFDA classification of actual modules; adequacy/accreditation mechanism status; CST applicability to a healthcare SaaS provider; NPHIES vendor-certification process documentation |
| `global-west-research.md` | Corrected; evidence gate exit 0 | `verification/west/CHANGELOG.md`, `quotes.md`, `report-changes.diff` | Trial supplements/disclosures (PMC fetches returned 403 and were not re-fetched); KLAS commissioning and metric selection (login-gated); no independent RCM outcome validation |
| `global-east-ecosystem-research.md` | Corrected; evidence gate exit 0 | `verification/east/CHANGELOG.md`, `evidence-quotes.md`, `claim-checks.json` | No purchaser-level capacity/API verification; HUMAIN GPU details unresolved; no exhaustive model-validation inventory (no absence claim made) |
| `saudi-competitors-research.md` | Corrected; evidence gate exit 0 | `verification/competitors/CHANGELOG.md`, `verification-results.txt`, `evidence-quotes.md`, `ledger.json` | Named Saudi references for the added comparators; rule-set composition and validation; Saudi availability of Solventum's prebill product; licensing boundaries and code-set support; contract pricing and periodicity; regulator-register verification of vendor certification |
| This summary | Rewritten against all four completed verifications | — | Residual gaps above; no external use until they are closed |

**Interpretation limits that apply throughout:** literal-quote verification confirms that a quoted passage exists in the saved source text. It does not confirm the source's own accuracy, establish entitlement to rely on it, or convert research into legal, regulatory, clinical or commercial advice. Vendor and company-reported figures remain labeled as such and cannot be promoted to established outcomes in any derived material.
