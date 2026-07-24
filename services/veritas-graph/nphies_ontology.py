"""NPHIES ontology node schema for the Sprint 6 pre-authorization necessity
graph: (:NphiesDiagnosis), (:NphiesService), (:NphiesDrug).

Deliberately kept SEPARATE from the Sprint 2 ontology graph's :Diagnosis/
:Service/:Medication nodes (ingest_ontologies.py) -- same real-world codes
(e.g. I10) exist in both graphs under different labels. This is a known,
explicit choice (see the Sprint 6 plan), not an oversight: same "load
reference vocabulary as MERGE-based nodes, never LLM-generated" principle,
same style as ingest_ontologies.py, just for the NPHIES pre-authorization
matrix specifically.

Usage:
    NEO4J_URI=bolt://localhost:7687 NEO4J_AUTH=neo4j/password \
        python services/veritas-graph/nphies_ontology.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from graph_client import GraphClient, GraphError, get_client  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
ONTOLOGY_DIR = REPO_ROOT / "data" / "ontologies"

DIAGNOSES_FILE = ONTOLOGY_DIR / "nphies_diagnoses.json"
SERVICES_FILE = ONTOLOGY_DIR / "nphies_services.json"
DRUGS_FILE = ONTOLOGY_DIR / "nphies_drugs.json"

# Uniqueness constraints keep re-ingestion idempotent and lookups indexed.
# Distinct constraint names from ingest_ontologies.py's -- different labels
# entirely, no collision risk, but kept clearly namespaced regardless.
CONSTRAINTS = [
    "CREATE CONSTRAINT nphies_diagnosis_icd10 IF NOT EXISTS FOR (d:NphiesDiagnosis) REQUIRE d.icd10 IS UNIQUE",
    "CREATE CONSTRAINT nphies_service_sbs_code IF NOT EXISTS FOR (s:NphiesService) REQUIRE s.sbs_code IS UNIQUE",
    "CREATE CONSTRAINT nphies_drug_sfda_code IF NOT EXISTS FOR (m:NphiesDrug) REQUIRE m.sfda_code IS UNIQUE",
]

MERGE_DIAGNOSIS = """
MERGE (d:NphiesDiagnosis {icd10: $icd10})
SET d.description = $description
"""

MERGE_SERVICE = """
MERGE (s:NphiesService {sbs_code: $sbs_code})
SET s.achi_code = $achi_code, s.description = $description, s.category = $category
"""

MERGE_DRUG = """
MERGE (m:NphiesDrug {sfda_code: $sfda_code})
SET m.scientific_name = $scientific_name, m.brand_name = $brand_name
"""


def _load_json_nodes(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)["nodes"]


def ingest_ontology_nodes(client: Optional[GraphClient] = None) -> dict[str, int]:
    """Seed all three NPHIES ontology node types. Returns per-type counts."""
    graph = client or get_client()

    for statement in CONSTRAINTS:
        graph.run(statement)

    diagnoses = _load_json_nodes(DIAGNOSES_FILE)
    services = _load_json_nodes(SERVICES_FILE)
    drugs = _load_json_nodes(DRUGS_FILE)

    counts = {"diagnoses": 0, "services": 0, "drugs": 0}

    for node in diagnoses:
        graph.run(
            MERGE_DIAGNOSIS,
            icd10=node["icd10"].strip().upper(),
            description=node.get("description", ""),
        )
        counts["diagnoses"] += 1

    for node in services:
        graph.run(
            MERGE_SERVICE,
            sbs_code=node["sbs_code"].strip().upper(),
            achi_code=node.get("achi_code", ""),
            description=node.get("description", ""),
            category=node.get("category", ""),
        )
        counts["services"] += 1

    for node in drugs:
        graph.run(
            MERGE_DRUG,
            sfda_code=node["sfda_code"].strip().upper(),
            scientific_name=node.get("scientific_name", ""),
            brand_name=node.get("brand_name", ""),
        )
        counts["drugs"] += 1

    return counts


def main() -> int:
    try:
        counts = ingest_ontology_nodes()
    except GraphError as exc:
        print(f"NPHIES ontology ingestion failed: {exc}", file=sys.stderr)
        return 1
    print(
        f"Ingested {counts['diagnoses']} NPHIES diagnoses, "
        f"{counts['services']} NPHIES services, {counts['drugs']} NPHIES drugs."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
