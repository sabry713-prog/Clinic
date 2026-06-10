# CLAUDE.md — Project Operating Instructions

**You are working on a hospital-grade clinical AI product targeted at the Saudi Arabian healthcare market.** Read this file completely before responding to any prompt in this repository. It governs every choice you make.

This product is a **non-SaMD (non-medical-device) Health IT system** under SFDA MDS-G027. Every design decision, every line of code, and every prompt you write must preserve that classification. Crossing the SaMD boundary is the single most expensive mistake possible on this project.

---

## 1. What this product is

A hospital-deployed application that helps authenticated clinicians work with a patient's existing record. It provides four capabilities, and **only these four**:

1. **Aggregated patient view** — read-only chronological display of data already in EHR, LIS, RIS, PACS, pharmacy systems.
2. **Factual narrative summary** — descriptive prose reproducing documented facts; no interpretation.
3. **Factual Q&A** — natural-language questions answered with retrieved record facts; interpretive questions refused.
4. **Shift-change handoff** — factual reproduction of recent record events.

## 2. What this product is NOT

Read this list carefully. Every item here is forbidden in this codebase. If you find yourself about to implement any of these — stop and ask.

- ❌ Diagnosis, suggested diagnosis, or differential diagnosis
- ❌ Treatment, medication, or dose recommendations
- ❌ Drug-drug, drug-disease, drug-allergy interaction checking
- ❌ Flagging, prioritizing, highlighting, color-coding by severity, or otherwise drawing clinical attention to specific findings
- ❌ Alerts, warnings, notifications, or escalations based on clinical content
- ❌ Risk scoring, predictive modeling, prognostic assessment, deterioration prediction
- ❌ Recommendations for tests, imaging, referrals, or monitoring
- ❌ Interpretation of lab values, imaging findings, vital signs, or genomic data
- ❌ Triage or acuity classification
- ❌ Trend interpretation (the words "worsening", "improving", "concerning", "trending" applied to clinical data)
- ❌ Cross-patient queries, cohort analysis, or aggregate computation

If any of these slip into the product even by accident, the regulatory classification flips from Health IT to SaMD, which means 24+ months of regulatory delays and potential exposure.

## 3. The boundary rule for generated text

Generated text (narrative summaries, Q&A answers) **must never** contain interpretive verbs or phrases. The blocklist is in `docs/prompts/blocklist.md`. When implementing any generative feature, the blocklist filter is mandatory and is the final gate before display.

Allowed: "Creatinine values: 138 (Mar), 141 (Apr), 168 (24 May)."
Forbidden: "Creatinine has risen, suggesting worsening renal function."

The first restates facts. The second interprets them. The first is Health IT. The second is SaMD.

## 4. Repository structure

```
/
├── CLAUDE.md                       # This file — operating instructions
├── docs/
│   ├── architecture/
│   │   ├── 01-overview.md          # System architecture
│   │   ├── 02-components.md        # Component map and responsibilities
│   │   ├── 03-deployment.md        # Deployment topology and infra
│   │   ├── 04-data-flow.md         # Data flow diagrams (text)
│   │   └── 05-security.md          # Security architecture
│   ├── api/
│   │   ├── 01-conventions.md       # REST conventions, error model
│   │   ├── 02-auth.md              # Auth endpoints
│   │   ├── 03-patient.md           # Patient view + search endpoints
│   │   ├── 04-narrative.md         # Narrative endpoints
│   │   ├── 05-qa.md                # Q&A endpoints
│   │   ├── 06-handoff.md           # Handoff endpoints
│   │   └── 07-admin.md             # Admin/audit endpoints
│   ├── data/
│   │   ├── 01-schema.md            # Database schema (PostgreSQL)
│   │   ├── 02-fhir-mapping.md      # FHIR resource → internal model
│   │   ├── 03-retrieval-index.md   # Vector index design
│   │   └── 04-audit-log.md         # Audit log schema + integrity
│   ├── prompts/
│   │   ├── narrative-prompt.md     # Narrative system + user prompts
│   │   ├── qa-answer-prompt.md     # Q&A answer synthesis prompt
│   │   ├── qa-refusal-prompt.md    # Refusal response prompt
│   │   └── blocklist.md            # Interpretive-language blocklist
│   ├── classifier/
│   │   ├── 01-design.md            # Query classifier design
│   │   ├── 02-rules.md             # Rule-based classifier rules
│   │   └── 03-evaluation.md        # Classifier evaluation methodology
│   ├── build/
│   │   ├── 01-stack.md             # Tech stack and rationale
│   │   ├── 02-bootstrap.md         # How to set up the project
│   │   ├── 03-slices.md            # Build slices and sequencing
│   │   ├── 04-testing.md           # Testing strategy
│   │   └── 05-coding-standards.md  # Code style, review gates
│   └── ops/
│       ├── 01-environments.md      # Dev / staging / prod
│       ├── 02-observability.md     # Logging, metrics, traces
│       └── 03-incident-response.md # On-call and incidents
├── apps/                           # Application code (to be created)
└── packages/                       # Shared packages (to be created)
```

## 5. How to use this spec with Claude Code (or any AI coder)

When you give Claude Code a task, your prompt should reference the relevant doc files explicitly. For example:

> "Implement the patient view aggregation endpoint per docs/api/03-patient.md, using the schema in docs/data/01-schema.md. Follow the conventions in docs/api/01-conventions.md and the coding standards in docs/build/05-coding-standards.md."

The doc files are the source of truth. If a prompt and a doc file disagree, the doc file wins (unless the doc file is what you intend to change).

## 6. Mandatory review gates (you are the gate)

You as CTO are the human in the loop. The following changes **never** ship without your explicit approval:

1. Any modification to the prompt templates in `docs/prompts/`
2. Any modification to the classifier rules in `docs/classifier/02-rules.md`
3. Any modification to the blocklist in `docs/prompts/blocklist.md`
4. Any new feature not already enumerated in section 1 of this file
5. Any change to audit log schema or integrity mechanism
6. Any change to FHIR ingestion mapping that affects patient identity
7. Any change to authentication or authorization logic

For everything else, AI-assisted development is fine, but human review of every PR is still required.

## 7. Sensitive data discipline

- Never log PHI to application logs. Structured logs use IDs and codes only.
- Never include PHI in prompts to external models unless the model endpoint is contractually bound to in-Kingdom processing with no training on data.
- Never send PHI in URL query strings.
- Never store unencrypted PHI on disk.
- Audit logs are append-only and hash-chained.

## 8. Language and locale

- Default UI language: Arabic (RTL) with English (LTR) toggle.
- Q&A and narrative must work in both languages, including code-switching (mixed Arabic/English in a single query).
- All clinical terminology (drug names, lab codes, diagnoses) preserved in source form; do not translate.

## 9. When in doubt

Ask. If a feature request or implementation choice feels like it might cross the SaMD boundary — ask. If a prompt change might leak interpretive language — ask. The cost of asking is one extra turn. The cost of crossing the boundary is the company.

---

**Last updated:** Initial commit
**Owner:** CTO / Founder
