"""M10: a citation is kept only if its row is still in this patient's record.

The rule used to be split across two functions that could not both be applied: one
counted unresolved citations and returned only a number, the other filtered sources by
chunk shape and never asked the record -- so a source whose row had been deleted after
indexing survived both.
"""
from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from qa.fact_contract import filter_resolved_sources  # noqa: E402
from qa.types import AnswerSource  # noqa: E402


@dataclass
class Source:
    id: str


class FakeConn:
    """Answers the row lookup the way the database would."""

    def __init__(self, stored):
        self.stored = set(stored)
        self.queries = []

    async def fetch(self, sql, *args):
        self.queries.append((sql, args))
        return [{"id": i} for i in args[1] if i in self.stored]


class FakePool:
    def __init__(self, stored):
        self.conn = FakeConn(stored)

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def run(stored, sources, chunks, patient_id="p-1"):
    pool = FakePool(stored)
    kept, unresolved = asyncio.run(
        filter_resolved_sources(pool, patient_id, sources, chunks)
    )
    return pool, kept, unresolved


def chunk(source_id="row-1", source_type="observation"):
    return {"source_type": source_type, "source_id": source_id, "content_text": "x"}


def test_a_source_whose_row_is_still_there_is_kept():
    _, kept, unresolved = run({"row-1"}, [Source("row-1")], [chunk()])
    assert [s.id for s in kept] == ["row-1"]
    assert unresolved == []


def test_a_row_deleted_after_indexing_is_unresolved():
    _, kept, unresolved = run(set(), [Source("row-9")], [chunk("row-9")])
    assert kept == []
    assert unresolved == ["row-9"]


def test_an_unmappable_type_is_unresolved_and_never_queried():
    pool, kept, unresolved = run({"row-1"}, [Source("row-1")], [chunk(source_type="not-a-type")])
    assert kept == [] and unresolved == ["row-1"]
    assert pool.conn.queries == [], "a chunk type with no table mapping must not reach the database"


def test_a_source_with_no_id_is_never_kept():
    _, kept, unresolved = run({"row-1"}, [Source("")], [chunk()])
    assert kept == []
    assert unresolved == ["<no id>"]


def test_the_lookup_is_patient_scoped():
    pool, kept, _ = run({"row-1"}, [Source("row-1")], [chunk()], patient_id="p-42")
    assert kept, "the row is stored, so it resolves"
    sql, args = pool.conn.queries[0]
    assert args[0] == "p-42", "the patient id must reach the query"
    assert "patient_id = $1" in sql, "a record belonging to another patient must not resolve"


def test_only_looked_up_rows_are_kept_when_several_are_cited():
    _, kept, unresolved = run(
        {"row-1"}, [Source("row-1"), Source("row-2")], [chunk("row-1"), chunk("row-2")]
    )
    assert [s.id for s in kept] == ["row-1"]
    assert unresolved == ["row-2"]


def test_the_real_source_type_still_carries_an_id():
    """The filter reads .id, so the shipped type has to keep offering one."""
    assert hasattr(AnswerSource, "__dataclass_fields__")
    assert "id" in AnswerSource.__dataclass_fields__, "AnswerSource lost its id field"
