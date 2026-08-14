"""Neuro-Symbolic Causal Reasoning Engine (NSCRE) -- unified deterministic
Cypher reasoning over the Veritas-Medica graph. No LLM call anywhere in this
module; every result is derived by graph traversal against reference data
loaded by `ingest_nscre_rules()` and patient facts already in the graph from
`etl_pskg.py` (Sprint 5) / `nphies_queries.py` (Sprint 6).

*** SCOPE FLAG -- read before relying on this module ***
Module A (drug-drug interaction) and Module B (renal dose-safety alerting)
are clinical decision-support capabilities. The project's original CLAUDE.md
explicitly forbade both, verbatim, as SaMD-boundary-crossing features; the
current CLAUDE.md (Veritas-Medica) is silent on scope rather than
affirmatively permitting them. This was flagged and explicitly confirmed by
the requester before this module was written -- see the Sprint 7 plan. This
module is not gated behind a feature flag; it ships enabled, per that
explicit instruction. It has NOT been through the CTO + Clinical Advisor +
Regulatory Consultant sign-off this project's own process otherwise requires
for new clinical-facing capability.

Reuses, does not re-derive:
  - Patient/Encounter/Medication/Condition/LabResult facts: Sprint 5's PSKG
    (etl_pskg.py) -- both the direct Encounter-linked and Patient-level
    fallback edges, via `-[:HAS_ENCOUNTER*0..1]->()-` patterns.
  - NPHIES necessity/pre-auth logic: Sprint 6's nphies_queries.py
    (validate_order_necessity), called as a library function, not
    reimplemented.

Identity-space note: Sprint 5's Medication.key is free-text-or-code
(whatever the source EHR feed recorded), while Sprint 6's NphiesDrug is
keyed by sfda_code specifically. Module C can only necessity-check a
patient's active medication when Sprint 5 happened to record a real SFDA
code for it (`Medication.sfda_code` is non-null) -- medications without one
are skipped, never guessed into a match.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evidence_chain import EvidenceStep, build_evidence_chain  # noqa: E402
from graph_client import GraphClient, GraphError, get_client  # noqa: E402
from nphies_queries import (  # noqa: E402
    NECESSITY_LOOKUP_CYPHER,
    SUGGESTED_DIAGNOSES_CYPHER,
    validate_order_necessity,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
ONTOLOGY_DIR = REPO_ROOT / "data" / "ontologies"
CONTRAINDICATIONS_FILE = ONTOLOGY_DIR / "nscre_contraindications.json"
DOSE_LIMITS_FILE = ONTOLOGY_DIR / "nscre_renal_dose_limits.json"

CONSTRAINTS = [
    "CREATE CONSTRAINT nscre_doserule_key IF NOT EXISTS FOR (r:DoseRule) REQUIRE r.key IS UNIQUE",
]

# Stored once per pair, queried with an undirected pattern below -- the
# interaction is symmetric, drug order doesn't matter.
MERGE_CONTRAINDICATION = """
MATCH (m1:Medication {key: $drug_a_key})
MATCH (m2:Medication {key: $drug_b_key})
MERGE (m1)-[r:CONTRAINDICATED_WITH]-(m2)
SET r.severity = $severity, r.rationale = $rationale
"""

MERGE_RENAL_DOSE_LIMIT = """
MATCH (m:Medication {key: $drug_key})
MERGE (rule:DoseRule {key: $rule_key})
SET rule.flag = $flag, rule.rationale = $rationale
MERGE (m)-[dr:RENAL_DOSE_LIMIT]->(rule)
SET dr.egfr_threshold = $egfr_threshold, dr.max_dose = $max_dose
"""

ACTIVE_MEDICATIONS_CYPHER = """
MATCH (p:Patient {id: $patient_id})-[:HAS_ENCOUNTER*0..1]->()-[:PRESCRIBED]->(m:Medication)
RETURN DISTINCT m.key AS key, m.name AS name, m.sfda_code AS sfda_code
"""

DRUG_INTERACTION_CYPHER = """
MATCH (p:Patient {id: $patient_id})-[:HAS_ENCOUNTER*0..1]->()-[:PRESCRIBED]->(m1:Medication)
MATCH (p)-[:HAS_ENCOUNTER*0..1]->()-[:PRESCRIBED]->(m2:Medication)
WHERE m1.key < m2.key
MATCH (m1)-[r:CONTRAINDICATED_WITH]-(m2)
RETURN DISTINCT m1.name AS name1, m2.name AS name2, r.severity AS severity, r.rationale AS rationale
"""

PROPOSED_DRUG_INTERACTIONS_CYPHER = """
MATCH (p:Patient {id: $patient_id})-[:HAS_ENCOUNTER*0..1]->()-[:PRESCRIBED]->(existing:Medication)
WHERE existing.key <> $proposed_key
MATCH (existing)-[r:CONTRAINDICATED_WITH]-(proposed:Medication {key: $proposed_key})
RETURN DISTINCT existing.name AS existing_name, proposed.name AS proposed_name,
       r.severity AS severity, r.rationale AS rationale
"""

MOST_RECENT_EGFR_CYPHER = """
MATCH (p:Patient {id: $patient_id})-[:HAS_ENCOUNTER*0..1]->()-[:HAS_LAB]->(l:LabResult)
WHERE toLower(l.test_name) CONTAINS 'gfr' AND l.effective_at IS NOT NULL AND l.value IS NOT NULL
RETURN l.value AS value, l.effective_at AS effective_at, l.test_name AS test_name
ORDER BY l.effective_at DESC
LIMIT 1
"""

DOSE_LIMIT_FOR_DRUG_CYPHER = """
MATCH (m:Medication {key: $drug_key})-[dr:RENAL_DOSE_LIMIT]->(rule:DoseRule)
RETURN dr.egfr_threshold AS egfr_threshold, dr.max_dose AS max_dose,
       rule.flag AS flag, rule.rationale AS rule_rationale
LIMIT 1
"""

CONDITIONS_CYPHER = """
MATCH (p:Patient {id: $patient_id})-[:HAS_ENCOUNTER*0..1]->()-[:DIAGNOSED_WITH]->(c:Condition)
WHERE c.icd10 IS NOT NULL
RETURN DISTINCT c.icd10 AS icd10, c.display_name AS display_name
"""

PROPOSED_MEDICATION_NAME_CYPHER = """
MATCH (m:Medication {key: $proposed_key})
RETURN m.name AS name
LIMIT 1
"""

# Candidate pool for alternative screening (Sprint 10). Deliberately limited to
# medications the NSCRE reference graph actually holds safety data for -- a drug
# with no contraindication or dose-rule edges cannot be screened, and returning
# an unscreenable drug as a "safe alternative" would be an assertion the graph
# cannot support. Better to offer fewer candidates than unverifiable ones.
SCREENABLE_MEDICATIONS_CYPHER = """
MATCH (m:Medication)
WHERE m.key <> $flagged_key AND m.name IS NOT NULL
  AND (
    EXISTS { MATCH (m)-[:CONTRAINDICATED_WITH]-() }
    OR EXISTS { MATCH (m)-[:RENAL_DOSE_LIMIT]->() }
  )
RETURN DISTINCT m.key AS key, m.name AS name
ORDER BY key
"""

# Every medication that conflicts with something this patient is already on.
PATIENT_CONFLICTING_DRUGS_CYPHER = """
MATCH (p:Patient {id: $patient_id})-[:HAS_ENCOUNTER*0..1]->()-[:PRESCRIBED]->(cur:Medication)
MATCH (cur)-[:CONTRAINDICATED_WITH]-(other:Medication)
RETURN DISTINCT other.key AS key, cur.name AS conflicts_with
"""

# Resolve the ATC therapeutic-subgroup class (first 3 chars) for a medication.
ATC_CLASS_FOR_MEDICATION_CYPHER = """
MATCH (m:Medication {key: $drug_key})-[:HAS_ATC_CLASS]->(a:AtcClass)
RETURN a.code AS class_code
LIMIT 1
"""

# Screenable medications filtered to a specific ATC class.
SCREENABLE_MEDICATIONS_BY_CLASS_CYPHER = """
MATCH (m:Medication)-[:HAS_ATC_CLASS]->(a:AtcClass {code: $class_code})
WHERE m.key <> $flagged_key AND m.name IS NOT NULL
  AND (
    EXISTS { MATCH (m)-[:CONTRAINDICATED_WITH]-() }
    OR EXISTS { MATCH (m)-[:RENAL_DOSE_LIMIT]->() }
  )
RETURN DISTINCT m.key AS key, m.name AS name
ORDER BY key
"""

_STATUS_RANK = {"GREEN": 0, "YELLOW": 1, "RED": 2}

# eGFR results older than this many days are flagged as stale.
EGFR_STALENESS_THRESHOLD_DAYS = 365


# -- Evidence-gap helpers --------------------------------------------------


def _evidence_gap(
    check: str,
    gap_type: str,
    detail: str,
) -> dict[str, str]:
    """Return a structured evidence-gap dict for the defer affordance.

    Gap types:
        missing_input   -- required data does not exist in the graph
        outdated_input  -- data exists but is too old to trust
        low_coverage    -- reference ontology lacks entries for the patient's drugs
        ambiguous_identity -- free-text key that cannot be resolved to reference data
    """
    return {
        "check": check,
        "gap_type": gap_type,
        "detail": detail,
    }


def _egfr_is_stale(egfr: dict[str, Any]) -> bool:
    """Return True if the eGFR result is older than the staleness threshold."""
    from datetime import datetime, timezone, timedelta

    effective_at_str = egfr.get("effective_at", "")
    try:
        dt = datetime.fromisoformat(effective_at_str)
        cutoff = datetime.now(timezone.utc) - timedelta(days=EGFR_STALENESS_THRESHOLD_DAYS)
        # Accept both naive (assume UTC) and aware datetimes.
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt < cutoff
    except (ValueError, TypeError):
        return False  # unparseable -- don't flag as stale, just skip


# -- Reference-data ingestion -------------------------------------------------

def ingest_nscre_rules(client: Optional[GraphClient] = None) -> dict[str, int]:
    """Load the contraindication and renal-dose-limit reference data onto
    the ALREADY-EXISTING Medication nodes from Sprint 5's PSKG (MATCH, not
    MERGE, on the medication side -- this never creates patient-fact nodes,
    only reference edges). A pair/rule whose drug_key doesn't exist in the
    live graph yet silently matches nothing (same risk class as Sprint 6's
    necessity rows; see test_nscre.py's coverage check)."""
    graph = client or get_client()
    for statement in CONSTRAINTS:
        graph.run(statement)

    with CONTRAINDICATIONS_FILE.open(encoding="utf-8") as fh:
        pairs = json.load(fh)["pairs"]
    with DOSE_LIMITS_FILE.open(encoding="utf-8") as fh:
        rules = json.load(fh)["rules"]

    counts = {"contraindications": 0, "dose_limits": 0}
    for pair in pairs:
        graph.run(
            MERGE_CONTRAINDICATION,
            drug_a_key=pair["drug_a_key"],
            drug_b_key=pair["drug_b_key"],
            severity=pair["severity"],
            rationale=pair["rationale"],
        )
        counts["contraindications"] += 1
    for rule in rules:
        graph.run(
            MERGE_RENAL_DOSE_LIMIT,
            drug_key=rule["drug_key"],
            rule_key=f"{rule['drug_key']}:renal_dose_limit",
            egfr_threshold=rule["egfr_threshold"],
            max_dose=rule["max_dose"],
            flag=rule["flag"],
            rationale=rule["rationale"],
        )
        counts["dose_limits"] += 1
    return counts


# -- Shared helpers ------------------------------------------------------------

def _active_medications(patient_id: str, graph: GraphClient) -> list[dict[str, Any]]:
    return graph.run(ACTIVE_MEDICATIONS_CYPHER, patient_id=patient_id)


def _most_recent_egfr(patient_id: str, graph: GraphClient) -> Optional[dict[str, Any]]:
    rows = graph.run(MOST_RECENT_EGFR_CYPHER, patient_id=patient_id)
    if not rows:
        return None
    try:
        value = float(rows[0]["value"])
    except (TypeError, ValueError):
        return None
    return {"value": value, "effective_at": rows[0]["effective_at"], "test_name": rows[0]["test_name"]}


def _dose_safety_for_medication(
    drug_key: str, drug_name: str, egfr: dict[str, Any], patient_id: str, graph: GraphClient
) -> Optional[dict[str, Any]]:
    """Returns a violation dict (with evidence chain) or None if this drug
    has no dose rule, or the patient's eGFR is at/above the threshold."""
    rows = graph.run(DOSE_LIMIT_FOR_DRUG_CYPHER, drug_key=drug_key)
    if not rows:
        return None
    r = rows[0]
    threshold = r.get("egfr_threshold")
    if threshold is None or egfr["value"] >= threshold:
        return None
    chain = build_evidence_chain(
        [
            EvidenceStep("Patient", {"id": patient_id}),
            EvidenceStep(
                "LabResult",
                {"test": egfr["test_name"], "value": egfr["value"], "effective_at": egfr["effective_at"]},
            ),
            EvidenceStep("Medication", {"name": drug_name}),
            EvidenceStep("Rule", {"flag": r["flag"], "threshold": f"eGFR < {threshold}"}),
        ],
        cypher=[MOST_RECENT_EGFR_CYPHER, DOSE_LIMIT_FOR_DRUG_CYPHER],
    )
    return {
        "medication": drug_name,
        "egfr_value": egfr["value"],
        "egfr_date": egfr["effective_at"],
        "threshold": threshold,
        "max_dose": r["max_dose"],
        "flag": r["flag"],
        "rationale": r["rule_rationale"],
        "evidence_chain": chain,
    }


# -- Module A: Drug-Drug Interaction Checker -----------------------------------

def check_drug_interactions(patient_id: str, *, client: Optional[GraphClient] = None) -> list[dict[str, Any]]:
    graph = client or get_client()
    rows = graph.run(DRUG_INTERACTION_CYPHER, patient_id=patient_id)
    results = []
    for r in rows:
        chain = build_evidence_chain(
            [
                EvidenceStep("Patient", {"id": patient_id}),
                EvidenceStep("Medication", {"name": r["name1"]}),
                EvidenceStep("Medication", {"name": r["name2"]}),
                EvidenceStep("Contraindication", {"severity": r["severity"], "rationale": r["rationale"]}),
            ],
            cypher=[DRUG_INTERACTION_CYPHER],
        )
        results.append(
            {
                "drug_a": r["name1"],
                "drug_b": r["name2"],
                "severity": r["severity"],
                "rationale": r["rationale"],
                "evidence_chain": chain,
            }
        )
    return results


def _gaps_for_drug_interactions(
    patient_id: str, findings: list[dict[str, Any]], *, client: Optional[GraphClient] = None,
) -> list[dict[str, str]]:
    """Produce evidence gaps for Module A (DDI)."""
    graph = client or get_client()
    gaps: list[dict[str, str]] = []
    meds = _active_medications(patient_id, graph)
    if not meds:
        gaps.append(_evidence_gap(
            "drug_interactions", "missing_input",
            "No active medications found for this patient. Drug-drug interaction check cannot be performed.",
        ))
    return gaps


# -- Module B: Organ Function / Dose Safety Evaluator --------------------------

def check_dose_safety(patient_id: str, *, client: Optional[GraphClient] = None) -> list[dict[str, Any]]:
    graph = client or get_client()
    egfr = _most_recent_egfr(patient_id, graph)
    if egfr is None:
        return []  # no recent renal-function data on file -- never assume a value
    medications = _active_medications(patient_id, graph)
    results = []
    for med in medications:
        violation = _dose_safety_for_medication(med["key"], med["name"], egfr, patient_id, graph)
        if violation:
            results.append(violation)
    return results


def _gaps_for_dose_safety(
    patient_id: str, findings: list[dict[str, Any]], *, client: Optional[GraphClient] = None,
) -> list[dict[str, str]]:
    """Produce evidence gaps for Module B (renal dose safety)."""
    graph = client or get_client()
    gaps: list[dict[str, str]] = []
    egfr = _most_recent_egfr(patient_id, graph)
    if egfr is None:
        gaps.append(_evidence_gap(
            "dose_safety", "missing_input",
            "No eGFR result found for this patient. Renal dose-safety cannot be evaluated for any medication.",
        ))
    else:
        if _egfr_is_stale(egfr):
            gaps.append(_evidence_gap(
                "dose_safety", "outdated_input",
                f"Most recent eGFR is from {egfr['effective_at']}, which is over "
                f"{EGFR_STALENESS_THRESHOLD_DAYS} days old. Renal function may have changed since.",
            ))
    return gaps


# -- Module C: Unified NPHIES Medical Necessity & Pre-Auth Evaluator ----------

def check_necessity(patient_id: str, *, client: Optional[GraphClient] = None) -> list[dict[str, Any]]:
    graph = client or get_client()
    medications = [m for m in _active_medications(patient_id, graph) if m.get("sfda_code")]
    if not medications:
        return []  # no sfda-coded active medications to check against NPHIES -- not fabricated
    conditions = graph.run(CONDITIONS_CYPHER, patient_id=patient_id)
    if not conditions:
        return []

    results = []
    for med in medications:
        best: Optional[dict[str, Any]] = None
        best_condition: Optional[dict[str, Any]] = None
        for cond in conditions:
            outcome = validate_order_necessity(cond["icd10"], med["sfda_code"], client=graph)
            if best is None or _STATUS_RANK[outcome["status"]] < _STATUS_RANK[best["status"]]:
                best, best_condition = outcome, cond
        assert best is not None  # conditions is non-empty, loop always runs at least once
        necessity_cypher = [NECESSITY_LOOKUP_CYPHER]
        if best["suggested_codes"]:
            # RED verdicts also ran the reverse lookup that produced the
            # suggested codes -- include it when it actually executed.
            necessity_cypher.append(SUGGESTED_DIAGNOSES_CYPHER)
        chain = build_evidence_chain(
            [
                EvidenceStep("Patient", {"id": patient_id}),
                EvidenceStep("Medication", {"name": med["name"], "sfda_code": med["sfda_code"]}),
                EvidenceStep("Condition", {"icd10": best_condition["icd10"] if best_condition else None}),
                EvidenceStep("NecessityRule", {"status": best["status"], "pre_auth_required": best["pre_auth_required"]}),
            ],
            cypher=[ACTIVE_MEDICATIONS_CYPHER, CONDITIONS_CYPHER, *necessity_cypher],
        )
        results.append(
            {
                "medication": med["name"],
                "sfda_code": med["sfda_code"],
                "status": best["status"],
                "pre_auth_required": best["pre_auth_required"],
                "suggested_codes": best["suggested_codes"],
                "matched_condition": best_condition["icd10"] if best_condition else None,
                "evidence_chain": chain,
            }
        )
    return results


def _gaps_for_necessity(
    patient_id: str, findings: list[dict[str, Any]], *, client: Optional[GraphClient] = None,
) -> list[dict[str, str]]:
    """Produce evidence gaps for Module C (necessity)."""
    graph = client or get_client()
    gaps: list[dict[str, str]] = []
    all_meds = _active_medications(patient_id, graph)
    coded_meds = [m for m in all_meds if m.get("sfda_code")]
    if all_meds and not coded_meds:
        gaps.append(_evidence_gap(
            "necessity", "missing_input",
            "None of this patient's active medications carry an SFDA code. NPHIES necessity validation cannot be performed.",
        ))
    conditions = graph.run(CONDITIONS_CYPHER, patient_id=patient_id)
    if coded_meds and not conditions:
        gaps.append(_evidence_gap(
            "necessity", "missing_input",
            "No ICD-10 coded conditions found for this patient. Necessity validation requires a diagnosis code.",
        ))
    return gaps


# -- Combined evaluators --------------------------------------------------------

def evaluate_encounter(patient_id: str, *, client: Optional[GraphClient] = None) -> dict[str, Any]:
    """Runs all three modules for a patient's current graph state.

    Returns ``overall_defer=True`` when any module reports evidence gaps
    (missing / outdated / low-coverage inputs), signalling to the caller
    that the results are incomplete and a human reviewer should not rely on
    them alone.
    """
    graph = client or get_client()

    ddi = check_drug_interactions(patient_id, client=graph)
    dose = check_dose_safety(patient_id, client=graph)
    nec = check_necessity(patient_id, client=graph)

    evidence_gaps = (
        _gaps_for_drug_interactions(patient_id, ddi, client=graph)
        + _gaps_for_dose_safety(patient_id, dose, client=graph)
        + _gaps_for_necessity(patient_id, nec, client=graph)
    )

    return {
        "patient_id": patient_id,
        "drug_interactions": ddi,
        "dose_safety": dose,
        "necessity": nec,
        "evidence_gaps": evidence_gaps,
        "overall_defer": len(evidence_gaps) > 0,
    }


def screen_alternative_candidates(
    patient_id: str,
    flagged_drug_key: str,
    *,
    limit: int = 5,
    client: Optional[GraphClient] = None,
) -> dict[str, Any]:
    """Module D (Sprint 10, enhanced Sprint S2) -- deterministic screening of
    possible alternatives to a flagged medication.

    *** This does NOT recommend a substitution. *** It returns medications that
    the graph can affirmatively screen and that PASSED every check it can run:
    no CONTRAINDICATED_WITH edge against anything the patient is currently
    prescribed, no RENAL_DOSE_LIMIT violated by their most recent eGFR, and
    same ATC therapeutic-subgroup class as the flagged drug. "Nothing
    contradicts this and it is in the same drug class" is a graph fact; "you
    should switch to this" is a prescribing decision, and this engine does
    not make it. The caller is responsible for presenting these as candidates
    for a clinician to consider, never as a recommendation.

    Candidates come only from medications the reference graph holds safety data
    for -- a drug we cannot screen is never offered as one that passed screening.

    REMAINING LIMITATION, returned in the payload so callers cannot omit it:
    Candidates are screened individually against the patient's CURRENT
    medications, not against one another. Two candidates that are each safe
    to add alone may be contraindicated together.
    """
    graph = client or get_client()

    # Resolve the flagged drug's ATC therapeutic-subgroup class.
    class_rows = graph.run(ATC_CLASS_FOR_MEDICATION_CYPHER, drug_key=flagged_drug_key)
    atc_class = class_rows[0]["class_code"] if class_rows else None

    if atc_class:
        candidates = graph.run(
            SCREENABLE_MEDICATIONS_BY_CLASS_CYPHER,
            class_code=atc_class,
            flagged_key=flagged_drug_key,
        )
    else:
        # Fallback to unfiltered when the flagged drug has no ATC class edge
        # (e.g. free-text medication names without a code).
        candidates = graph.run(SCREENABLE_MEDICATIONS_CYPHER, flagged_key=flagged_drug_key)

    conflicts = graph.run(PATIENT_CONFLICTING_DRUGS_CYPHER, patient_id=patient_id)
    conflict_keys = {row["key"]: row["conflicts_with"] for row in conflicts}

    # Never offer something the patient is already taking as an "alternative".
    current_keys = {m["key"] for m in _active_medications(patient_id, graph)}
    egfr = _most_recent_egfr(patient_id, graph)

    screened: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    for cand in candidates:
        key, name = cand["key"], cand["name"]
        if key in current_keys:
            continue

        if key in conflict_keys:
            rejected.append(
                {
                    "medication": name,
                    "reason": "contraindicated_with_current_medication",
                    "detail": f"Contraindicated with {conflict_keys[key]}, which this patient is currently prescribed.",
                }
            )
            continue

        if egfr is not None:
            violation = _dose_safety_for_medication(key, name, egfr, patient_id, graph)
            if violation:
                rejected.append(
                    {
                        "medication": name,
                        "reason": "renal_dose_limit",
                        "detail": violation.get("rationale"),
                    }
                )
                continue

        steps = [
            EvidenceStep("Patient", {"id": patient_id}),
            EvidenceStep("FlaggedMedication", {"key": flagged_drug_key}),
            EvidenceStep("AtcClass", {"class_code": atc_class} if atc_class else {"class_code": "unknown"}),
            EvidenceStep("CandidateMedication", {"name": name}),
        ]
        if egfr is not None:
            steps.append(
                EvidenceStep(
                    "LabResult",
                    {"test": egfr.get("test_name", "eGFR"), "value": egfr["value"]},
                )
            )
        steps.append(
            EvidenceStep(
                "ScreenResult",
                {"contraindications": 0, "renal_dose_violations": 0},
            )
        )
        screened.append(
            {
                "medication": name,
                "medication_key": key,
                # Named to resist being read as an endorsement.
                "screen_result": "no_contraindication_found",
                "evidence_chain": build_evidence_chain(
                    steps,
                    cypher=[
                        ATC_CLASS_FOR_MEDICATION_CYPHER,
                        SCREENABLE_MEDICATIONS_BY_CLASS_CYPHER if atc_class else SCREENABLE_MEDICATIONS_CYPHER,
                        PATIENT_CONFLICTING_DRUGS_CYPHER,
                        DOSE_LIMIT_FOR_DRUG_CYPHER,
                    ],
                ),
            }
        )
        if len(screened) >= limit:
            break

    evidence_gaps = _gaps_for_screening(
        patient_id, atc_class, egfr, screened, rejected, client=graph,
    )
    return {
        "patient_id": patient_id,
        "flagged_drug_key": flagged_drug_key,
        "atc_class": atc_class,
        "screened_candidates": screened,
        "rejected_candidates": rejected,
        "disclaimer": (
            "Candidates passed deterministic graph screening only (same ATC therapeutic-subgroup "
            "class, no contraindication edge against current medications, no renal dose rule "
            "violated). This is not a therapeutic substitution recommendation."
        ),
        # Stated in the payload, not just in a docstring, because a caller that
        # renders this list without these caveats will mislead a clinician.
        "limitations": [
            # Each candidate is screened as a single addition to the current regimen.
            "Screened INDIVIDUALLY against current medications. Candidates are not screened "
            "against each other, so selecting two from this list is not covered by this check.",
        ],
        "evidence_gaps": evidence_gaps,
        "overall_defer": len(evidence_gaps) > 0,
    }


def _gaps_for_screening(
    patient_id: str,
    atc_class: Optional[str],
    egfr: Optional[dict[str, Any]],
    screened: list[dict[str, Any]],
    rejected: list[dict[str, Any]],
    *,
    client: Optional[GraphClient] = None,
) -> list[dict[str, str]]:
    """Produce evidence gaps for Module D (alternative screening)."""
    gaps: list[dict[str, str]] = []
    if atc_class is None:
        gaps.append(_evidence_gap(
            "alternative_screening", "missing_input",
            "Flagged drug has no ATC therapeutic-subgroup class. Candidates are drawn from "
            "all classes rather than a matched class, reducing clinical relevance.",
        ))
    if egfr is None:
        gaps.append(_evidence_gap(
            "alternative_screening", "missing_input",
            "No eGFR on file. Renal dose-safety screening was skipped for all candidates.",
        ))
    if not screened and not rejected:
        gaps.append(_evidence_gap(
            "alternative_screening", "low_coverage",
            "No medications in the reference graph have safety data in the same ATC class "
            "as the flagged drug. No candidates could be screened.",
        ))
    return gaps


def check_order(
    patient_id: str,
    *,
    proposed_drug_key: Optional[str] = None,
    necessity_code: Optional[str] = None,
    icd10_code: Optional[str] = None,
    client: Optional[GraphClient] = None,
) -> dict[str, Any]:
    """Real-time single-order evaluation.

    `proposed_drug_key` (matched against Medication.key -- the same free-
    text-or-code identity Sprint 5's PSKG uses) drives the DDI/dose-safety
    checks; they don't apply to a pure service/procedure order, so this is
    optional. `necessity_code` + `icd10_code` (matched against Sprint 6's
    NphiesService/NphiesDrug identity) drive the necessity check. A caller
    proposing a medication typically supplies all three; a caller proposing
    a pure service/procedure supplies only `necessity_code` + `icd10_code`.
    """
    graph = client or get_client()
    result: dict[str, Any] = {"patient_id": patient_id, "drug_interactions": [], "dose_safety": [], "necessity": None}
    evidence_gaps: list[dict[str, str]] = []

    if proposed_drug_key:
        rows = graph.run(PROPOSED_DRUG_INTERACTIONS_CYPHER, patient_id=patient_id, proposed_key=proposed_drug_key)
        for r in rows:
            chain = build_evidence_chain(
                [
                    EvidenceStep("Patient", {"id": patient_id}),
                    EvidenceStep("Medication", {"name": r["existing_name"]}),
                    EvidenceStep("ProposedMedication", {"name": r["proposed_name"]}),
                    EvidenceStep("Contraindication", {"severity": r["severity"], "rationale": r["rationale"]}),
                ],
                cypher=[PROPOSED_DRUG_INTERACTIONS_CYPHER],
            )
            result["drug_interactions"].append(
                {
                    "drug_a": r["existing_name"],
                    "drug_b": r["proposed_name"],
                    "severity": r["severity"],
                    "rationale": r["rationale"],
                    "evidence_chain": chain,
                }
            )

        egfr = _most_recent_egfr(patient_id, graph)
        if egfr is not None:
            proposed_name_rows = graph.run(PROPOSED_MEDICATION_NAME_CYPHER, proposed_key=proposed_drug_key)
            proposed_name = proposed_name_rows[0]["name"] if proposed_name_rows else proposed_drug_key
            violation = _dose_safety_for_medication(proposed_drug_key, proposed_name, egfr, patient_id, graph)
            if violation:
                result["dose_safety"].append(violation)
        else:
            evidence_gaps.append(_evidence_gap(
                "dose_safety", "missing_input",
                "No eGFR result found for this patient. Renal dose-safety cannot be evaluated for the proposed medication.",
            ))

    if necessity_code and icd10_code:
        outcome = validate_order_necessity(icd10_code, necessity_code, client=graph)
        necessity_cypher = [NECESSITY_LOOKUP_CYPHER]
        if outcome["suggested_codes"]:
            necessity_cypher.append(SUGGESTED_DIAGNOSES_CYPHER)
        chain = build_evidence_chain(
            [
                EvidenceStep("Patient", {"id": patient_id}),
                EvidenceStep("Condition", {"icd10": icd10_code}),
                EvidenceStep("ProposedOrder", {"code": necessity_code}),
                EvidenceStep("NecessityRule", {"status": outcome["status"], "pre_auth_required": outcome["pre_auth_required"]}),
            ],
            cypher=necessity_cypher,
        )
        result["necessity"] = {**outcome, "evidence_chain": chain}

    result["evidence_gaps"] = evidence_gaps
    result["overall_defer"] = len(evidence_gaps) > 0
    return result


def main() -> int:
    try:
        counts = ingest_nscre_rules()
    except GraphError as exc:
        print(f"NSCRE reference-data ingestion failed: {exc}", file=sys.stderr)
        return 1
    print(f"Ingested {counts['contraindications']} contraindication pairs, {counts['dose_limits']} renal dose-limit rules.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
