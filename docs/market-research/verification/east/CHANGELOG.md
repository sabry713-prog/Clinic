# East report verification changelog

## Scope and cutoff

- Cutoff: 11 September 2026.
- Corrected only `docs/market-research/global-east-ecosystem-research.md`; all new supporting files are inside `docs/market-research/verification/east/`.
- Report edits used the `patch` operation, including the mechanically generated Sources block. Original report and all existing `global-east-evidence/page-*.json` captures were inspected before drafting; existing cache files were left unchanged.
- `verification/east/` did not exist when this retry began, so no prior east verification ledger could be resumed. The original report and cache were available. No HTTP 429 blocked this retry.
- The report was already untracked in this checkout; `git diff` therefore did not produce a tracked-file diff. Patch tool output recorded the edits, and the resulting report was read for content checks.

## Corrections

1. Replaced conflicting five/six-region counts and aggregator-based availability with a primary-source shortlist: OCI Jeddah/Riyadh region table and Google's Dammam access documentation. Corrected CNTXT wording to KSA billing-address customers, not all customers worldwide.
2. Verified Amazon's December 2026 Saudi region target and Microsoft's 31 August 2026 announcement of November 2026 availability. These remain announcements at the cutoff, not operational regions. Kept the separate AWS–HUMAIN 50 MW by 2028 commitment explicitly future-tense.
3. Removed unsupported exact GPU catalogue/region-count claims, HUMAIN exclusivity, aggregator national capacity/facility figures and uncorroborated August GPU go-live details from the decision baseline. Retained company-qualified HUMAIN ONE/HR and Dammam inference statements.
4. Removed the uncorroborated Tawazun/Seha agent rollout, numerical targets and inferred MOH policy endorsement as substantiated examples.
5. Corrected Sahl: 64 simulated/control-setting feasibility assessments, then 55 real-world new-patient consultations (40 Arabic/15 English); not 119 clinical encounters. Retained separate 22-person convenience survey and different language score denominators. Explained that modified PDQI-9 domains were not formally validated and perceived time savings are not measured causal outcomes.
6. Bound Arabic benchmark numbers to arXiv 2508.15797v1, Table 3: ALLaM-7B-Instruct-preview, Fanar-1-9B-Instruct and Falcon3-7B-Instruct; distinguished Task 1 answer accuracy from Task 2 BERTScore. Separated the seven-task MedArabiQ paper (2505.03427v2). No extension to ALLaM 34B, later Fanar or Jais, and no clinical-safety threshold inferred from exams.
7. Removed universal no-validation/no-deployment claims and frontier-LLM clinical-reasoning recommendations. Restated the project boundary: graph-backed facts and deterministic rules; LLM formatting and human review.
8. Corrected Note Buddy to progressive SingHealth rollout beginning September 2024; national Tandem capability is not national product adoption. Qualified PEACH figures/approval as hospital reporting, not independently inspected regulatory records.
9. Corrected Prudential to company-reported PoCs and a selected-claims 3–4 month comparison rollout, not established industrial outcomes.
10. Kept Ping An accident/health automation separate from auto-insurance expense-ratio movement and Good Doctor financial results. Downgraded iFLYTEK procurement/Yidu efficiency to explicitly secondary diligence leads, removed inflated usage/scale baselines and did not call company press releases audited AI ROI.
11. Replaced Saudi-absence/first-mover/nobody-combines assertions with testable product hypotheses; distinguished insurers, regulators, procurers and providers.

## Evidence artifacts

- `ledger.json`: task-specific stable numbered citations (21 registered/cited sources).
- `fresh-1.json` through `fresh-8.json`, `extra-1.json` through `extra-5.json`, `phi.json`: fresh retrieval results, including any extraction omissions.
- `source-1.txt` through `source-21.txt`: text used to validate exact quotes; some reproduce pre-existing cached provider/operator pages rather than new fetches.
- `evidence-quotes.md`: mechanically rendered source/quote mapping.
- `citation-check.txt`: final `sources.py verify ... --evidence --strict` output, exit 0, `citations OK`.
- `claim-checks.json`: eight content-boundary checks, all true. These are regression checks, not independent semantic proof.
- `revised-body.md`: intermediate drafting artifact; the assigned report is the final deliverable and includes its generated source index.

## Verification interpretation

All 21 cited sources have tool-accepted literal evidence quotes. The strict citation/evidence gate passes. Its prose-coverage heuristic reports 23%; no minimum-coverage gate was claimed. The report contains substantial explicitly labelled recommendations, evidence limitations and tables, so this number is not an estimate of factual accuracy. Literal-quote checking verifies the quote against the saved extract, not the truth of every source assertion. Company announcements and secondary articles remain qualified as such.

## Remaining issues

- No purchaser-level service/capacity/API or GPU quota verification; no compliance certification.
- HUMAIN GPU catalogue/go-live details and omitted KACST/facility capacity leads remain unresolved.
- Sahl's inspected extraction supports methods/results and instrument limitations but does not contain complete conflict-of-interest/funding end matter; the previous employee/consultant claim was not repeated as newly verified.
- No exhaustive clinical-validation/deployment inventory for ALLaM, Fanar or Jais; no claim of absence follows.
- No independent HSA-record/full-study inspection for PEACH, completed Note Buddy rollout census, Prudential post-comparison scope or independently measured Nada/PHI outcomes.
- iFLYTEK procurement award and Yidu efficiency figure were not traced to underlying primary filings; they remain explicitly secondary leads. No audited/causal ROI inference is permitted.

## Reusable verification rules

- Check dated provider launch wording before assigning operational status; separate region availability from service SKU availability and compliance.
- Read methods, not only abstracts: simulated feasibility samples and implementation patients must never be merged into a clinical sample.
- Pin benchmark checkpoint, paper version, task, split and metric before transferring a score; semantic similarity is not clinical safety.
- Distinguish rollout eligibility, staged activation and actual adoption; distinguish PoC gain from production effect.
- Keep payer/segment/denominator identity attached to every insurance metric. Repeated secondary coverage is not independent primary corroboration.
