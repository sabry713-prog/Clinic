"""Confirm M06 slice 1 landed in the real graph: every fact carries the run that
wrote it, and one patient materialization is one run."""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# `just` exports the repo .env for the ETL; a direct run does not, so load it here
# (values are never printed).
_ENV = Path(__file__).resolve().parents[2] / ".env"
for _line in _ENV.read_text(encoding="utf-8").splitlines():
    _line = _line.strip()
    if _line and not _line.startswith("#") and "=" in _line:
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())

from graph_client import AsyncGraphClient  # noqa: E402


async def main() -> None:
    graph = AsyncGraphClient()
    await graph.connect() if hasattr(graph, "connect") else None
    try:
        for label in ("Patient", "Encounter", "Condition", "Medication", "LabResult"):
            rows = await graph.run(
                f"MATCH (n:{label}) RETURN count(n) AS total, "
                "count(n.run_id) AS stamped, count(n.loaded_at) AS timed, "
                "count(DISTINCT n.run_id) AS runs"
            )
            r = rows[0] if rows else {}
            print(f"  {label:11} total={r.get('total')}  with run_id={r.get('stamped')}  "
                  f"with loaded_at={r.get('timed')}  distinct runs={r.get('runs')}")

        edges = await graph.run(
            "MATCH (p:Patient)-[r:PRESCRIBED]->(m:Medication) "
            "RETURN count(r) AS total, count(r.run_id) AS stamped"
        )
        print(f"  PRESCRIBED edge  total={edges[0].get('total')}  with run_id={edges[0].get('stamped')}")

        # one patient: every fact they own must name the same run
        rows = await graph.run(
            "MATCH (p:Patient {mrn: 'MRN-009'}) "
            "OPTIONAL MATCH (p)-[r:PRESCRIBED|DIAGNOSED_WITH|HAS_LAB]->() "
            "RETURN p.run_id AS patient_run, collect(DISTINCT r.run_id) AS edge_runs"
        )
        print("\n  MRN-009 patient run:", rows[0]["patient_run"])
        print("  MRN-009 edge runs  :", rows[0]["edge_runs"])

        findings = await graph.run(
            "MATCH (n) WHERE n.run_id IS NULL AND NOT n:Ontology "
            "RETURN labels(n)[0] AS label, count(*) AS c ORDER BY c DESC"
        )
        print("\n  nodes without a run id (expect none among facts):",
              [dict(f) for f in findings] or "none")
    finally:
        close = getattr(graph, "close", None)
        if close is not None:
            await close()


asyncio.run(main())
