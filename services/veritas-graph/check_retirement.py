"""Close-the-loop proof (M06): a withdrawn fact produces no finding, and is still
in the graph.

Run against the real graph. Non-destructive in the end: the edge is retired the way
the ETL retires it, checked, and then `just graph-pskg` is re-run to restore it --
which also demonstrates that a fact that comes back is un-retired.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

_ENV = Path(__file__).resolve().parents[2] / ".env"
for _line in _ENV.read_text(encoding="utf-8").splitlines():
    _line = _line.strip()
    if _line and not _line.startswith("#") and "=" in _line:
        _k, _v = _line.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip())

import nscre_engine  # noqa: E402
from graph_client import GraphClient  # noqa: E402

MRN = sys.argv[1] if len(sys.argv) > 1 else "MRN-017"


async def main() -> None:
    graph = GraphClient()

    rows = graph.run("MATCH (p:Patient {mrn: $mrn}) RETURN p.id AS id, p.published_run AS run", mrn=MRN)
    patient_id, published = rows[0]["id"], rows[0]["run"]
    print(f"patient {MRN}  id={patient_id}")
    print(f"published_run = {published}")

    def findings(client):
        out = []
        for check in (nscre_engine.check_drug_interactions,
                      nscre_engine.check_dose_safety,
                      nscre_engine.check_necessity):
            try:
                out.extend(check(patient_id, client=client) or [])
            except Exception as err:  # noqa: BLE001 -- a check may legitimately find nothing
                print(f"          ({check.__name__}: {type(err).__name__})")
        return out

    before = nscre_engine._active_medications(patient_id, graph)
    findings_before = findings(graph)
    print(f"\nBEFORE  visible medications={len(before)}  findings={len(findings_before)}")
    for m in before[:6]:
        print(f"          - {m['name']}")
    for f in findings_before[:4]:
        print(f"          ! {f.get('check')} {f.get('severity')} {str(f.get('message'))[:70]}")
    if not before:
        print("nothing to retire -- pick a patient with medications")
        return

    victim = before[0]
    print(f"\nretiring the edge to {victim['name']} ({victim['key']}), as a withdrawn source fact")

    # exactly what RETIRE_UNSEEN_FACTS does: an older run id, and retired_at set
    graph.run(
        "MATCH (p:Patient {id: $pid})-[r:PRESCRIBED]->(m:Medication {key: $key}) "
        "SET r.retired_at = '2026-09-18T00:00:00Z', r.retired_by_run = 'withdrawn-run', "
        "r.run_id = 'withdrawn-run'",
        pid=patient_id, key=victim["key"],
    )

    after = nscre_engine._active_medications(patient_id, graph)
    findings_after = findings(graph)
    still_there = graph.run(
        "MATCH (p:Patient {id: $pid})-[r:PRESCRIBED]->(m:Medication {key: $key}) "
        "RETURN count(r) AS edges, count(r.retired_at) AS retired, count(m) AS nodes",
        pid=patient_id, key=victim["key"],
    )[0]

    print(f"\nAFTER   visible medications={len(after)}  findings={len(findings_after)}")
    print(f"        the edge and its node in the graph: {dict(still_there)}")

    gone = victim["key"] not in {m["key"] for m in after}
    print("\n" + "=" * 68)
    print(f"  the withdrawn medication is invisible to the engine : {'YES' if gone else 'NO'}")
    print(f"  the fact is still in the graph (retired, not deleted): "
          f"{'YES' if still_there['retired'] == 1 and still_there['nodes'] == 1 else 'NO'}")
    print(f"  findings went {len(findings_before)} -> {len(findings_after)}")
    print("=" * 68)


asyncio.run(main())
