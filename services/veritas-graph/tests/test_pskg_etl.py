"""Postgres-to-Neo4j PSKG ETL tests.

Uses a fake asyncpg pool (canned rows, shaped like the dev-seed's synthetic
patient data) and a fake async graph client that records every Cypher call
and maintains an in-memory node/edge view -- same "test the contract, not the
driver" philosophy as tests/test_necessity.py's FakeGraph, extended to async.

Covers:
  - A full patient (encounter + confirmed-ICD10 condition + SFDA-coded
    medication + an out-of-range lab result) produces exactly the expected
    nodes/edges -- no orphans, no duplicates.
  - Running ingest_patient twice is idempotent (same counts, same node/edge
    state both times) -- the task's own "no duplicate nodes" requirement.
  - An unconfirmed, non-ICD10 condition falls back to a composite key and
    never fabricates an icd10 value.
  - A medication whose code_system is neither sfda nor rxnorm leaves both
    code properties null but still creates the node; dose lands on the
    PRESCRIBED relationship, never the Medication node.
  - Lab flag is a pure range comparison: high / normal / null (no value, no
    range) -- never a clinical judgment.
  - sync_patient_to_graph (the real-time single-patient entry point) produces
    the same result as calling ingest_patient directly.
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from etl_pskg import (  # noqa: E402
    LINK_CONDITION_TO_ENCOUNTER,
    LINK_CONDITION_TO_PATIENT,
    LINK_LAB_TO_ENCOUNTER,
    LINK_LAB_TO_PATIENT,
    LINK_MEDICATION_TO_ENCOUNTER,
    LINK_MEDICATION_TO_PATIENT,
    MERGE_CONDITION,
    MERGE_ENCOUNTER,
    MERGE_LABRESULT,
    MERGE_MEDICATION,
    MERGE_PATIENT,
    _condition_key,
    _lab_flag,
    _medication_identity,
    _strip_dose_suffix,
    ingest_patient,
    sync_patient_to_graph,
    MARK_LAB_AS_DERIVED,
)

PATIENT_ROW = {"id": "patient-1", "mrn": "MRN-001", "gender": "female", "age": 41}

ENCOUNTER_ROWS = [
    {
        "id": "enc-1",
        "date": datetime(2026, 1, 10, tzinfo=timezone.utc),
        "attending_user_id": "user-1",
        "provider": "Dr. Amal Al-Otaibi",
    }
]

CONDITION_ROWS_CONFIRMED = [
    {
        "id": "cond-1",
        "code": "38341003",
        "code_system": "snomed",
        "code_display": "Essential (primary) hypertension",
        "onset_date": date(2026, 1, 9),
        "confirmed_icd10": "I10",
    }
]

MEDICATION_ROWS_SFDA = [
    {
        "id": "med-1",
        "encounter_id": "enc-1",
        "medication_display": "Amlodipine 5mg",
        "code": "SFDA-1234",
        "code_system": "sfda",
        "dose": "5mg",
        "route": "oral",
        "frequency": "once daily",
        "started_at": datetime(2026, 1, 10, tzinfo=timezone.utc),
    }
]

LAB_ROWS_HIGH = [
    {
        "id": "lab-1",
        "encounter_id": "enc-1",
        "code_display": "Creatinine",
        "code": "2160-0",
        "value_numeric": 168.0,
        "value_text": None,
        "unit": "umol/L",
        "ref_range_low": 60.0,
        "ref_range_high": 110.0,
        "effective_at": datetime(2026, 1, 10, tzinfo=timezone.utc),
    }
]


class FakeAsyncConn:
    def __init__(self, patient_row, encounter_rows, condition_rows, medication_rows, lab_rows):
        self._patient_row = patient_row
        self._encounter_rows = encounter_rows
        self._condition_rows = condition_rows
        self._medication_rows = medication_rows
        self._lab_rows = lab_rows

    async def fetchrow(self, query, *args):
        if "date_part('year'" in query:
            return self._patient_row
        raise AssertionError(f"unexpected fetchrow query: {query}")

    async def fetch(self, query, *args):
        if "FROM hospital.encounter" in query:
            return self._encounter_rows
        if "FROM hospital.condition" in query:
            return self._condition_rows
        if "FROM hospital.medication_request" in query:
            return self._medication_rows
        if "FROM hospital.observation" in query:
            return self._lab_rows
        raise AssertionError(f"unexpected fetch query: {query}")


class _AcquireCtx:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *exc_info):
        return False


class FakeAsyncPool:
    def __init__(self, conn: FakeAsyncConn):
        self._conn = conn

    def acquire(self):
        return _AcquireCtx(self._conn)

    async def close(self):
        pass


class FakeAsyncGraph:
    """Records every call and maintains a minimal in-memory node/edge view,
    matched against etl_pskg's own Cypher constants (imported, not
    re-typed) so the fake can never silently drift from the real templates."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.patients: dict[str, dict] = {}
        self.encounters: dict[str, dict] = {}
        self.conditions: dict[str, dict] = {}
        self.medications: dict[str, dict] = {}
        self.lab_results: dict[str, dict] = {}
        self.has_encounter_edges: set[tuple[str, str]] = set()
        self.diagnosed_with_edges: set[tuple[str, str, str]] = set()
        self.prescribed_edges: dict[tuple[str, str], dict] = {}
        self.has_lab_edges: set[tuple[str, str]] = set()
        self.derived_markers: dict[str, dict] = {}

    async def run(self, cypher, **params):
        self.calls.append((cypher, params))
        if cypher == MERGE_PATIENT:
            self.patients[params["id"]] = params
        elif cypher == MERGE_ENCOUNTER:
            self.encounters[params["id"]] = params
            self.has_encounter_edges.add((params["patient_id"], params["id"]))
        elif cypher == MERGE_CONDITION:
            self.conditions[params["key"]] = params
        elif cypher == LINK_CONDITION_TO_ENCOUNTER:
            self.diagnosed_with_edges.add(("encounter", params["encounter_id"], params["key"]))
        elif cypher == LINK_CONDITION_TO_PATIENT:
            self.diagnosed_with_edges.add(("patient", params["patient_id"], params["key"]))
        elif cypher == MERGE_MEDICATION:
            self.medications[params["key"]] = params
        elif cypher == LINK_MEDICATION_TO_ENCOUNTER:
            self.prescribed_edges[("encounter", params["encounter_id"], params["key"])] = {
                "dose": params["dose"], "route": params["route"], "frequency": params["frequency"],
            }
        elif cypher == LINK_MEDICATION_TO_PATIENT:
            self.prescribed_edges[("patient", params["patient_id"], params["key"])] = {
                "dose": params["dose"], "route": params["route"], "frequency": params["frequency"],
            }
        elif cypher == MERGE_LABRESULT:
            self.lab_results[params["id"]] = params
        elif cypher == LINK_LAB_TO_ENCOUNTER:
            self.has_lab_edges.add(("encounter", params["encounter_id"], params["id"]))
        elif cypher == LINK_LAB_TO_PATIENT:
            self.has_lab_edges.add(("patient", params["patient_id"], params["id"]))
        elif cypher == MARK_LAB_AS_DERIVED:
            self.derived_markers[params["id"]] = params
        # CREATE CONSTRAINT statements -- no-op in the fake
        return []


def _make_pool(patient=PATIENT_ROW, encounters=ENCOUNTER_ROWS, conditions=None, medications=None, labs=None):
    return FakeAsyncPool(
        FakeAsyncConn(patient, encounters, conditions or [], medications or [], labs or [])
    )


@pytest.mark.asyncio
async def test_full_patient_produces_expected_nodes_and_edges_no_orphans():
    pool = _make_pool(conditions=CONDITION_ROWS_CONFIRMED, medications=MEDICATION_ROWS_SFDA, labs=LAB_ROWS_HIGH)
    graph = FakeAsyncGraph()

    counts = await ingest_patient("patient-1", pool, graph)

    # derived_egfr is not a source row: it is computed from this patient's
    # creatinine (B5), and counted separately so it can never be mistaken for a
    # lab the hospital reported.
    assert counts == {
        "patients": 1,
        "encounters": 1,
        "conditions": 1,
        "medications": 1,
        "lab_results": 1,
        "derived_egfr": 1,
    }
    assert "patient-1" in graph.patients
    assert "enc-1" in graph.encounters
    assert graph.has_encounter_edges == {("patient-1", "enc-1")}

    assert graph.conditions["I10"]["icd10"] == "I10"
    assert graph.diagnosed_with_edges == {("encounter", "enc-1", "I10")}

    assert graph.medications["SFDA-1234"]["sfda_code"] == "SFDA-1234"
    assert graph.prescribed_edges[("encounter", "enc-1", "SFDA-1234")]["dose"] == "5mg"

    assert graph.lab_results["lab-1"]["flag"] == "high"
    assert graph.lab_results["lab-1"]["effective_at"] == "2026-01-10T00:00:00+00:00"
    # the creatinine on its encounter, plus the derived eGFR on the patient
    assert graph.has_lab_edges == {
        ("encounter", "enc-1", "lab-1"),
        ("patient", "patient-1", "egfr-ckdepi2021-patient-1"),
    }

    # No orphaned nodes -- every non-Patient/Encounter node has exactly the
    # one edge we expect, nothing extra.
    assert len(graph.diagnosed_with_edges) == 1
    assert len(graph.prescribed_edges) == 1
    assert len(graph.has_lab_edges) == 2


@pytest.mark.asyncio
async def test_ingest_patient_is_idempotent():
    pool = _make_pool(conditions=CONDITION_ROWS_CONFIRMED, medications=MEDICATION_ROWS_SFDA, labs=LAB_ROWS_HIGH)
    graph = FakeAsyncGraph()

    first = await ingest_patient("patient-1", pool, graph)
    second = await ingest_patient("patient-1", pool, graph)

    assert first == second
    # Still exactly one of each -- MERGE, not duplicate creation.
    assert len(graph.patients) == 1
    assert len(graph.encounters) == 1
    assert len(graph.conditions) == 1
    assert len(graph.medications) == 1
    # the measured creatinine plus the eGFR derived from it
    assert len(graph.lab_results) == 2
    assert len(graph.diagnosed_with_edges) == 1
    assert len(graph.prescribed_edges) == 1
    assert len(graph.has_lab_edges) == 2


@pytest.mark.asyncio
async def test_unconfirmed_non_icd10_condition_falls_back_and_never_fabricates():
    uncoded = [
        {
            "id": "cond-2",
            "code": "12345",
            "code_system": "local-ehr",
            "code_display": "Some locally-coded finding",
            "onset_date": None,
            "confirmed_icd10": None,
        }
    ]
    pool = _make_pool(conditions=uncoded)
    graph = FakeAsyncGraph()

    await ingest_patient("patient-1", pool, graph)

    key, icd10 = _condition_key(uncoded[0])
    assert icd10 is None
    assert key == "local-ehr:12345"
    assert graph.conditions[key]["icd10"] is None
    # No encounter correlates by date (onset_date is None) but the patient
    # DOES have an encounter -- falls back to the most recent one, not
    # dropped or linked to the patient directly in this case.
    assert ("encounter", "enc-1", key) in graph.diagnosed_with_edges


@pytest.mark.asyncio
async def test_condition_links_to_patient_when_no_encounter_exists_at_all():
    pool = _make_pool(encounters=[], conditions=CONDITION_ROWS_CONFIRMED)
    graph = FakeAsyncGraph()

    await ingest_patient("patient-1", pool, graph)

    assert graph.diagnosed_with_edges == {("patient", "patient-1", "I10")}


@pytest.mark.asyncio
async def test_medication_links_to_patient_when_no_encounter_exists_at_all():
    # Live-verified against the dev-seed data: most patients have zero
    # hospital.encounter rows, so this is the common case, not an edge case.
    no_encounter_med = [dict(MEDICATION_ROWS_SFDA[0], encounter_id=None)]
    pool = _make_pool(encounters=[], medications=no_encounter_med)
    graph = FakeAsyncGraph()

    counts = await ingest_patient("patient-1", pool, graph)

    assert counts["medications"] == 1
    assert "SFDA-1234" in graph.medications  # node still created, never dropped
    assert graph.prescribed_edges[("patient", "patient-1", "SFDA-1234")]["dose"] == "5mg"
    # No orphan: exactly one edge exists for this node, just to Patient not Encounter.
    assert len(graph.prescribed_edges) == 1


@pytest.mark.asyncio
async def test_lab_result_links_to_patient_when_no_encounter_exists_at_all():
    no_encounter_lab = [dict(LAB_ROWS_HIGH[0], encounter_id=None)]
    pool = _make_pool(encounters=[], labs=no_encounter_lab)
    graph = FakeAsyncGraph()

    counts = await ingest_patient("patient-1", pool, graph)

    assert counts["lab_results"] == 1
    assert "lab-1" in graph.lab_results  # node still created, never dropped
    # the derived eGFR joins it, on the patient, because this patient has no
    # encounter to hang it from
    assert graph.has_lab_edges == {
        ("patient", "patient-1", "lab-1"),
        ("patient", "patient-1", "egfr-ckdepi2021-patient-1"),
    }


@pytest.mark.asyncio
async def test_medication_with_unrecognized_code_system_leaves_codes_null():
    uncoded_med = [
        {
            "id": "med-2",
            "encounter_id": "enc-1",
            "medication_display": "Generic Analgesic",
            "code": "XYZ-9",
            "code_system": "local-formulary",
            "dose": "1 tablet",
            "route": "oral",
            "frequency": "as needed",
            "started_at": datetime(2026, 1, 11, tzinfo=timezone.utc),
        }
    ]
    pool = _make_pool(medications=uncoded_med)
    graph = FakeAsyncGraph()

    await ingest_patient("patient-1", pool, graph)

    key, sfda_code, rxnorm_code = _medication_identity(uncoded_med[0])
    assert sfda_code is None
    assert rxnorm_code is None
    assert key == "generic analgesic"
    node = graph.medications[key]
    assert node["sfda_code"] is None
    assert node["rxnorm_code"] is None
    assert node["name"] == "Generic Analgesic"
    # dose lives on the relationship, never on the Medication node itself.
    assert "dose" not in node
    assert graph.prescribed_edges[("encounter", "enc-1", key)]["dose"] == "1 tablet"


@pytest.mark.parametrize(
    ("value", "low", "high", "expected"),
    [
        (168.0, 60.0, 110.0, "high"),
        (30.0, 60.0, 110.0, "low"),
        (90.0, 60.0, 110.0, "normal"),
        (5.0, None, None, None),
        (None, 60.0, 110.0, None),
    ],
)
def test_lab_flag_is_pure_range_comparison(value, low, high, expected):
    assert _lab_flag(value, low, high) == expected


@pytest.mark.asyncio
async def test_sync_patient_to_graph_matches_ingest_patient_directly():
    pool_a = _make_pool(conditions=CONDITION_ROWS_CONFIRMED, medications=MEDICATION_ROWS_SFDA, labs=LAB_ROWS_HIGH)
    graph_a = FakeAsyncGraph()
    direct_counts = await ingest_patient("patient-1", pool_a, graph_a)

    pool_b = _make_pool(conditions=CONDITION_ROWS_CONFIRMED, medications=MEDICATION_ROWS_SFDA, labs=LAB_ROWS_HIGH)
    graph_b = FakeAsyncGraph()
    sync_counts = await sync_patient_to_graph("patient-1", pool=pool_b, graph=graph_b)

    assert direct_counts == sync_counts
    assert graph_a.patients.keys() == graph_b.patients.keys()
    assert graph_a.conditions.keys() == graph_b.conditions.keys()
    assert graph_a.medications.keys() == graph_b.medications.keys()


# ── Dose-suffix stripping (Task 6) ────────────────────────────────────────────


@pytest.mark.parametrize(
    ("input_name", "expected"),
    [
        ("warfarin 3mg", "warfarin"),
        ("warfarin 5 mg", "warfarin"),
        ("Metformin 500mg", "Metformin"),
        ("Metformin  500MG", "Metformin"),
        ("insulin 100units", "insulin"),
        ("insulin 100 units", "insulin"),
        ("amlodipine 2.5mg", "amlodipine"),
        ("solution 5%", "solution"),
        ("warfarin", "warfarin"),
        ("Warfarin 3mg", "Warfarin"),
        ("B12 100mcg", "B12"),
    ],
)
def test_strip_dose_suffix_variants(input_name, expected):
    assert _strip_dose_suffix(input_name) == expected


def test_medication_identity_strips_dose_suffix_from_name_key():
    """Two rows whose display names differ only by a dose suffix must
    produce the same merge key."""
    row_suffixed = {
        "id": "med-a",
        "medication_display": "warfarin 3mg",
        "code": None,
        "code_system": "",
    }
    row_plain = {
        "id": "med-b",
        "medication_display": "warfarin",
        "code": None,
        "code_system": "",
    }
    key_a, _, _ = _medication_identity(row_suffixed)
    key_b, _, _ = _medication_identity(row_plain)
    assert key_a == key_b == "warfarin"


def test_medication_identity_code_based_key_is_unaffected_by_dose_suffix():
    """SFDA/RxNorm-coded medications ignore the display name entirely."""
    row = {
        "id": "med-x",
        "medication_display": "Amlodipine 5mg",
        "code": "SFDA-1234",
        "code_system": "sfda",
    }
    key, sfda, rxnorm = _medication_identity(row)
    assert key == "SFDA-1234"
    assert sfda == "SFDA-1234"
    assert rxnorm is None


@pytest.mark.asyncio
async def test_dose_suffixed_medication_names_merge_with_base_name():
    """Two patients, one with "warfarin 3mg" and another with "warfarin"
    (both uncoded), should produce a SINGLE Medication node -- MERGE
    deduplicates on the stripped name key."""
    med_a = [
        {
            "id": "med-a",
            "encounter_id": None,
            "medication_display": "warfarin 3mg",
            "code": None,
            "code_system": "",
            "dose": "3mg",
            "route": "oral",
            "frequency": "once daily",
            "started_at": None,
        }
    ]
    med_b = [
        {
            "id": "med-b",
            "encounter_id": None,
            "medication_display": "warfarin",
            "code": None,
            "code_system": "",
            "dose": "5mg",
            "route": "oral",
            "frequency": "once daily",
            "started_at": None,
        }
    ]

    graph = FakeAsyncGraph()
    pool_a = _make_pool(encounters=[], medications=med_a)
    await ingest_patient("patient-a", pool_a, graph)

    pool_b = _make_pool(encounters=[], medications=med_b)
    await ingest_patient("patient-b", pool_b, graph)

    # Both patients should share the same Medication node (key = "warfarin").
    assert "warfarin" in graph.medications
    assert len(graph.medications) == 1

    # Each patient has its own PRESCRIBED edge with its own dose.
    assert ("patient", "patient-a", "warfarin") in graph.prescribed_edges
    assert ("patient", "patient-b", "warfarin") in graph.prescribed_edges
    assert graph.prescribed_edges[("patient", "patient-a", "warfarin")]["dose"] == "3mg"
    assert graph.prescribed_edges[("patient", "patient-b", "warfarin")]["dose"] == "5mg"

@pytest.mark.asyncio
async def test_projects_a_derived_egfr_labelled_as_derived():
    """B5: the renal check needs a LabResult containing 'gfr' and the cohort has
    none, so one is computed from the patient's own creatinine and marked."""
    pool = _make_pool(labs=LAB_ROWS_HIGH)
    graph = FakeAsyncGraph()

    await ingest_patient("patient-1", pool, graph)

    derived = [lab for lab in graph.lab_results.values() if "gfr" in str(lab["test_name"]).lower()]
    assert len(derived) == 1
    node = derived[0]
    assert node["id"] == "egfr-ckdepi2021-patient-1"
    assert node["unit"] == "mL/min/1.73m2"
    # LAB_ROWS_HIGH's creatinine is 168 umol/L; CKD-EPI 2021 puts a patient with
    # that value in the 30s, i.e. below the conventional threshold of 60, which is
    # exactly the case the renal rule exists to catch.
    assert 25 < float(node["value"]) < 45
    # no source reference range exists for a derived value, so no flag is invented
    assert node["flag"] is None

    marker = graph.derived_markers["egfr-ckdepi2021-patient-1"]
    assert "CKD-EPI 2021" in marker["formula"]
    assert "creatinine" in marker["derived_from"]


@pytest.mark.asyncio
async def test_no_derived_egfr_without_a_creatinine():
    """Nothing is derived from nothing: a patient with no creatinine gets no
    eGFR, and the check that needs it defers rather than firing on a guess."""
    labs_without_creatinine = [
        dict(LAB_ROWS_HIGH[0], id="lab-hb", code="718-7", code_display="Hemoglobin")
    ]
    pool = _make_pool(labs=labs_without_creatinine)
    graph = FakeAsyncGraph()

    counts = await ingest_patient("patient-1", pool, graph)

    assert "derived_egfr" not in counts
    assert not [lab for lab in graph.lab_results.values() if "gfr" in str(lab["test_name"]).lower()]


@pytest.mark.asyncio
async def test_no_derived_egfr_when_the_creatinine_unit_is_unrecognised():
    """Units are the difference between ~92 and ~2; an unknown one is refused."""
    odd_unit = [dict(LAB_ROWS_HIGH[0], unit="mg/24h")]
    pool = _make_pool(labs=odd_unit)
    graph = FakeAsyncGraph()

    counts = await ingest_patient("patient-1", pool, graph)

    assert "derived_egfr" not in counts

@pytest.mark.asyncio
@pytest.mark.parametrize(
    "unit",
    [
        "umol/L",       # ASCII
        "\u00b5mol/L",  # U+00B5 MICRO SIGN
        "\u03bcmol/L",  # U+03BC GREEK SMALL LETTER MU -- what the database holds
        "UMOL/L",
        " umol/l ",
    ],
)
async def test_creatinine_units_are_folded_before_comparison(unit):
    """The two mu characters look identical and are not.

    Comparing the raw string against the micro sign threw away every real
    creatinine (the source uses the Greek mu), so no eGFR was projected at all --
    silently, because refusing an unrecognised unit is a legitimate outcome. This
    is the test that would have caught it.
    """
    pool = _make_pool(labs=[dict(LAB_ROWS_HIGH[0], unit=unit)])
    graph = FakeAsyncGraph()

    counts = await ingest_patient("patient-1", pool, graph)

    assert counts.get("derived_egfr") == 1
    assert any("gfr" in str(lab["test_name"]).lower() for lab in graph.lab_results.values())


@pytest.mark.asyncio
async def test_creatinine_in_mg_dl_is_converted_not_assumed():
    """A source that reports mg/dL must be converted, not read as umol/L."""
    pool = _make_pool(labs=[dict(LAB_ROWS_HIGH[0], unit="mg/dL", value_numeric=1.5)])
    graph = FakeAsyncGraph()

    await ingest_patient("patient-1", pool, graph)

    derived = next(
        lab for lab in graph.lab_results.values() if "gfr" in str(lab["test_name"]).lower()
    )
    # 1.5 mg/dL == 132.6 umol/L; reading it as umol/L would put a healthy 20-something
    # value where a stage-3 one belongs
    assert 35 < float(derived["value"]) < 50


# --- M06, slice 1: run lineage -------------------------------------------------
#
# Every fact records the run that wrote it. Nothing reads it yet; it is the
# prerequisite for retiring a fact the source has withdrawn, because retiring has
# to know which run last saw it. These two tests pin the invariant that would
# otherwise rot silently: one patient materialization is exactly one run.

@pytest.mark.asyncio
async def test_every_write_records_the_identical_run():
    pool = _make_pool(
        conditions=CONDITION_ROWS_CONFIRMED, medications=MEDICATION_ROWS_SFDA, labs=LAB_ROWS_HIGH
    )
    graph = FakeAsyncGraph()

    await ingest_patient("patient-1", pool, graph)

    assert graph.calls, "the fake recorded no writes"
    for cypher, params in graph.calls:
        assert params.get("run_id"), f"a write carried no run id: {cypher[:40]}"
        assert params.get("loaded_at"), f"a write carried no timestamp: {cypher[:40]}"

    runs = {params["run_id"] for _, params in graph.calls}
    assert len(runs) == 1, f"one patient materialization must be one run, saw {runs}"


@pytest.mark.asyncio
async def test_two_patients_are_two_runs():
    pool = _make_pool(
        conditions=CONDITION_ROWS_CONFIRMED, medications=MEDICATION_ROWS_SFDA, labs=LAB_ROWS_HIGH
    )

    first, second = FakeAsyncGraph(), FakeAsyncGraph()
    await ingest_patient("patient-1", pool, first)
    await ingest_patient("patient-1", pool, second)

    run_a = {params["run_id"] for _, params in first.calls}
    run_b = {params["run_id"] for _, params in second.calls}
    assert len(run_a) == len(run_b) == 1
    assert run_a != run_b, "a re-materialization must be a new run, not a continuation"

