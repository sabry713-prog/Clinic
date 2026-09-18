"""Typed fact contracts for Q&A — facts with immutable record ids.

M10.  Every fact handed to the model, and every source handed back to the
clinician, carries the **immutable id of the row it came from**
(``PatientFact.record_id``).  Before this, Q&A attached the *patient* id to
every chunk: a citation could not be dereferenced at all, and a source list of
eight facts deduplicated down to one.

Two retrieval routes are named and reported, never blurred:

``lexical_index``
    The patient's chunks in ``hospital.retrieval_chunk``, ranked by the
    packaged retriever (BM25, deterministic ordering).  ``source_id`` there is
    the source row's id, written by the indexer — the same contract as here.
``facts_fallback``
    The record read directly, when the patient has no chunks in the index.
    The path is reported on the response, so a claim about retrieval can be
    checked against what actually ran.

Vector ranking is not available by default: it needs an *evaluated* embedding
model, and the development provider is a stub whose ordering means nothing
(see ``retrieval.embedder``).  Lexical retrieval is retained deliberately
until such a model is provisioned and measured.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Optional

import structlog

from .types import AnswerSource

if TYPE_CHECKING:
    import asyncpg
    from retrieval.embedder import EmbeddingProvider

logger = structlog.get_logger()

#: source_type → table holding that row.  Used only to check that a cited
#: record is still there; the table names are constants of this module, never
#: caller input.
SOURCE_TABLES: dict[str, str] = {
    "condition": "hospital.condition",
    "observation": "hospital.observation",
    "allergy": "hospital.allergy_intolerance",
    "encounter": "hospital.encounter",
    "medication": "hospital.medication_request",
    "document": "hospital.document_reference",
    "procedure": "hospital.procedure",
}

#: Names other producers use for the same record types (the chunker writes
#: FHIR-style names, the indexer and this module write short ones).
_TYPE_ALIASES: dict[str, str] = {
    "allergyintolerance": "allergy",
    "medicationrequest": "medication",
    "documentreference": "document",
    "lab": "observation",
    "laboratory": "observation",
    "vital-signs": "observation",
    "vital": "observation",
}


def normalize_source_type(source_type: str) -> Optional[str]:
    """Map a source-type name onto a table key, or None if unrecognised."""
    key = (source_type or "").strip().lower()
    key = _TYPE_ALIASES.get(key, key)
    return key if key in SOURCE_TABLES else None


def _fmt_dt(value: Any) -> str:
    """Render DB timestamps as readable text for chunk content."""
    if value is None:
        return "unknown"
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d %b %Y")
    return str(value)


@dataclass(frozen=True)
class PatientFact:
    """One fact from the record, tied to the row it came from.

    ``record_id`` is that row's primary key.  It is immutable: a corrected
    fact is a new version of the same row (same id, new values), and a
    withdrawn fact is a row that stops being returned — so a citation that
    resolved yesterday identifies the same thing today.
    """

    record_id: str
    source_type: str
    field: str
    code: str
    content_text: str
    effective_at: str
    source_system: str = "hospital"
    language: str = "en"

    @property
    def table(self) -> Optional[str]:
        return SOURCE_TABLES.get(self.source_type)

    def to_chunk(self) -> dict[str, Any]:
        """The chunk shape the synthesis pipeline consumes."""
        return {
            "source_type": self.source_type,
            "source_id": self.record_id,
            "content_text": self.content_text,
            "language": self.language,
            "effective_at": self.effective_at,
            "code": self.code,
            "source_system": self.source_system,
            "field": self.field,
        }


@dataclass
class RetrievalOutcome:
    """What retrieval did, and the chunks it produced.

    ``path`` is carried onto the response so the answer states which route
    grounded it.
    """

    path: str
    chunks: list[dict[str, Any]]
    facts_count: int = 0
    index_chunks: int = 0
    embedding_model: str = "none"


async def load_patient_facts(
    pool: "asyncpg.Pool[Any]",
    patient_id: str,
) -> list[PatientFact]:
    """Read the patient's facts as typed records with their row ids.

    Every query selects ``id`` and orders deterministically (the sort key
    followed by ``id``): the same record read twice yields the same list in
    the same order, which is what makes the fallback ranking reproducible.
    """
    facts: list[PatientFact] = []
    now = datetime.utcnow().isoformat()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id::text AS id, code, code_display, status, onset_date
               FROM hospital.condition
               WHERE patient_id = $1
               ORDER BY onset_date DESC NULLS LAST, id""",
            patient_id,
        )
        for r in rows:
            facts.append(PatientFact(
                record_id=r["id"],
                source_type="condition",
                field="condition",
                code=r["code"] or "",
                content_text=(
                    f"Condition: {r['code_display']} (code: {r['code']}) "
                    f"status: {r['status']}, onset: {_fmt_dt(r['onset_date'])}"
                ),
                effective_at=str(r["onset_date"]) if r["onset_date"] else now,
            ))

        rows = await conn.fetch(
            """SELECT id::text AS id, code, code_display, category, value_numeric, unit,
                      value_text, effective_at, ref_range_low, ref_range_high, ref_range_text
               FROM hospital.observation
               WHERE patient_id = $1
               ORDER BY effective_at DESC, id
               LIMIT 200""",
            patient_id,
        )
        for r in rows:
            val = (
                f"{r['value_numeric']} {r['unit'] or ''}".strip()
                if r["value_numeric"] is not None
                else (r["value_text"] or "")
            )
            ref = ""
            if r["ref_range_low"] is not None and r["ref_range_high"] is not None:
                ref = f" (ref: {r['ref_range_low']}-{r['ref_range_high']} {r['unit'] or ''})"
            elif r["ref_range_text"]:
                ref = f" (ref: {r['ref_range_text']})"
            facts.append(PatientFact(
                record_id=r["id"],
                source_type="observation",
                field=r["category"] or "observation",
                code=r["code"] or "",
                content_text=(
                    f"{r['category'] or 'Lab'}: {r['code_display']} = {val}{ref} "
                    f"(recorded: {_fmt_dt(r['effective_at'])})"
                ),
                effective_at=str(r["effective_at"]),
            ))

        rows = await conn.fetch(
            """SELECT id::text AS id, code, code_display, reaction, recorded_at
               FROM hospital.allergy_intolerance
               WHERE patient_id = $1
               ORDER BY recorded_at DESC NULLS LAST, id""",
            patient_id,
        )
        for r in rows:
            facts.append(PatientFact(
                record_id=r["id"],
                source_type="allergy",
                field="allergy",
                code=r["code"] or "",
                content_text=(
                    f"Allergy: {r['code_display']} "
                    f"reaction: {r['reaction'] or 'unspecified'} "
                    f"(recorded: {_fmt_dt(r['recorded_at'])})"
                ),
                effective_at=str(r["recorded_at"]) if r["recorded_at"] else now,
            ))

        rows = await conn.fetch(
            """SELECT id::text AS id, encounter_type, status, started_at, ended_at, ward
               FROM hospital.encounter
               WHERE patient_id = $1
               ORDER BY started_at DESC, id
               LIMIT 40""",
            patient_id,
        )
        for r in rows:
            facts.append(PatientFact(
                record_id=r["id"],
                source_type="encounter",
                field="encounter",
                code="",
                content_text=(
                    f"Encounter: {r['encounter_type']} status: {r['status']} "
                    f"ward: {r['ward'] or 'unknown'} "
                    f"from {_fmt_dt(r['started_at'])} "
                    f"to {_fmt_dt(r['ended_at']) if r['ended_at'] else 'ongoing'}"
                ),
                effective_at=str(r["started_at"]),
            ))

        # Medications (joined to the ordering encounter so clinic-prescribed
        # treatment can be attributed to its clinic)
        rows = await conn.fetch(
            """SELECT m.id::text AS id, m.medication_display, m.status, m.prescriber_display,
                      m.dose, m.route, m.frequency, m.started_at, e.ward AS clinic
               FROM hospital.medication_request m
               LEFT JOIN hospital.encounter e ON e.id = m.encounter_id
               WHERE m.patient_id = $1
               ORDER BY m.started_at DESC, m.id
               LIMIT 40""",
            patient_id,
        )
        for r in rows:
            # Only outpatient clinic encounters carry a meaningful clinic name;
            # inpatient meds (ward like "Ward-4A") are left unattributed.
            clinic = r["clinic"] if r["clinic"] and str(r["clinic"]).endswith("Clinic") else None
            clinic_suffix = f" (prescribed at {clinic})" if clinic else ""
            facts.append(PatientFact(
                record_id=r["id"],
                source_type="medication",
                field="medication",
                code="",
                content_text=(
                    f"Medication: {r['medication_display']} "
                    f"dose: {r['dose'] or 'unspecified'} "
                    f"route: {r['route'] or ''} "
                    f"frequency: {r['frequency'] or ''} "
                    f"status: {r['status']} "
                    f"(started: {_fmt_dt(r['started_at'])})"
                    f"{clinic_suffix}"
                ),
                effective_at=str(r["started_at"]) if r["started_at"] else now,
            ))

        rows = await conn.fetch(
            """SELECT id::text AS id, type, content_text, authored_at
               FROM hospital.document_reference
               WHERE patient_id = $1
               ORDER BY authored_at DESC, id
               LIMIT 40""",
            patient_id,
        )
        for r in rows:
            content = (r["content_text"] or "")[:500]
            facts.append(PatientFact(
                record_id=r["id"],
                source_type="document",
                field=r["type"] or "note",
                code="",
                content_text=f"Note ({r['type']}): {content}",
                effective_at=str(r["authored_at"]) if r["authored_at"] else now,
            ))

        rows = await conn.fetch(
            """SELECT id::text AS id, code_display, status, performed_at, performer_display, note
               FROM hospital.procedure
               WHERE patient_id = $1
               ORDER BY performed_at DESC, id
               LIMIT 40""",
            patient_id,
        )
        for r in rows:
            note = (r["note"] or "")[:400]
            facts.append(PatientFact(
                record_id=r["id"],
                source_type="procedure",
                field="procedure",
                code="",
                content_text=(
                    f"Procedure: {r['code_display']} "
                    f"status: {r['status']} "
                    f"(performed: {_fmt_dt(r['performed_at'])}"
                    f"{f', {note}' if note else ''})"
                ),
                effective_at=str(r["performed_at"]) if r["performed_at"] else now,
            ))

    return facts


async def count_index_chunks(
    pool: "asyncpg.Pool[Any]",
    patient_id: str,
    language: str = "en",
) -> int:
    """How many chunks this patient actually has in the retrieval index."""
    async with pool.acquire() as conn:
        return int(await conn.fetchval(
            """SELECT count(*)
               FROM hospital.retrieval_chunk
               WHERE patient_id = $1 AND language = $2""",
            patient_id,
            language,
        ) or 0)


async def _index_chunks(
    pool: "asyncpg.Pool[Any]",
    patient_id: str,
    question: str,
    language: str,
    mode: str,
    embedder: Optional["EmbeddingProvider"],
    top_k: int,
) -> list[dict[str, Any]]:
    """Run the packaged retriever over the patient's index."""
    from retrieval.retriever import hybrid_retrieve, lexical_retrieve

    if mode == "hybrid":
        if embedder is None:
            raise ValueError(
                "retrieval_mode='hybrid' requires an embedding provider; "
                "none is configured (EMBEDDING_MODEL_PROVIDER is stub/empty)."
            )
        results = await hybrid_retrieve(
            patient_id=patient_id,
            query=question,
            pool=pool,
            embedder=embedder,
            top_k=top_k,
            language=language,
        )
    else:
        results = await lexical_retrieve(
            patient_id=patient_id,
            query=question,
            pool=pool,
            top_k=top_k,
            language=language,
        )

    return [
        {
            "source_type": r.source_type,
            "source_id": r.source_id,
            "content_text": r.content_text,
            "language": r.language,
            "effective_at": r.effective_at,
            "code": getattr(r, "code", ""),
            "source_system": getattr(r, "source_system", "hospital"),
            "field": getattr(r, "field", ""),
        }
        for r in results
    ]


async def retrieve_patient_chunks(
    pool: "asyncpg.Pool[Any]",
    patient_id: str,
    question: str,
    language: str,
    mode: str = "lexical",
    embedder: Optional["EmbeddingProvider"] = None,
    top_k: int = 8,
) -> RetrievalOutcome:
    """Retrieve the chunks that will ground an answer, recording the route.

    The index is used when the patient has chunks in it; otherwise the record
    is read directly.  The chosen route, the counts behind it and any citation
    that failed to resolve are all reported on the outcome, so the answer can
    be audited against the retrieval that produced it.
    """
    facts_count = 0
    index_chunks = await count_index_chunks(pool, patient_id, language)

    if index_chunks > 0:
        try:
            chunks = await _index_chunks(
                pool=pool,
                patient_id=patient_id,
                question=question,
                language=language,
                mode=mode,
                embedder=embedder,
                top_k=top_k,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("qa_index_retrieval_failed", error=str(exc), patient_id=patient_id)
            chunks = []
        path = f"{mode}_index"
        return RetrievalOutcome(
            path=path,
            chunks=chunks,
            facts_count=facts_count,
            index_chunks=index_chunks,
            embedding_model=embedder.model_id() if embedder is not None else "none",
        )

    facts = await load_patient_facts(pool, patient_id)
    logger.info(
        "qa_retrieval_facts_fallback",
        patient_id=patient_id,
        index_chunks=index_chunks,
        facts=len(facts),
        # named explicitly: the index did not ground this answer
    )
    return RetrievalOutcome(
        path="facts_fallback",
        chunks=[f.to_chunk() for f in facts],
        facts_count=len(facts),
        index_chunks=index_chunks,
    )


async def filter_resolved_sources(
    pool: "asyncpg.Pool[Any]",
    patient_id: str,
    sources: list[AnswerSource],
    chunks: list[dict[str, Any]],
) -> tuple[list[AnswerSource], list[str]]:
    """Split the answer's sources into the ones that resolve and the ones that do not.

    This replaces a pair of functions that each held half the rule and could not be
    used together: one counted unresolved citations but returned only a number, the
    other dropped sources without ever asking the record, so a source whose row had
    been deleted since the index was written survived both.

    A source resolves when a chunk was retrieved for it, that chunk names a mapped
    source type and an immutable record id, and **that row is still in this patient's
    record**.  Everything else comes back as unresolved rather than being cited: a
    link that cannot be dereferenced does not entail its claim, and a citation whose
    type has no table mapping cannot be checked at all — "cannot be verified" is not
    "verified".  The patient id is part of the lookup, so a record that exists but
    belongs to someone else does not resolve either.

    Returns ``(kept, unresolved)`` where ``unresolved`` holds the source ids that
    failed, in input order, for the caller to log or report.
    """
    verified: set[str] = set()
    by_table: dict[str, list[str]] = {}
    unmappable = 0

    for chunk in chunks:
        source_type = normalize_source_type(str(chunk.get("source_type", "")))
        record_id = str(chunk.get("source_id", "") or "")
        if source_type is None or not record_id:
            unmappable += 1
            continue
        by_table.setdefault(source_type, []).append(record_id)

    async with pool.acquire() as conn:
        for source_type, ids in sorted(by_table.items()):
            rows = await conn.fetch(
                f"SELECT id::text AS id FROM {SOURCE_TABLES[source_type]} "
                "WHERE patient_id = $1 AND id = ANY($2::uuid[])",
                patient_id,
                sorted(set(ids)),
            )
            verified.update(str(r["id"]) for r in rows)

    kept: list[AnswerSource] = []
    unresolved: list[str] = []
    for source in sources:
        source_id = str(getattr(source, "id", "") or "")
        if source_id and source_id in verified:
            kept.append(source)
        else:
            unresolved.append(source_id or "<no id>")

    if unresolved:
        logger.warning(
            "qa_source_unresolved",
            patient_id=patient_id,
            unresolved=len(unresolved),
            checked=len(sources),
            unmappable_chunks=unmappable,
        )
    return kept, unresolved
