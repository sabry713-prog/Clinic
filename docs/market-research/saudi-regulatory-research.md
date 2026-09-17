# Saudi Arabia Regulatory & Market Research — Provider-Side Claims/Clinical Documentation Software

**Prepared for:** Veritas-Medica market strategy (Saudi healthcare prototype: reviewed clinical documentation/SOAP, coding confirmation, deterministic Neo4j claim-necessity checks with evidence chains, coder remediation queue, simulated NPHIES).
**Date compiled:** 11 September 2026
**Method:** Primary-source verification with a task-specific citation/quote ledger in `verification/regulatory/`; reused `saudi-source-extracts.json` and prior retrieval batches. Legal requirements are reported with scope, and unresolved applicability is explicit. This is research, not legal advice, regulatory approval or a product compliance determination.

---

## 1. Executive Summary

- **Market evidence, not software TAM:** the NPHIES IG labels its market overview October 2025 and reports 14.1M+ employer-insurance beneficiaries, 18.8M+ visitor-insurance beneficiaries, 6,419+ onboarded provider facilities, 25 onboarded insurers and 60+ onboarded software vendors. These are different populations and units; they are not a count of unique software buyers.[1]
- **Correct denominator:** NPHIES Q3-2025 says “46% of rejected items in prior authorizations were rejected for not being justified clinically”; its leading reason is 46.14% of those rejected PA items. This is **not** 46% of all PAs, denied claims, lost revenue or preventable denials. The report does not measure whether this prototype could reverse any rejection.[20]
- **Regulatory applicability is conditional:** PDPL governs applicable personal-data processing and classifies health data as sensitive; it allows conditional transfers rather than imposing a universal health-data residency ban. NCA ECC covers government entities and affiliates as well as relevant private CNI entities; CCC includes in-scope cloud tenants and their providers.[8][2][7]
- **SFDA classification remains unresolved for the prototype:** MDS-G027 distinguishes purely administrative HIT from software with intended medical functions. Actual functions, technical specifications, intended purpose and outputs must be assessed; a billing label or clinician sign-off does not establish exemption.[3]
- **CHI's published DRG timetable is verified:** its private-health-insurance guideline specifies shadow billing in 2026–2027, full DRG reimbursement from 1 January 2028, quarterly internal coding audits, annual external coding audits from 1 January 2027, and CDI for private-sector hospitals submitting DRG claims. These are scoped provider obligations, not a requirement to purchase this product.[16]
- **Institutional roles:** CHI provides regulatory oversight; insurers are payers, with TPAs administering claims. NPHIES validates/exchanges transactions rather than adjudicating them. Neither CHI nor NPHIES should be presented as the payer.[16][1]

---

## 2. Market Size and Current State

### 2.1 Insurance and provider context

The NPHIES IG describes both public healthcare and private healthcare/insurance, and says employers must insure their employees, including Saudi citizens. Its October 2025 overview lists approximately 6,600 regulated provider organizations, 28 insurers and eight TPAs. Its separate onboarding KPI table lists 6,419+ facilities and 25 insurers. “Organizations,” “facilities,” regulated entities and onboarded entities must not be treated as interchangeable.[1]

SPA's 27 October 2025 report, quoting the Insurance Authority, puts 2024 health-insurance gross written premiums at **SAR42.2 billion**, versus **SAR38.6 billion in 2023**, and reports **55.5%** of insurance-sector premiums and **23 companies operating in health insurance**. These are insurance premiums, not RCM software revenue. The reason the 23-company figure differs from the IG's insurer counts has not been established; the earlier licensed-but-inactive explanation is withdrawn.[12]

The IG also refers to approximately 18,000 Saudi provider organizations and says the public health system has joined NPHIES. This does not establish that the difference between total organizations and onboarded facilities is a commercially accessible “unserved tail,” or that all public providers use the same purchasing route.[1]

### 2.2 NPHIES scale: explicitly dated platform figures

| Indicator | Published value / period |
|---|---|
| Beneficiaries served | 14.1M+ employer insurance; 18.8M+ visitor insurance — IG snapshot |
| Provider facilities onboarded | 6,419+ — IG snapshot |
| Insurers / software vendors onboarded | 25 / 60+ — IG snapshot |
| “Market Share of Claims” | 98% — IG label; not share of software expenditure |
| Total transactions | 143M in 2023; 292M in 2024; 96M in Q1 2025 |
| Q1 2025 transaction breakdown | Eligibility 50M; authorization 11M; claims 31M; payment 4M |

Source: NPHIES IG, whose overview is labeled October 2025 and build footer 3 December 2025; do not represent these as September 2026 live measurements.[1]

The Q3-2025 operational report records **52.3M eligibility transactions, 13.3M PAs and 32.8M submitted claims**, compared with 43M, 10.8M and 18.8M respectively in Q3-2024. It reports 99.77% platform availability and a 62.7% claims-to-eligibility count ratio, expressly warning that aggregate transaction ratios do not represent correlations between individual transactions (PDF pp. 8–12).[20]

**Market-sizing limits:** these sources establish platform activity and the scale of insurance, not unique active patients, independent purchasing units, annual software budgets, willingness to pay, or a serviceable market for this prototype. No software-market valuation is asserted here.

---

## 3. Provider Pain Points — What the Evidence Does and Does Not Show

### 3.1 Rejected PA items, not claims or recoverable revenue

The NPHIES Q3-2025 report, PDF p. 22, states: “46% of rejected items in prior authorizations were rejected for not being justified clinically.” The chart gives **46.14%** for Q3-2025 and **38.84%** for Q3-2024 for “Service is not clinically justified based on clinical practice guideline, without additional supporting diagnosis.” The denominator is **rejected PA items**, not whole requests, all claim submissions, payments or financially recoverable denials.[20]

| Rejection reason | Q3-2025 share of rejected PA items |
|---|---:|
| Not clinically justified / without additional supporting diagnosis | 46.14% |
| Duplicate service/procedure code based on date | 8.00% |
| Submission not compliant with provider–payer contractual agreement | 5.23% |
| History of present illness inadequate or missing | 5.22% |
| Service/procedure not covered | 5.01% |
| Provider outside beneficiary network | 4.51% |
| Refill too soon | 3.98% |
| Investigation result inadequate or missing | 2.57% |
| Annual limit/sublimit exceeded | 2.56% |

Source: the chart and labels on Q3-2025 report p. 22. This corrects the earlier reversal of duplicate/contract percentages and mislabeling of 2.56% as refill-too-soon.[20]

The rejection code records the payer's response; it does not prove that supporting clinical evidence existed, that documentation was the sole cause, or that software could make an inappropriate/non-covered service payable. The share cannot be converted into an avoidable-denial rate or product revenue uplift from these data alone.[20]

### 3.2 Separate transaction-quality evidence

NPHIES reports **over 172K** transactions blocked for wrong National ID, **over 150K** duplicate PA requests and **over 179K** duplicate claim requests prevented in Q3-2025 (pp. 16–18). It also reports **4.02%** of requests requiring correction under validation criteria (p. 15), and **3.16%** of requested PAs returned with payer-side errors, of which the duplicate error accounts for 41.30% (p. 23). Those denominators differ from rejected PA items.[20]

The earlier statement that 81.2% of ineligible requests had missing patient credentials is withdrawn: p. 5 labels **81.2% as eligible** and **18.8% as not eligible**, with a separate 5.8% label for “No member found with the supplied patient credentials.” This report does not infer an ineligible-only denominator from that chart.[20]

NPHIES describes itself as a “smart courier”: it validates data formats and coding standards but does not take the provider, payer or TPA role. Technical acceptance therefore is not evidence of payer approval or payment. The source does **not** establish that most HIS products lack adjudication analytics.[1]

### 3.3 Evidence limits and product hypothesis

**Hypothesis for testing, not a demonstrated result:** documentation review, coding remediation and transaction validation may help selected workflows. A provider pilot would need to separate documentation omissions, unsupported clinical necessity, coverage/contract decisions, duplicate items and technical errors; measure requests, items, claims and payments separately; and preserve clinician/coder accountability.

Previously cited vendor rejection-rate estimates, coding-workforce scarcity assertions, commercial market estimates and small observational CDI studies are not used as quantified evidence of this product's impact. In particular, an observational difference between hospitals with and without CDI does not establish causality, generalize to the Saudi market, or establish an effect of this software. Their source/methodology verification remains outside the verified primary-source facts below.

---

## 4. Regulatory Analysis — Scope Before Classification

This is source verification, **not legal advice, an SFDA classification determination, certification, or permission to deploy**. “Provider-side,” “non-diagnostic” and “human reviewed” describe intended design choices, not verified regulatory exemptions. Applicable obligations depend on the entity, customer, actual modules, data flows and production integration.

### 4.1 Applicability summary

| Regime | Source-backed scope / status |
|---|---|
| PDPL and Implementing Regulation | Applicable personal-data processing; health data is sensitive. Controller/processor duties depend on role; sensitive-data processing triggers a documented impact assessment.[8][9] |
| Cross-border transfer | Conditional legal route under Article 29 and Transfer Regulation, not a universal prohibition or automatic permission through SCCs.[8][2] |
| NPHIES | Exchange standards apply to production NPHIES transactions; not every standalone documentation module necessarily needs its own direct integration.[1] |
| CHI DRG guideline | Private health insurance admitted-care framework; shadow billing 2026–2027, reimbursement from 1 January 2028; audit/CDI requirements described below.[16] |
| NCA ECC-2:2024 | Government agencies and affiliates, and private entities owning, operating or hosting CNI; other entities strongly encouraged to adopt controls.[6] |
| NCA CCC-2:2024 | In-scope cloud tenants and CSPs serving those tenants; responsibilities are allocated to both, not transferred entirely to a host.[7] |
| CST cloud framework | Cloud-service provisioning and provider registration framework; service/provider applicability must be established. No blanket healthcare SaaS residency rule is established by the retrieved decision/guide page.[4][18] |
| SFDA MDS-G027 | Qualification depends on intended medical purpose and functionality; purely administrative HIT examples do not decide this prototype's classification.[3] |
| DGA | Government entities and private developers/operators of digital-government activities; public-sector supply includes procurement/framework-agreement requirements.[5] |

### 4.2 PDPL: processing, transfers and residency are separate questions

PDPL Article 1 includes **Health Data** in **Sensitive Data**. Article 8 requires controllers to select processors offering the necessary compliance guarantees and monitor them; outsourcing does not remove controller responsibility.[8]

Implementing Regulation Article 25 requires a written impact assessment for sensitive-data processing, among other triggers. Article 26 requires health-data safeguards and adoption of requirements issued by relevant health/insurance regulators. A DPIA is a documented assessment obligation, not a substitute for lawful processing, security or sectoral requirements. Human review is a prudent product safeguard, but this report does not infer a universal human-sign-off requirement from the DPIA provision.[9]

**Transfers:** Article 29 permits transfers/disclosures abroad for specified purposes subject to conditions, including national security/vital interests, adequate protection and data minimization, with defined exceptions. Transfer Regulation Article 2 includes necessary central-processing operations, providing a service/benefit to the data subject, and research; Article 4 provides an appropriate-safeguard route using **standard contractual clauses, binding common rules, or a certificate of accreditation** in the specified exemption cases.[8][2]

Article 7 requires a transfer risk assessment when relying on Article 4 and when sensitive data is transferred/disclosed abroad on a continuous or widespread basis. Those conditions do not mean that all transfers use SCCs/BCRs, nor that signing one makes any offshore deployment lawful. The current operational availability of adequacy decisions/accreditation mechanisms was not conclusively established in this review; the prior categorical “none published as of mid-2026” assertion is removed.[2]

**Residency:** PDPL is not, by itself, a blanket ban on transferring all Saudi health data. Applicable health-sector restrictions, NCA scope, public-sector requirements, data classification and contract conditions must be considered separately. Conversely, transfer safeguards cannot be assumed to override a separate applicable localization restriction. The statute preserves stronger protections under other laws, and the Implementing Regulation expressly layers sectoral health-data requirements.[8][9]

**Deployment question still open:** map storage, backup, logs, support access, subprocessors and external model processing against these requirements before making a compliance claim. No specific cloud/model architecture has been approved by this report.

### 4.3 NCA ECC and CCC: government, CNI and tenant responsibilities

ECC-2:2024's scope expressly includes government agencies and their affiliated companies/entities inside and outside the Kingdom, plus private-sector entities **owning, operating or hosting Critical National Infrastructures**. NCA strongly encourages other entities to leverage the controls. The earlier “mandatory only for CNI-connected entities” formulation omitted government scope; the earlier assumption that large hospitals automatically qualify as CNI is not established.[6]

ECC cloud/hosting controls should be read within this entity-level scope. Merely using a cloud service does not establish that every otherwise out-of-scope private clinic is subject to the entire ECC regime; contracts or other applicable rules can still impose requirements. Customer-specific scope remains to be determined.[6]

CCC-2:2024 states that in-scope cloud service tenants are government agencies/affiliates and private CNI entities using or planning to use cloud services. CSPs are in scope when providing services to those tenants. Its implementation section requires both tenant and provider compliance with the relevant ECC and CCC controls; it assigns cybersecurity roles and RACI responsibilities to both parties.[7]

**Shared responsibilities:** using a third-party Saudi cloud does not reduce a software vendor or customer's task to checking the host's certificate. Where applicable, tenant-side governance, access/configuration, risk assessment and contractual control allocation remain relevant. In the NCA document, “CST” means **Cloud Service Tenant**, not the Communications, Space and Technology Commission.[7]

### 4.4 CST: cloud-service regulation, not universal SaaS residency

CST's decision approved **Cloud Computing Service Provisioning Regulations v4**, the provider guide v5 and qualifying-category registration guide v2, superseding the previous framework from **10 October 2023**. The official provider-guide page describes registration procedures and requirements for cloud computing service providers operating in Saudi Arabia.[4][18]

**Scope conclusion:** identify whether the supplied service and responsible entity fall within the current cloud-provisioning/registration rules; a SaaS label alone is not an applicability analysis. The retrieved decision and guide summary do **not** establish either “every healthcare product must run inside KSA” or “a CST-registered CSP permits any data location.” The full operative v4 provisions and the particular provider category remain a deployment-specific verification gap. Any data-location restriction must be tied to its actual legal, sectoral or contractual basis rather than inferred from registration alone.

### 4.5 SFDA MDS-G027: no blanket HIT exemption for this prototype

The retrieved **Guidance on Digital Health Products**, Version 1.0, is dated **10 August 2025**, document code **MDS-G-027-V1/250810**. Its URL's August 2026 directory is not the guidance's version date. It covers multiple digital-health categories, not only AI software.[3]

Section 1.1 links qualification to intended purpose as reflected in labeling, technical specifications, instructions and accompanying documents. Section 1.2.4 says: “In general, HIT products are not considered medical devices unless they are specifically intended to analyze or interpret medical information for the purpose of diagnosing, treating, mitigating, curing, or preventing a disease or health condition.” It separately gives non-device examples of purely administrative/communication support and exclusive storage, transfer, format conversion or display without analysis/interpretation.[3]

**Corrected product conclusion:** simple administrative billing support may fit the HIT examples, but documentation generation/review and patient-specific “medical necessity” or clinical-guideline interpretation require module-by-module assessment of actual outputs and intended clinical use. Calling an output “financial integrity” does not neutralize a medical function. Marketing is evidence of intended purpose, not the sole determinant; human confirmation is not an exemption. This report therefore makes **no determination that Veritas-Medica is non-device or exempt from MDMA**.[3]

For mixed products, the guidance allows regulated modules to be submitted separately where separation and non-medical functions are clearly documented. Section 3 addresses MDMA compliance for qualifying medical devices. Whether a module qualifies, and which authorization pathway applies, remains for product-specific regulatory assessment.[3]

### 4.6 DGA: public digital work can directly involve private suppliers

Digital Government Policies v2.0, dated 5 December 2023, lists government entities and the private sector acting as developer/operator of digital-government activities in its applicability text (p. 6). Section 7.2.5 covers supply of digital-government products, services, solutions and systems by private suppliers to government agencies, with government tender/procurement regulations and ICT framework-agreement commitments (p. 11).[5]

Thus DGA is not a blanket private-clinic software regime, but **“not applicable to private vendors” is incorrect**. A government-health contract, subcontract or digital-government operating role may bring relevant DGA requirements into the supplier's scope. Exact contractual and licensing/accreditation requirements need review for the proposed engagement.[5]

### 4.7 CHI / NPHIES: roles, coding and verified DRG timetable

The IG identifies CHI as a regulator for financial exchanges and distinguishes providers, insurers and TPAs. NPHIES is the exchange/validation platform; the IG says all private insurers/TPAs and **most**, not all, of the approximately 6,600 regulated provider organizations exchange eClaims through it. The 60+ figure is labeled **onboarded software vendors**; it does not establish the certification status or feature coverage of every vendor.[1]

For the guideline's admitted-care shadow-billing scope, §3.3.1 specifies **ICD-10-AM 10th Edition diagnoses, SBS v3 interventions and a CHI-certified DRG grouper**. Section 2.2 says manual grouping is not permitted. These are not grounds to assert that every standalone document-review tool must itself be a certified grouper or direct NPHIES vendor. Current integration/onboarding requirements must be confirmed for the actual production path.[16]

**Verified from CHI DRG Implementation Guideline v1.0, primary PDF:**

| Provision | Text-supported requirement and scope |
|---|---|
| Executive summary, p. 6 | Shadow billing **2026–2027**: parallel DRG and FFS submission for validation/modeling, **without reimbursement impact**. Full implementation **from 1 January 2028**, mandatory DRG reimbursement for admitted care in the guideline's Saudi private-health-insurance scope.[16] |
| §§1.1, 3.5, pp. 7, 15 | Private hospitals/day-case centers and associated stakeholders. Shadow billing includes inpatient and day-case admissions; it excludes outpatient/ambulatory care and ER visits that do not lead to admission, and non-inpatient rehabilitation/sub-acute episodes.[16] |
| §4.2.3, pp. 18–19 | Quarterly internal coding audit program is **required**, not merely recommended. The section says all healthcare providers must undergo an **annual external audit through CHI-approved audit vendors effective 1 January 2027**; interpret in the guideline's scope, not as a verified universal mandate for unrelated outpatient clinics.[16] |
| §4.2.3, p. 19 | Error DRGs 960Z/961Z/963Z must not exceed **3% of total submitted episodes in any reporting month during shadow billing**. A mandatory improvement action plan is triggered when the threshold is exceeded for **two consecutive months**, not after any single breach.[16] |
| §4.4, pp. 21–22 | **All private-sector hospitals submitting DRG claims must establish CDI** with staffing/collaboration, concurrent review, clinician queries and documented responses, and monitoring. It is not merely a recommendation until 2028.[16] |

CHI's stated role is regulatory oversight, market monitoring and refinement of DRG parameters; payers/TPAs establish validation, financial modeling and contracting processes. The guideline expressly says it does not determine clinical decision-making, medical necessity or coverage policies.[16]

**Source caution:** publication on CHI's site supports the above statements, but the PDF contains apparent editorial placeholders in §9.1.1 (including “X3%” and “80X%”) and separate readiness/recommended KPI tables. This report does not silently repair those tokens or turn every KPI into a legal deadline. Document hosting/Last-Modified metadata is not an issuance or commencement date; any subsequent circulars, supersession and entity-specific implementation should be confirmed before reliance.[16]

---

## 5. Buyer Segments, Procurement and Localization

### 5.1 Potential buyer segments — hypotheses, not verified purchase intent

- **Private hospitals and day-case centers:** admitted-care DRG/CDI/audit obligations are documented, but budget, procurement timing and preference for standalone versus existing HIS modules are not.[16]
- **Private outpatient clinics/medical complexes:** potential documentation and billing users; do not extend admitted-care DRG requirements to non-admitted episodes.[16]
- **Public providers/health clusters:** the IG records public-provider participation in NPHIES; participation alone does not determine purchasing authority or route.[1]
- **Insurers/TPAs:** distinct payer/administration roles, potentially different use cases from provider-side documentation. CHI is not an insurer/payer buyer.[1][16]

### 5.2 Procurement: NUPCO is not universal software procurement

NUPCO's official overview describes medical procurement, warehousing and distribution for **pharmaceuticals, medical devices/equipment and supplies**, serving government healthcare entities. It does **not** establish that every public hospital, health cluster or military facility buys all software/SaaS through NUPCO.[19]

DGA's policies separately address private supply of digital-government services, solutions and systems, government tender/procurement rules and ICT framework agreements. For a particular opportunity, the contracting entity, tender/package scope, applicable framework and delegated purchasing authority must establish the route. No universal NUPCO or Etimad route is asserted for this prototype.[5]

The earlier claim that NUPCO began rejecting foreign bids whenever a local alternative existed in 2026 is withdrawn: the cited vendor guide did not establish a universal rule or its application to this software. Specific local-content, bid-eligibility and framework conditions remain tender-dependent verification items.

### 5.3 Localization and production readiness

Arabic/English workflows, local support and auditable integration are **product/procurement considerations to test**, not universal legal requirements established here. No general bilingual-labeling obligation for software is inferred from SFDA guidance on other product categories. Workforce localization thresholds require the actual Saudi employer/activity classification; a local partner is not assumed to discharge them.

Data hosting and remote access require the layered PDPL/NCA/CST/sectoral/contract analysis in §4. Local hosting alone is not proof of compliance, and offshore safeguards alone are not proof that a sectoral restriction is satisfied.[8][9][7]

---

## 6. Existing Solution Categories and Competitive Limits

NPHIES supplies a transaction-validation/exchange layer, while the CHI guideline requires certified grouping, coding-quality controls, CDI and audits in its admitted-care scope. These establish **functions that need to be fulfilled**, not mutually exclusive vendor categories.[1][16]

An HIS vendor may offer documentation, coding, grouping integration, claims management and analytics together; a separate documentation tool may integrate into that stack. This is a design/competitive possibility, not a verified inventory of incumbent capabilities.

**Withdrawn:** “none of the incumbents combines these functions,” “no incumbent intervenes upstream,” “most HIS dashboards only measure technical acceptance,” and “CDI works” as a causal/product-effect conclusion. The reviewed primary sources contain no exhaustive feature audit or controlled effectiveness evaluation supporting those statements.

**Testable opportunity:** compare the proposed evidence-chain/remediation workflow against the customer's actual HIS, grouper, CDI staff and RCM processes. Establish incremental benefit through observed workflow outcomes rather than treating the 46.14% rejected-PA-item share as an addressable or recoverable revenue pool.

---

## 7. Implications for Veritas-Medica — Research Conclusions, Not Approval

1. **Classification is an open dependency.** Document intended purpose and actual behavior of each module, especially patient-specific interpretation and generated clinical content. Purely administrative HIT examples do not certify this prototype as non-device.[3]
2. **Separate obligations by actor and deployment.** Controller/processor, cloud tenant/provider, NPHIES-connected system and government supplier are different roles. A compliant host, a clinician approval click, or a “billing only” label is not an all-purpose compliance shortcut.[8][7][5]
3. **Use the DRG calendar precisely.** The published 2026–2027/2028 phases, 2027 external audits and scoped CDI/internal-audit requirements justify readiness research, not claims that the law requires buying this product or that outpatient clinics share every admitted-care obligation.[16]
4. **Measure benefits rather than promise them.** Establish baseline/follow-up denominators, distinguish PA items from claims and paid revenue, and review causes rather than assume every rejection is preventable. The official evidence does not establish product efficacy, financial uplift or exclusive market space.[20]

---

## 8. Verification Status and Remaining Gaps

**Review cutoff: 11 September 2026.** Reused the saved source extracts and failed-run evidence, then obtained full primary PDFs for the CHI DRG guideline, NPHIES Q3 report and DGA policies. The accompanying ledger distinguishes retrieved text from conclusions; source snapshots are not a guarantee of the latest consolidated law.

**Remaining verification gaps:**
- Product-specific SFDA qualification/MDMA requirements; no approval or exemption established.
- Full CST v4 operative applicability/registration details, provider category and the actual cloud/data-flow architecture.
- Current SDAIA adequacy/accreditation availability and any superseding instruments; exact sector/customer localization requirements.
- Entity-specific NCA CNI/government scope, tenant/provider responsibility mapping and applicable contracts.
- Subsequent CHI circulars/amendments, ambiguous editorial placeholders in the guideline, exact onboarding/certification path and rollout implementation for a particular provider.
- Government procurement route, local-content/workforce requirements, buyer budgets and willingness to pay.
- Latest 2026 market counts and 2025 insurance-premium primary report; commercial software TAM, market-wide vendor capabilities and causal/product-effect claims.

Previously included tertiary statistics, unsupported generalizations, study/vendor estimates and dates lacking sufficient verification were removed rather than presented as established facts. See `verification/regulatory/CHANGELOG.md`, `ledger.json`, `quotes-ledger.md` and the retained primary-text snapshots for the audit trail.

---

## Sources

[1] https://portal.nphies.sa/ig/introduction.html — Introduction - Healthcare Financial Services IG Edition 1 v1.0.0
[2] https://sdaia.gov.sa/Documents/RegulationonPersonalDataEN.pdf — RegulationonPersonalDataEN.pdf
[3] https://sfda.gov.sa/sites/default/files/2026-08/MDS-G027_0.pdf — MDS-G027_0.pdf
[4] https://www.cst.gov.sa/en/regulations-and-licenses/decisions/Regulation-1482 — Approval on the Update of the Cloud Computing Service Provisioning Regulations and its Guides
[5] https://dga.gov.sa/sites/default/files/2024-03/Digital%20Government%20Policies%20-%20V2.0.pdf — Digital%20Government%20Policies%20-%20V2.0.pdf
[6] https://cdn.nca.gov.sa/api/files/public/upload/86e09090-44e4-481f-bc28-355673607654_ECC--2024-EN.pdf — Microsoft Word - ECC 2-2024 EN reviewed final no metadata.docx
[7] https://cdn.nca.gov.sa/api/files/public/upload/6d5408a3-d8e6-4e96-963b-2c7198e5b7c2_CCC-2-2024-EN-.pdf — Microsoft Word - CCC-2-2024 EN.docx
[8] https://sdaia.gov.sa/en/SDAIA/about/Documents/PersonalDataProtectionLaw.pdf — Personal Data English V2-23April2023- Reviewed-
[9] https://sdaia.gov.sa/en/SDAIA/about/Documents/ImplementingRegulationPersonalDataProtectionLaw.pdf — ExecutiveRegulationsEn
[12] https://spa.gov.sa/en/N2429898 — Insurance Authority Participates in Global Health Exhibition to Promote Sector Integration
[16] https://www.chi.gov.sa/en/Rules/MedicalStandards/CHI-DRG-ImplementationGuidelines.pdf — CHI-DRG-ImplementationGuidelines.pdf
[18] https://www.cst.gov.sa/en/regulations-and-licenses/regulations/Document-1552 — Guide for Cloud Computing Service Providers
[19] https://www.nupco.com/about-nupco/overview — Overview - nupco
[20] https://nphies.sa/storage/library-files/01KBMWZ2KFSH7X8M1P5BWFZ2VP.pdf — 01KBMWZ2KFSH7X8M1P5BWFZ2VP.pdf
