# Competitor report verification changelog

## Status and handling

The verification subagent for `docs/market-research/saudi-competitors-research.md` was terminated by a provider rate limit (HTTP 429) after it had patched the report body but before it generated the `Sources:` block and this changelog. The parent session completed both on 11 September 2026. The report body was not re-edited by the parent; the inline `Sources` block was rendered with the markdown style, and the full quote render was saved as `evidence-quotes.md` in this directory so the report itself stays readable.

## Principal correction

The earlier differentiation thesis — that no competitor connects documentation, submission and adjudication, that the position was "underserved", and that a 12–24 month window existed — was **withdrawn**. It rested on an incomplete vendor set, and missing public evidence is not evidence of absence.

The withdrawal is evidenced by primary product pages retrieved in this pass:

| Vendor | Advertised overlap found | Source |
|---|---|---|
| Glance Care | Saudi-developed; SOAP Builder; Quick Coder (Moramiz AI) ICD-10-AM coding of clinical notes; pre-audit positioning, code recommendations and embedded audit trails | glance.care homepage and knowledge-centre article [15][13] |
| Santechture | "4 million+ rules" guarding claims before they leave a facility, encounter-to-settlement; Thynk real-time pre-submission validation with eligibility/necessity checks; Verity AI CDI, coding and coder/CDI task lists | santechture.com homepage, Thynk and Verity pages [16][4][5] |
| Solventum | Saudi Codefinder (ICD-10-AM/ACHI, SBS, code editing) and Saudi 360 Encompass (coding, CDI, audit, worklists); global Revenue Integrity Prebill Review flags high-risk claims before submission | Saudi brochures [17][18]; global factsheet [6] |
| Nano Health | Encounter-to-record-to-code-to-claim platform; NANO AI CDI 360 documentation validation and gap detection; DoctorSense Arabic/English conversational notes; Riyadh address and claimed Saudi regulatory activity | nanohealthsuite.com HIT and Saudi location pages [7][8] |

## Other corrections applied

1. **Waseel re-characterised.** Its OTD engine validates in real time against insurers' medical policies with automated service validation and smart rule checks — directly relevant to claim integrity, not merely transport. The report no longer asserts Waseel "cannot construct or evidence claims", and expressly asks for demonstration of encounter-documentation linkage and exportable provenance.
2. **Waseel pricing period removed.** Basic 1,499 SAR (≤500 transactions) and Premium 1,999 SAR (≤1,500 transactions) are retained, but the page states **no billing period**; the report forbids converting these into monthly USD amounts, a monthly price floor, or measured willingness to pay.
3. **Oracle corrected.** The "planned" label applies to a subset of functions (draft prior authorisations, proactive denial management, capture/validate charges); present-tense documentation and context-based coding suggestions are advertised. The prior inference that Oracle has shipped nothing relevant to claims is retracted.
4. **Lean, Selat, TachyHealth, Elm, OASIS and Clinicy re-scoped.** Language implying aggregate-only, services-only or absent-technology roles was removed; each row now states the specific evidence and the diligence gaps. TachyHealth's prior King Fahd Medical City case-study deployment is not counted as verified and its absence of provider-facing capability is no longer asserted.
5. **InterSystems limited to retrieved evidence.** TrakCare MEUI upgrade evidence and the signed IntelliCare transition agreement at King's Jeddah are retained; the LinkedIn-derived Saudi German Health timing and other deployment counts are dropped; future-tense IntelliCare wording is not converted into a go-live.
6. **Dedalus → ENTOMO confined to the primary transfer notice** — an operating transition, not evidence of customer dissatisfaction or a buying window.
7. **Sahl AI recast** from market leader to Saudi pilot evidence, with the JMIR study's stages and limitations reflected.
8. **Secondary regional statistics removed.** The AI-in-Arabia aggregates (hospital counts, vendor-consolidation counts, spend projections, paid-site assertions) are no longer used as market facts.
9. **Comparison matrix rebuilt** on the semantics "unresolved" = the reviewed evidence does not answer the question, explicitly not "not offered"; advertising is separated from confirmed implementation, and a per-player principal diligence gap is stated.
10. **Section 6 restated as hypotheses** with named acceptance tests in section 7; no market-entry timing window is estimated from the evidence reviewed.

## Evidence artifacts

- `ledger.json` — 33 registered sources; 31 cited in the report carry tool-accepted literal evidence quotes.
- `evidence-quotes.md` — full quote render for the cited sources (kept out of the report body to preserve readability).
- `verification-results.txt` — the parent's final evidence-gated citation run: **exit 0, `citations OK`**.
- `fresh-primary.json`, `fresh-incumbents.json`, `fresh-secondary-batch.json`, `evidence-index.json`, `page-*.txt`, `build-evidence.py` — retrieval and evidence-indexing artifacts from the run.
- The pre-existing `saudi-competitors-evidence/` cache was reused without modification.

## Retrieval limits recorded by the run

- The historic Cerner Middle East blog page failed retrieval, so prior MODHS facility counts, KFSH&RC detail and the UAE RCM example are not used as newly verified facts.
- Microsoft partner content returned an empty application shell; no Dragon Copilot availability conclusion is drawn from it in this report.
- Cached pages that were truncated are used only for content actually present; claims previously resting on those gaps were removed or qualified rather than silently confirmed.
- Solventum's Saudi brochures and its global prebill factsheet are read separately: they establish overlapping capability and local relevance, not a Saudi prebill deployment.
- Undated live pages establish what was advertised when retrieved, not historical release dates or audited adoption.

## Interpretation limits

Literal-quote verification confirms the quoted passage exists in the saved source text; it does not verify the vendor's own claims, establish adoption, or prove feature absence anywhere. Prose coverage reported by the heuristic is 31% (37 of 119 prose sentences carry a citation); no minimum-coverage gate is claimed, and two sentences carry more than three citations. Ledger sources [3] and [9] are registered but not cited.

## Open questions carried forward

Named Saudi reference customers for the newly added comparators; rule-set composition and validation for Santechture; Saudi availability and deployment of Solventum's prebill product; licensing boundaries and code-set support per module; comparable contract pricing and periodicity; regulator-register verification of vendor certification claims; and demonstrated evidence/provenance export behaviour for each product.
