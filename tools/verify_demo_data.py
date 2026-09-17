#!/usr/bin/env python3
"""Verify the running demo stack against docs/DEMO_MANIFEST.md.

The manifest used to declare counts that were simply not true -- it named a
table that does not exist (`app.audit_event`; the audit chain lives in
`audit.event`), promised "100+" NPHIES graph nodes when the shipped reference
files contain 6 and 5, and asserted "500+" necessity edges where the CSVs
define 41 and 8. Every one of those numbers was checked by hand, once.

So this script checks them instead:

  * SCHEMA   -- every table and column the manifest names exists. This is the
               class of error that made the manifest lie: a name that was never
               valid.
  * SEED     -- the seeded demo cohort is present (MRN-001..MRN-050 and the
               patients the demo script uses).
  * GRAPH    -- the reference nodes in Neo4j match the committed ontology files
               and rule CSVs exactly. Deterministic, so it proves the graph
               seed ran rather than partially ran.
  * TOTALS   -- live row counts, reported but NOT asserted: they move whenever
               the ingestion scheduler runs, so asserting them would produce a
               flaky failure rather than a real one.

Run:  just verify-demo-data      (or: python tools/verify_demo_data.py)
Exit: 0 when every asserted check passes, 1 otherwise.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PG_CONTAINER = os.environ.get("PG_CONTAINER", "cc-postgres")
PG_USER = os.environ.get("PG_USER", "app")
PG_DB = os.environ.get("PG_DB", "clinical_copilot")
NEO4J_CONTAINER = os.environ.get("NEO4J_CONTAINER", "cc-neo4j")

# Patients the demo script walks through (docs/DEMO_MANIFEST.md).
DEMO_PATIENTS = {
    "MRN-006": "rejection analytics path",
    "MRN-009": "ambient documentation path",
    "MRN-010": "order entry path",
}

SEEDED_COHORT_PATTERN = r"^MRN-[0-9]{3}$"
SEEDED_COHORT_SIZE = 50

# Tables and columns the manifest refers to. A vanished column here is what
# broke the DSR feature and the login check, so they are asserted by name.
SCHEMA_EXPECTATIONS: dict[str, list[str]] = {
    "hospital.patient": ["id", "mrn", "display_name", "national_id_hash", "fhir_resource_json"],
    "hospital.encounter": ["id", "patient_id", "ward", "bed", "attending_user_id"],
    "hospital.observation": ["id", "patient_id", "category", "code", "value_numeric", "value_text"],
    "app.service_request": ["id", "patient_id"],
    "app.nphies_claim": ["id"],
    "app.dsr_request": ["id", "type", "status", "subject_id_hash", "reason", "completed_at", "result_note"],
    "app.document_draft": ["id", "patient_id", "document_type", "sections_json"],
    "audit.event": ["id", "ts", "action", "actor_id", "target_id", "hash_prev", "hash_self"],
}

# Reference data: the graph must contain exactly what the committed files define.
ONTOLOGY_NODE_FILES = {
    "NphiesDiagnosis": "data/ontologies/nphies_diagnoses.json",
    "NphiesService": "data/ontologies/nphies_services.json",
    "NphiesDrug": "data/ontologies/nphies_drugs.json",
}
RULE_EDGE_FILES = {
    "JUSTIFIES": "data/ontologies/nphies_necessity_map.csv",
    "NPHIES_JUSTIFIES": "data/ontologies/nphies_preauth_necessity_map.csv",
}

passed: list[str] = []
failed: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    (passed if ok else failed).append(label)
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}{(' -- ' + detail) if detail else ''}")


def psql(sql: str) -> str:
    out = subprocess.run(
        ["docker", "exec", PG_CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB, "-tAc", sql],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        raise RuntimeError(f"psql failed: {out.stderr.strip()[:200]}")
    return out.stdout.strip()


def neo4j_password() -> str:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("NEO4J_AUTH="):
                value = line.split("=", 1)[1].strip().strip('"').strip("'")
                return value.split("/", 1)[1] if "/" in value else value
    return os.environ.get("NEO4J_PASSWORD", "")


def cypher(query: str) -> str:
    out = subprocess.run(
        ["docker", "exec", NEO4J_CONTAINER, "cypher-shell", "-u", "neo4j",
         "-p", neo4j_password(), query],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        raise RuntimeError(f"cypher failed: {out.stderr.strip()[:200]}")
    # cypher-shell prints a header line and quotes strings
    lines = [l.strip().strip('"') for l in out.stdout.strip().splitlines()]
    return lines[-1] if lines else ""


def scalar(sql: str) -> int:
    return int(psql(sql) or 0)


def check_schema() -> None:
    print("\nSCHEMA -- names the manifest relies on")
    for qualified, columns in SCHEMA_EXPECTATIONS.items():
        schema, table = qualified.split(".")
        exists = scalar(
            "SELECT count(*) FROM information_schema.tables "
            f"WHERE table_schema='{schema}' AND table_name='{table}'"
        )
        check(f"table {qualified}", exists == 1, "" if exists else "does not exist")
        if not exists:
            continue
        for column in columns:
            found = scalar(
                "SELECT count(*) FROM information_schema.columns "
                f"WHERE table_schema='{schema}' AND table_name='{table}' AND column_name='{column}'"
            )
            check(f"column {qualified}.{column}", found == 1)


def check_seed() -> None:
    print("\nSEED -- the demo cohort")
    cohort = scalar(f"SELECT count(*) FROM hospital.patient WHERE mrn ~ '{SEEDED_COHORT_PATTERN}'")
    check(f"seeded cohort MRN-001..MRN-{SEEDED_COHORT_SIZE:03d}", cohort == SEEDED_COHORT_SIZE,
          f"found {cohort}")
    for mrn, why in DEMO_PATIENTS.items():
        found = scalar(f"SELECT count(*) FROM hospital.patient WHERE mrn = '{mrn}'")
        check(f"demo patient {mrn} ({why})", found == 1, "" if found else "missing")
    vitals = scalar(
        "SELECT count(DISTINCT o.patient_id) FROM hospital.observation o "
        "JOIN hospital.patient p ON p.id = o.patient_id "
        "WHERE o.category = 'vital-signs' AND p.mrn ~ '" + SEEDED_COHORT_PATTERN + "'"
    )
    check("seeded patients with nurse-recorded vitals", vitals > 0,
          f"{vitals} patients (the SOAP Objective reads these)")


def check_graph() -> None:
    print("\nGRAPH -- reference data must match the committed files")
    for label, rel_path in ONTOLOGY_NODE_FILES.items():
        payload = json.loads((ROOT / rel_path).read_text(encoding="utf-8"))
        expected = len(payload.get("nodes", []))
        actual = int(cypher(f"MATCH (n:{label}) RETURN count(n);"))
        check(f"{label} nodes == {rel_path}", actual == expected,
              f"graph {actual} vs file {expected}")

    for rel_type, rel_path in RULE_EDGE_FILES.items():
        rows = (ROOT / rel_path).read_text(encoding="utf-8").strip().splitlines()
        expected = max(len(rows) - 1, 0)  # minus the header
        actual = int(cypher(f"MATCH ()-[r:{rel_type}]->() RETURN count(r);"))
        check(f"{rel_type} edges == {rel_path}", actual == expected,
              f"graph {actual} vs file {expected}")

    patients = int(cypher("MATCH (p:Patient) RETURN count(p);"))
    check("PSKG Patient nodes == seeded cohort", patients == SEEDED_COHORT_SIZE,
          f"graph {patients} (run: just graph-pskg)")


def report_totals() -> None:
    print("\nTOTALS (informational -- these move while ingestion runs, not asserted)")
    for label, sql in [
        ("hospital.patient (all, incl. ingested)", "SELECT count(*) FROM hospital.patient"),
        ("hospital.encounter", "SELECT count(*) FROM hospital.encounter"),
        ("app.service_request", "SELECT count(*) FROM app.service_request"),
        ("app.nphies_claim", "SELECT count(*) FROM app.nphies_claim"),
        ("app.document_draft", "SELECT count(*) FROM app.document_draft"),
        ("audit.event", "SELECT count(*) FROM audit.event"),
    ]:
        print(f"  {label:<42} {scalar(sql):>8}")
    for label, query in [
        ("Neo4j Patient", "MATCH (p:Patient) RETURN count(p);"),
        ("Neo4j LabResult", "MATCH (l:LabResult) RETURN count(l);"),
        ("Neo4j Encounter", "MATCH (e:Encounter) RETURN count(e);"),
        ("Neo4j Medication", "MATCH (m:Medication) RETURN count(m);"),
    ]:
        print(f"  {label:<42} {int(cypher(query)):>8}")


def main() -> int:
    try:
        check_schema()
        check_seed()
        check_graph()
        report_totals()
    except (RuntimeError, ValueError, FileNotFoundError) as exc:
        print(f"\nverification could not run: {exc}", file=sys.stderr)
        print("(are the containers up? try: just infra-up)", file=sys.stderr)
        return 1

    print(f"\n{len(passed)} passed, {len(failed)} failed")
    if failed:
        print("failed checks:")
        for label in failed:
            print(f"  - {label}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
