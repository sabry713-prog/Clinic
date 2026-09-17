# Global & East Ecosystem Research: Health AI in Saudi Arabia, UAE, Singapore, and China (2025–2026)

- **Evidence cutoff / verification date:** 11 September 2026.
- **Prepared for:** Veritas-Medica — a Saudi healthcare prototype with claim-integrity checks, Arabic/English documentation and simulated NPHIES workflows.
- **Purpose:** Separate operational infrastructure, research benchmarks, prospective evaluations, limited rollouts and vendor announcements; identify patterns worth testing, not claim an exhaustive competitive census.
- **Method:** Reused `global-east-evidence/` extracts, then retrieved provider documentation and the full Sahl study. The expected `verification/east/` directory was absent when this retry began; this pass created it. Numbered citations resolve through its task-specific `ledger.json`, with verbatim evidence in `source-*.txt`, retrieval captures and a verification log. Cached extracts containing omissions were not treated as complete papers.
- **Project boundary:** Neo4j-backed facts and deterministic checks remain the authority; the LLM formats supported information. This report does **not** recommend LLM-generated clinical reasoning, diagnosis, autonomous adjudication or live NPHIES integration.

## 0. Summary of Source-Qualified Examples

| Example | Geography | Evidence-supported maturity | What it does not establish |
|---|---|---|---|
| Oracle Jeddah/Riyadh; Google Dammam | Saudi Arabia | Provider-listed regions and documented customer access.[1][9][10] | An exhaustive national region count, particular GPU availability or workload compliance |
| AWS Saudi region; Azure Saudi Arabia East | Saudi Arabia | Provider-announced future availability: December and November 2026, respectively.[3][4] | General availability by the report cutoff |
| HUMAIN ONE | Saudi Arabia | Company-announced enterprise product; HR systems described as live, with inference hosted in Dammam.[18] | Healthcare validation or exclusive access to Saudi GPU inference |
| Sahl AI | Saudi Arabia | Published two-stage documentation study; 55 real-world consultations in its implementation evaluation.[5] | 119 real clinical encounters, national adoption or diagnosis safety |
| Malaffi/ADHDS | UAE | Operator-reported SNOMED CT implementation and Global Reference Site recognition.[16] | Clinical effectiveness of every AI application built on the HIE |
| PureHealth Nada; DoH PHI | UAE | Selected-facility scribe pilot; population-health platform unveiling.[15][21] | Independently demonstrated patient outcomes |
| SingHealth Note Buddy; SGH PEACH | Singapore | Progressive SingHealth rollout; hospital-reported PEACH evaluations.[14][17] | Universal national adoption or transferable Saudi authorization |
| Prudential MedLM | Singapore/Malaysia | Company-reported PoCs and a planned selected-claims comparison rollout.[8] | Established industrial-scale outcome gains |
| Ping An; iFLYTEK; Yidu | China | Company/secondary reports of insurance automation, procurement and hospital-platform activity.[11][12][13] | Comparable causal ROI, Saudi market absence or a single health/auto metric |

## 1. Saudi AI Ecosystem: Hosting and Clinical Evidence

### 1.1 In-Kingdom Cloud Regions: Operational vs. Announced

“Operational” here means provider documentation supports region availability or customer access, not that this project has purchased capacity or completed a deployment test. Infrastructure availability is also not a legal compliance determination.

| Provider | Source-supported status at cutoff | Buyer qualification |
|---|---|---|
| Oracle | OCI's region table lists Saudi Arabia West (Jeddah), `me-jeddah-1`, and Saudi Arabia Central (Riyadh), `me-riyadh-1`; Oracle's Riyadh page describes the existing Jeddah region launched in 2020.[1][10] | Confirm required services, capacity, tenancy, support and recovery architecture; no unsupported exact day of Riyadh launch is asserted. |
| Google Cloud | Dammam `me-central2` has documented purchase/access paths; customers with a KSA billing address must purchase through CNTXT.[9] | The CNTXT rule is customer-location-specific, not a statement that every worldwide customer has the same sales path. |
| AWS | Amazon says its first Saudi infrastructure region is on track for **December 2026**.[3] | Announced future region, not verified live at cutoff; the separate HUMAIN AI Zone commitment is up to 50 MW by 2028.[3] |
| Microsoft Azure | Microsoft's **31 August 2026** release says Saudi Arabia East will be available to customers in **November 2026**.[4] | Use this more specific target rather than the older Q4-only wording; a planned date is not a launch confirmation. |

This is a verified shortlist, **not an exact count of Saudi cloud regions**. The earlier five/six-region totals and aggregator-based Huawei/Alibaba/Tencent availability, national MW totals and DAMAC facility claims have been removed from the decision baseline. Those providers may still merit diligence; omission is not evidence of unavailability.

**Deployment recommendation:** assess Oracle and Google as documented region candidates, then verify the exact inference service, accelerator SKU, quota, contractual data handling, logging, backups, support access and permitted data flows. Do not infer a specific GPU catalogue from region availability, claim HUMAIN is the only Saudi GPU option, or equate domestic hosting with complete PDPL/health-sector compliance. Keep AWS/Azure region deployment conditional on an actual launch and service-level verification.

### 1.2 HUMAIN: Product Evidence vs. Capacity Announcements

HUMAIN's 28 October 2025 company release describes HUMAIN ONE as an enterprise agentic operating system spanning HR, finance, procurement and productivity; it says agent-native HR systems of record are already live and the models powering HUMAIN ONE run on Groq inference infrastructure hosted in Dammam.[18] These are **vendor-reported enterprise capabilities**, not a clinical deployment evaluation.

Amazon separately describes a future AWS–HUMAIN AI Zone capacity commitment of up to 50 MW by 2028.[3] It should not be substituted for evidence of an already purchasable GPU service. The earlier August 2026 MI355X go-live assertion, precise chip/capacity totals and infrastructure exclusivity conclusion are not retained without a directly verified provider service announcement/catalogue.

For Veritas-Medica, HUMAIN is a **candidate for procurement diligence**, not a certified inference host in the reference architecture. Enterprise orchestration may inform workflow design, but it does not authorize autonomous clinical or claims decisions. The unusual HUMAIN Chat subdomain and cookie-dominated HUMAIN IQ capture in the old cache are insufficient to certify product-wide compliance or model performance.

### 1.3 Saudi Clinical Documentation: Sahl AI

The JMIR Medical Informatics study, published 24 March 2026, evaluated a bilingual ambient documentation pipeline in Riyadh First Health Cluster; study activity ran from December 2023 to November 2024.[5]

- **Stage 1 — development/feasibility:** version 1 underwent **64 independent assessments** using role-plays, mock conversations and prerecorded simulated conversations in a controlled setting. Development also involved clinical audio collection, but these feasibility assessments must not be relabelled 64 real patient visits.[5]
- **Stage 2 — implementation:** independent evaluators reviewed **55 new-patient consultations**, comprising **40 predominantly Arabic and 15 English conversations**, at King Saud Medical City family medicine clinics.[5]
- **Quality scores:** mean modified PDQI-9 totals were **42.4/45 for Arabic** and **37.8/40 for English**; the translation-to-English item was not applicable to English consultations. These totals have different denominators and should not be read as a direct language ranking.[5]
- **Physician experience:** a separate convenience survey had **22 respondents** drawn from users; the invitation denominator was not systematically recorded. Reported time/burnout benefits were perceptions, not an objectively timed or controlled causal effect.[5]
- **Instrument limitation:** the substituted “free from hallucination” and “translated accurately to English” domains were **not formally validated**, and the authors caution against comparison with original PDQI-9 benchmarks.[5]

**Interpretation:** this is useful prospective, real-world documentation-evaluation evidence alongside a simulated feasibility stage—not evidence that every Arabic model is clinically safe. Do not add the stages and call the result 119 clinical encounters, label it the only Arabic study, or copy its modified instrument “verbatim” as a validated scale. A project evaluation should separate audio capture, factual fidelity, omissions, unsupported additions, terminology and formatting; use independent review and measure editing/time outcomes directly.

The previous Seha Virtual Hospital/Tawazun AI agent story, numerical targets and claimed regulator signal are removed from the substantiated examples. The narrow secondary account was not corroborated here; neither its alleged rollout nor inferred MOH endorsement is a basis for product decisions. That uncertainty concerns the specific AI-agent story, not the existence of Saudi telehealth services.

## 2. Arabic Medical Benchmarks: Version and Task Boundaries

### 2.1 What Was Actually Tested

The **arXiv 2508.15797v1** paper, *Benchmarking the Medical Understanding and Reasoning of Large Language Models in Arabic Healthcare Tasks*, uses the AraHealthQA/MedArabiQ2025 challenge data and distinguishes a structured-answer accuracy task from open-ended answer evaluation with BERTScore.[6] Its tested Arabic checkpoints are explicitly named as `ALLaM-AI/ALLaM-7B-Instruct-preview`, `QCRI/Fanar-1-9B-Instruct` and `tiiuae/Falcon3-7B-Instruct`.[6]

| Checkpoint (Table 3) | Task 1 accuracy | Task 2 BERTScore |
|---|---:|---:|
| ALLaM-7B-Instruct-preview | 39% | 0.8431 |
| Fanar-1-9B-Instruct | 31% | 0.8403 |
| Falcon3-7B-Instruct | 36% | 0.8493 |

These are the paper's **Table 3** results, not scores for ALLaM 34B, later Fanar releases, Jais, or all versions of an Arabic model family.[6] Task 1 is discussed as MCQ answer-match accuracy (the paper also describes fill-in-the-blank material); Task 2 measures semantic alignment of generated open-ended answers with reference answers.[6] BERTScore is **not** a clinical correctness rate.

The separate **MedArabiQ benchmark paper, arXiv 2505.03427v2**, describes **seven Arabic medical tasks**, including multiple-choice, fill-in-the-blank and patient–doctor Q&A, constructed from past medical exams and public datasets.[7] Its benchmark description must not be conflated with the later challenge paper's two reported evaluation tasks or used as a family-wide model leaderboard.

### 2.2 What This Means for ALLaM, Fanar and Jais

The inspected Table 3 covers named ALLaM, Fanar and Falcon checkpoints—not Jais.[6] This review does not establish a comprehensive clinical-validation or deployment inventory for ALLaM, Fanar or Jais. No blanket “zero clinical validation,” “no hospital deployment anywhere,” or “no regulatory approval” conclusion follows from these benchmark papers.

**Exam/QA benchmark performance is not clinical validation.** Neither a higher proprietary-model score nor a lower Arabic-checkpoint score establishes a clinical safety threshold. Scores can guide narrowly scoped offline testing; they cannot justify recommending a frontier LLM for clinical reasoning.

**Project implication:** retain Neo4j-backed facts, provenance and deterministic rules as the authoritative substrate, with LLM formatting of supported information and human review. Test the exact selected model/version on Arabic/English documentation fidelity and constrained outputs. Do not promote a benchmark into evidence for diagnosis, autonomous treatment advice or payer adjudication.

## 3. UAE: Data Infrastructure, Pilots and Announcements

### 3.1 Malaffi / ADHDS

ADHDS's **10 November 2025** announcement reports Global Reference Site recognition by SNOMED International following Malaffi's comprehensive SNOMED CT implementation, covering diagnoses, allergies, chronic disease, family/social history and diagnostic procedures.[16] The operator reports more than **3,000 facilities** and **52,000 authorised users**; these are operator figures, not an independently audited AI-user count.[16]

The extract's malformed “3.5 clinical records” phrase is not repaired into an invented number. Record-volume claims are omitted. This source supports a **semantic-standardization example**; it does not prove that every downstream AI use case is effective, nor support a blanket assertion that Malaffi runs no clinical AI.

**Project fit:** explicit terminology mappings, provenance and coding-quality checks are useful design patterns. The evidence does not establish that NPHIES documentation universally lacks semantics or that Saudi buyers must be measured against this particular reference site.

### 3.2 PureHealth Nada

PureHealth describes a **pilot across selected facilities** for real-time capture and organization of consultation notes, following evaluation across its SEHA network.[15] Its benefit language is vendor announcement material; the retained evidence does not provide an independently reviewed outcome study. Do not infer nationwide adoption, proven Arabic-dialect accuracy or realized time savings from the pilot label.

**Project fit:** use as a regional documentation-workflow comparator, then request evaluation methods, denominators and editing/error rates before transferring performance targets.

### 3.3 DoH Population Health Intelligence

Abu Dhabi's Media Office describes the PHI platform's unveiling with Microsoft at **GITEX Global 2025**, combining clinical, lifestyle and environmental information in a population-health digital twin, initially focused on obesity and cancer.[21] “World's first” is the announcer's framing, not an independently verified priority claim. This is a platform announcement, not measured evidence of improved population outcomes.

The earlier Riayati, G42/Cleveland Clinic/Oracle, MBZUAI and Daman leads are not promoted to verified clinical deployments in this narrowed correction. Their current product scope and outcomes need separate primary-source diligence. The ambiguous “pastoral AI insurance” phrase remains unresolved and is not a market finding.

## 4. Singapore: Staged Adoption and Evaluation

### 4.1 Note Buddy / Tandem

Synapxe's **17 September 2024** article says SingHealth was **progressively launching** Note Buddy across its institutions **from 4 September 2024**, not that every institution or clinician had already adopted it.[14] It describes real-time transcription/summarization in English, Mandarin, Malay and Tamil on the secure Tandem platform; deployment to **other public healthcare institutions** is described as an eventual possibility.[14]

**Maturity:** staged rollout within a public healthcare cluster. A national platform's remit is not the installed base of an individual tool. The previous “46 hospitals/1,400 clinics” aggregator figure is removed, and no universal national Note Buddy adoption is claimed.

**Project fit:** shared security/governance infrastructure and multilingual evaluation are useful patterns. Actual adoption, errors, editing time and workflow fit still require measurement; this source is not per-tool ROI evidence.

### 4.2 SGH PEACH and Hospital Governance

SGH's **30 July 2025** release describes PEACH, a perioperative guideline-based chatbot built on PAIR and restricted to hospital-issued encrypted laptops.[17] The hospital reports a November 2024 evaluation of **240 interactions**, approximately **98%** recommendation accuracy, and a second evaluation across **more than 270 actual patient assessments** in January–February 2025; it also reports HSA approval for deployment.[17]

These are **hospital-reported, task-specific** evaluation and authorization statements. This pass has not independently inspected the HSA authorization record or complete underlying studies. They are not general clinical-safety guarantees or evidence of Saudi regulatory policy.

The cached AIDE article describes a hospital's AI/digital ecosystem and a broader national push to scale use cases; it is organizational-methodology evidence, not proof of nationwide rollout of any named tool.[20] **Project fit:** borrow evaluation gates, access controls and traceability—not PEACH's clinical reasoning function. Keep project outputs grounded in graph facts and reviewed by authorized humans.

### 4.3 Prudential + Google MedLM

Prudential's **24 October 2024** announcement describes using MedLM to analyze claim-submitted documents, including diagnostic reports, prescriptions and invoices, beginning in Singapore and Malaysia.[8] It says PoCs **doubled the automation rate** of claim reviews/assessments and improved decision accuracy, but does not provide a numeric accuracy estimate or a baseline automation denominator in the cited announcement.[8]

Crucially, it specifies applying MedLM to **selected claims over 3–4 months**, then comparing the AI's analysis/advice with actual decisions through existing approval processes.[8] **Maturity:** company-reported PoC results and a limited comparison rollout—not established industrial-scale outcomes or independently verified ongoing production scope in 2026.

**Project fit:** evaluate document extraction/formatting and discrepancy flags against existing human-reviewed workflows. Define the automation denominator, error severity, reviewer workload and false-positive/false-negative tradeoffs before proposing targets. Do not reuse “doubled automation” as an achieved project result or assume local MedLM availability from Google region availability.

## 5. China: Separate Health, Auto and Financial Evidence

### 5.1 Ping An

A **31 March 2026 Carrier Management** article reports **nearly 60% of accident and health claims** automated, with **some** settled in **51 seconds**.[11] This is secondary reporting, not an independently reproduced benchmark; “some” is not a median or service-wide settlement guarantee.

The same article separately reports a **1.7 percentage-point reduction in the auto-insurance expense ratio over nine years**.[11] That is an **auto segment** metric, not a health-claims outcome. It does not isolate AI's causal contribution. The report's questionable currency conversion is not reused.

Ping An Good Doctor's company-issued FY2025 results release reports **RMB5.47 billion revenue** and **RMB379.5 million profit attributable to owners of the parent**.[19] These are financial-results claims from a company release—not a primary filing reviewed here, and not proof that AI caused revenue or profit. Group claims automation and this separately identified healthcare business's results must not be merged into one outcome measure.

### 5.2 iFLYTEK / Xunfei Healthcare

VCBeat's **10 December 2025** article reports an **RMB428 million** winning bid for software services for a national AI primary-healthcare pilot base in Hefei/Anhui.[12] This is a **secondary procurement report**; a contract award is not the same as completed deployment or validated patient benefit. The translated headline's dollar-denominated amount is not used. App downloads, satisfaction percentages, hospital counts and “surpasses GPT-4o” claims from the previous draft are removed from the decision baseline pending stronger primary evidence.

### 5.3 Yidu Tech

A **30 June 2026 Minichart** results summary attributes a **60–70% claims-processing efficiency improvement** to a fast-claims service model.[13] The underlying filing, denominator, measurement period and causal attribution were not independently checked here. Retain this only as a **secondary, management-attributed diligence lead**, not an established industrial outcome, audited AI ROI or a target directly comparable with Ping An's settlement time.

**Commercial lesson:** these examples suggest different procurement, insurer and provider routes—not a universal “regulator is payer” model. A regulator, a government procurer, a care provider and a risk-bearing insurer are distinct roles; identify the actual budget holder and user before choosing a Saudi go-to-market approach.

## 6. Cross-Cutting Lessons for Veritas-Medica

These are **proposed design and validation choices**, not externally proven project outcomes:

1. **Constrain factual authority.** Use Neo4j facts, explicit provenance and deterministic integrity rules; limit LLMs to formatting supported content, with review and refusal paths. Do not substitute a model's medical knowledge for sourced facts.
2. **Evaluate exact workflows and versions.** Separate real-world consultations from simulations, language groups from scoring denominators, and perceived benefits from measured time savings.
3. **Buy a service, not a headline.** Confirm region, API/model availability, SKU, capacity, data paths, contractual controls and applicable approvals independently. An announced datacenter or domestic region is not compliance certification.
4. **Measure staged adoption.** Report eligible sites/users, activated sites/users and actual usage separately; national infrastructure capability is not national product adoption.
5. **Keep metrics comparable.** PoC automation, settlement latency, financial profit, contract awards and clinical outcomes have different denominators and cannot form a single performance league table.
6. **Validate the buyer hypothesis.** Interview providers, revenue-cycle operators and insurers separately; do not assume CHI is a claims payer or guaranteed anchor customer.

## 7. Differentiation Hypotheses — Not Claims of Saudi Absence

| Source-qualified international pattern | Saudi evidence boundary | Testable project hypothesis |
|---|---|---|
| Prudential selected-claims comparison and PoC document analysis.[8] | This review is not a census of Saudi claims AI. | Arabic/English evidence formatting plus deterministic integrity flags may reduce reviewer work. |
| SingHealth's progressive documentation rollout.[14] | Sahl provides one Saudi evaluation example, not the full adoption landscape.[5] | Measure bilingual factual fidelity and editing burden on a defined pilot. |
| Malaffi semantic-standardization implementation.[16] | NPHIES transaction standards do not, by themselves, establish every source system's semantic quality. | Explicit graph provenance and validated terminology mappings may improve traceability. |
| SGH task-specific evaluation and restricted delivery.[17] | Foreign evaluations/authorization do not transfer automatically to Saudi workflows. | Evaluate constrained documentation outputs before any deployment expansion. |

The proposed combination of bilingual documentation, graph-backed integrity checks and verified in-Kingdom deployment is a **product hypothesis**, not proof that “nobody combines” these features. No claim is made that the categories are absent in Saudi Arabia or that this project would be the first clinically validated Arabic stack.

## 8. Remaining Uncertainty and Evidence Use

- **Provider freshness:** the shortlist uses primary provider evidence accessed by the cutoff. AWS/Azure targets remain future commitments; purchasing eligibility, actual capacity and later launch changes need rechecking before deployment.
- **Unverified infrastructure leads:** HUMAIN GPU service availability/SKUs, KACST external production access and the omitted facility/aggregator capacity figures require direct evidence.
- **Clinical scope:** Sahl evaluates documentation, not diagnostic safety; exact Arabic model families' clinical deployment/approval inventories remain incomplete. Benchmark results must remain checkpoint/task-specific.
- **Rollout follow-up:** completed Note Buddy coverage, Prudential post-comparison scope, Nada outcomes and PHI measured benefits are not established by the inspected announcements.
- **China:** secondary procurement/automation reports and company financial releases are clearly distinguished from independently inspected filings, causal outcomes and clinical validation.
- **Sources excluded from the decision baseline:** Tawazun/Seha agent claims, unusual HUMAIN Chat subdomain assertions, vague “pastoral” insurance wording, aggregator region totals and unsupported universal Saudi market-absence claims.

## Sources
