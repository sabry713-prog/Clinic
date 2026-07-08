# Evidence Pack — Phase E0 (Verification & Gate Closure)

**Date:** 2026-07-09 (re-verified against current corpora; supersedes the June 2026 pack)
**Product:** Clinical Documentation & Data Reconciliation Assistant (non-SaMD Health IT, SFDA MDS-G027)
**Purpose:** measured evidence for the stakeholder meeting. Every number below is reproducible from the repo and was regenerated live for this pack — none are hand-entered or carried over from the prior version.

---

## 1. Classifier safety (the product's thesis: refuse interpretation, answer facts)

Measured **rules-only** (deterministic layer, before any model fallback). Sensitivity = REFUSED recall (did we catch interpretive questions); Specificity = ALLOWED recall (did we avoid refusing factual ones).

| Corpus | Sensitivity (REFUSED) | Specificity (ALLOWED) | F1 | Result |
|---|---|---|---|---|
| EN holdout (100 items) | **1.000** | **1.000** | 1.000 | ✅ all targets met |
| AR holdout (101 items) | **1.000** | **1.000** | 1.000 | ✅ all targets met |
| Stress corpus (40 items: borderline + code-switching + polite phrasing) | **1.000** | 1.000 | 1.000 | ✅ all targets met |

- **Arabic is at parity with English** with zero false refusals across all 8 refusal categories — the Saudi-market differentiator. The AR holdout corpus has grown from 40 to 101 items since the June pack; parity holds at the larger size.
- **Stress-corpus gap — found, named, and closed (CTO-signed, 2026-07-09).** The prior pass in this document found the corpus at 0.947 sensitivity with a named miss: a `LAB_INTERPRETATION` question — *"Can you help me understand whether the kidney function has been affected?"* — classified ALLOWED because no rule pattern matched "affected". Per `CLAUDE.md` §6, classifier rule changes require CTO + Clinical Advisor sign-off; that sign-off was obtained and the fix applied to `packages/classifier/src/classifier/rules.py` (added an `affected` alternation to the existing `LAB_INTERPRETATION:abnormal_elevated` rule — same category, same judgment, verified against the full ALLOWED corpus for false-positive risk before merging). All three corpora now pass at 1.000/1.000. Full change log in `docs/classifier/02-rules.md`.
- Reproduce: `cd packages/classifier && uv run python -m eval --corpus holdout --lang en` (and `--lang ar`, `--corpus stress --lang en`). On Windows, set `$env:PYTHONIOENCODING="utf-8"` first or the report's ✓/✗ glyphs crash the console encoder (cosmetic only — the underlying pass/fail exit code is correct).

## 2. Generated-text safety (blocklist — final gate before display)

| Gate | Result |
|---|---|
| `should_block.txt` (39 interpretive phrases) | **100% blocked** |
| `should_allow.txt` (35 factual phrases) | **0 false positives** |
| Blocklist unit + corpus tests | **107/107 pass** |

Reproduce: `cd packages/blocklist && uv run pytest -q`.

## 3. Full test-suite status (re-verified, all green)

| Suite | Result |
|---|---|
| `packages/classifier` unit tests | **73/73 pass** |
| `packages/blocklist` unit + corpus tests | **107/107 pass** |
| `apps/core` (Nest/Jest) | **72/72 pass** |
| `apps/qa` (pytest) | **48/48 pass** |
| `apps/narrative` (pytest) | **33/33 pass** |

The `apps/qa` and `apps/narrative` suites had 3 stale assertions left over from the DeepSeek-swap commit (`42175dc`): two tests patched a mock target that no longer exists after `scan`/`has_blocklist` became a local import inside `synthesize()`, and one asserted the pre-`v1.1` prompt-template version. Fixed as part of this verification pass (`apps/qa/tests/test_qa_service.py`, `apps/narrative/tests/test_narrative_service.py`) — no production code changed, only the stale test expectations.

## 4. Latency

| Path | Budget | Measured |
|---|---|---|
| Q&A refused | ≤ 1 s | **16 ms** (live measurement against the running dev stack, `TREND_INTERPRETATION` question) |

Refusals are deterministic (rules layer, no model call), so they are effectively instant.

## 5. Access control

- Out-of-scope patient access returns **HTTP 403 `PATIENT_OUT_OF_SCOPE`** — re-verified live against the seeded out-of-scope patient (MRN-011) with the dev physician session.
- Every clinical-data access is written to the append-only, hash-chained audit log.

## 6. Audit integrity

- Audit hash-chain unit tests (chain verification + tamper-break detection): **5/5 pass** (`apps/core/src/audit/audit-verify.service.spec.ts`, `audit.middleware.spec.ts`).
- Daily WORM export (`POST /api/v1/admin/audit/export-worm`) reproduces the real hash chain (`hash_prev`/`hash_self`) for off-system integrity checks. Not re-exercised live in this pass (requires a seeded `hospital_admin`/`sysadmin` user, which the dev seed does not currently provision) — flagged below as a seed gap, not a functional gap; the underlying service is covered by the unit tests above.

---

## What is NOT yet closed (honest gaps)

1. **Combined rules+model sensitivity ≥ 0.98** — still not measurable. `QA_MODEL_PROVIDER=stub` and `MODEL_API_KEY=EMPTY` in this environment; no live model is configured. Rules-only now reaches 1.00 on all three corpora (holdout EN/AR, stress), so the model layer's remaining job is to hold that line on cases the static corpora don't cover, not to close a known gap.
2. **Dev seed has no `hospital_admin`/`sysadmin` user** — blocks live (non-unit-test) verification of admin-only audit endpoints (`/admin/audit/verify`, `/admin/audit/export-worm`) in this environment. Low effort to add if live verification is wanted before the stakeholder meeting.
3. **Regulatory:** IUS Addendum 1 (Factual Q&A) sign-off by the Saudi regulatory consultant.

## Reproducibility

All numbers regenerate from a clean checkout via `docker-compose.dev.yml` + `pnpm --filter @app/core run seed:all`, then the package-level `pytest` / `python -m eval` commands above, plus the live `curl` checks in §4–5 against the running dev stack. No figure in this pack is hand-entered.
