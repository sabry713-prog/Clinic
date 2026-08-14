# E5 — ICD-10-AM vs ICD-10-CM Audit (discovery only)

**Status:** discovery complete. **No code was changed by this audit.** The
AM-vs-CM decision belongs to the human (with their coding specialists); this
document converts that decision into ~5 days of planned work once made.

**Why it matters:** NPHIES is the Saudi exchange, and the Saudi coding
standard question (AM, the Australian modification used by some Saudi
providers, vs CM, the US modification some payers/systems expect) determines
the diagnosis vocabulary on every claim, the reference-map table, the FHIR
`system` URI, and the dev seed. Shipping the wrong one is a leading cause of
wholesale claim rejection. Note the codebase is **uniformly ICD-10-AM today**
— CM appears only in documentation as the unresolved alternative.

## Method

Full-repo search for every occurrence of: `icd-10-am` (any case), `icd10am` /
`icd10am_code` / `icd10am_display` / `allowed_secondary_icd10am`,
`snomed_icd10am_map`, `icd10Code`, `icd10_code`, the FHIR system URI
`http://hl7.org/fhir/sid/icd-10-am`, `ICD-10-CM`, and the graph property
`icd10` / `:Diagnosis.system='ICD-10-AM'`. Verified against the live dev
database (tables/columns) and the running code.

## Summary of surfaces

| # | Surface | Files | Rename difficulty |
|---|---|---|---|
| 1 | FHIR system URI `http://hl7.org/fhir/sid/icd-10-am` | `apps/core/src/nphies/connector.service.ts:165` (hardcoded), `services/nphies-engine/config/nphies_profiles.json` (`code_systems.icd10_am`) | **Low** — 2 runtime spots. CM's canonical URI is `http://hl7.org/fhir/sid/icd-10-cm`. |
| 2 | Reference table `app.snomed_icd10am_map` (+ reseed) | migration `1718800000000` (create/insert/drop), `icd-coding.service.ts` (2 JOINs + INSERT), `seed/nphies-claims.ts`, `docs/api/08-nphies.md` | **DB rename** — new migration (`ALTER TABLE ... RENAME`), map rows re-pointed at the CM release, code references updated |
| 3 | Columns `icd10am_code` / `icd10am_display` | migrations `1718800000000`, `1719200000000` (PK `icd10am_code, sbs_code`), `1719400000000` (`allowed_secondary_icd10am`); `icd-coding.service.ts`, `claim-readiness.service.ts` (check id + SQL), `connector.service.ts`, `rejection-risk.service.ts`, `claim-readiness.service.spec.ts`, `seed/nphies-claims.ts`, `apps/web/src/lib/api.ts`, `CodingQueue.tsx`, `RejectionRiskPanel.tsx`, `services/veritas-graph/etl_pskg.py:184` | **Broad but mechanical** — column renames via migration + ~15 files' field references. `etl_pskg.py` reads the column by name from Postgres, so it must move in lockstep with the migration |
| 4 | Readiness check id `icd10am_mapping` + label `"ICD-10-AM coding confirmed"` | `claim-readiness.service.ts:137-138`, `docs/api/08-nphies.md:26`, consumed by `ClaimReadinessPanel.tsx` | **Medium** — the check **id** is an API contract; clients/audit trails observe it. Either keep the id (recommended: rename label only) or version the id deliberately |
| 5 | Python param `icd10_code` (snake) + `icd10Code` (camel, web `OrderLine`) | `preauth.dto.ts`, `preauth.service.ts`, `nphies.controller.ts`, all `services/nphies-engine` + `services/veritas-graph` files + tests, `apps/web/src/lib/api.ts`, `SullyContext.tsx`, `TimelinePane.tsx`, `PreAuthModal.tsx(+test)` | **Mechanical, no rename needed for AM→CM** — these are ICD-10-generic names, not AM-bound. Decide once whether to leave as-is (recommended) |
| 6 | Graph property `icd10` + literal `'ICD-10-AM'` on `:Diagnosis.system` | `ingest_ontologies.py:50` (writes the literal), `nscre_engine.py` (reads `c.icd10`), `data/ontologies/nphies_diagnoses.json` (`icd10` property), `data/ontologies/icd10am_diagnoses.json` (file name + `_meta.ontology`), `data/synthetic_seed.json` (13× `"system": "ICD-10-AM"`) | **Data + Cypher** — the property name is AM-generic (no change); the **literal value** and the **file name/ontology label** need a re-ingest (`just graph-seed` after renaming the data file) + synthetic-seed reseed |
| 7 | UI strings | `PreAuthModal.tsx` (`"Diagnosis (ICD-10-AM)"`), `CodingQueue.tsx` heading, `SullyContext.tsx` error string, `icd-coding.service.ts` / `nphies.controller.ts` error + Swagger summaries, `seed/nphies-claims.ts` error string | **Mechanical, user-visible** — pass through i18n where the surrounding component already does |
| 8 | Docs | `docs/api/08-nphies.md` (check table + coding section), `docs/ENGINEERING_WORK_BREAKDOWN.md:157-158` (already carries this plan), `docs/PROTOTYPE_EVALUATION.md`, `docs/TECHNICAL_ONBOARDING_BRIEF.md:219-221,250`, `docs/MARKET_READINESS_ROADMAP.md:84,123,248`, `docs/PROJECT-STATUS-FULL-2026-07-22.md`, `docs/executive-demo/EXECUTIVE_PRESENTATION.md` | Mechanical |

## Full occurrence inventory (by file)

### Database migrations — `apps/core/migrations/`

| File | Lines | What |
|---|---|---|
| `1718800000000_nphies-icd-coding.ts` | 17–20, 30–31, 40, 80 | Creates `app.snomed_icd10am_map` + `app.condition_icd_coding` with `icd10am_code` / `icd10am_display`; dev-seed INSERT; down() drops the table |
| `1718900000000_nphies-sbs-coding.ts` | 4 | Comment references "the ICD-10-AM pattern" |
| `1719200000000_nphies-rejection-risk.ts` | 7, 22–24, 34, 37 | Creates `diagnosis_procedure_compat` (later `nphies_clinical_mapping`) with `icd10am_code`, PK `(icd10am_code, sbs_code)`; seed INSERT |
| `1719400000000_nphies-clinical-mapping.ts` | 4, 24, 45, 54, 64 | Adds `allowed_secondary_icd10am`; UPDATE filters on `icd10am_code`; down() drops the column |

### apps/core — `apps/core/src/`

| File | Lines | What |
|---|---|---|
| `nphies/icd-coding.service.ts` | 2, 5, 23–29, 67–74, 90–97, 105, 122–126, 128, 138–142, 149–157, 166–170 | Doc comments; TS type fields; SQL SELECT/JOIN on `app.snomed_icd10am_map`; UPSERT columns; error message `"No ICD-10-AM mapping exists…"` |
| `nphies/claim-readiness.service.ts` | 11, 124, 137–143, 175, 221–226, 249, 264–297 | Doc comment; **check id `icd10am_mapping`**; label `"ICD-10-AM coding confirmed"`; detail strings; pairing/MDS SQL on `icd10am_code`; dynamic check id `mds_evidence_complete:<sr>:<icd10am_code>` |
| `nphies/claim-readiness.service.spec.ts` | 20, 74–200 | Mock rows carry `icd10am_code` |
| `nphies/connector.service.ts` | 11, 101, 104–107, 114, 165–167 | Types + SQL reading `cc.icd10am_code`; blocker string `"…clinician-confirmed ICD-10-AM code."`; **FHIR URI hardcode** at 165 |
| `nphies/rejection-risk.service.ts` | 30, 71, 78–93 | Types + SQL on `cc.icd10am_code` / `compat.icd10am_code` |
| `nphies/nphies.controller.ts` | 69, 83, 93, 100, 294 | Swagger summaries; audit payload `icd10am_code` |
| `nphies/preauth.dto.ts` / `preauth.service.ts` | 8, 21 / 24 | `icd10_code` DTO field (generic) |
| `seed/nphies-claims.ts` | 12, 20, 129–143, 169 | Reads `app.snomed_icd10am_map` + `app.nphies_clinical_mapping`; error string |
| `claim-integrity/claim-simulator.service.ts` | SQL + types | New E3 surface joins `cc.icd10am_code` (added this sprint — include in the rename batch) |

### apps/web — `apps/web/src/`

| File | Lines | What |
|---|---|---|
| `lib/api.ts` | 152–158, 217, 270 | TS types `icd10am_code` / `icd10am_display` / `icd10_code` |
| `components/ClaimReadinessPanel/CodingQueue.tsx` | 2, 5, 80, 116–118, 153–155 | Doc comments; heading `"ICD-10-AM coding (claim vocabulary)"`; rendered fields |
| `components/ClaimReadinessPanel/ClaimReadinessPanel.tsx` | 6, 121 | Doc comment; JSX comment |
| `components/ClaimReadinessPanel/RejectionRiskPanel.tsx` | 61 | Renders `p.icd10am_code` |
| `components/layout/SullyContext.tsx` | 82–83, 310–337, 888–889, 897 | `OrderLine.icd10Code` / `icd10Display` (camelCase); mock data; error string `"…confirmed ICD-10-AM diagnosis code…"`; maps to `icd10_code` API field |
| `components/layout/panes/TimelinePane.tsx` | 69 | `icd10Code` field spread |
| `components/timeline/PreAuthModal.tsx` / `.test.tsx` | 27–28, 124–125 / 19 | Props type; **label `"Diagnosis (ICD-10-AM)"`**; test fixture |

### services/nphies-engine

| File | Lines | What |
|---|---|---|
| `config/nphies_profiles.json` | 24 | **`code_systems.icd10_am` = the FHIR URI** (config-driven, read by `fhir_client`) |
| `fhir_client.py` | 222, 229, 238, 346–347, 602, 610 | `icd10_code` params (generic); resolves `_system("code_systems", "icd10_am")` |
| `api_router.py` / `tasks.py` | 41, 87 / 129, 146 | `icd10_code` Pydantic field + pass-through (generic) |
| `tests/test_nphies_fhir.py` | 221–223, 445 | `icd10_code` fixtures (generic) |

### services/veritas-graph

| File | Lines | What |
|---|---|---|
| `ingest_ontologies.py` | 5, 13, 35, 50 | Docstrings; `DIAGNOSES_FILE = icd10am_diagnoses.json`; **writes `system = 'ICD-10-AM'` literal** to Neo4j |
| `etl_pskg.py` | 184, 236–240 | SQL alias `cic.icd10am_code AS confirmed_icd10`; ICD-10/AM fallback docstring |
| `nphies_queries.py` / `api_router.py` / `nscre_engine.py` | 51 / 51, 87 / 111–112, 398–441, 653–709 | `icd10_code` params + Cypher `c.icd10` property (generic names) |
| `tests/test_nscre.py`, `tests/test_nphies_graph.py` | various | `icd10_code="I10"` fixtures (generic) |

### Data files

| File | What |
|---|---|
| `data/ontologies/icd10am_diagnoses.json` | **File name** + `_meta.ontology: "ICD-10-AM"` (loaded by `ingest_ontologies.py:35`) |
| `data/ontologies/nphies_diagnoses.json` | `_meta.ontology: "NPHIES Diagnosis (ICD-10)"`; node property `icd10` (generic) |
| `data/synthetic_seed.json` | 13 occurrences of `"system": "ICD-10-AM"` on seeded conditions |

### Docs

`docs/api/08-nphies.md` (check table, coding section, `icd10am_code` PK prose);
`docs/ENGINEERING_WORK_BREAKDOWN.md:157-158` (the original ~5-day estimate);
`docs/PROTOTYPE_EVALUATION.md` (258–264, 305, 367);
`docs/TECHNICAL_ONBOARDING_BRIEF.md` (219–221, 250);
`docs/MARKET_READINESS_ROADMAP.md` (84, 123, 248);
`docs/PROJECT-STATUS-FULL-2026-07-22.md:181`;
`docs/executive-demo/EXECUTIVE_PRESENTATION.md` (44, 112).

**ICD-10-CM today:** documentation only (the files above) — no code,
migration, config key, or data file uses CM. There is no
`http://hl7.org/fhir/sid/icd-10-cm` URI, no `icd10cm_*` column anywhere.

**Generic ICD-10 names that do NOT need changing for AM→CM** (flagged to
prevent over-renaming): `icd10_code` / `icd10Code` params and DTO fields;
the graph property `icd10`; `nphies_diagnoses.json`'s property name;
`docs/api/03-patient.md:73`; `packages/retrieval/tests/test_chunker.py` test
fixtures; `docs/prompts/ambient-condensation-prompt.md:50`.

## If the answer is CM — the ~5-day work plan

1. **Day 1 — vocabulary + schema.** Migration: rename
   `app.snomed_icd10am_map` → `app.snomed_icd10cm_map`, columns
   `icd10am_code`/`icd10am_display`/`allowed_secondary_icd10am` → `icd10cm_*`
   (all four tables: `snomed_icd10am_map`, `condition_icd_coding`,
   `nphies_clinical_mapping` incl. its PK, and any `mds` references). Replace
   dev reference rows with a CM-coded map (licensed CM release in production).
2. **Day 1–2 — FHIR system URI.** `connector.service.ts:165` and
   `nphies_profiles.json` `code_systems.icd10_am` →
   `http://hl7.org/fhir/sid/icd-10-cm`; update `test_nphies_fhir.py`
   expectations.
3. **Day 2–3 — apps/core services.** `icd-coding.service.ts`,
   `claim-readiness.service.ts` (+ spec), `connector.service.ts`,
   `rejection-risk.service.ts`, `claim-integrity/claim-simulator.service.ts`,
   `nphies.controller.ts`, `seed/nphies-claims.ts` — SQL column references,
   TS types, error strings, Swagger summaries. **Decision point:** keep the
   readiness check id `icd10am_mapping` (API-compat, recommended) or rename
   and version it.
4. **Day 3–4 — data + graph.** Rename `icd10am_diagnoses.json` →
   `icd10cm_diagnoses.json` (+ `_meta`), update `ingest_ontologies.py`
   (path + `'ICD-10-AM'` literal), update `data/synthetic_seed.json` (13
   rows), re-run `just graph-seed` + reseed dev data. `etl_pskg.py:184`
   column read moves with the migration.
5. **Day 4–5 — web + docs.** `api.ts` types, `CodingQueue.tsx`,
   `RejectionRiskPanel.tsx`, `PreAuthModal.tsx` label, `SullyContext.tsx`
   (OrderLine display + error string), i18n keys where applicable; the eight
   docs above; update this audit's status line.

## Decision inputs for the human

- What does CCHI/NPHIES actually mandate on the Claim.diagnosis coding
  system? (The official IG is not in this repo — `profiles_verified: false`
  on the engine's `/health` reflects the same gap.)
- What does the hospital's existing coding staff already code in (AM vs CM),
  and what does their CMMS export?
- Do target payers reject one modification outright?
- Licensed vocabulary availability: the repo's dev rows are illustrative
  either way; production needs the licensed release of whichever is chosen.
