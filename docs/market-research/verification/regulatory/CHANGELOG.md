# Regulatory report verification changelog

## Status and handling

The verification subagent for `docs/market-research/saudi-regulatory-research.md` was terminated mid-run by a provider rate limit (HTTP 429). The report body had already been rewritten from primary sources, but the run ended before the generated `Sources:` block was appended and before this changelog was written. Both were completed by the parent session on 11 September 2026; the report body was not re-edited.

## What was corrected in the report body

Corrected claims, as evidenced by the current body versus the pre-verification draft:

1. **NPHIES 46% denominator.** Now stated as "46% of rejected items in prior authorizations," leading reason 46.14% of rejected PA items — explicitly *not* 46% of all PAs, denied claims, lost revenue or preventable denials. The chart percentages were also re-read: 8.00% duplicate code based on date, 5.23% contractual, 5.22% HPI, 5.01% not covered, 4.51% out of network, 3.98% refill-too-soon, 2.57% investigation, 2.56% annual limit. The earlier reversal of duplicate/contract values is corrected in place.
2. **Insurer-count explanation withdrawn.** The unverified "licensed-but-not-active" explanation for 28 regulated insurers versus 23 health-writing companies is removed.
3. **Ineligible-request claim withdrawn.** "81.2% missing patient credentials" is corrected to the source's actual labels (81.2% eligible, 18.8% not eligible, separate 5.8% no-member-found).
4. **SFDA classification left unresolved.** MDS-G027 is quoted for its intended-purpose test and its non-device examples; the report no longer asserts exemption, and states that a billing label or clinician sign-off does not decide classification.
5. **CHI role corrected.** CHI is described as regulator; insurers are payers; TPAs administer; NPHIES validates/exchanges and does not adjudicate. CHI/NPHIES are no longer presented as the payer.
6. **PDPL residency and transfer corrected.** Article 29 conditional transfer route, Transfer Regulation Articles 2/4/7, three safeguard types, and the separation of processing, transfer and residency questions. The categorical "no adequacy decisions published" assertion is removed as not conclusively established.
7. **NCA ECC/CCC scope corrected.** ECC applies to government entities and affiliates plus private CNI owners/operators/hosts, with cloud subdomain 4-2 binding on cloud users; CCC applies to in-scope CSPs and CSTs with responsibilities shared, not transferred to the host.
8. **CST scope qualified.** No blanket healthcare-SaaS residency rule is asserted from the retrieved decision/guide page; applicability must be established.
9. **DGA applicability narrowed.** Government entities and private developers/operators of digital-government activities, with Ministry of Finance tender/procurement and framework-agreement obligations for public supply.
10. **DRG requirements scoped.** Shadow billing 2026–2027, reimbursement from 1 January 2028, quarterly internal audits, annual external audits from 1 January 2027, CDI for private-sector hospitals submitting DRG claims — stated as scoped provider obligations, not a requirement to buy this product.
11. **Vendor estimates, scarcity and causality claims removed** from the evidence base; the CDI observational difference is explicitly not treated as causal, generalizable or product-attributable; the market white space is restated as a hypothesis for testing.
12. **Method header added** stating this is research, not legal advice, regulatory approval or a compliance determination.

## Evidence artifacts

- `ledger.json` — 20 registered sources with 14 carrying tool-accepted literal evidence quotes.
- `evidence-documents.json`, `normalized-01..18.txt`, `primary-*.txt` — retrieved/normalized source texts used for verification.
- `live-batch1..3.json` — raw retrieval batches.
- `verify_sources.py` — the checking script used during the run.
- `citation-check.txt` — not produced by the terminated run; the parent re-ran the gate: `sources.py --ledger verification/regulatory/ledger.json verify saudi-regulatory-research.md --evidence` → **exit 0, `citations OK`**.

## Verification interpretation

Every cited source has a quote that the tool matched literally against the saved extract. Prose coverage reported by the heuristic is 29% (47 of 163 prose sentences carry a citation); no minimum-coverage gate is claimed. Six ledger sources ([10], [11], [13], [14], [15], [17]) are registered but not cited in the report and are retained only to preserve IDs. Literal-quote matching validates the quote against the saved text; it does not prove the truth of the source's assertions, and it is not legal or regulatory advice.

## Remaining gaps

- SFDA classification of the actual prototype modules was not determined and cannot be from documentation alone.
- Current status of SDAIA adequacy decisions and accreditation-certificate mechanisms was not conclusively established.
- No independent confirmation of CST registration obligations specific to a healthcare SaaS provider, or of MOH/CHI sectoral localization instruments beyond those retrieved.
- Procurement routes beyond the DGA/Finance framework text (for example NUPCO-specific software channels) were not verified and are no longer asserted.
- No NPHIES vendor-certification process documentation was retrieved and verified in this pass.
