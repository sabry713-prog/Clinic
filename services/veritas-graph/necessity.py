"""NPHIES medical-necessity lookup against the Veritas-Medica graph.

`check_nphies_necessity` answers one question deterministically: does the
knowledge graph contain a documented rule in which this diagnosis justifies
this service or medication?

This is a set-membership lookup over payer/authority-published mapping rules
loaded into the graph — NOT a clinical-appropriateness judgment, and never an
LLM call (CLAUDE.md Principle 1). A False result means "no such rule is
recorded", not "this is clinically wrong".
"""
from __future__ import annotations

from typing import Any, Optional

from graph_client import GraphClient, get_client

# A diagnosis JUSTIFIES a Service or a Medication. Matching on the shared
# `code` property lets one helper serve both SBS/ACHI and SFDA targets.
NECESSITY_CYPHER = """
MATCH (d:Diagnosis {code: $diagnosis_code})-[r:JUSTIFIES]->(t)
WHERE t.code = $service_code
RETURN count(r) > 0 AS justified
"""

# Returns the rule rows behind a decision, for display/audit.
NECESSITY_DETAIL_CYPHER = """
MATCH (d:Diagnosis {code: $diagnosis_code})-[r:JUSTIFIES]->(t)
WHERE t.code = $service_code
RETURN d.code AS diagnosis_code,
       d.display AS diagnosis_display,
       t.code AS target_code,
       t.display AS target_display,
       labels(t)[0] AS target_type,
       r.rule_id AS rule_id,
       r.source AS source
"""


def _normalize(code: Optional[str]) -> str:
    return (code or "").strip().upper()


def check_nphies_necessity(
    diagnosis_code: str,
    service_code: str,
    *,
    client: Optional[GraphClient] = None,
) -> bool:
    """Return True if the graph records `diagnosis_code` as justifying
    `service_code` (an SBS/ACHI service or an SFDA medication).

    Both codes are matched case-insensitively after trimming. Empty or missing
    codes return False without querying.
    """
    dx = _normalize(diagnosis_code)
    svc = _normalize(service_code)
    if not dx or not svc:
        return False

    graph = client or get_client()
    rows = graph.run(NECESSITY_CYPHER, diagnosis_code=dx, service_code=svc)
    if not rows:
        return False
    return bool(rows[0].get("justified", False))


def explain_nphies_necessity(
    diagnosis_code: str,
    service_code: str,
    *,
    client: Optional[GraphClient] = None,
) -> list[dict[str, Any]]:
    """Return the rule row(s) that justify the pairing (empty if none).

    Useful for showing the clinician *which* documented rule applied, rather
    than a bare boolean.
    """
    dx = _normalize(diagnosis_code)
    svc = _normalize(service_code)
    if not dx or not svc:
        return []
    graph = client or get_client()
    return graph.run(NECESSITY_DETAIL_CYPHER, diagnosis_code=dx, service_code=svc)
