"""Seed the Veritas-Medica knowledge graph with NPHIES coding ontologies.

Loads three code systems as nodes and the payer necessity rules as edges:

    (:Diagnosis  {code, display, chapter})      -- ICD-10-AM
    (:Service    {code, display, category})     -- SBS / ACHI
    (:Medication {code, display, form, atc})    -- SFDA

    (:Diagnosis)-[:JUSTIFIES {rule_id, source, note}]->(:Service|:Medication)

Everything is MERGE-based, so re-running is idempotent. The dev data files
under data/ontologies/ are illustrative; production loads the licensed
ICD-10-AM / SBS / SFDA releases and the payer-published necessity rules.

Usage:
    NEO4J_URI=bolt://localhost:7687 NEO4J_AUTH=neo4j/password \
        python services/veritas-graph/ingest_ontologies.py
"""
from __future__ import annotations

import csv
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from graph_client import GraphClient, GraphError, get_client  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
ONTOLOGY_DIR = REPO_ROOT / "data" / "ontologies"

DIAGNOSES_FILE = ONTOLOGY_DIR / "icd10am_diagnoses.json"
SERVICES_FILE = ONTOLOGY_DIR / "sbs_achi_services.json"
MEDICATIONS_FILE = ONTOLOGY_DIR / "sfda_medications.json"
NECESSITY_FILE = ONTOLOGY_DIR / "nphies_necessity_map.csv"

# Uniqueness constraints keep re-ingestion idempotent and lookups indexed.
CONSTRAINTS = [
    "CREATE CONSTRAINT diagnosis_code IF NOT EXISTS FOR (d:Diagnosis) REQUIRE d.code IS UNIQUE",
    "CREATE CONSTRAINT service_code IF NOT EXISTS FOR (s:Service) REQUIRE s.code IS UNIQUE",
    "CREATE CONSTRAINT medication_code IF NOT EXISTS FOR (m:Medication) REQUIRE m.code IS UNIQUE",
]

MERGE_DIAGNOSIS = """
MERGE (d:Diagnosis {code: $code})
SET d.display = $display, d.chapter = $chapter, d.system = 'ICD-10-AM'
"""

MERGE_SERVICE = """
MERGE (s:Service {code: $code})
SET s.display = $display, s.category = $category, s.system = $system
"""

MERGE_MEDICATION = """
MERGE (m:Medication {code: $code})
SET m.display = $display, m.form = $form, m.atc = $atc, m.system = 'SFDA'
"""

# Target label varies, so the edge statement is templated per target type.
MERGE_NECESSITY = """
MATCH (d:Diagnosis {{code: $diagnosis_code}})
MATCH (t:{label} {{code: $target_code}})
MERGE (d)-[r:JUSTIFIES]->(t)
SET r.rule_id = $rule_id, r.source = $source, r.note = $note
"""

TARGET_LABELS = {"service": "Service", "medication": "Medication"}


def _load_json_nodes(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)["nodes"]


def load_necessity_rows(path: Path = NECESSITY_FILE) -> list[dict[str, str]]:
    """Read the necessity mapping CSV into normalized dict rows."""
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
        normalized.append(
            {
                "diagnosis_code": (row["diagnosis_code"] or "").strip().upper(),
                "target_code": (row["target_code"] or "").strip().upper(),
                "target_type": target_type,
                "rule_id": (row.get("rule_id") or "").strip(),
                "source": (row.get("source") or "").strip(),
                "note": (row.get("note") or "").strip(),
            }
        )
    return normalized


def ingest(client: Optional[GraphClient] = None) -> dict[str, int]:
    """Seed all ontologies and necessity edges. Returns per-type counts."""
    graph = client or get_client()

    for statement in CONSTRAINTS:
        graph.run(statement)

    diagnoses = _load_json_nodes(DIAGNOSES_FILE)
    services = _load_json_nodes(SERVICES_FILE)
    medications = _load_json_nodes(MEDICATIONS_FILE)
    necessity = load_necessity_rows()

    counts = {"diagnoses": 0, "services": 0, "medications": 0, "necessity_edges": 0}

    for node in diagnoses:
        graph.run(
            MERGE_DIAGNOSIS,
            code=node["code"].strip().upper(),
            display=node.get("display", ""),
            chapter=node.get("chapter", ""),
        )
        counts["diagnoses"] += 1

    for node in services:
        graph.run(
            MERGE_SERVICE,
            code=node["code"].strip().upper(),
            display=node.get("display", ""),
            category=node.get("category", ""),
            system=node.get("system", "SBS"),
        )
        counts["services"] += 1

    for node in medications:
        graph.run(
            MERGE_MEDICATION,
            code=node["code"].strip().upper(),
            display=node.get("display", ""),
            form=node.get("form", ""),
            atc=node.get("atc", ""),
        )
        counts["medications"] += 1

    for row in necessity:
        label = TARGET_LABELS[row["target_type"]]
        graph.run(
            MERGE_NECESSITY.format(label=label),
            diagnosis_code=row["diagnosis_code"],
            target_code=row["target_code"],
            rule_id=row["rule_id"],
            source=row["source"],
            note=row["note"],
        )
        counts["necessity_edges"] += 1

    return counts


def main() -> int:
    try:
        counts = ingest()
    except GraphError as exc:
        print(f"Ingestion failed: {exc}", file=sys.stderr)
        return 1
    print(
        "Ingested "
        f"{counts['diagnoses']} diagnoses, "
        f"{counts['services']} services, "
        f"{counts['medications']} medications, "
        f"{counts['necessity_edges']} necessity edges."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
