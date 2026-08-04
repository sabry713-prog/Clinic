# Veritas-Medica — Engineering Work Breakdown

**Date:** 2026-08-03
**Companion to:** [`MARKET_READINESS_ROADMAP.md`](MARKET_READINESS_ROADMAP.md)
(the *what* and *why*) — this is the *how*, at a level an engineer can pick up.

Every item below was checked against the current tree. Where the roadmap
assumed something exists, and it does not, that is called out — three of those
materially change the estimates.

**Effort is in person-days** for one engineer familiar with the codebase.
Multiply by ~1.6 for someone new to it.

---

## Findings that revise the roadmap's assumptions

| # | Assumption | Reality | Effect |
|---|---|---|---|
| A | "Accuracy evaluation pack" is a reporting exercise | **No evaluation harness exists.** `docs/evidence-pack-e0.md` is a 73-line document; there is no `evals/` directory, no labelled dataset, no scoring code | E1 grows from ~3d to **~12d** and needs clinical input |
| B | DSR module gives erasure to build on | `dsr.service.ts` only **records requests** (`status: 'pending'`) — `createErase` writes a row, it does not delete anything, in Postgres or Neo4j | E8 is larger than "add Neo4j parity"; there is no working erasure anywhere |
| C | Checklist persistence is a small add | **Zero backend** — 0 references to `checklist` in `apps/core` | Needs migration + service + controller + client, not just a hook change |

None of these are blockers. All three were simply scoped optimistically because
the evaluation looked at *architecture*, not at whether each capability had a
working implementation behind it.

---

## NOW — 6 weeks

### E2 — Port orchestrator to `ModelProvider` — **4 days** *(highest RICE, 8.1)*

**Exists:** `apps/qa/src/qa/model_client.py` has the target pattern —
`ModelProvider` Protocol (`complete()` / `version()`), `StubModelProvider`,
`LocalModelProvider` over OpenAI-compatible `/chat/completions`, PHI guard
wired, `get_model()` factory.

**Missing:** `services/orchestrator/deepseek_client.py` has none of it —
`DEFAULT_BASE_URL = "https://api.deepseek.com"` hardcoded, no Protocol, no
provider switch, no guard. All five agents route through it.

**Build:**

1. `services/orchestrator/model_provider.py` — port the Protocol + both
   providers from `apps/qa`. Do **not** re-invent; keep the interface identical
   so the two services stay comparable.
2. `pyproject.toml` — add `phi-guard` path dependency (pattern already used by
   `services/nphies-engine`); bump `requires-python` to `>=3.12` to match.
3. Refactor `_chat_completion()` to delegate to the provider. `format_agent_prose`
   and `generate_soap_note` signatures stay unchanged — nothing downstream moves.
4. Env: `ORCHESTRATOR_MODEL_PROVIDER=stub|local|deepseek`,
   `MODEL_ENDPOINT_URL`, `MODEL_NAME`, reusing existing names.
5. Tests: provider selection; PHI-guard refusal for an external endpoint under
   `PHI_EGRESS_POLICY=block`; existing 59 orchestrator tests still green.

**Acceptance:** a self-hosted model swap is a `.env` change with no code edit,
demonstrated live. Audit **H-1 closes**.

**Watch:** `deepseek_client.py` currently raises when `DEEPSEEK_API_KEY` is
absent. Preserve the Sprint-10 degradation fix — the provider must fail in a way
`receptionist_agent.generate_care_instructions()` can still catch, or the
post-care package regresses to 500s.

---

### E4 — Finish UI wiring — **6 days**

Three separate gaps, different sizes.

**E4a — Agent action cards (M-1) — 2 days.**
`SullyContext.runAgentAction()` appends a message and returns; eight buttons
across five tabs do nothing. Split them:

| Action | Disposition |
|---|---|
| "Regenerate SOAP note" | Wire → E4b's endpoint |
| "Summarise prior encounters" | Wire → existing `/narrative` |
| "Show related results" | Wire → existing `/observations` |
| "Submit Pre-Auth" | Wire → existing `submitPreAuth` |
| "Adjust Dosage", "Check formulary tier", "Fix code mismatch", "Book follow-up", "Send visit summary" | **Mark "Pending integration"** using the `ReceptionistTab` pattern from Phase 1 |

Do not invent backends to make buttons light up. The disabled-with-explanation
treatment is already established and is the honest option.

**E4b — SOAP generation (H-3b) — 3 days.**
`generate_soap_note(transcript)` exists in the orchestrator and is never called.
Needs: a core proxy route (`POST patients/:id/ai-team/soap` — same scope/RBAC/
audit shape as the Phase 2 routes), `api.aiTeam.generateSoap()`, and
`SullyContext` calling it when live transcript lines land, replacing
`SOAP_STAGES`. Keep the canned stages under `dictationMode === "demo"`.

**E4c — Checklist persistence (M-7) — 1 day.** See finding **C** — this is a
new migration (`app.encounter_checklist`), service, controller and client
method, not a hook tweak.

---

### E1 — Clinical accuracy evaluation pack — **12 days** *(revised, finding A)*

**Exists:** nothing executable. `docs/evidence-pack-e0.md` describes a prior
gate but there is no harness, dataset or scoring code.

**Build:**

1. `evals/` — dataset format (JSONL: input, expected, rationale) and a runner
   emitting precision / recall / F1 per task.
2. **Labelled sets** (needs a clinical coder — the long pole, not the code):
   - ICD-10 coding suggestions: ≥200 conditions with correct codes
   - SBS order coding: ≥150 orders
   - NPHIES necessity: ≥100 diagnosis×order pairs with known verdicts
3. **Scribe WER**: ≥30 recorded consultations (Arabic + English), reference
   transcripts, WER per language. Synthetic/consented audio only.
4. **NSCRE regression set**: the DDI and renal-dose scenarios as fixed cases, so
   a reference-data change cannot silently alter clinical output.
5. `just eval` + CI job; a one-page report artefact.

**Acceptance:** a published one-pager with real numbers. **Publish them even if
unflattering** — measured weakness beats unmeasured confidence in front of a CMO.

**Sequencing note:** start dataset labelling in week 1. The code is ~4 days; the
labelling is the other 8 and cannot be compressed by engineering.

---

### E8 — Data erasure (PDPL) — **5 days** *(revised, finding B)*

**Exists:** `dsr.service.ts` records access/erase *requests* as `pending` rows
with audit events. **No actual deletion executes**, in Postgres or Neo4j.

**Build:**

1. `POST /api/v1/nscre/erase-patient` in `services/veritas-graph` —
   `MATCH (p:Patient {id})-[:HAS_ENCOUNTER*0..1]->()-[r]->(n) DETACH DELETE`,
   scoped to patient-fact labels only. **Must not delete reference nodes**
   (`NphiesDrug`, `DoseRule`, ontology `Medication`) — those are shared
   vocabulary. This is the one place to be careful; get the label allowlist
   explicit and test it.
2. An erase executor in `dsr.service.ts` that fans out to Postgres tables +
   the graph endpoint, transitions the request `pending → completed`, and audits.
3. Tests: erasure removes all patient facts; **reference data survives**;
   idempotent re-run; a failed graph call leaves the request `pending`, never
   falsely `completed`.

**Acceptance:** an erase request provably removes the patient from both stores,
with the graph reference vocabulary intact.

---

### E5 (discovery) — ICD-10-AM vs CM — **1 day** *(engineering)*

Spike only: confirm the required system URI, then size the change. Pre-scoped so
the answer converts straight into work:

| If the answer is | Change surface |
|---|---|
| ICD-10-**AM** (current) | None — confirm and move on |
| ICD-10-**CM** | `app.snomed_icd10am_map` (rename + reseed), `icd-coding.service.ts`, the FHIR system URI in `connector.service.ts` **and** `config/nphies_profiles.json`, seeded dev data, `OrderLine.icd10Code` display, docs. **~5 days** once the code set is in hand |

---

## NEXT — 3 months

### E3 — Claim-integrity pilot package — **15 days**

The roadmap's fastest revenue path. Almost entirely assembly of built parts.

- **Deployment profile** that runs claim readiness, coding, rejection risk and
  pre-auth **without** the clinical agents — a feature-flag/module composition in
  `app.module.ts`, so no SaMD surface ships. (~3d)
- **Rejection-cost dashboard** — SAR at risk by department and code. Data exists
  in `rejection-risk.service.ts`; this is aggregation + a page. (~5d)
- **Claim simulator** — "check before you send" against an existing claim batch;
  reuses `claim-readiness` + `validate_order_necessity`. (~4d)
- **Coder review queue** — batch surface for RCM teams; the current flow is
  clinician-first only. (~3d)

### E5 (execution) — NPHIES conformance — **8 days + external**

Real IG profiles into `config/nphies_profiles.json` (already config-driven —
this was the Sprint 9 design decision paying off), conformance testing, and
certificate lifecycle with annual renewal. Flip `profiles_verified` to `true`
**only when genuinely verified**; the flag is surfaced on `/health` and should
stay honest.

### E9 — ATC therapeutic-class data — **4 days**

Reference dataset + `(:Medication)-[:HAS_ATC_CLASS]->(:AtcClass)` edges, and a
class filter in `screen_alternative_candidates()`. Removes the "Warfarin as a
Metformin alternative" output and lets one of the two documented `limitations`
be dropped.

### Localisation quick wins — **4 days**

Hijri dates, Arabic patient-message templates, clinician-gender scheduling
preference. Small, visible, repeatedly requested.

---

## LATER

| Item | Effort | Trigger |
|---|---|---|
| E6 — durable queues (Celery/Redis or Postgres outbox) | 8d | Second site or second replica |
| SMART-on-FHIR launch | 15d | EMR embedding required by a buyer |
| E7 — dialect ASR | 25d+ | Only if pilot shows ambient is the wedge |
| Ambient consent capture | 3d | **Before any real ambient use** (PDPL) |
| SOC2/HITRUST | 60d+ | Non-KSA or large private group |

---

## Summary

| Phase | Days | Calendar (1 eng) | Calendar (2 eng) |
|---|---|---|---|
| **NOW** (E2, E4, E1, E8, E5-discovery) | **28** | ~6 weeks | ~3.5 weeks |
| **NEXT** (E3, E5-exec, E9, localisation) | **31** | ~7 weeks | ~4 weeks |
| **LATER** | 111+ | trigger-driven | — |

The NOW phase fits the roadmap's 6-week window **for one engineer only if E1's
labelling runs in parallel with a clinical resource.** With two engineers it
lands in ~3.5 weeks — and E1's dataset work is still the critical path, because
it is not engineering-bound.

**Highest leverage, in order:** E2 (4d — closes H-1, kills LLM lock-in, converts
the residency gate to internal), E4a (2d — removes the worst demo risk), then E8
(5d — the compliance item with no current implementation at all).
