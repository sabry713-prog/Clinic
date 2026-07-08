# Clinical Documentation & Data Reconciliation Assistant — Build Spec

This repository contains the engineering specification for a hospital-deployed clinical AI product targeted at the Saudi Arabia market. It is the source of truth that AI coding tools (Claude Code, Cursor, GitHub Copilot, etc.) and human engineers consult on every change.

## Start here

1. Read **`CLAUDE.md`** in full. This is the operating contract — what the product is, what it is not, and the rules that preserve its non-SaMD classification.
2. Read **`docs/architecture/01-overview.md`** for the system shape.
3. Read **`docs/build/03-slices.md`** to see how the work is sequenced.
4. Begin Slice 0 (`docs/build/02-bootstrap.md`).

## Specification structure

```
CLAUDE.md                            Operating contract (read first)
docs/
├── architecture/                    How the system is shaped
├── api/                             What the system exposes
├── data/                            How data is stored, mapped, retrieved, audited
├── prompts/                         Safety-critical generation templates
├── classifier/                      Q&A query classification (REFUSED vs ALLOWED)
├── build/                           Stack, bootstrap, slicing, testing, standards
└── ops/                             Environments, observability, incidents
```

## Non-negotiables

- This product is **Health IT (non-SaMD)** under SFDA MDS-G027. Every change preserves that.
- Generated text **never** interprets clinical data. The blocklist filter is the final gate.
- Q&A questions are **classified before retrieval**. Interpretive questions are refused.
- All patient data stays **inside the Kingdom of Saudi Arabia**.
- Every clinical-data access is **audit-logged** with hash-chain integrity.

If a change might violate any of these, escalate before merging. See `CLAUDE.md` section 6 for review gates.

## Working with this spec

When you give a coding task to an AI tool, reference the doc files explicitly. Example:

> "Implement the Q&A endpoint per `docs/api/05-qa.md` using the classifier described in `docs/classifier/01-design.md` and rules in `docs/classifier/02-rules.md`. Follow `docs/build/05-coding-standards.md`."

The doc files are the source of truth. If a prompt and a doc file disagree, the doc file wins (unless the doc file is what you intend to change — in which case open a PR against the doc file first, get the relevant approvals, then act).

## Status

**Implemented — MVP running locally; Phase E0 (verification & gate closure) in progress.**

Working end-to-end (local `docker-compose.dev.yml` + dev seed): authentication/RBAC,
aggregated patient view, factual narrative, factual Q&A (EN/AR/code-switched), shift
handoff, audit log with hash-chain verification and WORM export.

Phase E0 measured results (2026-07-09, classifier rules-only — see `docs/evidence-pack-e0.md` for full detail):

| Metric | Result |
|---|---|
| Classifier unit tests | 73/73 pass |
| Full test suites (core/qa/narrative/classifier/blocklist) | all green |
| Eval harness | runs in CI-ready form |
| EN holdout sensitivity / specificity | 1.00 / 1.00 (100 items) |
| AR holdout sensitivity / specificity | 1.00 / 1.00 (101 items) |
| Stress corpus sensitivity (borderline + code-switching + polite) | 0.947 (target 0.98; 1 named miss, root-caused) |
| Blocklist corpus gates | 107/107 (100% block, 0 false-positive) |
| Q&A refused-path latency | 16 ms (budget ≤ 1 s) |
| Out-of-scope patient access | denied (403 PATIENT_OUT_OF_SCOPE) |

Remaining before the E0 gate fully closes: combined rules+model classifier
sensitivity ≥ 0.98 (pending the on-prem foundation-model endpoint), and the
stakeholder evidence pack (`docs/evidence-pack-e0.md`).

Open decisions: on-prem foundation-model endpoint; Saudi regulatory consultant
sign-off on the IUS Addendum 1 (Factual Q&A).

## Owners

- **CTO / Founder**: spec owner, technical decisions, all merge gates
- **Clinical Advisor**: clinical safety, prompts, classifier, blocklist
- **Regulatory Consultant**: non-SaMD posture, IUS sign-off
- **DPO**: PDPL compliance, DSR workflows, breach response
