# Demo Manifest — Frozen Seed + Graph Configuration

**Version:** v1.0 · **Date:** 15 September 2026
**Branch:** `feat/ui-light-theme` · **Baseline commit:** set at demo freeze
**Purpose:** C09 (readiness assessment) — reproducible demo data.

## Clean-reset procedure

```bash
# 1. Wipe and restart all infrastructure
just infra-reset           # down -v (wipes Postgres, Neo4j, MinIO data)
just demo-setup            # infra up + migrate + full seed + graph seed

# 2. Start services
just dev                   # core + web + all Python services

# 3. Verify
curl localhost:4000/api/v1/health   # → {"status":"ok",...}
curl localhost:5004/health           # → {"status":"ok",...}
open http://localhost:3000           # login as physician1
```

## Expected data counts (verify after clean reset)

| Store | Check | Expected |
|---|---|---|
| Postgres patients | `SELECT count(*) FROM hospital.patient;` | 50 (dev seed) |
| Postgres encounters | `SELECT count(*) FROM hospital.encounter;` | 100+ |
| Postgres service_requests | `SELECT count(*) FROM app.service_request;` | 100+ |
| Postgres nphies_claims | `SELECT count(*) FROM app.nphies_claim;` | 60 |
| Postgres audit_events | `SELECT count(*) FROM app.audit_event;` | 0 (fresh) |
| Neo4j NphiesDiagnosis | `MATCH (d:NphiesDiagnosis) RETURN count(d);` | 100+ |
| Neo4j NphiesService | `MATCH (s:NphiesService) RETURN count(s);` | 100+ |
| Neo4j NPHIES_JUSTIFIES edges | `MATCH ()-[r:NPHIES_JUSTIFIES]->() RETURN count(r);` | 500+ |
| Neo4j Patient nodes | `MATCH (p:Patient) RETURN count(p);` | 50 (after etl_pskg) |

## Graph data sources (versioned reference)

| Dataset | File | Ingest command |
|---|---|---|
| SNOMED-ICD10-AM map | `app.snomed_icd10am_map` (seeded via core) | `just seed-demo` |
| NPHIES diagnoses | `data/ontologies/nphies_diagnoses.json` | `just graph-seed` |
| NPHIES services/drugs | `data/ontologies/nphies_services.json` | `just graph-seed` |
| NPHIES necessity rules | `data/nphies_rules/*.json` | `just graph-seed` |
| NSCRE contraindications | `data/ontologies/nscre_contraindications.json` | `just graph-seed` |
| PSKG (patient graph) | Derived from Postgres seed | `etl_pskg.py` |

## Known illustrative data (disclosed, not hidden)

- NSCRE contraindication rules: **illustrative** reference data (watermarked
  in the UI with limitations). Production requires governed licensed releases.
- NPHIES profiles: **unverified** (`profiles_verified: false` on /health).
- Claim connector: **stub** (returns administrative acceptance, never real
  payer approval).
- Reference data checksums: to be added when licensed releases are obtained.

## Demo patient IDs (validated for the demo script)

| Patient | MRN | Why |
|---|---|---|
| Fatimah Al-Sayed (pt-017) | MRN-0017 | Hypertension + CKD (renal dose alert path) |
| Ahmad Fakename-Al-Bishi | MRN-010 | GI case (abdominal pain, colonoscopy orders) |
| Omar Fakename-Al-Dossary | MRN-006 | 4/12 rejected claims (rejection analytics path) |

## Pre-demo checklist

- [ ] `just infra-reset && just demo-setup` completed without errors
- [ ] All expected data counts match the table above
- [ ] `curl localhost:4000/api/v1/health` → `status: ok`
- [ ] Login works for physician1, admin1, nurse1, pharmacist1
- [ ] Journey wizard opens for a demo patient and all 5 stages complete
- [ ] Audit chain verification passes (`Verify` on the audit page)
- [ ] Demo containment flag set: `DEMO_CONTAINMENT=true` in `.env`
- [ ] This manifest is committed at the demo-freeze commit
