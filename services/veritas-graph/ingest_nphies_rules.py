"""Loads the NPHIES/CCHI pre-authorization necessity matrix into
(:NphiesDiagnosis)-[:NPHIES_JUSTIFIES {pre_auth_required}]->(:NphiesService|:NphiesDrug)
edges.

MATCH-based (not MERGE) on the endpoint nodes, same as ingest_ontologies.py's
MERGE_NECESSITY -- the nodes must already exist (see nphies_ontology.py).
main() runs node ingestion first so a single CLI invocation is enough.

Usage:
    NEO4J_URI=bolt://localhost:7687 NEO4J_AUTH=neo4j/password \
        python services/veritas-graph/ingest_nphies_rules.py
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from graph_client import GraphClient, GraphError, get_client  # noqa: E402
from nphies_ontology import ingest_ontology_nodes  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
NECESSITY_FILE = REPO_ROOT / "data" / "ontologies" / "nphies_preauth_necessity_map.csv"

# Target label varies (service vs drug), so the edge statement is templated
# per target type -- same dispatch shape as ingest_ontologies.py's
# MERGE_NECESSITY/TARGET_LABELS.
MERGE_NPHIES_JUSTIFIES = """
MATCH (d:NphiesDiagnosis {{icd10: $diagnosis_icd10}})
MATCH (t:{label} {{{code_prop}: $target_code}})
MERGE (d)-[r:NPHIES_JUSTIFIES]->(t)
SET r.pre_auth_required = $pre_auth_required, r.rule_id = $rule_id, r.source = $source, r.note = $note
"""

TARGET_LABELS = {"service": ("NphiesService", "sbs_code"), "drug": ("NphiesDrug", "sfda_code")}


def load_preauth_necessity_rows(path: Path = NECESSITY_FILE) -> list[dict[str, object]]:
    """Read the pre-authorization necessity CSV into normalized dict rows."""
    with path.open(encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    normalized = []
    for row in rows:
        target_type = (row.get("target_type") or "").strip().lower()
        if target_type not in TARGET_LABELS:
            raise ValueError(
                f"Unknown target_type {target_type!r} in {path.name} "
                f"(expected one of {sorted(TARGET_LABELS)})"
            )
        pre_auth_raw = (row.get("pre_auth_required") or "").strip().lower()
        normalized.append(
            {
                "diagnosis_icd10": (row["diagnosis_icd10"] or "").strip().upper(),
                "target_code": (row["target_code"] or "").strip().upper(),
                "target_type": target_type,
                "pre_auth_required": pre_auth_raw in ("true", "1", "yes"),
                "rule_id": (row.get("rule_id") or "").strip(),
                "source": (row.get("source") or "").strip(),
                "note": (row.get("note") or "").strip(),
            }
        )
    return normalized


def ingest_necessity_rules(client: Optional[GraphClient] = None) -> dict[str, int]:
    """Load pre-authorization necessity edges. Returns per-type counts."""
    graph = client or get_client()
    rows = load_preauth_necessity_rows()

    counts = {"service_edges": 0, "drug_edges": 0}
    for row in rows:
        label, code_prop = TARGET_LABELS[row["target_type"]]
        graph.run(
            MERGE_NPHIES_JUSTIFIES.format(label=label, code_prop=code_prop),
            diagnosis_icd10=row["diagnosis_icd10"],
            target_code=row["target_code"],
            pre_auth_required=row["pre_auth_required"],
            rule_id=row["rule_id"],
            source=row["source"],
            note=row["note"],
        )
        counts["service_edges" if row["target_type"] == "service" else "drug_edges"] += 1

    return counts


def main() -> int:
    try:
        node_counts = ingest_ontology_nodes()
        edge_counts = ingest_necessity_rules()
    except GraphError as exc:
        print(f"NPHIES necessity ingestion failed: {exc}", file=sys.stderr)
        return 1
    print(
        f"Ingested {node_counts['diagnoses']} diagnoses, {node_counts['services']} services, "
        f"{node_counts['drugs']} drugs, {edge_counts['service_edges']} service justification edges, "
        f"{edge_counts['drug_edges']} drug justification edges."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
