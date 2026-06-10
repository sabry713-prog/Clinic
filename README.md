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

Pre-build draft. This specification has not yet been implemented. Slice 0 begins when:
- Open questions in the product spec are closed (anchor hospital, EHR, cloud, foundation model)
- Saudi regulatory consultant has signed the IUS Addendum 1 (Factual Q&A)
- A development environment is provisioned

## Owners

- **CTO / Founder**: spec owner, technical decisions, all merge gates
- **Clinical Advisor**: clinical safety, prompts, classifier, blocklist
- **Regulatory Consultant**: non-SaMD posture, IUS sign-off
- **DPO**: PDPL compliance, DSR workflows, breach response
