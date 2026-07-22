"""Unit tests for the NPHIES necessity Cypher helper and ontology ingestion.

A fake GraphClient stands in for Neo4j: it evaluates the necessity query
against the real CSV mapping, so the tests exercise the helper's contract and
the seed data together without needing a live database.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

import ingest_ontologies  # noqa: E402
from graph_client import GraphError, parse_auth  # noqa: E402
from necessity import (  # noqa: E402
    NECESSITY_CYPHER,
    check_nphies_necessity,
    explain_nphies_necessity,
)


class FakeGraph:
    """Minimal stand-in for GraphClient backed by the real necessity CSV."""

    def __init__(self, rows=None):
        self.rows = rows if rows is not None else ingest_ontologies.load_necessity_rows()
        self.calls = []

    def run(self, cypher, **params):
        self.calls.append((cypher, params))
        dx = params.get("diagnosis_code")
        svc = params.get("service_code")
        matches = [
            r for r in self.rows
            if r["diagnosis_code"] == dx and r["target_code"] == svc
        ]
        if "count(r) > 0 AS justified" in cypher:
            return [{"justified": len(matches) > 0}]
        return [
            {
                "diagnosis_code": m["diagnosis_code"],
                "target_code": m["target_code"],
                "target_type": m["target_type"],
                "rule_id": m["rule_id"],
                "source": m["source"],
            }
            for m in matches
        ]


@pytest.fixture
def graph():
    return FakeGraph()


# --------------------------------------------------------------------------
# check_nphies_necessity
# --------------------------------------------------------------------------
@pytest.mark.parametrize(
    "diagnosis,service",
    [
        ("I10", "11700-00-10"),      # hypertension -> ECG
        ("E11.9", "66551-00-10"),    # T2DM -> HbA1c
        ("J45.9", "11506-00-10"),    # asthma -> spirometry
        ("R07.4", "58500-00-10"),    # chest pain -> chest X-ray
        ("N18.3", "66500-00-10"),    # CKD3 -> renal profile
    ],
)
def test_justified_service_pairings_return_true(graph, diagnosis, service):
    assert check_nphies_necessity(diagnosis, service, client=graph) is True


@pytest.mark.parametrize(
    "diagnosis,medication",
    [
        ("E11.9", "A10BA02"),   # T2DM -> metformin
        ("J45.9", "R03BA02"),   # asthma -> budesonide
        ("E03.9", "H03AA01"),   # hypothyroidism -> levothyroxine
        ("K21.9", "A02BC01"),   # GORD -> omeprazole
    ],
)
def test_justified_medication_pairings_return_true(graph, diagnosis, medication):
    """The same helper serves SFDA medication targets, not just SBS services."""
    assert check_nphies_necessity(diagnosis, medication, client=graph) is True


@pytest.mark.parametrize(
    "diagnosis,service",
    [
        ("S93.4", "66551-00-10"),   # ankle sprain -> HbA1c: not a recorded rule
        ("J06.9", "11000-00-10"),   # URTI -> EEG: not a recorded rule
        ("I10", "R03AC02"),         # hypertension -> salbutamol: not recorded
        ("Z99.9", "11700-00-10"),   # unknown diagnosis
        ("I10", "99999-00-10"),     # unknown service
    ],
)
def test_unjustified_pairings_return_false(graph, diagnosis, service):
    assert check_nphies_necessity(diagnosis, service, client=graph) is False


def test_codes_are_normalized_case_and_whitespace(graph):
    assert check_nphies_necessity("  i10  ", " 11700-00-10 ", client=graph) is True


@pytest.mark.parametrize(
    "diagnosis,service",
    [("", "11700-00-10"), ("I10", ""), ("", ""), (None, None)],
)
def test_empty_codes_return_false_without_querying(graph, diagnosis, service):
    assert check_nphies_necessity(diagnosis, service, client=graph) is False
    assert graph.calls == []  # short-circuited, no Cypher issued


def test_result_is_a_real_bool(graph):
    result = check_nphies_necessity("I10", "11700-00-10", client=graph)
    assert isinstance(result, bool)


def test_empty_result_set_is_false():
    """A graph that returns no rows must read as 'not justified', not error."""
    class EmptyGraph:
        def run(self, cypher, **params):
            return []

    assert check_nphies_necessity("I10", "11700-00-10", client=EmptyGraph()) is False


def test_query_uses_parameters_not_string_interpolation(graph):
    check_nphies_necessity("I10", "11700-00-10", client=graph)
    cypher, params = graph.calls[0]
    assert cypher == NECESSITY_CYPHER
    assert params == {"diagnosis_code": "I10", "service_code": "11700-00-10"}
    assert "I10" not in cypher  # code never embedded in the statement


# --------------------------------------------------------------------------
# explain_nphies_necessity
# --------------------------------------------------------------------------
def test_explain_returns_rule_provenance(graph):
    rows = explain_nphies_necessity("I10", "11700-00-10", client=graph)
    assert len(rows) == 1
    assert rows[0]["rule_id"] == "NEC-0001"
    assert rows[0]["target_type"] == "service"


def test_explain_returns_empty_for_unjustified(graph):
    assert explain_nphies_necessity("S93.4", "66551-00-10", client=graph) == []


# --------------------------------------------------------------------------
# ontology seed data / ingestion
# --------------------------------------------------------------------------
def test_necessity_rows_load_and_normalize():
    rows = ingest_ontologies.load_necessity_rows()
    assert len(rows) >= 40
    for row in rows:
        assert row["target_type"] in ("service", "medication")
        assert row["diagnosis_code"] == row["diagnosis_code"].upper()
        assert row["rule_id"]


def test_every_necessity_code_exists_in_an_ontology_file():
    """Seed integrity: no dangling edge — every code in the mapping must be a
    node we actually create, or ingestion would silently no-op that edge.
    """
    dx = {n["code"].upper() for n in ingest_ontologies._load_json_nodes(ingest_ontologies.DIAGNOSES_FILE)}
    svc = {n["code"].upper() for n in ingest_ontologies._load_json_nodes(ingest_ontologies.SERVICES_FILE)}
    med = {n["code"].upper() for n in ingest_ontologies._load_json_nodes(ingest_ontologies.MEDICATIONS_FILE)}

    for row in ingest_ontologies.load_necessity_rows():
        assert row["diagnosis_code"] in dx, f"missing diagnosis {row['diagnosis_code']}"
        pool = svc if row["target_type"] == "service" else med
        assert row["target_code"] in pool, f"missing target {row['target_code']}"


def test_ingest_merges_nodes_and_edges():
    """Ingestion issues constraint + MERGE statements for every seed row."""
    class RecordingGraph:
        def __init__(self):
            self.statements = []

        def run(self, cypher, **params):
            self.statements.append((cypher, params))
            return []

    graph = RecordingGraph()
    counts = ingest_ontologies.ingest(client=graph)

    assert counts["diagnoses"] == 18
    assert counts["services"] == 13
    assert counts["medications"] == 14
    assert counts["necessity_edges"] >= 40
    # Constraints run first, then the MERGEs.
    assert sum("CREATE CONSTRAINT" in s for s, _ in graph.statements) == 3
    assert any("MERGE (d:Diagnosis" in s for s, _ in graph.statements)
    assert any("MERGE (d)-[r:JUSTIFIES]->(t)" in s for s, _ in graph.statements)


# --------------------------------------------------------------------------
# connection config
# --------------------------------------------------------------------------
def test_parse_auth_splits_user_and_password():
    assert parse_auth("neo4j/secret") == ("neo4j", "secret")


def test_parse_auth_keeps_slashes_in_password():
    assert parse_auth("neo4j/a/b/c") == ("neo4j", "a/b/c")


@pytest.mark.parametrize("bad", [None, "", "neo4j", "/secret", "neo4j/"])
def test_parse_auth_rejects_malformed(bad):
    with pytest.raises(GraphError):
        parse_auth(bad)
