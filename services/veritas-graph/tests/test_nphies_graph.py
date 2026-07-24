"""NPHIES pre-authorization necessity graph tests (Sprint 6).

A fake GraphClient stands in for Neo4j, evaluating the two queries against
the real CSV/JSON dev data -- same "test the helper's contract and the seed
data together, no live database" philosophy as tests/test_necessity.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

import ingest_nphies_rules  # noqa: E402
import nphies_ontology  # noqa: E402
from graph_client import GraphError, parse_auth  # noqa: E402
from nphies_queries import (  # noqa: E402
    NECESSITY_LOOKUP_CYPHER,
    SUGGESTED_DIAGNOSES_CYPHER,
    validate_order_necessity,
)


class FakeGraph:
    """Minimal stand-in for GraphClient backed by the real necessity CSV and
    diagnosis JSON."""

    def __init__(self, rows=None):
        self.rows = rows if rows is not None else ingest_nphies_rules.load_preauth_necessity_rows()
        self.descriptions = {
            n["icd10"]: n.get("description", "")
            for n in nphies_ontology._load_json_nodes(nphies_ontology.DIAGNOSES_FILE)
        }
        self.calls = []

    def run(self, cypher, **params):
        self.calls.append((cypher, params))
        if cypher == NECESSITY_LOOKUP_CYPHER:
            icd10 = params["icd10"]
            code = params["code"]
            for r in self.rows:
                if r["diagnosis_icd10"] == icd10 and r["target_code"] == code:
                    target_label = "NphiesService" if r["target_type"] == "service" else "NphiesDrug"
                    return [{"pre_auth_required": r["pre_auth_required"], "target_type": target_label}]
            return []
        if cypher == SUGGESTED_DIAGNOSES_CYPHER:
            code = params["code"]
            matches = sorted({r["diagnosis_icd10"] for r in self.rows if r["target_code"] == code})
            return [
                {"icd10": icd10, "description": self.descriptions.get(icd10, "")}
                for icd10 in matches[:3]
            ]
        raise AssertionError(f"unexpected cypher: {cypher}")


@pytest.fixture
def graph():
    return FakeGraph()


# --------------------------------------------------------------------------


def test_sciatica_lumbar_mri_is_yellow_with_preauth_required(graph):
    # The task's own required test case.
    result = validate_order_necessity("M54.3", "56241-00-10", client=graph)
    assert result == {"status": "YELLOW", "pre_auth_required": True, "suggested_codes": []}


def test_hypertension_ecg_is_green_without_preauth(graph):
    result = validate_order_necessity("I10", "11700-00-10", client=graph)
    assert result == {"status": "GREEN", "pre_auth_required": False, "suggested_codes": []}


def test_drug_pairing_is_green_without_preauth(graph):
    result = validate_order_necessity("E11.9", "SFDA-A10BA02", client=graph)
    assert result == {"status": "GREEN", "pre_auth_required": False, "suggested_codes": []}


def test_undocumented_pairing_is_red_with_suggested_diagnoses(graph):
    # Headache has no documented rule at all -- but M54.3 does justify this
    # same lumbar MRI code, so it should come back as a suggestion.
    result = validate_order_necessity("R51", "56241-00-10", client=graph)
    assert result["status"] == "RED"
    assert result["pre_auth_required"] is True  # conservative default, not a fabricated rule
    assert result["suggested_codes"] == [{"icd10": "M54.3", "description": "Sciatica"}]


def test_red_result_never_exceeds_three_suggestions(graph):
    # Fabricate extra rules all targeting the same service to prove the LIMIT.
    rows = list(graph.rows) + [
        {"diagnosis_icd10": f"Z{i}", "target_code": "11700-00-10", "target_type": "service",
         "pre_auth_required": False, "rule_id": f"X{i}", "source": "test", "note": ""}
        for i in range(5)
    ]
    graph2 = FakeGraph(rows=rows)
    result = validate_order_necessity("UNRELATED", "11700-00-10", client=graph2)
    assert result["status"] == "RED"
    assert len(result["suggested_codes"]) == 3


@pytest.mark.parametrize(
    ("icd10", "code"),
    [("", "56241-00-10"), ("M54.3", ""), ("", ""), (None, None)],
)
def test_empty_or_missing_codes_return_safe_red_without_querying(icd10, code):
    graph = FakeGraph()
    result = validate_order_necessity(icd10, code, client=graph)
    assert result == {"status": "RED", "pre_auth_required": True, "suggested_codes": []}
    assert graph.calls == []


def test_codes_are_normalized_case_and_whitespace(graph):
    result = validate_order_necessity(" m54.3 ", " 56241-00-10 ", client=graph)
    assert result["status"] == "YELLOW"


# -- ingestion --------------------------------------------------------------


class _FakeIngestGraph:
    """Records every MERGE/constraint call -- verifies node/edge ingestion
    calls the graph the expected number of times, same style as
    test_necessity.py::test_ingest_merges_nodes_and_edges."""

    def __init__(self):
        self.calls = []

    def run(self, cypher, **params):
        self.calls.append((cypher, params))
        return []


def test_ingest_ontology_nodes_merges_all_three_types():
    graph = _FakeIngestGraph()
    counts = nphies_ontology.ingest_ontology_nodes(client=graph)
    assert counts == {"diagnoses": 6, "services": 5, "drugs": 3}
    # Idempotent: running again produces the same counts (MERGE, not duplicate).
    counts2 = nphies_ontology.ingest_ontology_nodes(client=graph)
    assert counts2 == counts


def test_ingest_necessity_rules_produces_service_and_drug_edges():
    graph = _FakeIngestGraph()
    counts = ingest_nphies_rules.ingest_necessity_rules(client=graph)
    assert counts["service_edges"] + counts["drug_edges"] == len(
        ingest_nphies_rules.load_preauth_necessity_rows()
    )
    assert counts["service_edges"] > 0
    assert counts["drug_edges"] > 0


def test_every_necessity_row_target_exists_in_an_ontology_file():
    # Guards against a typo'd target_code in the CSV that would silently
    # produce a no-op MATCH (no edge created, no error) in the live graph.
    services = {n["sbs_code"] for n in nphies_ontology._load_json_nodes(nphies_ontology.SERVICES_FILE)}
    drugs = {n["sfda_code"] for n in nphies_ontology._load_json_nodes(nphies_ontology.DRUGS_FILE)}
    diagnoses = {n["icd10"] for n in nphies_ontology._load_json_nodes(nphies_ontology.DIAGNOSES_FILE)}
    for row in ingest_nphies_rules.load_preauth_necessity_rows():
        assert row["diagnosis_icd10"] in diagnoses
        if row["target_type"] == "service":
            assert row["target_code"] in services
        else:
            assert row["target_code"] in drugs


def test_parse_auth_still_works_unmodified():
    # Sanity check that this file's import of graph_client didn't break the
    # shared parse_auth() helper other tests also rely on.
    assert parse_auth("neo4j/secret") == ("neo4j", "secret")
    with pytest.raises(GraphError):
        parse_auth(None)
