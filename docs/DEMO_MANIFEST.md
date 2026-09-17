# Demo Manifest — Frozen Seed + Graph Configuration

**Version:** v2.0 · **Date:** 17 September 2026
**Branch:** `feat/ui-light-theme`
**Purpose:** C09 (readiness assessment) — reproducible demo data.
**Verified by:** `just verify-demo-data` (asserts everything marked "asserted" below)

> **What changed in v2.0.** v1.0 of this file declared numbers that were never
> true: it named `app.audit_event` (the audit chain lives in `audit.event`),
> promised "100+" NPHIES graph nodes when the committed reference files contain
> **6** and **5**, and claimed "500+" necessity edges where the CSVs define
> **41** and **8**. It also listed `MRN-0017` as the renal-path demo patient —
> no such patient was ever seeded. Every figure below was measured against the
> running stack on 17 September, and the assertions now live in a script so they
> cannot drift again.

## Clean-reset procedure

```bash
# 1. Wipe and restart all infrastructure
just infra-reset           # down -v (wipes Postgres, Neo4j, MinIO data)
just demo-setup            # infra up + migrate + full seed + graph seed + checks

# 2. Start services
just dev                   # core + web + all Python services

# 3. Verify
just verify-demo-data      # schema + cohort + graph reference data
curl localhost:4000/api/v1/health   # → 200
open http://localhost:3000          # login as physician1 / Test1234!
```

`just demo-setup` ends by running `just verify-demo-data`, so a clean reset
either proves itself or fails loudly.

## Seed data — asserted

| Store | Check | Expected |
|---|---|---|
| Seeded cohort | `SELECT count(*) FROM hospital.patient WHERE mrn ~ '^MRN-[0-9]{3}$'` | **50** (`MRN-001` … `MRN-050`) |
| Demo patients | see the table below | all present |
| Seeded vitals | patients in the cohort with `category='vital-signs'` observations | **5** (MRN-006 … MRN-010) |
| PSKG projection | `MATCH (p:Patient) RETURN count(p)` | **50** (after `just graph-pskg`) |
| NPHIES diagnoses | `MATCH (d:NphiesDiagnosis) RETURN count(d)` | **6** (`nphies_diagnoses.json`) |
| NPHIES services | `MATCH (s:NphiesService) RETURN count(s)` | **5** (`nphies_services.json`) |
| NPHIES drugs | `MATCH (d:NphiesDrug) RETURN count(d)` | **3** (`nphies_drugs.json`) |
| Necessity edges | `MATCH ()-[r:JUSTIFIES]->() RETURN count(r)` | **41** (`nphies_necessity_map.csv`) |
| Pre-auth edges | `MATCH ()-[r:NPHIES_JUSTIFIES]->() RETURN count(r)` | **8** (`nphies_preauth_necessity_map.csv`) |

The graph checks are equalities against the committed files, not round numbers:
they prove the seed actually ran instead of partly ran.

## Live totals — reported, never asserted

These move whenever the ingestion scheduler runs, so `verify-demo-data` prints
them without failing on them (measured 17 September):

| Store | Value |
|---|---|
| `hospital.patient` (includes ingested FHIR records) | 13,599 and climbing |
| `hospital.encounter` | 6,217 |
| `app.service_request` | 20 |
| `app.nphies_claim` | 64 |
| `app.document_draft` | 4 |
| `audit.event` (the audit chain — **not** `app.audit_event`) | 17,041 |
| Neo4j `Encounter` / `Condition` / `Medication` / `LabResult` | 101 / 64 / 47 / 476 |

**Why the patient count is not 50:** the seed creates the 50-patient demo
cohort, and the ingestion scheduler separately pulls thousands of synthetic FHIR
records from the sandbox feed. Both are legitimate; only the cohort is the demo.
Do not read the total as "the demo has 13,599 patients".

## Graph data sources (versioned reference)

| Dataset | Source | Ingest command |
|---|---|---|
| SNOMED-ICD10-AM map | `app.snomed_icd10am_map` | `just seed-demo` |
| NPHIES diagnoses / services / drugs | `data/ontologies/nphies_*.json` | `just graph-seed` |
| NPHIES necessity rules | `data/ontologies/nphies_*_necessity_map.csv` | `just graph-seed` |
| NSCRE contraindications + renal dose limits | `data/ontologies/nscre_*.json` | `just graph-nscre-rules` |
| PSKG (patient graph) | derived from the Postgres seed | `just graph-pskg` |

All are checksummed in `data/reference-release-manifest.json` and verified
before ingest.

## Demo patients — asserted

| Patient | MRN | Path it supports |
|---|---|---|
| Omar Fakename-Al-Dossary | MRN-006 | Rejection analytics (claims), vitals recorded |
| Sara Fakename-Al-Anazi | MRN-009 | Ambient documentation: SOAP + the nurse's vitals in Objective |
| Ahmad Fakename-Al-Bishi | MRN-010 | Order entry (GI case), vitals recorded |

**The renal-path patient does not exist.** v1.0 named `MRN-0017` "Fatimah
Al-Sayed — Hypertension + CKD (renal dose alert path)". There is no such
patient in the seed, and **no seeded patient has an eGFR result**, so the renal
dose-safety path cannot fire for any of them. Seeding one requires clinical
values from a governed source — that is a product decision, not a data fix.

## Known illustrative data (disclosed, not hidden)

- **NSCRE rules are an illustrative dev subset**: 4 contraindication pairs (all
  pairing warfarin with NSAIDs that no seeded patient is prescribed, so no edge
  is ever created) and 1 renal dose limit (metformin, eGFR < 30).
- **NPHIES profiles: unverified** (`profiles_verified: false` on `/health`).
- **Claim connector: stub** (administrative acceptance only, never payer
  approval).
- **No medication carries an SFDA code**, so NPHIES necessity validation cannot
  run for any patient.
- Reference data checksums cover the illustrative files only; licensed releases
  with named approvers are still required.

**Consequence, stated plainly:** all three NSCRE modules return zero findings
for every patient — `drug_interaction` (no reference pair matches a
prescription), `dose_safety` (no eGFR), `necessity` (no SFDA-coded
medication). The engine runs and reports honest evidence gaps; the demo should
present "no findings + explicit gap" as the expected state.

## Pre-demo checklist

- [ ] `just infra-reset && just demo-setup` completed without errors
- [ ] `just verify-demo-data` → `0 failed`
- [ ] `curl localhost:4000/api/v1/health` → 200
- [ ] Login works for physician1, admin1, nurse1, pharmacist1 (`Test1234!`)
- [ ] Journey wizard opens for a demo patient and stages advance
- [ ] Audit chain verification passes (`Verify` on the audit page)
- [ ] Demo containment flag set: `DEMO_CONTAINMENT=true` in `.env`
- [ ] This manifest is committed at the demo-freeze commit
