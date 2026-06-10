# 04 — Data Flow

## Flow 1 — Patient view aggregation

```
Clinician opens patient
  → GET /api/v1/patients/:id  [core service]
    → Auth: validate OIDC token
    → RBAC: check user has scope for this patient (care team or ward)
    → Audit: write PATIENT_VIEW event
    → DB: fetch latest ingested resources from hospital_data
      (Patient, Encounter, Condition, Observation, AllergyIntolerance,
       MedicationRequest, Procedure, DocumentReference, DiagnosticReport)
    → Assemble PatientView DTO (no interpretation, no flagging)
  ← 200 OK with PatientView JSON
```

Performance budget: ≤ 2s P95 from request to response.

## Flow 2 — Narrative generation

```
Clinician clicks "Generate narrative"
  → POST /api/v1/patients/:id/narrative  [core service]
    → Auth + RBAC + Audit (NARRATIVE_REQUEST)
    → gRPC call to narrative service: GenerateNarrative(patient_id)
        → narrative service:
          1. Pull structured patient bundle from DB
          2. Build retrieval bundle (lab trends, recent meds, recent docs)
          3. Fill prompt template from docs/prompts/narrative-prompt.md
          4. Call foundation model with strict params (temp=0.1, max_tokens=800)
          5. Parse model output
          6. Verify provenance: every sentence linked to source ID
          7. Run blocklist filter (packages/blocklist)
          8. If blocklist fails:
              retry up to 2x with stricter prompt
              if all retries fail: return fallback "Summary unavailable"
          9. Return NarrativeOutput with provenance refs
    ← NarrativeOutput
    → Audit: write NARRATIVE_GENERATED event with model version, prompt version
  ← 200 OK with narrative + provenance
```

Performance budget: ≤ 8s P95.

## Flow 3 — Q&A (allowed factual query)

```
Clinician types: "What was the last creatinine?"
  → POST /api/v1/patients/:id/qa  [core service]
    → Auth + RBAC + Audit (QA_REQUEST)
    → gRPC call to qa service: Answer(patient_id, question, language)
        → qa service:
          1. Classifier: classify the question
             → Rule layer: check explicit patterns
             → Model layer: classify ambiguous cases
             → Result: ALLOWED (confidence 0.97)
          2. Retrieval: query patient-scoped index
             → Returns top-5 relevant Observation records (creatinine)
          3. Synthesis: fill answer prompt, call model
             → Model produces grounded answer
          4. Provenance: link each fact to source ID
          5. Blocklist filter
          6. Return Answer with sources
    ← Answer
    → Audit: write QA_ANSWERED event (question text, classification,
      classifier confidence, sources used, model version, prompt version)
  ← 200 OK with answer + sources
```

Performance budget: ≤ 4s median, ≤ 7s P95.

## Flow 4 — Q&A (refused interpretive query)

```
Clinician types: "Is the kidney function getting worse?"
  → POST /api/v1/patients/:id/qa  [core service]
    → Auth + RBAC + Audit (QA_REQUEST)
    → gRPC call to qa service: Answer(...)
        → qa service:
          1. Classifier: classify
             → Rule layer: pattern "is [X] getting worse" → REFUSED
             → Result: REFUSED (refusal_category: TREND_INTERPRETATION)
          2. (Skip retrieval and model call)
          3. Refusal generator: build helpful refusal
             "I don't interpret clinical trends. Here are the recent
              creatinine values: [fetch values from DB]"
          4. Return Refusal with offered facts
    ← Refusal
    → Audit: write QA_REFUSED event (question, refusal category, alternative facts offered)
  ← 200 OK with refusal + offered facts
```

Performance budget: ≤ 1s.

## Flow 5 — FHIR ingestion (scheduled)

```
Cron: every 5 minutes
  → ingestion job [core service]
    → For each connected patient (those in active encounters):
       → FHIR client: pull updated resources since last sync
       → Identity reconciliation
          → If confidence < 95%: write to identity_quarantine table
          → If confidence ≥ 95%: upsert into patient table
       → Upsert resources into hospital_data with hash fingerprint
       → If new lab/vital/medication: update retrieval index for that patient
    → Write SYNC_COMPLETED event with counts and any errors
```

## Flow 6 — Audit log write (every request)

```
Every API request:
  → Middleware writes audit_event:
     id, ts, actor_id, action, target_type, target_id, outcome,
     request_metadata (no PHI), hash_prev, hash_self
  → hash_self = SHA-256(prev_hash + canonical_event_bytes)
  → Daily WORM replication to object storage
```
