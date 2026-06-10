# 02 — Components

## Code organization (monorepo)

```
/
├── apps/
│   ├── web/                    # React frontend
│   ├── core/                   # NestJS API + business logic
│   ├── narrative/              # Python narrative service
│   └── qa/                     # Python Q&A service
├── packages/
│   ├── fhir-client/            # TypeScript FHIR R4 client
│   ├── shared-types/           # TypeScript types shared between web/core
│   ├── audit/                  # Audit logging helpers (TypeScript)
│   ├── classifier/             # Python query classifier
│   ├── retrieval/              # Python retrieval / RAG library
│   └── blocklist/              # Python interpretive-language blocklist
└── infra/
    ├── docker-compose.yml      # Local development
    ├── k8s/                    # Production manifests
    └── terraform/              # Cloud infrastructure
```

## Components

### apps/core (TypeScript, NestJS)

**Responsibility:** business logic orchestration. Most clinician-facing API endpoints live here.

**Modules:**
- `auth/` — OIDC validation, session management
- `rbac/` — role and patient scope checks
- `patient/` — aggregated view assembly, search backed by Q&A service
- `handoff/` — handoff summary generation
- `narrative-proxy/` — passes narrative requests to narrative service
- `qa-proxy/` — passes Q&A requests to Q&A service
- `audit/` — audit event recording
- `ingestion/` — schedules and runs FHIR pulls
- `admin/` — user management, audit review

**External clients:**
- FHIR client (from packages/fhir-client)
- Narrative service (gRPC client)
- Q&A service (gRPC client)
- PostgreSQL via Prisma or TypeORM
- Object storage via AWS SDK (S3-compatible)

### apps/narrative (Python, FastAPI)

**Responsibility:** generate factual descriptive narrative summaries.

**Modules:**
- `assembly/` — pulls structured patient data, builds retrieval bundle
- `prompt/` — fills the narrative prompt template from `docs/prompts/narrative-prompt.md`
- `model_client/` — calls the foundation model with strict parameters
- `provenance/` — verifies every sentence has a source reference
- `filter/` — runs blocklist filter (from packages/blocklist)

**Internal API (gRPC):**
- `GenerateNarrative(patient_id, options) -> NarrativeOutput`

### apps/qa (Python, FastAPI)

**Responsibility:** factual Q&A with refusal of interpretive queries.

**Modules:**
- `classifier/` — uses packages/classifier; returns ALLOWED or REFUSED with reason
- `retrieval/` — uses packages/retrieval; patient-scoped vector + keyword search
- `synthesis/` — fills the answer prompt template, calls model
- `refusal/` — generates helpful refusal responses
- `filter/` — blocklist filter on the synthesized answer
- `provenance/` — attaches source references to each fact

**Internal API (gRPC):**
- `Answer(patient_id, question, language) -> AnswerOrRefusal`

### apps/web (TypeScript, React)

**Responsibility:** clinician UI.

**Routes:**
- `/` — patient list (scoped by care team / ward)
- `/patient/:id` — aggregated patient view
- `/patient/:id/narrative` — narrative panel
- `/patient/:id/qa` — Q&A conversation
- `/patient/:id/handoff` — handoff view
- `/admin/users` — user management
- `/admin/audit` — audit review
- `/admin/reconciliation` — identity quarantine queue

**Components:**
- `PatientHeader` — identity, allergies, problems
- `LabPanel` — chronological lab values with reference ranges (no color coding)
- `MedicationPanel` — active medications list
- `NarrativePanel` — narrative output with hover-to-source
- `QAConversation` — Q&A chat with source attribution + refusal handling
- `HandoffView` — handoff summary

### packages/fhir-client (TypeScript)

Wraps `@types/fhir` and an HTTP client. Handles:
- OAuth 2.0 / SMART on FHIR authentication
- Pagination, retry, circuit breaker
- Bundle parsing
- NPHIES profile validation (planned for v2)

### packages/classifier (Python)

Query classifier. Two layers:
1. **Rule layer** — fast deterministic patterns from `docs/classifier/02-rules.md`
2. **Model layer** — fine-tuned small classifier model for ambiguous cases

Returns:
```python
ClassifierResult(
    label: Literal["ALLOWED", "REFUSED"],
    confidence: float,         # 0.0 - 1.0
    rule_matches: list[str],   # which rules triggered (if any)
    refusal_category: Optional[str]  # if REFUSED, which category
)
```

### packages/retrieval (Python)

Patient-scoped retrieval over ingested FHIR data.

- Indexes per patient (vector + BM25 over structured content)
- Returns top-k passages with source references
- Embedding model: must be in-Kingdom; choice deferred (see open questions)

### packages/blocklist (Python)

Post-generation interpretive-language scanner.

```python
BlocklistResult(
    passed: bool,
    matches: list[BlocklistMatch],  # if not passed
)
```

Used by both narrative and Q&A services after generation.

### packages/audit (TypeScript)

Hash-chained audit event recording. Wraps PostgreSQL writes with mandatory hash computation.

## Service ports (development)

| Service | Port | Protocol |
|---|---|---|
| web | 3000 | HTTP |
| core | 4000 | HTTP (REST) |
| narrative | 5001 | gRPC |
| qa | 5002 | gRPC |
| PostgreSQL | 5432 | TCP |
| Keycloak | 8080 | HTTP |
| MinIO (dev S3) | 9000 | HTTP |
