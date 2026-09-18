# M06 — Graph lineage, stale-fact handling, and atomic publication

**Status:** plan agreed, implementation not started.
**Evidence base:** the files as they stand at `be5913b`, read directly.
**Related:** B5 (the derived-eGFR projection), the audit entry for M06, and commit
`901fbc7`, which claimed this work and did not do it.

---

## 1. What the code does today, with evidence

The PSKG is written by `services/veritas-graph/etl_pskg.py` through
`services/veritas-graph/graph_client.py`.

- Writes are eight standalone `MERGE` statements: `MERGE_PATIENT` (`:82`),
  `MERGE_ENCOUNTER` (`:87`), `MERGE_CONDITION` (`:95`), `MERGE_MEDICATION`
  (`:114`), `MERGE_LABRESULT` (`:139`), the derived-lab variant (`:158`), plus the
  relationship `MERGE`s inside them.
- Each one is issued as its own call (`etl_pskg.py:442`–`:524`), so each is its own
  transaction. A run that fails halfway leaves a partially written patient.
- `_rematerialize_patient` (`:427`) re-materializes one patient, and the docstring
  is accurate about what that means: MERGE-based throughout.
- Node identity comes from five constraints (`:75`–`:79`): `Patient.id`,
  `Encounter.id`, `Condition.key`, `Medication.key`, `LabResult.id`.
- Nothing in either file records which run or which source version produced a fact:
  `graph_client.py` is 195 lines of driver plumbing and carries no such notion.

## 2. The three defects, and what each one costs

**2.1 A fact that disappears from the source stays in the graph forever.**
The ETL only ever merges. If a medication is stopped, a diagnosis is retracted, or
a lab is corrected at the source, the graph keeps the old fact and the NSCRE engine
keeps reading it. For a claims-integrity check this is the dangerous direction: it
can raise an override against a patient who is no longer on the drug, and it can
*miss* a contraindication that only becomes visible once the stop is reflected.

**2.2 No atomic publication.** A reader querying while a run is in flight sees a
patient with half of one snapshot and half of the next. Two findings computed from
such a graph are not from the same clinical picture.

**2.3 No lineage.** A fact in the graph cannot be traced to the source version that
produced it, so it cannot be audited against the record it came from, and it cannot
be invalidated when that record changes.

## 3. The design

### 3.1 Retire, do not delete

A clinical fact that the source has withdrawn is **marked** as no longer current,
never removed. An override that was issued in March must stay explainable in
September; deleting the fact that justified it destroys the explanation. This also
keeps the graph an append-only history, which is what the audit trail assumes.

Each fact written by a run carries:

| Property | Meaning |
| --- | --- |
| `run_id` | the ETL run that last saw this fact |
| `source_version` | the source row version that produced it (already available from the ingestion side; where the source gives none, `null` and the fact is marked as carrying no version rather than guessed) |
| `last_seen_run` / `last_seen_at` | when it was last present in the source |
| `retired_at` | set when a later run no longer saw it |

### 3.2 Scope: patient-owned facts, never the shared dictionary nodes

`Condition(key)` and `Medication(key)` are **shared** nodes keyed by code —
`MERGE_CONDITION` (`:95`) and `MERGE_MEDICATION` (`:114`) merge them globally and
other patients point at the same node. Deleting or retiring one because *this*
patient no longer has it would corrupt every other patient's graph.

So a run retires, for the patient it is materializing:

- the patient's edges: `(p)-[:PRESCRIBED]->(m)`, `(p)-[:DIAGNOSED_WITH]->(c)`,
  `(p)-[:HAS_LAB]->(l)`, `(p)-[:HAS_ENCOUNTER]->(e)` and the encounter-scoped
  edges inside them;
- patient-owned nodes whose identity is not shared: `LabResult` (owned through
  `(e)-[:HAS_LAB]->(l)`, `:147`) and `Encounter` when it belongs only to this
  patient, and only when nothing else references them.

It never touches a `Condition` or `Medication` node.

### 3.3 Atomic publication: one property write

The ETL loads a patient's new facts under a new `run_id` — invisible, because a
reader filters on the published run — and then publishes with a **single** property
write on the patient node:

```cypher
SET p.published_run = $run_id, p.published_at = $now
```

One statement, one transaction, so a reader either sees the whole new snapshot or
the whole old one. No reader can observe a half-materialized patient. A run that
dies before that write changes nothing that is visible.

### 3.4 The reader side is part of the change

Retirement and publication are inert unless the NSCRE engine excludes facts that
are not in the published run. `services/veritas-graph/nscre_engine.py` and the
queries it issues must filter on the patient's published run, and the graph tests
must pin that a retired fact produces no finding while remaining present in the
graph with its `retired_at`. Without this, 2.1 and 2.2 stay exactly as they are.

## 4. Change list

| File | Change |
| --- | --- |
| `services/veritas-graph/graph_client.py` | a transactional `run_many` (one session, one transaction) so a patient's materialization is all-or-nothing, and `run_id`/`source_version` parameters threaded through |
| `services/veritas-graph/etl_pskg.py` | stamp facts with `run_id`/`source_version`; retire the patient's unseen facts; publish with the single `published_run` write; keep the derived-eGFR projection (B5) inside the same run |
| `services/veritas-graph/nscre_engine.py` | read only facts in the patient's published run; ignore retired facts |
| `services/veritas-graph/tests/` | the cases in §5 |
| `data/reference-release-manifest.json` + `tools/verify_demo_data.py` | assert the new invariants (every fact carries a `run_id`; no fact is visible outside its published run) |

## 5. Verification

1. A patient whose source loses a medication: the edge is retired (`retired_at`
   set, `last_seen_run` unchanged), the `Medication` node still exists, and the
   NSCRE engine produces no finding from the retired edge.
2. The same for a retracted diagnosis and a corrected lab value.
3. Another patient taking the same drug is **unaffected** — the shared node and
   their edge are untouched.
4. A run interrupted before the publish write leaves the previous snapshot fully
   visible and the new facts invisible.
5. A fact's `run_id` and `source_version` match the run and the source row that
   produced it, and the demo cohort's 50 patients still produce exactly the
   findings they produce today (the derived-eGFR case included).
6. `just graph-pskg` remains re-runnable with no drift, and the graph suite passes.

## 6. The decision that is not mine to make

Retiring rather than deleting is a change to how the clinical record is
represented, so per `CLAUDE.md` it needs **CTO + Clinical Advisor + Regulatory
Consultant** sign-off before it is implemented — specifically: whether a withdrawn
fact must remain queryable as history by a clinician, and whether the graph may
serve a snapshot that is not the latest source version.
