"""Deterministic NPHIES order-necessity/pre-authorization lookup against the
Sprint 6 graph (nphies_ontology.py / ingest_nphies_rules.py).

`validate_order_necessity` answers one question deterministically: does the
graph record a documented rule in which this diagnosis justifies this
service or drug, and if so, does it require pre-authorization? This is a
set-membership lookup over payer-published mapping rules loaded into the
graph -- NOT a clinical-appropriateness judgment, and never an LLM call
(CLAUDE.md / Veritas-Medica Principle 1, same discipline as necessity.py).

Status meaning:
    GREEN  -- a NPHIES_JUSTIFIES edge exists, pre_auth_required is false.
    YELLOW -- a NPHIES_JUSTIFIES edge exists, pre_auth_required is true.
    RED    -- no edge exists. `pre_auth_required` defaults to True in this
              case -- a deliberate conservative default (no documented rule
              means "treat as needing review", never silently pre-approved),
              not a fabricated fact about any real rule. `suggested_codes`
              is a reverse lookup: which diagnoses DO already justify this
              same target, for the coder/clinician to consider documenting
              instead -- up to 3, ordered by icd10 for reproducible output.
"""
from __future__ import annotations

from typing import Any, Optional

from graph_client import GraphClient, get_client
from evidence_chain import EvidenceStep, build_evidence_chain  # noqa: E402

NECESSITY_LOOKUP_CYPHER = """
MATCH (d:NphiesDiagnosis {icd10: $icd10})-[r:NPHIES_JUSTIFIES]->(t)
WHERE (t:NphiesService AND (t.sbs_code = $code OR t.achi_code = $code))
   OR (t:NphiesDrug AND t.sfda_code = $code)
RETURN r.pre_auth_required AS pre_auth_required, labels(t)[0] AS target_type
LIMIT 1
"""

SUGGESTED_DIAGNOSES_CYPHER = """
MATCH (d:NphiesDiagnosis)-[:NPHIES_JUSTIFIES]->(t)
WHERE (t:NphiesService AND (t.sbs_code = $code OR t.achi_code = $code))
   OR (t:NphiesDrug AND t.sfda_code = $code)
RETURN DISTINCT d.icd10 AS icd10, d.description AS description
ORDER BY d.icd10
LIMIT 3
"""


def _normalize(code: Optional[str]) -> str:
    return (code or "").strip().upper()


def validate_order_necessity(
    icd10_code: str,
    service_or_drug_code: str,
    *,
    client: Optional[GraphClient] = None,
) -> dict[str, Any]:
    """Return {"status": "GREEN"|"YELLOW"|"RED", "pre_auth_required": bool,
    "suggested_codes": list[{"icd10", "description"}]}.

    Both codes are matched case-insensitively after trimming. Empty or
    missing codes return a safe RED result without querying, matching
    necessity.py's existing empty-input guard convention.
    """
    icd10 = _normalize(icd10_code)
    code = _normalize(service_or_drug_code)
    if not icd10 or not code:
        return {
            "status": "RED",
            "pre_auth_required": True,
            "suggested_codes": [],
            "evidence_chain": build_evidence_chain(
                [
                    EvidenceStep("NphiesDiagnosis", {"icd10": icd10 or None}),
                    EvidenceStep("NphiesServiceOrDrug", {"code": code or None}),
                    EvidenceStep("NecessityRule", {"status": "RED", "reason": "empty/missing code — no query executed"}),
                ]
            ),
        }

    graph = client or get_client()
    rows = graph.run(NECESSITY_LOOKUP_CYPHER, icd10=icd10, code=code)
    if rows:
        pre_auth_required = bool(rows[0].get("pre_auth_required", True))
        target_type = rows[0].get("target_type") if rows else None
        return {
            "status": "YELLOW" if pre_auth_required else "GREEN",
            "pre_auth_required": pre_auth_required,
            "suggested_codes": [],
            "evidence_chain": build_evidence_chain(
                [
                    EvidenceStep("NphiesDiagnosis", {"icd10": icd10}),
                    EvidenceStep(target_type or "NphiesServiceOrDrug", {"code": code}),
                    EvidenceStep(
                        "NecessityRule",
                        {"pre_auth_required": pre_auth_required, "status": "YELLOW" if pre_auth_required else "GREEN"},
                    ),
                ],
                cypher=[NECESSITY_LOOKUP_CYPHER],
            ),
        }

    suggestions = graph.run(SUGGESTED_DIAGNOSES_CYPHER, code=code)
    return {
        "status": "RED",
        "pre_auth_required": True,
        "suggested_codes": [
            {"icd10": r.get("icd10"), "description": r.get("description")} for r in suggestions
        ],
        "evidence_chain": build_evidence_chain(
            [
                EvidenceStep("NphiesDiagnosis", {"icd10": icd10}),
                EvidenceStep("NphiesServiceOrDrug", {"code": code}),
                EvidenceStep(
                    "NecessityRule",
                    {"status": "RED", "reason": "no NPHIES_JUSTIFIES edge for this pair — conservative default"},
                ),
            ],
            cypher=[NECESSITY_LOOKUP_CYPHER, SUGGESTED_DIAGNOSES_CYPHER],
        ),
    }
