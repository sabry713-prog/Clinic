"""NSCRE (Sprint 7) tests.

A FakeGraph backed by a small in-memory dataset stands in for Neo4j -- same
"test the contract, not the driver" philosophy as every prior sprint's
tests. The fake dispatches on exact Cypher-constant identity (imported from
nscre_engine.py / nphies_queries.py, never re-typed), so it can never
silently drift from the real templates.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from evidence_chain import EvidenceStep, build_evidence_chain  # noqa: E402
from nphies_queries import NECESSITY_LOOKUP_CYPHER, SUGGESTED_DIAGNOSES_CYPHER  # noqa: E402
from nscre_engine import (  # noqa: E402
    ACTIVE_MEDICATIONS_CYPHER,
    CONDITIONS_CYPHER,
    DOSE_LIMIT_FOR_DRUG_CYPHER,
    DRUG_INTERACTION_CYPHER,
    MOST_RECENT_EGFR_CYPHER,
    PROPOSED_DRUG_INTERACTIONS_CYPHER,
    PROPOSED_MEDICATION_NAME_CYPHER,
    SCREENABLE_MEDICATIONS_CYPHER,
    PATIENT_CONFLICTING_DRUGS_CYPHER,
    screen_alternative_candidates,
    check_dose_safety,
    check_drug_interactions,
    check_necessity,
    check_order,
    evaluate_encounter,
    ingest_nscre_rules,
)


class FakeGraph:
    """In-memory stand-in for GraphClient. Small fixed dataset covering the
    task's own required scenarios (Warfarin+NSAID, Metformin+eGFR<30) plus
    a few edge cases."""

    def __init__(self):
        self.calls = []

        self.patient_medications = {
            "patient-warfarin-nsaid": [
                {"key": "warfarin", "name": "Warfarin", "sfda_code": None},
                {"key": "ibuprofen", "name": "Ibuprofen", "sfda_code": None},
            ],
            "patient-no-interaction": [
                {"key": "metformin", "name": "Metformin", "sfda_code": "SFDA-A10BA02"},
                {"key": "lisinopril", "name": "Lisinopril", "sfda_code": None},
            ],
            "patient-on-warfarin": [
                {"key": "warfarin", "name": "Warfarin", "sfda_code": None},
            ],
            "patient-metformin-low-egfr": [
                {"key": "metformin", "name": "Metformin", "sfda_code": "SFDA-A10BA02"},
            ],
            "patient-metformin-normal-egfr": [
                {"key": "metformin", "name": "Metformin", "sfda_code": "SFDA-A10BA02"},
            ],
            "patient-metformin-no-egfr": [
                {"key": "metformin", "name": "Metformin", "sfda_code": "SFDA-A10BA02"},
            ],
            "patient-multi-egfr": [
                {"key": "metformin", "name": "Metformin", "sfda_code": "SFDA-A10BA02"},
            ],
            "patient-necessity-green": [
                {"key": "metformin", "name": "Metformin", "sfda_code": "SFDA-A10BA02"},
            ],
            "patient-uncoded-med": [
                {"key": "generic pain reliever", "name": "Generic Pain Reliever", "sfda_code": None},
            ],
            "patient-uncoded-condition": [
                {"key": "metformin", "name": "Metformin", "sfda_code": "SFDA-A10BA02"},
            ],
            # Sprint 10: low eGFR but NOT on metformin, so alternative screening
            # must reject metformin on renal grounds rather than skip it as
            # "already prescribed".
            "patient-low-egfr-no-metformin": [
                {"key": "lisinopril", "name": "Lisinopril", "sfda_code": None},
            ],
        }

        # Symmetric -- stored once per unordered pair.
        self.contraindications = {
            frozenset({"warfarin", "ibuprofen"}): {"severity": "severe", "rationale": "Bleeding risk"},
        }

        self.dose_rules = {
            "metformin": {
                "egfr_threshold": 30.0,
                "max_dose": "Contraindicated below eGFR 30",
                "flag": "CRITICAL_OVERRIDE",
                "rule_rationale": "Lactic acidosis risk",
            },
        }

        self.patient_labs = {
            "patient-metformin-low-egfr": [
                {"value": 28.0, "effective_at": "2026-01-01T00:00:00+00:00", "test_name": "eGFR"},
            ],
            "patient-metformin-normal-egfr": [
                {"value": 60.0, "effective_at": "2026-01-01T00:00:00+00:00", "test_name": "eGFR"},
            ],
            "patient-multi-egfr": [
                {"value": 45.0, "effective_at": "2025-06-01T00:00:00+00:00", "test_name": "Estimated GFR"},
                {"value": 20.0, "effective_at": "2026-02-01T00:00:00+00:00", "test_name": "eGFR"},
            ],
            "patient-necessity-green": [
                {"value": 90.0, "effective_at": "2026-01-01T00:00:00+00:00", "test_name": "eGFR"},
            ],
            "patient-low-egfr-no-metformin": [
                {"value": 22.0, "effective_at": "2026-03-01T00:00:00+00:00", "test_name": "eGFR"},
            ],
        }

        self.patient_conditions = {
            "patient-necessity-green": [{"icd10": "I10", "display_name": "Hypertension"}],
            "patient-uncoded-condition": [],  # simulates the WHERE c.icd10 IS NOT NULL filter upstream
        }

        # Mirrors Sprint 6's necessity shape but self-contained (not
        # dependent on the real CSV, so this test file can't silently break
        # if that data changes).
        self.necessity_rows = [
            {"diagnosis_icd10": "I10", "target_code": "SFDA-A10BA02", "target_type": "drug", "pre_auth_required": False},
        ]

    def run(self, cypher, **params):
        self.calls.append((cypher, params))

        if cypher == ACTIVE_MEDICATIONS_CYPHER:
            return list(self.patient_medications.get(params["patient_id"], []))

        if cypher == DRUG_INTERACTION_CYPHER:
            meds = self.patient_medications.get(params["patient_id"], [])
            out = []
            for i, m1 in enumerate(meds):
                for m2 in meds[i + 1 :]:
                    rule = self.contraindications.get(frozenset({m1["key"], m2["key"]}))
                    if rule and m1["key"] < m2["key"]:
                        out.append({"name1": m1["name"], "name2": m2["name"], **rule})
                    elif rule:
                        out.append({"name1": m2["name"], "name2": m1["name"], **rule})
            return out

        if cypher == SCREENABLE_MEDICATIONS_CYPHER:
            # Every drug the reference graph has safety data for, minus the flagged one.
            names = {"warfarin": "Warfarin", "ibuprofen": "Ibuprofen",
                     "metformin": "Metformin", "lisinopril": "Lisinopril"}
            screenable = set()
            for pair in self.contraindications:
                screenable |= set(pair)
            screenable |= set(self.dose_rules)
            return [{"key": k, "name": names.get(k, k.title())}
                    for k in sorted(screenable) if k != params["flagged_key"]]

        if cypher == PATIENT_CONFLICTING_DRUGS_CYPHER:
            meds = self.patient_medications.get(params["patient_id"], [])
            out = []
            for m in meds:
                for pair, _rule in self.contraindications.items():
                    if m["key"] in pair:
                        other = next(k for k in pair if k != m["key"])
                        out.append({"key": other, "conflicts_with": m["name"]})
            return out

        if cypher == PROPOSED_DRUG_INTERACTIONS_CYPHER:
            existing = self.patient_medications.get(params["patient_id"], [])
            proposed_key = params["proposed_key"]
            out = []
            for m in existing:
                if m["key"] == proposed_key:
                    continue
                rule = self.contraindications.get(frozenset({m["key"], proposed_key}))
                if rule:
                    out.append({"existing_name": m["name"], "proposed_name": proposed_key.title(), **rule})
            return out

        if cypher == MOST_RECENT_EGFR_CYPHER:
            labs = self.patient_labs.get(params["patient_id"], [])
            if not labs:
                return []
            best = max(labs, key=lambda l: l["effective_at"])
            return [best]

        if cypher == DOSE_LIMIT_FOR_DRUG_CYPHER:
            rule = self.dose_rules.get(params["drug_key"])
            return [rule] if rule else []

        if cypher == PROPOSED_MEDICATION_NAME_CYPHER:
            key = params["proposed_key"]
            return [{"name": key.title()}]

        if cypher == CONDITIONS_CYPHER:
            return list(self.patient_conditions.get(params["patient_id"], []))

        if cypher == NECESSITY_LOOKUP_CYPHER:
            for r in self.necessity_rows:
                if r["diagnosis_icd10"] == params["icd10"] and r["target_code"] == params["code"]:
                    return [{"pre_auth_required": r["pre_auth_required"], "target_type": "NphiesDrug"}]
            return []

        if cypher == SUGGESTED_DIAGNOSES_CYPHER:
            matches = sorted({r["diagnosis_icd10"] for r in self.necessity_rows if r["target_code"] == params["code"]})
            return [{"icd10": i, "description": ""} for i in matches[:3]]

        if cypher.strip().startswith("CREATE CONSTRAINT") or "MERGE" in cypher:
            return []  # ingestion calls -- no-op in the fake, covered by a separate call-count test

        raise AssertionError(f"unexpected cypher: {cypher}")

    def close(self) -> None:
        pass  # matches GraphClient's interface; api_router.py calls this in a finally block


@pytest.fixture
def graph():
    return FakeGraph()


# -- Module A: DDI -------------------------------------------------------------


def test_severe_ddi_warfarin_nsaid_detected(graph):
    # The task's own required case.
    results = check_drug_interactions("patient-warfarin-nsaid", client=graph)
    assert len(results) == 1
    hit = results[0]
    assert {hit["drug_a"], hit["drug_b"]} == {"Warfarin", "Ibuprofen"}
    assert hit["severity"] == "severe"
    assert "evidence_chain" in hit
    assert hit["evidence_chain"]["rendered"].startswith("Patient(")


def test_no_interaction_when_no_documented_contraindication(graph):
    results = check_drug_interactions("patient-no-interaction", client=graph)
    assert results == []


def test_check_order_no_interaction_for_unrelated_proposed_drug(graph):
    result = check_order("patient-no-interaction", proposed_drug_key="warfarin", client=graph)
    # patient-no-interaction has metformin + lisinopril, neither contraindicated with warfarin
    assert result["drug_interactions"] == []


def test_check_order_detects_interaction_with_proposed_drug(graph):
    # Patient is already on warfarin; proposing ibuprofen should flag the interaction.
    result = check_order("patient-on-warfarin", proposed_drug_key="ibuprofen", client=graph)
    assert len(result["drug_interactions"]) == 1
    hit = result["drug_interactions"][0]
    assert {hit["drug_a"], hit["drug_b"]} == {"Warfarin", "Ibuprofen"}
    assert hit["severity"] == "severe"


# -- Module B: renal dose safety ------------------------------------------------


def test_renal_dose_violation_metformin_low_egfr(graph):
    # The task's own required case.
    results = check_dose_safety("patient-metformin-low-egfr", client=graph)
    assert len(results) == 1
    v = results[0]
    assert v["medication"] == "Metformin"
    assert v["egfr_value"] == 28.0
    assert v["threshold"] == 30.0
    assert v["flag"] == "CRITICAL_OVERRIDE"
    assert "evidence_chain" in v


def test_no_dose_violation_when_egfr_above_threshold(graph):
    results = check_dose_safety("patient-metformin-normal-egfr", client=graph)
    assert results == []


def test_no_dose_violation_claimed_when_no_egfr_on_file(graph):
    # No renal-function data at all -- must never assume/guess a value.
    results = check_dose_safety("patient-metformin-no-egfr", client=graph)
    assert results == []


def test_most_recent_egfr_is_used_not_oldest(graph):
    # patient-multi-egfr has an old 45.0 (above threshold) and a newer 20.0
    # (below threshold) -- only the newer one should drive the result.
    results = check_dose_safety("patient-multi-egfr", client=graph)
    assert len(results) == 1
    assert results[0]["egfr_value"] == 20.0
    assert results[0]["egfr_date"] == "2026-02-01T00:00:00+00:00"


def test_check_order_dose_safety_for_proposed_drug(graph):
    result = check_order("patient-metformin-no-egfr", proposed_drug_key="metformin", client=graph)
    assert result["dose_safety"] == []  # no eGFR on file, no claim made

    result2 = check_order("patient-metformin-low-egfr", proposed_drug_key="metformin", client=graph)
    assert len(result2["dose_safety"]) == 1
    assert result2["dose_safety"][0]["flag"] == "CRITICAL_OVERRIDE"


# -- Evidence chain accuracy -----------------------------------------------------


def test_evidence_chain_reflects_exact_values_in_order():
    steps = [
        EvidenceStep("Patient", {"mrn": "102"}),
        EvidenceStep("LabResult", {"eGFR": 28}),
        EvidenceStep("Contraindication", {"drug": "Metformin", "condition": "eGFR < 30"}),
        EvidenceStep("Rule", {"flag": "CRITICAL_OVERRIDE"}),
    ]
    chain = build_evidence_chain(steps)
    assert chain["steps"][0] == {"node_type": "Patient", "properties": {"mrn": "102"}}
    assert chain["steps"][3] == {"node_type": "Rule", "properties": {"flag": "CRITICAL_OVERRIDE"}}
    assert chain["rendered"] == (
        "Patient(mrn=102) -> LabResult(eGFR=28) -> "
        "Contraindication(drug=Metformin, condition=eGFR < 30) -> Rule(flag=CRITICAL_OVERRIDE)"
    )


def test_dose_safety_evidence_chain_matches_the_actual_violation(graph):
    v = check_dose_safety("patient-metformin-low-egfr", client=graph)[0]
    rendered = v["evidence_chain"]["rendered"]
    assert "Patient(id=patient-metformin-low-egfr)" in rendered
    assert "value=28.0" in rendered
    assert "Metformin" in rendered
    assert "CRITICAL_OVERRIDE" in rendered


# -- Module C: necessity ---------------------------------------------------------


def test_necessity_check_returns_green_for_justified_pairing(graph):
    results = check_necessity("patient-necessity-green", client=graph)
    assert len(results) == 1
    assert results[0]["status"] == "GREEN"
    assert results[0]["pre_auth_required"] is False
    assert results[0]["matched_condition"] == "I10"


def test_necessity_skips_medications_without_an_sfda_code(graph):
    # Generic Pain Reliever has sfda_code=None -- can't be necessity-checked
    # against NPHIES's SFDA-keyed catalog; must be skipped, never guessed.
    results = check_necessity("patient-uncoded-med", client=graph)
    assert results == []


def test_necessity_skips_when_patient_has_no_coded_conditions(graph):
    # patient-uncoded-condition has a codeable medication but zero coded
    # conditions (simulating an uncoded condition filtered upstream).
    results = check_necessity("patient-uncoded-condition", client=graph)
    assert results == []


# -- Combined evaluators ----------------------------------------------------------


def test_evaluate_encounter_combines_all_three_modules(graph):
    result = evaluate_encounter("patient-warfarin-nsaid", client=graph)
    assert result["patient_id"] == "patient-warfarin-nsaid"
    assert len(result["drug_interactions"]) == 1
    assert "dose_safety" in result
    assert "necessity" in result


def test_check_order_necessity_for_proposed_service(graph):
    result = check_order(
        "patient-warfarin-nsaid",
        necessity_code="SFDA-A10BA02",
        icd10_code="I10",
        client=graph,
    )
    assert result["necessity"]["status"] == "GREEN"
    assert result["drug_interactions"] == []  # no proposed_drug_key supplied -- DDI/dose not evaluated
    assert result["dose_safety"] == []


# -- Reference-data ingestion ------------------------------------------------------


class _FakeIngestGraph:
    def __init__(self):
        self.calls = []

    def run(self, cypher, **params):
        self.calls.append((cypher, params))
        return []


def test_ingest_nscre_rules_merges_contraindications_and_dose_limits():
    graph = _FakeIngestGraph()
    counts = ingest_nscre_rules(client=graph)
    assert counts["contraindications"] == 4  # matches nscre_contraindications.json's 4 pairs
    assert counts["dose_limits"] == 1  # matches nscre_renal_dose_limits.json's 1 rule
    # Idempotent: running again produces the same counts.
    counts2 = ingest_nscre_rules(client=graph)
    assert counts2 == counts


# -- FastAPI endpoints --------------------------------------------------------------


@pytest.fixture
def api_client(monkeypatch):
    import api_router

    fake = FakeGraph()
    monkeypatch.setattr(api_router, "get_client", lambda: fake)
    return TestClient(api_router.app)


def test_health_endpoint(api_client):
    resp = api_client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_evaluate_encounter_endpoint(api_client):
    resp = api_client.post("/api/v1/nscre/evaluate-encounter", json={"patient_id": "patient-warfarin-nsaid"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["patient_id"] == "patient-warfarin-nsaid"
    assert len(body["drug_interactions"]) == 1


def test_check_order_endpoint(api_client):
    resp = api_client.post(
        "/api/v1/nscre/check-order",
        json={"patient_id": "patient-metformin-low-egfr", "proposed_drug_key": "metformin"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["dose_safety"]) == 1
    assert body["dose_safety"][0]["flag"] == "CRITICAL_OVERRIDE"


# ---------------------------------------------------------------- Module D: alternative screening (Sprint 10)
def test_screening_excludes_drugs_conflicting_with_current_medications():
    """A candidate that clashes with something the patient is already on must
    never be offered as an alternative."""
    graph = FakeGraph()
    result = screen_alternative_candidates("patient-on-warfarin", "metformin", client=graph)

    screened = {c["medication"] for c in result["screened_candidates"]}
    assert "Ibuprofen" not in screened  # contraindicated with the patient's warfarin
    rejected = {r["medication"]: r for r in result["rejected_candidates"]}
    assert rejected["Ibuprofen"]["reason"] == "contraindicated_with_current_medication"


def test_screening_excludes_drugs_violating_renal_dose_limit():
    """eGFR 28 must knock metformin out of the candidate list."""
    graph = FakeGraph()
    result = screen_alternative_candidates("patient-low-egfr-no-metformin", "warfarin", client=graph)

    screened = {c["medication"] for c in result["screened_candidates"]}
    assert "Metformin" not in screened
    reasons = {r["reason"] for r in result["rejected_candidates"]}
    assert "renal_dose_limit" in reasons


def test_screening_never_offers_a_drug_the_patient_already_takes():
    graph = FakeGraph()
    result = screen_alternative_candidates("patient-warfarin-nsaid", "metformin", client=graph)
    screened = {c["medication"] for c in result["screened_candidates"]}
    assert "Warfarin" not in screened and "Ibuprofen" not in screened


def test_every_screened_candidate_carries_an_evidence_chain():
    """No candidate may reach the caller without the graph traversal that
    justified it -- same invariant as every other NSCRE finding."""
    graph = FakeGraph()
    result = screen_alternative_candidates("patient-metformin-normal-egfr", "warfarin", client=graph)
    assert result["screened_candidates"], "expected at least one candidate to pass"
    for cand in result["screened_candidates"]:
        assert cand["evidence_chain"]["steps"]
        assert "CandidateMedication" in cand["evidence_chain"]["rendered"]


def test_screen_result_is_phrased_as_screening_not_recommendation():
    """Guards the wording boundary: passing screening is not an endorsement."""
    graph = FakeGraph()
    result = screen_alternative_candidates("patient-metformin-normal-egfr", "warfarin", client=graph)
    for cand in result["screened_candidates"]:
        assert cand["screen_result"] == "no_contraindication_found"
        assert "recommend" not in cand["screen_result"]
    assert "not a therapeutic substitution recommendation" in result["disclaimer"]


def test_screening_respects_the_limit():
    graph = FakeGraph()
    result = screen_alternative_candidates("patient-no-egfr-unknown", "warfarin", limit=1, client=graph)
    assert len(result["screened_candidates"]) <= 1


def test_screening_declares_its_limitations_in_the_payload():
    """A caller must not be able to render this list without the caveats:
    no therapeutic-class filtering, and no candidate-vs-candidate screening."""
    graph = FakeGraph()
    result = screen_alternative_candidates("patient-metformin-normal-egfr", "warfarin", client=graph)
    joined = " ".join(result["limitations"]).lower()
    assert "therapeutic class" in joined
    assert "not screened" in joined and "against each other" in joined
