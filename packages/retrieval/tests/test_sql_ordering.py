"""M10: the SQL arms must be ordered in the database, not by luck.

The handover audit filed "`_BM25_SQL` still has no `ORDER BY`" against an older
revision of retriever.py (it points at lines 30-47, which in the current file are
`_VECTOR_SQL`). Both arms do order their rows today; this pins that, so the claim
cannot quietly become true again.

Why it matters: these queries end in LIMIT 20. A statement without ORDER BY may
return any 20 rows, so the fusion step downstream would rank an arbitrary slice of
the patient's index rather than the best-matching one -- and a tiebreak on id also
keeps two identical queries from returning different top-k sets.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from retrieval.retriever import _BM25_SQL, _VECTOR_SQL  # noqa: E402


def _flat(sql: str) -> str:
    return " ".join(sql.upper().split())


def _order_clause(sql: str) -> str:
    flat = _flat(sql)
    assert "ORDER BY" in flat, "this query ends in LIMIT; without ORDER BY it may slice arbitrarily"
    return flat.split("ORDER BY", 1)[1]


def test_lexical_arm_is_ordered_by_rank_with_a_tiebreak():
    order = _order_clause(_BM25_SQL)
    assert "TS_RANK" in order, "lexical rows must be ordered by their rank, not by insertion order"
    assert "DESC" in order, "rank must descend -- best match first"
    assert ", ID" in order, "no tiebreak: two identical queries can return different top-k sets"


def test_vector_arm_is_ordered_by_distance_with_a_tiebreak():
    order = _order_clause(_VECTOR_SQL)
    assert "<=>" in order, "vector rows must be ordered by cosine distance"
    assert ", ID" in order, "no tiebreak: two identical queries can return different top-k sets"


def test_neither_query_returns_unranked_rows():
    for sql in (_BM25_SQL, _VECTOR_SQL):
        flat = _flat(sql)
        assert "LIMIT" in flat, "an unbounded scan of the patient index is not a top-k retrieval"
