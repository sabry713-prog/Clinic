# Evidence Pack — Phase E0 (Verification & Gate Closure)

**Date:** June 2026
**Product:** Clinical Documentation & Data Reconciliation Assistant (non-SaMD Health IT, SFDA MDS-G027)
**Purpose:** measured evidence for the stakeholder meeting. Every number below is reproducible from the repo.

---

## 1. Classifier safety (the product's thesis: refuse interpretation, answer facts)

Measured **rules-only** (deterministic layer, before any model fallback). Sensitivity = REFUSED recall (did we catch interpretive questions); Specificity = ALLOWED recall (did we avoid refusing factual ones).

| Corpus | Sensitivity (REFUSED) | Specificity (ALLOWED) | F1 |
|---|---|---|---|
| EN holdout (100 items) | **1.00** | **1.00** | 1.00 |
| AR holdout (40 items) | **1.00** | **1.00** | 1.00 |
| Code-switching stress | **0.95** | 1.00 | — |

Baseline before E0: EN 0.56, AR 0.25, code-switching 0.53 — see git history (`03e40f5`, `ccc946f`, `cc2c6e9`).

- **Arabic is at parity with English** with zero false refusals — the Saudi-market differentiator.
- The single code-switching miss is a politely-phrased ambiguous case, deferred to the model layer by design.
- Reproduce: `cd packages/classifier && uv run python -m eval --corpus holdout --lang en` (and `--lang ar`, `--corpus stress`).

## 2. Generated-text safety (blocklist — final gate before display)

| Gate | Result |
|---|---|
| `should_block.txt` (39 interpretive phrases) | **100% blocked** |
| `should_allow.txt` (35 factual phrases) | **0 false positives** |
| Blocklist unit + corpus tests | **107/107 pass** |

Reproduce: `cd packages/blocklist && uv run pytest -q`.

## 3. Classifier test suite

- **73/73** unit tests pass (`packages/classifier`), including category-precedence and bilingual cases.
- Eval harness import error fixed — `python -m eval` now completes (AC-5 is measurable).

## 4. Latency

| Path | Budget | Measured |
|---|---|---|
| Q&A refused | ≤ 1 s | **~10 ms** |

Refusals are deterministic (rules layer, no model call), so they are effectively instant.

## 5. Access control

- Out-of-scope patient access returns **HTTP 403 `PATIENT_OUT_OF_SCOPE`** (verified against a patient not assigned to the requesting physician).
- Every clinical-data access is written to the append-only, hash-chained audit log.

## 6. Audit integrity

- Audit chain verification passes (`POST /api/v1/admin/audit/verify`).
- Daily WORM export reproduces the real hash chain (`hash_prev`/`hash_self`) for off-system integrity checks.

---

## What is NOT yet closed (honest gaps)

1. **Combined rules+model sensitivity ≥ 0.98** — not measurable until the on-prem foundation-model endpoint is selected. Rules-only already reaches 0.95–1.00, so the model layer's remaining job is small.
2. **Regulatory:** IUS Addendum 1 (Factual Q&A) sign-off by the Saudi regulatory consultant.

## Reproducibility

All numbers regenerate from a clean checkout via `docker-compose.dev.yml` + dev seed, then the package-level `pytest` / `python -m eval` commands above. No figure in this pack is hand-entered.
