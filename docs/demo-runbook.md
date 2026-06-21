# Demo Runbook (Phase E5)

A flawless 15-minute story for the stakeholder meeting. Everything below runs
on a clean machine from `docker-compose.dev.yml` with synthetic data only.

---

## 1. Clean-environment setup (one command)

Prerequisites: Docker, Node + pnpm, `uv`, and `just`.

```bash
git clone https://github.com/sabry713-prog/Clinic.git && cd Clinic
cp .env.example .env
pnpm install
just demo-setup     # infra up + wait + migrate + full demo seed
just dev            # start core(4000) narrative(5001) qa(5002) web(3000)
```

`just demo-setup` runs: infra → wait for Postgres+Keycloak → migrate →
`seed:all` (dev + enrich + symptoms + reconciliation + search index).

Open **http://localhost:3000**, log in as **physician1 / Test1234!**.

> Note (on-prem model): Stage 1 runs in `stub` mode. To use the real on-prem
> model, set `{QA,NARRATIVE}_MODEL_PROVIDER=local` + `MODEL_ENDPOINT_URL` /
> `MODEL_NAME` (see `docs/architecture/on-prem-model.md`). No code change.

## 2. The demo patients (each exercises a feature)

| MRN | Highlights |
|---|---|
| **MRN-006 (Omar)** | **Medication reconciliation** — EHR vs pharmacy disagree (dose mismatch + one-sided meds) |
| **MRN-010 (Ahmad)** | Rich record for **search** + Q&A; atrial fibrillation, warfarin, penicillin anaphylaxis |
| **MRN-007 (Hana)** | Asthma; ibuprofen allergy; good **narrative** demo |
| MRN-008 / MRN-009 | Additional varied histories (CKD+diabetes; migraine+hypothyroid) |
| MRN-011 (Layla) | **Out-of-scope** — used to show access denial (403) |

## 3. Scripted 15-minute flow

1. **Login** → patient list shows only the 5 in-scope patients (RBAC).
2. **Patient view (MRN-010)** — aggregated record: allergies, conditions,
   labs (plain text, no color-coding), medications.
3. **Reconciliation (MRN-006 → Overview → Medication Reconciliation)** —
   EHR vs pharmacy columns; factual differences ("dose strings differ: 5 mg
   (ehr) vs 10 mg (pharmacy)"; "documented in ehr, not pharmacy"). *No flags.*
4. **Narrative (Narrative tab)** — generate; **hover any sentence** to see its
   source; note **Provenance: N/N (100%)**; **Copy with sources**. Toggle
   **العربية** → regenerate → Arabic structure, values verbatim.
5. **Search (Search tab)** — `creatinine`, then `دوخة` (Arabic) → verbatim
   excerpts grouped by record type.
6. **Q&A (Q&A tab / Copilot panel)** — one **allowed** factual question
   (e.g. "list his medications") → answer with sources. Then one **refusal**
   ("should we increase the dose?") → neutral "Type: medication-safety
   judgement — outside this tool's factual scope", with documented facts
   offered. **Show the refusal proudly — it is the product's thesis.**
7. **Handoff (Handoff tab)** — factual shift handoff, recent events.
8. **Audit trail** — log in as **Hospital Admin (subject …020)** → Audit page;
   show every action just performed is recorded; run **Verify** (hash-chain
   integrity passes); show the **compliance summary**
   (`GET /api/v1/admin/audit/summary`) for the DPO.

## 4. DPO compliance export

`GET /api/v1/admin/audit/summary?since=YYYY-MM-DD&until=YYYY-MM-DD` returns a
date-ranged compliance summary: total events, distinct actors, distinct
patients accessed, counts by action and outcome, and hash-chain integrity
status. The admin UI renders it as a printable report (browser print → PDF)
— no PHI free-text, IDs/codes only.

## 5. Boundary reminder (say this in the room)

Nothing in the product flags, prioritizes, scores, interprets, recommends, or
alerts. The refusal is a feature, not a limitation: it is what keeps this a
non-SaMD Health IT system under SFDA MDS-G027.
