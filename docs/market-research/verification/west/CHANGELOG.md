# West source verification — 2026-09-11

## Scope
Only `docs/market-research/global-west-research.md` and artifacts in `docs/market-research/verification/west/` were changed. Original evidence caches were read, not edited. Report edits used patch mode. All eleven vendor profiles retained.

## Corrections
- RCT checks now distinguish UCLA primary versus exploratory secondary outcomes, late registration, tested versions, English-only setting and omitted platform-editing time.
- UW coding endpoint is practitioner-entered/coder-reviewed documentation alignment, not autonomous coding, revenue or Saudi reimbursement. Quality review used an LLM judge on unedited notes; citation domain excluded. NNT is model-derived. Drift-window descriptions conflict within the article.
- Removed unverified adoption/funding/ROI aggregates, market superlatives and universal signoff assertions. Vendor PR, system announcements, commissioned evaluations and observational reports are labeled separately.
- CHI is not a dominant payer; NPHIES is not single-payer. US CPT/E/M effects cannot be presumed transferable. Current local regulatory roles/code sets remain a deployment prerequisite.
- Reviewed evidence, evaluation and deterministic Neo4j remediation are P0. LLM formats only. Removed confidence-only auto-pass and no-new-AI-risk recommendations. Linked Evidence is neither entailment proof nor an RCT-validated feature.

## Retrieval and limits
- Earlier PMC verification files contain only 403 bodies; verified methods/results against the existing cached article extracts (some paragraphs truncated). These were not represented as fresh successful fetches.
- Fresh extracts saved for CHI onboarding, Suki trade report, Mankato vendor page, Heidi vendor page and KLAS public landing page.
- KLAS full dataset requires login; no credentials used. Commissioning and metric selection remain unconfirmed. CHI direct HTTP retry returned 404 while extraction returned onboarding text; no claim of comprehensive current regulatory verification.
- A BeautifulSoup import was unavailable; no dependency installed. Existing extracted text was sufficient for retained narrow CHI statement.

## Validation
`citation-validation.txt`: evidence-gated verification with minimum coverage 0.5 passed; remaining warning identifies inherited unused ledger entries, intentionally retained to preserve IDs. This is citation/quote integrity, not semantic entailment certification.
`validation.json`: eleven profiles, architectural boundary, key RCT confidence intervals and removal of prohibited recommendations checked programmatically.
`quote-validation.json`: inherited quotes rechecked against saved extracts, plus trial-specific quote checks. `quotes.md` renders the final supporting excerpts; `ledger.json` preserves source identities.
`report-changes.diff`: before/after report diff captured independently of git tracking.

## Remaining gaps
Full RCT supplements/disclosures, primary UCSF paper, full GOSH evaluation/economic model, KLAS commissioning/methods, independent RCM outcome validation, Saudi Arabic clinical performance and local regulatory/coding/integration verification.
