"""Postgres-to-Neo4j ETL: materializes a per-patient knowledge graph (PSKG)
from the existing hospital.* Postgres tables.

    (:Patient {id, age, gender, mrn})
    (:Encounter {id, date, provider})
    (:Condition {icd10, display_name})       -- keyed by `key`, see _condition_key()
    (:Medication {sfda_code, rxnorm_code, name})  -- keyed by `key`, see _medication_identity()
    (:LabResult {test_name, value, unit, flag})

    (:Patient)-[:HAS_ENCOUNTER]->(:Encounter)
    (:Encounter)-[:DIAGNOSED_WITH]->(:Condition)
    (:Encounter)-[:PRESCRIBED {dose, route, frequency}]->(:Medication)
    (:Encounter)-[:HAS_LAB]->(:LabResult)

Design notes (see the Sprint 5 plan for the full rationale):

- `dose`/`route`/`frequency` live on the PRESCRIBED relationship, not the
  Medication node -- a Medication node identifies a *drug* (shared across
  encounters/patients, same as the ontology :Medication nodes in
  ingest_ontologies.py), but dose is per-prescription. Putting it on the node
  would mean two patients on the same drug at different doses fight over one
  property.
- `LabResult.flag` is a pure arithmetic comparison against the SOURCE's own
  recorded ref_range_low/ref_range_high (hospital.observation) -- never an
  inferred range, never a clinical judgment (CLAUDE.md sec 2 / the "ZERO
  FACTUAL HALLUCINATIONS" principle).
- `Patient.age` is computed at sync time from date_of_birth (Postgres age()
  arithmetic) -- a point-in-time snapshot, not interpretation; it goes stale
  between syncs the same way any cached derived value does.
- `Condition.icd10`/`Medication.sfda_code`/`rxnorm_code` are left null rather
  than fabricated when the source record doesn't actually carry that coding
  system -- see _condition_key()/_medication_identity().
- hospital.condition has no encounter_id column, so a condition is linked to
  its patient's nearest-by-date encounter as a best-effort correlation, or
  directly to the Patient node when no encounter correlates at all (a
  deliberate deviation from the literal "(:Encounter)-[:DIAGNOSED_WITH]"-only
  spec, documented here rather than silently applied). Medications and lab
  results get the SAME Patient-level fallback for the same reason -- live-
  verified against the dev-seed data that most patients (8931/11126) have no
  hospital.encounter rows at all, so without this fallback a large share of
  real, documented medications/lab results would be created as orphan nodes
  (no relationship at all), which the task's own tests explicitly require
  never happens.

Usage:
    DATABASE_URL=postgresql://... NEO4J_URI=bolt://localhost:7687 \\
        NEO4J_AUTH=neo4j/password python services/veritas-graph/etl_pskg.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Any, Optional

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parent))

from graph_client import AsyncGraphClient, GraphError, get_async_client  # noqa: E402

# Uniqueness constraints keep re-ingestion idempotent and lookups indexed.
# Distinct constraint names from ingest_ontologies.py's -- both target
# :Medication but on different properties (code vs key), which Neo4j allows.
CONSTRAINTS = [
    "CREATE CONSTRAINT pskg_patient_id IF NOT EXISTS FOR (p:Patient) REQUIRE p.id IS UNIQUE",
    "CREATE CONSTRAINT pskg_encounter_id IF NOT EXISTS FOR (e:Encounter) REQUIRE e.id IS UNIQUE",
    "CREATE CONSTRAINT pskg_condition_key IF NOT EXISTS FOR (c:Condition) REQUIRE c.key IS UNIQUE",
    "CREATE CONSTRAINT pskg_medication_key IF NOT EXISTS FOR (m:Medication) REQUIRE m.key IS UNIQUE",
    "CREATE CONSTRAINT pskg_labresult_id IF NOT EXISTS FOR (l:LabResult) REQUIRE l.id IS UNIQUE",
]

MERGE_PATIENT = """
MERGE (p:Patient {id: $id})
SET p.mrn = $mrn, p.age = $age, p.gender = $gender
"""

MERGE_ENCOUNTER = """
MERGE (e:Encounter {id: $id})
SET e.date = $date, e.provider = $provider
WITH e
MATCH (p:Patient {id: $patient_id})
MERGE (p)-[:HAS_ENCOUNTER]->(e)
"""

MERGE_CONDITION = """
MERGE (c:Condition {key: $key})
SET c.icd10 = $icd10, c.display_name = $display_name
"""

LINK_CONDITION_TO_ENCOUNTER = """
MATCH (e:Encounter {id: $encounter_id})
MATCH (c:Condition {key: $key})
MERGE (e)-[:DIAGNOSED_WITH]->(c)
"""

# Fallback when no encounter correlates (hospital.condition has no
# encounter_id column) -- never silently dropped, never fabricated a link.
LINK_CONDITION_TO_PATIENT = """
MATCH (p:Patient {id: $patient_id})
MATCH (c:Condition {key: $key})
MERGE (p)-[:DIAGNOSED_WITH]->(c)
"""

MERGE_MEDICATION = """
MERGE (m:Medication {key: $key})
SET m.sfda_code = $sfda_code, m.rxnorm_code = $rxnorm_code, m.name = $name
"""

LINK_MEDICATION_TO_ENCOUNTER = """
MATCH (e:Encounter {id: $encounter_id})
MATCH (m:Medication {key: $key})
MERGE (e)-[r:PRESCRIBED]->(m)
SET r.dose = $dose, r.route = $route, r.frequency = $frequency
"""

# Fallback when no encounter correlates -- same rationale as
# LINK_CONDITION_TO_PATIENT above. In the live dev-seed data most patients
# (8931/11126) have zero hospital.encounter rows at all, so without this
# fallback a large share of real, documented medications/lab results would
# become orphan nodes (found live, not just theoretical -- see the Sprint 5
# verification notes).
LINK_MEDICATION_TO_PATIENT = """
MATCH (p:Patient {id: $patient_id})
MATCH (m:Medication {key: $key})
MERGE (p)-[r:PRESCRIBED]->(m)
SET r.dose = $dose, r.route = $route, r.frequency = $frequency
"""

MERGE_LABRESULT = """
MERGE (l:LabResult {id: $id})
SET l.test_name = $test_name, l.value = $value, l.unit = $unit, l.flag = $flag
"""

LINK_LAB_TO_ENCOUNTER = """
MATCH (e:Encounter {id: $encounter_id})
MATCH (l:LabResult {id: $id})
MERGE (e)-[:HAS_LAB]->(l)
"""

LINK_LAB_TO_PATIENT = """
MATCH (p:Patient {id: $patient_id})
MATCH (l:LabResult {id: $id})
MERGE (p)-[:HAS_LAB]->(l)
"""


# -- Postgres reads (patient-scoped, modeled on apps/narrative's assembly.py) --

async def _fetch_patient(conn: Any, patient_id: str) -> Optional[dict[str, Any]]:
    row = await conn.fetchrow(
        """
        SELECT id, mrn, sex AS gender,
               date_part('year', age(now(), date_of_birth))::int AS age
        FROM hospital.patient
        WHERE id = $1
        """,
        patient_id,
    )
    return dict(row) if row else None


async def _fetch_encounters(conn: Any, patient_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT e.id, e.started_at AS date, e.attending_user_id, u.display_name AS provider
        FROM hospital.encounter e
        LEFT JOIN app."user" u ON u.id = e.attending_user_id
        WHERE e.patient_id = $1
        ORDER BY e.started_at DESC NULLS LAST
        """,
        patient_id,
    )
    return [dict(r) for r in rows]


async def _fetch_conditions(conn: Any, patient_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT c.id, c.code, c.code_system, c.code_display, c.onset_date,
               cic.icd10am_code AS confirmed_icd10
        FROM hospital.condition c
        LEFT JOIN app.condition_icd_coding cic ON cic.condition_id = c.id
        WHERE c.patient_id = $1
        """,
        patient_id,
    )
    return [dict(r) for r in rows]


async def _fetch_medications(conn: Any, patient_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT id, encounter_id, medication_display, code, code_system,
               dose, route, frequency, started_at
        FROM hospital.medication_request
        WHERE patient_id = $1
        """,
        patient_id,
    )
    return [dict(r) for r in rows]


def _to_float(value: Any) -> Optional[float]:
    """Postgres `numeric` columns arrive from asyncpg as decimal.Decimal,
    which the Neo4j driver rejects as a Cypher parameter type -- convert to
    plain float (or None) right after the fetch, before anything else
    touches the row."""
    return float(value) if value is not None else None


async def _fetch_lab_results(conn: Any, patient_id: str) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        """
        SELECT id, encounter_id, code_display, code, value_numeric, value_text,
               unit, ref_range_low, ref_range_high, effective_at
        FROM hospital.observation
        WHERE patient_id = $1 AND category = 'laboratory'
        """,
        patient_id,
    )
    results = [dict(r) for r in rows]
    for r in results:
        r["value_numeric"] = _to_float(r.get("value_numeric"))
        r["ref_range_low"] = _to_float(r.get("ref_range_low"))
        r["ref_range_high"] = _to_float(r.get("ref_range_high"))
    return results


# -- Deterministic transforms -- never fabricate, null when unknown ----------

def _condition_key(row: dict[str, Any]) -> tuple[str, Optional[str]]:
    """Returns (merge_key, icd10_or_None). Prefers the doctor-confirmed code
    (app.condition_icd_coding); falls back to the source code only when it's
    already ICD-10/ICD-10-AM; otherwise the node is still created (keyed by
    a composite so it doesn't collide with every other uncoded condition)
    but `icd10` stays null -- never guessed."""
    confirmed = (row.get("confirmed_icd10") or "").strip().upper()
    if confirmed:
        return confirmed, confirmed
    code_system = (row.get("code_system") or "").strip().lower()
    code = (row.get("code") or "").strip().upper()
    if code and "icd" in code_system and "10" in code_system:
        return code, code
    if code_system and code:
        return f"{code_system}:{code}", None
    return f"uncoded:{row['id']}", None


def _medication_identity(row: dict[str, Any]) -> tuple[str, Optional[str], Optional[str]]:
    """Returns (merge_key, sfda_code_or_None, rxnorm_code_or_None). Only
    populates a code when the source record's own code_system actually says
    so -- a generic code_system never gets relabeled as SFDA/RxNorm."""
    code_system = (row.get("code_system") or "").strip().lower().replace("-", "").replace(" ", "")
    code = (row.get("code") or "").strip()
    sfda_code = code if code and code_system == "sfda" else None
    rxnorm_code = code if code and code_system == "rxnorm" else None
    name = (row.get("medication_display") or "").strip()
    key = sfda_code or rxnorm_code or (name.lower() if name else f"unnamed:{row['id']}")
    return key, sfda_code, rxnorm_code


def _lab_flag(
    value_numeric: Optional[float],
    ref_range_low: Optional[float],
    ref_range_high: Optional[float],
) -> Optional[str]:
    """Pure arithmetic comparison against the SOURCE-provided reference
    range -- never a clinical judgment, never an inferred normal range
    (CLAUDE.md sec 2 / "ZERO FACTUAL HALLUCINATIONS")."""
    if value_numeric is None:
        return None
    if ref_range_high is not None and value_numeric > ref_range_high:
        return "high"
    if ref_range_low is not None and value_numeric < ref_range_low:
        return "low"
    if ref_range_low is not None or ref_range_high is not None:
        return "normal"
    return None


def _as_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=timezone.utc)
    return None


def _nearest_encounter_id(encounters: list[dict[str, Any]], reference: Any) -> Optional[str]:
    """Best-effort temporal correlation, used only when the source row has no
    direct encounter_id. `encounters` is already ordered most-recent-first."""
    candidates = [e for e in encounters if e.get("date") is not None]
    if not candidates:
        return None
    reference_dt = _as_datetime(reference)
    if reference_dt is None:
        return candidates[0]["id"]
    best = min(candidates, key=lambda e: abs((e["date"] - reference_dt).total_seconds()))
    return best["id"]


# -- Graph writes --------------------------------------------------------------

async def _ensure_constraints(graph: AsyncGraphClient) -> None:
    for statement in CONSTRAINTS:
        await graph.run(statement)


async def ingest_patient(
    patient_id: str,
    pool: "asyncpg.Pool[asyncpg.Record]",
    graph: AsyncGraphClient,
) -> dict[str, int]:
    """Re-materializes ONE patient's graph. MERGE-based throughout, so
    calling this twice for the same patient produces the same graph, never
    duplicate nodes -- safe to re-run as a full refresh or a one-off sync."""
    counts = {"patients": 0, "encounters": 0, "conditions": 0, "medications": 0, "lab_results": 0}

    async with pool.acquire() as conn:
        patient = await _fetch_patient(conn, patient_id)
        if patient is None:
            return counts
        encounters = await _fetch_encounters(conn, patient_id)
        conditions = await _fetch_conditions(conn, patient_id)
        medications = await _fetch_medications(conn, patient_id)
        lab_results = await _fetch_lab_results(conn, patient_id)

    await graph.run(
        MERGE_PATIENT,
        id=str(patient["id"]),
        mrn=patient.get("mrn"),
        age=patient.get("age"),
        gender=patient.get("gender"),
    )
    counts["patients"] = 1

    for enc in encounters:
        provider = enc.get("provider") or (
            str(enc["attending_user_id"]) if enc.get("attending_user_id") else None
        )
        enc_date = enc.get("date")
        await graph.run(
            MERGE_ENCOUNTER,
            id=str(enc["id"]),
            patient_id=str(patient_id),
            date=enc_date.isoformat() if enc_date else None,
            provider=provider,
        )
        counts["encounters"] += 1

    for cond in conditions:
        key, icd10 = _condition_key(cond)
        await graph.run(MERGE_CONDITION, key=key, icd10=icd10, display_name=cond.get("code_display"))
        encounter_id = _nearest_encounter_id(encounters, cond.get("onset_date"))
        if encounter_id:
            await graph.run(LINK_CONDITION_TO_ENCOUNTER, encounter_id=str(encounter_id), key=key)
        else:
            await graph.run(LINK_CONDITION_TO_PATIENT, patient_id=str(patient_id), key=key)
        counts["conditions"] += 1

    for med in medications:
        key, sfda_code, rxnorm_code = _medication_identity(med)
        await graph.run(
            MERGE_MEDICATION,
            key=key,
            sfda_code=sfda_code,
            rxnorm_code=rxnorm_code,
            name=med.get("medication_display"),
        )
        encounter_id = med.get("encounter_id") or _nearest_encounter_id(encounters, med.get("started_at"))
        edge_params = {
            "key": key,
            "dose": med.get("dose"),
            "route": med.get("route"),
            "frequency": med.get("frequency"),
        }
        if encounter_id:
            await graph.run(LINK_MEDICATION_TO_ENCOUNTER, encounter_id=str(encounter_id), **edge_params)
        else:
            await graph.run(LINK_MEDICATION_TO_PATIENT, patient_id=str(patient_id), **edge_params)
        counts["medications"] += 1

    for lab in lab_results:
        flag = _lab_flag(lab.get("value_numeric"), lab.get("ref_range_low"), lab.get("ref_range_high"))
        value = lab.get("value_numeric") if lab.get("value_numeric") is not None else lab.get("value_text")
        await graph.run(
            MERGE_LABRESULT,
            id=str(lab["id"]),
            test_name=lab.get("code_display") or lab.get("code"),
            value=value,
            unit=lab.get("unit"),
            flag=flag,
        )
        encounter_id = lab.get("encounter_id") or _nearest_encounter_id(encounters, lab.get("effective_at"))
        if encounter_id:
            await graph.run(LINK_LAB_TO_ENCOUNTER, encounter_id=str(encounter_id), id=str(lab["id"]))
        else:
            await graph.run(LINK_LAB_TO_PATIENT, patient_id=str(patient_id), id=str(lab["id"]))
        counts["lab_results"] += 1

    return counts


async def sync_patient_to_graph(
    patient_id: str,
    pool: "asyncpg.Pool[asyncpg.Record] | None" = None,
    graph: Optional[AsyncGraphClient] = None,
) -> dict[str, int]:
    """Real-time single-patient sync entry point -- callers pass a
    `patient_id` after a new encounter/lab result is saved. NOT yet wired
    into any apps/core write path (see the module-level Sprint 5 plan note);
    this makes real-time sync possible, not automatic.

    `pool`/`graph` are injectable for tests; when omitted, a short-lived pool
    and client are opened from DATABASE_URL/NEO4J_URI/NEO4J_AUTH and closed
    before returning.
    """
    owns_pool = pool is None
    owns_graph = graph is None
    if pool is None:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL is required for sync_patient_to_graph")
        pool = await asyncpg.create_pool(database_url, min_size=1, max_size=1)
    if graph is None:
        graph = get_async_client()
    try:
        await _ensure_constraints(graph)
        return await ingest_patient(patient_id, pool, graph)
    finally:
        if owns_pool:
            await pool.close()
        if owns_graph:
            await graph.close()


async def _run_full_refresh() -> dict[str, int]:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")
    pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5)
    graph = get_async_client()
    totals = {"patients": 0, "encounters": 0, "conditions": 0, "medications": 0, "lab_results": 0}
    try:
        await _ensure_constraints(graph)
        async with pool.acquire() as conn:
            patient_ids = [r["id"] for r in await conn.fetch("SELECT id FROM hospital.patient")]
        for pid in patient_ids:
            counts = await ingest_patient(str(pid), pool, graph)
            for k, v in counts.items():
                totals[k] += v
    finally:
        await pool.close()
        await graph.close()
    return totals


def main() -> int:
    try:
        totals = asyncio.run(_run_full_refresh())
    except (GraphError, RuntimeError) as exc:
        print(f"PSKG ETL failed: {exc}", file=sys.stderr)
        return 1
    print(
        f"Synced {totals['patients']} patients, {totals['encounters']} encounters, "
        f"{totals['conditions']} conditions, {totals['medications']} medications, "
        f"{totals['lab_results']} lab results into the graph."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
