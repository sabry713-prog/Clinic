# 03 — Retrieval Index Design

## Purpose

Per-patient retrieval index supporting:
1. **Q&A grounding** — fetch source records relevant to a question
2. **Narrative source pull** — gather material for narrative generation
3. **Smart search backing** — natural-language search returns structured matches

Retrieval is **always patient-scoped**. There is no cross-patient retrieval surface in MVP.

## Chunking strategy

Each ingested record becomes one or more `retrieval_chunk` rows. Chunks contain:
- A short canonicalized factual text representation (1–3 sentences)
- The source pointer (source_type, source_id)
- The language tag (`ar` or `en`)
- An embedding (dense vector)

### Chunk templates by source type

**Observation (lab):**
```
"{code_display} = {value} {unit} on {effective_at|date} at {effective_at|time}.
Reference range: {ref_range_low}-{ref_range_high} {unit}. Status: {status}."
```
Two language variants generated (Arabic + English) for each observation.

**Observation (vital):**
```
"{code_display}: {value} {unit} recorded {effective_at|date_time}."
```

**MedicationRequest:**
```
"{medication_display} {dose} {route} {frequency}, status {status},
started {started_at|date}, prescriber {prescriber_display}."
```

**Condition:**
```
"Condition: {code_display} ({code_system}:{code}), status {status},
onset {onset_date}."
```

**AllergyIntolerance:**
```
"Allergy: {code_display}, reaction {reaction}, severity {severity},
recorded {recorded_at}."
```

**Encounter:**
```
"Encounter: {encounter_type}, status {status}, started {started_at|date_time},
ended {ended_at|date_time}, ward {ward}, bed {bed}, attending {attending}."
```

**DocumentReference (with inline text):**
```
"{type} authored {authored_at|date_time} by {author_display}:
{content_text|first_500_chars}"
```
Long documents are chunked into 500-char passages with overlap of 100 chars.

## Embedding model

To be selected (open question). Requirements:
- Multilingual (Arabic + English clinical text)
- In-Kingdom inference available
- Acceptable cost per chunk (we will index millions of chunks over time)
- Reasonable dimension (768–1536 typical)

Candidate evaluation criteria (run before final selection):
- Retrieval@10 on a held-out clinical Q&A test set
- Latency for batch embedding
- Latency for query embedding
- Vendor terms (no training on data, in-Kingdom processing)

## Indexing pipeline

```
On hospital data change (after FHIR ingest):
  For each new or updated row in hospital.observation / medication_request /
      condition / allergy_intolerance / encounter / document_reference:
    1. Build chunk template text(s) for {ar, en}
    2. Call embedding model
    3. Upsert into hospital.retrieval_chunk
       (delete prior chunks for same source_type + source_id first)
```

Indexing is **eventual**, not synchronous with API requests. Queue-driven.

## Query pipeline

```
Q&A receives question Q for patient P:
  1. Classifier classifies Q (allowed/refused) — short-circuit if refused
  2. Embed Q with embedding model → query_vector
  3. Retrieve:
     a) Vector: SELECT * FROM hospital.retrieval_chunk
                 WHERE patient_id = P
                 ORDER BY embedding <=> query_vector
                 LIMIT 20
     b) Keyword (BM25 via tsvector): SELECT * FROM hospital.retrieval_chunk
                 WHERE patient_id = P
                   AND to_tsvector('simple', content_text) @@ plainto_tsquery(Q)
                 LIMIT 20
  4. Hybrid rank: combine vector and keyword results (reciprocal rank fusion)
  5. Return top 8 chunks with full source_type + source_id references
```

## Source reference resolution

Every chunk references a row in `hospital.*`. When building an answer, the synthesis step:
1. Receives the top-N chunks
2. For each chunk, dereferences source_type + source_id to fetch the full source row
3. Passes both chunk text and source row to the model
4. Model output cites facts; provenance attaches the chunk + source IDs

## Performance targets

| Step | Target |
|---|---|
| Embed query | ≤ 150 ms |
| Hybrid retrieval (P95) | ≤ 300 ms |
| Source resolution batch | ≤ 100 ms |
| Total Q&A latency P95 | ≤ 7 s (most time in model inference) |

## Index maintenance

- On row update: delete + reinsert chunks for the affected source
- On row delete: delete chunks
- Periodic VACUUM and REINDEX (weekly maintenance window)
- Embeddings re-generated if embedding model version changes (background batch)

## Multi-language considerations

A question in Arabic may need to match chunks in English (if the source data is English) and vice versa. Mitigations:
- Generate both Arabic and English chunk variants for each source (where source field has a translatable display)
- Use multilingual embedding model that maps cross-language semantics
- Test cross-lingual retrieval explicitly in evaluation
