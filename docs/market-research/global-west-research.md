# Global West Innovation Research: Clinical Documentation-to-Revenue (US/Europe)

**Prepared for:** Veritas-Medica innovation-transfer recommendations  
**Evidence cutoff:** 11 September 2026  
**Verification:** Cached source extracts in `global-west-evidence/`, supplemented by `verification/west/`. The two earlier PMC fetches in the verification directory are 403 error bodies, not evidence; RCT details below were checked against cached article text (`page-18.txt` and `page-14.txt`). Some cached paragraphs are truncated, and supplements/disclosures were not fully available.

**Evidence labels:** Peer-reviewed randomized trial; peer-reviewed implementation perspective; health-system news summary; commissioned evaluation; vendor case study/press release; trade-press reporting. Peer review does not establish independence, and a third-party publisher does not convert customer/vendor claims into an independent causal evaluation.

## 1. Executive Summary

- **Prioritize reviewed evidence and evaluation, not autonomous coding.** VM's project constraint is that clinical facts, codes and necessity decisions come from deterministic Neo4j logic and reviewed inputs; the LLM formats only.
This report recommends design patterns, not changes to that boundary.
- **RCT benefits are outcome- and product-specific.** In the UCLA trial, Nabla reduced measured time-in-note versus control; DAX did not.[18][14]
In the UW trial, work exhaustion/interpersonal disengagement improved, but professional fulfillment did not meet the prespecified significance threshold.[18][14]
- **Billing compliance is not revenue or coding autonomy.** UW practitioners entered their own codes, reviewed by professional coders; the improved documentation/code-alignment score does not establish autonomous coding accuracy, claim acceptance, or ROI.[14]
- **Traceability is useful but not entailment.** Abridge describes draft documentation linked to source conversations. A source link does not prove that the statement follows from the source, that the transcript is correct, or that a code is justified.[19]
The UW RCT did not isolate or validate Linked Evidence as a feature.[19][14]
- **Saudi transfer requires local validation.** NPHIES serves providers and insurance companies; it is not itself a payer. CHI must not be described as the dominant payer or Saudi Arabia as a single-payer NPHIES environment.[22]
US CPT/E/M revenue effects are not automatically transferable to Saudi reimbursement.

## 2. Controlled Evidence and Evaluation Caveats

### 2.1 UCLA: DAX Copilot versus Nabla versus usual care (Lukac et al., NEJM AI)

**Design.** 238 outpatient physicians across 14 specialties at one academic institution; covariate-constrained 1:1:1 randomization to DAX (79), Nabla (79), or control (80).[18]
The intervention ran November 4, 2024–January 3, 2025 and was restricted to English-only visits.[18]
DAX version 2.0 and Nabla version 1.5 were tested, not every subsequent Dragon Copilot or Nabla release.[18]

**Analysis.** Intention-to-treat mixed-effects analysis of log time-in-note; the primary comparison used the second intervention month after a learning period against the preceding six-month baseline.[18]
The primary comparisons used alpha 0.025.[18]
Registration was submitted after the trial began and published after completion; this was not a prospectively registered trial.[18]

**Primary outcome.** Nabla: −9.5% versus control (95% CI −17.2% to −1.8%; P=0.02).[18]
DAX: −1.7% (95% CI −9.4% to +5.9%; P=0.66).[18]
The reported 41-second Nabla reduction is a within-group change, not the incremental saving versus control.[18]
DAX and Nabla were used in 33.5% and 29.5% of eligible visits, respectively; approximately 15% of assigned physicians never used their scribe.[18]

**Secondary outcomes and safety.** Mini-Z composite estimates favored both products.[18]
Secondary outcomes were reported as estimates and confidence intervals without hypothesis testing; Nabla's PFI work-exhaustion interval (−0.46 to +0.01) and task-load interval (−63.79 to +0.42) included no effect.[18]
It is therefore inappropriate to say both products conclusively reduced burnout.[18]
One reported omission of extensive counseling was adjudicated grade 1 (mild).[18]
Inaccuracy frequency came from clinician surveys, not an adjudicated error rate across all notes.[18]
These data do not establish safety equivalence.[18]

**Measurement limitations.** Epic Signal omitted editing time inside the vendor platforms, potentially overstating time savings.[18]
No differences were observed in time on unscheduled days or outside scheduled hours.[18]
Short duration, single-center recruitment, English-only encounters and incomplete survey response constrain generalizability; no Saudi effectiveness or billing-compliance result follows from this study.[18]

### 2.2 UW Health: stepped-wedge Abridge trial (NEJM AI)

**Design.** A 24-week, individually randomized stepped-wedge trial across Wisconsin and Illinois ambulatory clinics: 66 physicians/advanced practice practitioners, three sequences transitioning at six-week intervals.[14]
The reported study dates are August 21, 2024–March 27, 2025.[14]
Mixed-effects intention-to-treat models adjusted for time and specialty.[14]
There were 71,487 notes, including 27,092 ambient-generated notes; the reported 71% utilization is a note-weighted practitioner utilization measure, not the fraction of all study-period notes.[14]

**Coprimary outcomes.** Work exhaustion/interpersonal disengagement decreased by 0.44 points on a five-point scale (95% CI −0.62 to −0.25; P<0.001).[14]
Professional fulfillment increased by 0.14 (95% CI 0.004 to 0.28; P=0.04), not significant at the prespecified alpha 0.025.[14]
The article's NNT 1.68 was model-derived using dichotomized thresholds and an adjusted logistic model; it is not an independently replicated clinical-event NNT or a simple inverse of the raw before/after proportions.[14]

**Time outcomes.** Note time decreased by 0.36 hours per normalized eight-hour workday (95% CI −0.55 to −0.17), robust to the reported sensitivity analysis.[14]
Work outside work decreased by 0.50 hours initially, but after excluding the top 3% of observations the estimate was −0.19 hours (95% CI −0.40 to +0.03), no longer significant.[14]
Do not market the initial estimate as a reliable after-hours saving for all practitioners.[14]

**Coding endpoint.** In a stratified sample of 6,110 notes balanced by practitioner and note type, ambient notes scored 6.87 versus 5.94 on a 0–10 ICD-10 documentation-compliance rubric (P<0.001).[14]
Practitioners entered codes and certified health-system coders assessed their alignment with documentation.[14]
This secondary, note-type comparison is not a randomized test of autonomous code assignment and does not measure reimbursement, denial reduction, CPT/E/M uplift, or Saudi coding accuracy.[14]

**Note quality and monitoring.** An LLM-as-judge implementation, described as previously validated against physician ratings, scored 7,966 unedited ambient notes against transcripts; domain means ranged from 3.97 to 4.99.[14]
Accuracy averaged 4.44/5, not 100% factual correctness.[14]
The citation domain was excluded.[14]
This is not clinician adjudication of every note, a comparison with independently scored human notes, or an evaluation of Linked Evidence.[14]

The results report no drift events in 15 rolling one-month windows, whereas the discussion describes two-week rolling efficiency monitoring.[14]
Preserve this inconsistency rather than prescribing a supposedly validated monitoring cadence.[14]
These operational metrics do not exclude semantic errors or all software drift.[14]

**Caveats.** Volunteer early adopters, predominantly white and female, with family medicine heavily represented; open-label self-reports permit expectancy effects.[14]
English was preferred in 98.1% of encounters.[14]
The study recorded 99.92% recording consent and no recording-related complaints, but did not collect patient-reported comfort/disclosure outcomes.[14]
Neither those observations nor the quality rubric establish broad patient safety or consent-policy equivalence in Saudi Arabia.[14]

### 2.3 GOSH-led London TORTUS evaluation

A GOSH news summary describes an NHS England-sponsored evaluation across nine sites and over 17,000 encounters.[11]
It reports 23.5% more direct patient interaction time and 8.2% shorter appointments when scribes were used.[11]
This source is a health-system announcement, not the full protocol or an independently verified randomized trial.[11]
Denominators, allocation and uncertainty for each outcome need the underlying evaluation; national economic projections are modeled capacity, not realized savings, and are not carried into VM's ROI assumptions.[11]

### 2.4 Kent and Medway TORTUS pilot

Health Innovation KSS and TORTUS commissioned Unity Insights to evaluate seven sites across four settings.[12]
The commissioning relationship must remain visible even though the evaluator is described as independent.[12]
Primary care reported uptake and perceived time benefits; adult social care sites ended early after failing to realize expected benefits.[12]
Implementation barriers were reported, but this observational summary cannot isolate implementation from technology as the cause.[12]

### 2.5 Observational financial evidence

Suki's KLAS report covers FMOL, McLeod and Rush and describes documentation and E/M improvements.[26][23]
The public KLAS page dates the report January 22, 2026, but the full dataset requires login.[26][23]
Trade coverage supplies financial figures and customer statements, not a controlled causal estimate; reported after-hours reductions are also inconsistent within that coverage (a general 35–65% claim versus 4% at Rush).[26][23]
Do not aggregate or use these figures as a Saudi ROI forecast.[26][23]

The previous report's claim that the KLAS work was vendor-commissioned and that Suki selected metrics cannot be fully checked from the accessible report landing page; funding, metric selection, baselines and independence remain unresolved.[26]
It must not be promoted as independently proven causality.[26]

Nabla's Mankato page describes a before/after comparison restricted to continuous twelve-month users.[24][25]
Heidi's CND OHT results are published on Heidi's own site and describe a three-month evaluation.[24][25]
Both are vendor-hosted observational/customer reports, not independent RCTs; self-selection, secular change and survey response can affect apparent gains.[24][25]

The UCSF retrospective study previously quoted only through trade coverage remains a primary-paper verification gap. Its revenue estimate is removed rather than treated as an established causal result.

## 3. Innovation Profiles

Profiles retain useful workflow patterns, not market-share rankings. Adoption, valuation, ROI and revenue projections without auditable methods are omitted.

### 3.1 Microsoft Dragon Copilot

Microsoft's launch describes a unified dictation/ambient documentation assistant and grounded responses with citations; this is vendor product information.[2]
The UCLA evidence concerns DAX Copilot 2.0 and does not establish effectiveness of the later unified product.[18]

**VM relevance (recommendation):** A unified review surface for notes and supporting documentation. Any LLM-rendered output must preserve reviewed facts and deterministic codes; citations alone cannot guarantee factuality. Arabic speech availability is not Saudi clinical validation.

### 3.2 Abridge

Abridge describes Linked Evidence as tracing draft clinical documentation to the source conversation.[19]
Trade coverage reports an Availity prior-authorization collaboration as a company announcement, not evidence of realized authorization improvement.[3]
The UW RCT is reviewed in Section 2.2.[14]

**VM relevance (recommendation):** Link reviewed statements to source spans, with separate checks for negation, temporality, subject attribution and whether the evidence actually supports the statement. Link those reviewed facts to versioned graph rules. Do not treat transcript provenance as code justification or the RCT as validation of this UI feature.

### 3.3 Ambience Healthcare

Cleveland Clinic's announcement describes documentation, CDI and point-of-care coding, and requires providers to read the entire note, correct it and sign it.[4]
A peer-reviewed implementation perspective reports onboarding over 4,000 ambulatory clinicians in four months through governance, training/onboarding, support and real-time learning. It describes a vendor–health-system partnership, not a randomized efficacy comparison or an independent safety audit.[5]

**VM relevance (recommendation):** Adopt the governance/training/support/feedback structure. Full-note review is a documented local policy, not a universal legal standard inferred for every vendor or country.

### 3.4 Suki

The public KLAS report describes Suki as supporting clinical note creation and coding in ambulatory EHR workflows at FMOL, McLeod and Rush.[26][23]
It reports operational and financial improvements; the full dataset and methods require authorized access.[26]
Trade reporting attributes some gains to US E/M coding shifts.[23]

**VM relevance (recommendation):** Measure documentation completeness and independently adjudicated code correctness, not an upward coding shift as a success target. Treat vendor/commissioning relationships as unresolved until disclosed; do not call the evidence an independently proven financial effect. No direct Saudi CPT/E/M reimbursement transfer is established.

### 3.5 Nabla

Nabla participated in the UCLA randomized comparison, where its tested version reduced measured time-in-note versus usual care.[18]
Its Mankato customer page describes a twelve-month before/after study selected for continuous use; this is vendor-hosted observational evidence, not a second independent controlled trial.[24]

**VM relevance (recommendation):** Publish neutral evaluations including failures and uncertainty. Evaluate changes against a predefined baseline, retain nonusers in intention-to-treat analyses where appropriate, and measure review burden outside the main UI.

### 3.6 Heidi Health

Heidi's CND OHT page describes ambient transcription and note generation and a three-month evaluation involving 169 clinicians.[25]
Reported presence, burnout and editing outcomes appear in a vendor-hosted customer announcement, without enough accessible detail to establish independent causal effects.[25]

**VM relevance (recommendation):** Assess configurable documentation workflows and clinician-facing evidence reminders, but do not imply that international procurement proves Saudi approval, clinical safety, or equivalence to Saudi financing. Cross-country adoption and ROI totals from the previous draft are not retained as verified facts.

### 3.7 TORTUS

The GOSH summary describes consultation transcription and draft clinical notes for clinician review.[11]
The Kent and Medway commissioned evaluation supplies both perceived benefits and an early-stop example in adult social care.[12]

**VM relevance (recommendation):** Multi-setting pilots with predeclared outcomes, consent/privacy assessment and published negative findings. An NHS-sponsored evaluation is a useful process example, not a single-payer analogy or government validation of every product claim.

### 3.8 CodaMetrix

A CodaMetrix press release describes autonomous high-volume coding and auditability, and announces a Best in KLAS award.[21]
The source is vendor PR, not the underlying independent KLAS dataset and not a clinical-accuracy certification.[21]

Healthcare IT News quotes OHSU's revenue-cycle director reporting lower coding-related denial rates for autonomously coded radiology cases (0.33% versus 1.09% manual).[20]
This is a customer-reported observational operational comparison: easier cases may be selected for automation while harder cases go to humans.[20]
It cannot establish a causal reduction, equivalent case mix, or Saudi performance.[20]

**VM relevance (recommendation):** Audit trails, explicit exclusion criteria and a remediation queue. **Do not adopt confidence-only auto-coding:** model confidence is not evidence, and the project LLM must not assign or modify codes. Deterministic graph checks should return supported, contradicted or insufficient-evidence states, with unresolved cases routed to authorized reviewers. Simulation does not validate production autonomy.

### 3.9 AKASA

AKASA's Montage case study describes prior-authorization status checking and reports reduced queue volume; its Cleveland Clinic announcement concerns coding/CDI deployment.[7][8]
These are vendor case-study/PR sources, not independently controlled effectiveness studies.[7][8]

**VM relevance (recommendation):** After the reviewed claims core is validated, consider authorized status tracking with transaction-level audit logs, retries, idempotency and human escalation. NPHIES integration specifications, permissions and actual provider needs must be established rather than assuming US payer-portal behavior applies.

### 3.10 Waystar

Waystar's AltitudeAI announcement describes denial-prevention and reimbursement-recovery tools, including generative appeal preparation.[9]
Its early-adopter results are vendor claims without sufficient cohort and counterfactual detail for a verified effect estimate.[9]

**VM relevance (recommendation):** Organize rejection reasons and reviewed evidence before submission. Separate statistical denial prediction from deterministic rule checking: neither is a guarantee of payment or medical necessity. Appeal rendering may format approved facts, codes and citations only; submission remains an authorized workflow.

### 3.11 SmarterDx

SmarterDx's press release describes pre-bill record review and denial support.[10]
Its revenue and ROI statements are vendor assertions rather than independently verified estimates in the reviewed evidence.[10]

**VM relevance (recommendation):** A pre-bill review checkpoint is a useful insertion point. Do not infer new diagnoses from narrative using the formatting LLM; surface missing or conflicting evidence for clinical/coder review. No revenue-capture target should reward unsupported coding.

## 4. Cross-Cutting Conclusions

- **Evidence is endpoint-specific.** A randomized reduction in note time does not validate clinical safety, revenue effects, a tracing feature, or coding autonomy.[18][14][5]
Implementation perspectives and customer case studies answer different questions from randomized trials.[18][14][5]
- **Review is a local workflow requirement and a VM design safeguard.** Cleveland Clinic documents full review before signing; this does not establish universal vendor behavior or a universal legal rule.[4]
- **Traceability and correctness are separate.** Abridge's provenance feature is a useful design reference, not an entailment proof.[19]
- **Implementation and product behavior both need evaluation.** The Kent and Medway summary documents barriers and setting variability but cannot rank technology versus implementation as causal drivers.[12]
- **Recommendation:** Retain immutable source versions, reviewer decisions, rule versions and generated-output diffs. A formatting-only LLM can still introduce omissions, altered negation, wrong subject attribution or unsupported text; deterministic code selection also has rule-maintenance and input-quality risks.

## 5. Transferability to Saudi Arabia

**Analysis and proposed requirements, not evidence of local deployment.**

- **Institutional roles:** CHI is not a dominant payer; NPHIES is an exchange infrastructure used by providers and insurers, not a single-payer health system.[22][18][14]
The official page explicitly addresses healthcare providers and health insurance companies.[22]
Do not infer a complete current division of regulatory powers from this historical onboarding page; current CHI/Insurance Authority responsibilities need authoritative confirmation before deployment.
- **Coding and payment:** Do not automatically map US CPT/E/M, ICD-10 billing alignment or wRVUs to Saudi coding and reimbursement. Validate the applicable Saudi code systems, versions, service-setting requirements, NPHIES profiles and payer contracts with authorized coding specialists.[22][18][14]
No universal CPT/ICD-10-AM combination is asserted here.
- **Language:** No Saudi-dialect or Arabic/English clinical validation was established in this review.[22][18][14]
UCLA restricted use to English visits, and UW encounters were predominantly English; multilingual marketing is not a substitute for local testing.[18][14]
- **Necessity versus rejection:** A rejection code identifies a transaction outcome, not a complete executable medical-necessity rule. Encode only sourced, applicable and versioned rules; missing policy must produce an unresolved state, not an invented denial prediction.
- **Privacy and consent:** Foreign consent percentages and product privacy statements do not establish PDPL compliance, permissible international transfer or required hosting arrangements.[22][18][14]
Obtain a Saudi-specific privacy/security assessment, lawful recording process, access controls and retention policy before collecting audio.
- **Evaluation:** A provider-led, independently adjudicated local pilot is preferable to assuming NHS or US results transfer.[22][18][14]
Any CHI/MOH participation is a proposed engagement, not an endorsement already secured.[22][18][14]

## 6. Incorporation Priorities for Veritas-Medica

**All actions below are recommendations under the project's fixed boundary: reviewed inputs and deterministic Neo4j clinical facts/codes; LLM formatting only.** Priority reflects readiness and risk, not claimed product superiority.

| Priority | Capability | Evidence and limits | Concrete acceptance gate |
|---|---|---|---|
| **P0** | Reviewed evidence and rule provenance | RCTs document residual errors; provenance feature evidence is vendor-described, not feature-level efficacy.[18][14][19] | Every clinical statement/code has a reviewed source and applicable rule version; test contradiction, negation, missing evidence and wrong-patient attribution. Unsupported content cannot pass. |
| **P0** | Independent evaluation harness | RCT methods support controlled measurement, not automatic local effectiveness.[18][14] | Prespecify outcomes; use blinded clinician/coder adjudication where feasible; report uncertainty, nonuse, external editing time, false passes and false blocks by specialty/language. |
| **P0** | Deterministic simulation and remediation | OHSU is observational evidence, not an autonomy threshold validation.[20] | Keep code decisions in Neo4j; route insufficient/conflicting evidence to reviewers. No model-confidence-only auto-pass, code creation or live submission. |
| **P1** | Deployment governance and reviewed SOAP formatting | Cleveland's perspective supplies a process example, not a causal efficacy result.[5] | Owners for rules, clinical review, security and incidents; output-fidelity regression tests; traceable reviewer approval and rollback. |
| **P1** | Local coding/claims measurement | US E/M and UW coding results have jurisdiction and endpoint limits.[23][14] | Verify local mappings/contracts; assess correct coding and actual adjudication, review effort and cost. Do not target higher code levels. |
| **P2** | Optional ambient input pilot | RCT support is English-dominant and setting-specific.[18][14] | Validate Arabic/bilingual transcription, consent and privacy separately; extracted content remains untrusted until reviewed and cannot directly change graph facts/codes. |
| **P2** | Reviewed appeal formatting | Vendor product evidence only.[9][10] | Format approved facts/codes and approved citations; prohibit invented rationale, inferred diagnoses and autonomous submission. |
| **P3** | Prior-authorization transaction assistance | Vendor case studies only.[7][8] | Verify NPHIES interfaces, authorization, idempotency and auditability; require explicit approval for consequential submissions. |

**Sequencing:** P0 improves assurance but is not risk-free. New evidence links, rule mappings, UI defaults and formatting changes can introduce errors. Ship only after the declared gates are exercised; ambient input and agentic workflows require additional validation and are not implied by the reviewed trials.

## 7. Verification Gaps

- Fresh PMC attempts in `verification/west/PMC12768499.txt` and `PMC12858090.txt` returned 403; usable cached article extracts carry some truncation. Full supplements, disclosures and the UW NNT/drift details warrant primary-material follow-up.
- KLAS full Suki dataset is access-controlled; no credentials were used. Commissioning, metric selection and independence were not confirmed from the public landing page. Vendor-hosted Mankato and Heidi evaluations remain observational.
- The GOSH underlying protocol/economic model, the UCSF primary retrospective paper and independent validation of RCM outcome claims remain gaps.
- No reviewed source establishes Saudi clinical performance, current local code-set applicability, integration certification, reimbursement uplift or regulatory approval of VM.
- The citation ledger and exact-source quotes support source traceability, not automatic sentence-level entailment. Validation results and substantive corrections are recorded under `verification/west/`.

## Sources

[2] https://www.microsoft.com/en-us/microsoft-cloud/blog/healthcare/2025/03/03/meet-microsoft-dragon-copilot-your-new-ai-assistant-for-clinical-workflow — Meet Microsoft Dragon Copilot: Your new AI assistant for clinical workflow | The Microsoft Cloud Blog
[3] https://www.healthcarefinancenews.com/news/abridge-and-availity-partner-real-time-prior-authorization — Abridge and Availity partner for real-time prior authorization | Healthcare Finance News
[4] https://newsroom.clevelandclinic.org/2025/02/19/cleveland-clinic-announces-the-rollout-of-ambience-healthcares-ai-platform — https://newsroom.clevelandclinic.org/2025/02/19/cleveland-clinic-announces-the-rollout-of-ambience-healthcares-ai-platform
[5] https://www.nature.com/articles/s44401-026-00144-6 — Accelerating ambient AI scribe enterprise-scale deployment: Cleveland Clinicâs novel approach to health system-industry partnership | npj Health Systems
[7] https://akasa.com/case-studies/montage-auth-status — (no title)
[8] https://akasa.com/press/cleveland-clinic-akasa-deepen-ai-partnership — (no title)
[9] https://www.waystar.com/news/waystar-advances-ai-leadership-with-next-generation-denial-prevention-and-reimbursement-recovery-innovations — Waystar Advances AI Leadership with Next-Generation Denial Prevention and Reimbursement Recovery Innovations | Waystar
[10] https://www.prnewswire.com/news-releases/smarterdx-recognized-as-one-of-modern-healthcares-2025-innovators-award-honorees-302428230.html — SmarterDx recognized as one of Modern Healthcare's 2025 Innovators Award Honorees
[11] https://www.gosh.nhs.uk/news/researchgosh-led-trial-of-ai-scribe-technology-shows-transformative-benefits-for-patients-and-clinicians-across-london — GOSH-led trial of AI-scribe technology shows ‘transformative’ benefits for patients and clinicians across London
[12] https://healthinnovation-kss.com/independent-evaluation-of-tortus-ambient-voice-technology-shows-time-savings-and-improved-patient-interaction-for-kent-and-medway — Independent evaluation of TORTUS ambient voice technology shows time savings and improved patient interaction for Kent and Medway
[14] https://pmc.ncbi.nlm.nih.gov/articles/PMC12858090 — A Pragmatic Randomized Controlled Trial of Ambient Artificial Intelligence to Improve Health Practitioner Well-Being
[18] https://pmc.ncbi.nlm.nih.gov/articles/PMC12768499 — Ambient AI Scribes in Clinical Practice: A Randomized Trial
[19] https://abridge.com/blog/building-trusted-healthcare-ai — Abridge General Counsel Tim Hwang on Principles for Building Trusted AI
[20] https://www.healthcareitnews.com/news/autonomous-coding-ai-shows-impressive-results-ohsu — Autonomous coding with AI shows impressive results at OHSU
[21] https://www.prnewswire.com/news-releases/codametrix-named-no-1-in-inaugural-best-in-klas-title-for-autonomous-medical-coding-302678539.html — CodaMetrix Named No. 1 in Inaugural Best in KLAS Title for Autonomous Medical Coding
[22] https://www.chi.gov.sa/en/Uniplat/pages/default3.aspx — Home
[23] https://www.fiercehealthcare.com/ai-and-machine-learning/rush-mcleod-health-and-fmol-health-report-revenue-gains-suki-ai-scribe — KLAS report finds clinical, financial gains from Suki AI scribe
[24] https://nabla.com/mankato-clinic — Mankato Clinic
[25] https://www.heidihealth.com/blog/clinicians-reclaim-over-500-hours-weekly-with-ai-powered-clinical-scribe — Clinicians Reclaim Over 500 Hours Weekly with Heidi
[26] https://klasresearch.com/report/suki-roi-validations-2026-cross-organizational-results-from-suki-s-clinical-intelligence-platform/3869 — Suki ROI Validations 2026


