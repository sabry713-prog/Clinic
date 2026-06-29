from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import date, datetime
from typing import Any, AsyncGenerator, Optional

import asyncpg
import structlog
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from pydantic import BaseModel

from src.qa.config import settings
from src.qa.grpc_server import create_grpc_server
from src.qa.logging_config import configure_logging
from src.qa.model_client import get_model
from src.qa.model_classifier import get_classifier_model
from src.qa.qa_service import answer as qa_answer
from src.qa.tracing import configure_tracing

configure_logging(settings.otel_service_name)
configure_tracing(settings.otel_service_name, settings.otel_exporter_otlp_endpoint)

logger = structlog.get_logger()

_grpc_server = None
_db_pool: Optional[asyncpg.Pool] = None  # type: ignore[type-arg]


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    global _grpc_server, _db_pool  # noqa: PLW0603
    _grpc_server = create_grpc_server(settings.qa_grpc_port)
    _grpc_server.start()
    logger.info(
        "grpc_server_started",
        port=settings.qa_grpc_port,
        service=settings.otel_service_name,
    )
    db_url = settings.database_url
    if db_url:
        try:
            _db_pool = await asyncpg.create_pool(db_url, min_size=1, max_size=5)
            logger.info("db_pool_created")
        except Exception as exc:  # noqa: BLE001
            logger.warning("db_pool_failed", error=str(exc))
    yield
    _grpc_server.stop(grace=5)
    logger.info("grpc_server_stopped")
    if _db_pool:
        await _db_pool.close()


app = FastAPI(
    title="Clinical Copilot Q&A Service",
    version="0.1.0",
    docs_url="/docs",
    lifespan=lifespan,
)

FastAPIInstrumentor.instrument_app(app)


class AskRequest(BaseModel):
    patient_id: str
    question: str
    language: str = "en"
    conversation_id: Optional[str] = None


@app.get("/health", response_class=JSONResponse)
async def health() -> dict[str, str]:
    """HTTP health endpoint for Docker / k8s liveness probes."""
    return {
        "status": "ok",
        "service": settings.otel_service_name,
    }


def _fmt_dt(value: Any) -> str:
    """Render DB timestamps as readable text for chunk content."""
    if value is None:
        return "unknown"
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d %b %Y")
    return str(value)


async def _fetch_patient_chunks(patient_id: str) -> list[dict[str, Any]]:
    """
    Fetch patient facts directly from the DB and format them as retrieval chunks.
    Used in stub/dev mode when the vector index is not populated.
    """
    if _db_pool is None:
        return []

    chunks: list[dict[str, Any]] = []
    now = datetime.utcnow().isoformat()

    async with _db_pool.acquire() as conn:
        # Conditions
        rows = await conn.fetch(
            """SELECT code, code_display, status, onset_date
               FROM hospital.condition
               WHERE patient_id = $1
               ORDER BY onset_date DESC NULLS LAST""",
            patient_id,
        )
        for r in rows:
            chunks.append({
                "source_type": "condition",
                "source_id": patient_id,
                "content_text": (
                    f"Condition: {r['code_display']} (code: {r['code']}) "
                    f"status: {r['status']}, onset: {_fmt_dt(r['onset_date'])}"
                ),
                "language": "en",
                "effective_at": str(r["onset_date"]) if r["onset_date"] else now,
                "code": r["code"] or "",
                "source_system": "hospital",
                "field": "condition",
            })

        # Observations (vitals, labs)
        rows = await conn.fetch(
            """SELECT code, code_display, category, value_numeric, unit,
                      value_text, effective_at, ref_range_low, ref_range_high, ref_range_text
               FROM hospital.observation
               WHERE patient_id = $1
               ORDER BY effective_at DESC
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
            chunks.append({
                "source_type": "observation",
                "source_id": patient_id,
                "content_text": (
                    f"{r['category'] or 'Lab'}: {r['code_display']} = {val}{ref} "
                    f"(recorded: {_fmt_dt(r['effective_at'])})"
                ),
                "language": "en",
                "effective_at": str(r["effective_at"]),
                "code": r["code"] or "",
                "source_system": "hospital",
                "field": r["category"] or "observation",
            })

        # Allergies
        rows = await conn.fetch(
            """SELECT code, code_display, reaction, recorded_at
               FROM hospital.allergy_intolerance
               WHERE patient_id = $1""",
            patient_id,
        )
        for r in rows:
            chunks.append({
                "source_type": "allergy",
                "source_id": patient_id,
                "content_text": (
                    f"Allergy: {r['code_display']} "
                    f"reaction: {r['reaction'] or 'unspecified'} "
                    f"(recorded: {_fmt_dt(r['recorded_at'])})"
                ),
                "language": "en",
                "effective_at": str(r["recorded_at"]) if r["recorded_at"] else now,
                "code": r["code"] or "",
                "source_system": "hospital",
                "field": "allergy",
            })

        # Encounters
        rows = await conn.fetch(
            """SELECT encounter_type, status, started_at, ended_at, ward
               FROM hospital.encounter
               WHERE patient_id = $1
               ORDER BY started_at DESC
               LIMIT 40""",
            patient_id,
        )
        for r in rows:
            chunks.append({
                "source_type": "encounter",
                "source_id": patient_id,
                "content_text": (
                    f"Encounter: {r['encounter_type']} status: {r['status']} "
                    f"ward: {r['ward'] or 'unknown'} "
                    f"from {_fmt_dt(r['started_at'])} "
                    f"to {_fmt_dt(r['ended_at']) if r['ended_at'] else 'ongoing'}"
                ),
                "language": "en",
                "effective_at": str(r["started_at"]),
                "code": "",
                "source_system": "hospital",
                "field": "encounter",
            })

        # Medications (joined to the ordering encounter so clinic-prescribed
        # treatment can be attributed to its clinic)
        rows = await conn.fetch(
            """SELECT m.medication_display, m.status, m.prescriber_display,
                      m.dose, m.route, m.frequency, m.started_at, e.ward AS clinic
               FROM hospital.medication_request m
               LEFT JOIN hospital.encounter e ON e.id = m.encounter_id
               WHERE m.patient_id = $1
               ORDER BY m.started_at DESC
               LIMIT 40""",
            patient_id,
        )
        for r in rows:
            # Only outpatient clinic encounters carry a meaningful clinic name;
            # inpatient meds (ward like "Ward-4A") are left unattributed.
            clinic = r["clinic"] if r["clinic"] and str(r["clinic"]).endswith("Clinic") else None
            clinic_suffix = f" (prescribed at {clinic})" if clinic else ""
            chunks.append({
                "source_type": "medication",
                "source_id": patient_id,
                "content_text": (
                    f"Medication: {r['medication_display']} "
                    f"dose: {r['dose'] or 'unspecified'} "
                    f"route: {r['route'] or ''} "
                    f"frequency: {r['frequency'] or ''} "
                    f"status: {r['status']} "
                    f"(started: {_fmt_dt(r['started_at'])})"
                    f"{clinic_suffix}"
                ),
                "language": "en",
                "effective_at": str(r["started_at"]) if r["started_at"] else now,
                "code": "",
                "source_system": "hospital",
                "field": "medication",
            })

        # Documents (notes)
        rows = await conn.fetch(
            """SELECT type, content_text, authored_at
               FROM hospital.document_reference
               WHERE patient_id = $1
               ORDER BY authored_at DESC
               LIMIT 40""",
            patient_id,
        )
        for r in rows:
            content = (r["content_text"] or "")[:500]
            chunks.append({
                "source_type": "document",
                "source_id": patient_id,
                "content_text": f"Note ({r['type']}): {content}",
                "language": "en",
                "effective_at": str(r["authored_at"]) if r["authored_at"] else now,
                "code": "",
                "source_system": "hospital",
                "field": r["type"] or "note",
            })

        # Procedures / interventions (operations, cath lab, stents)
        rows = await conn.fetch(
            """SELECT code_display, status, performed_at, performer_display, note
               FROM hospital.procedure
               WHERE patient_id = $1
               ORDER BY performed_at DESC
               LIMIT 40""",
            patient_id,
        )
        for r in rows:
            note = (r["note"] or "")[:400]
            chunks.append({
                "source_type": "procedure",
                "source_id": patient_id,
                "content_text": (
                    f"Procedure: {r['code_display']} "
                    f"status: {r['status']} "
                    f"(performed: {_fmt_dt(r['performed_at'])}"
                    f"{f', {note}' if note else ''})"
                ),
                "language": "en",
                "effective_at": str(r["performed_at"]) if r["performed_at"] else now,
                "code": "",
                "source_system": "hospital",
                "field": "procedure",
            })

    return chunks


@app.post("/qa/answer", response_class=JSONResponse)
async def ask(body: AskRequest) -> dict:
    """Classify and answer a factual question about a patient."""
    try:
        # In stub/dev mode: fetch patient facts directly from DB as context chunks
        chunks = await _fetch_patient_chunks(body.patient_id)

        result = await qa_answer(
            patient_id=body.patient_id,
            question=body.question,
            language=body.language,
            conversation_id=body.conversation_id,
            pool=None,    # vector retrieval disabled in stub mode
            embedder=None,
            model=get_model(),  # stub, or on-prem local provider when configured
            classifier_model=get_classifier_model(),
            _override_chunks=chunks,  # pass DB facts directly
        )
        return asdict(result)
    except Exception as exc:  # noqa: BLE001
        logger.error("qa_answer_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=5002,
        reload=False,
        log_config=None,
    )
