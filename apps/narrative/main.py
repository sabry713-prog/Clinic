from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Optional

import asyncpg
import structlog
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from src.narrative.config import settings
from src.narrative.grpc_server import create_grpc_server
from src.narrative.interpreter import INTERPRETER_TEMPLATE_VERSION, translate_message
from src.narrative.logging_config import configure_logging
from src.narrative.model_client import get_model
from src.narrative.narrative_service import generate_narrative
from src.narrative.patient_recap import PATIENT_RECAP_TEMPLATE_VERSION, generate_patient_recap
from src.narrative.tracing import configure_tracing

configure_logging(settings.otel_service_name)
configure_tracing(settings.otel_service_name, settings.otel_exporter_otlp_endpoint)

logger = structlog.get_logger()

# gRPC server singleton
_grpc_server = None
_db_pool: Optional[asyncpg.Pool] = None  # type: ignore[type-arg]

# Model provider — replaced with real implementation when model is selected
_model = get_model()


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    global _grpc_server, _db_pool  # noqa: PLW0603
    _grpc_server = create_grpc_server(settings.narrative_grpc_port)
    _grpc_server.start()
    logger.info(
        "grpc_server_started",
        port=settings.narrative_grpc_port,
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
    title="Clinical Copilot Narrative Service",
    version="0.1.0",
    docs_url="/docs",
    lifespan=lifespan,
)

FastAPIInstrumentor.instrument_app(app)


@app.get("/health", response_class=JSONResponse)
async def health() -> dict[str, str]:
    """HTTP health endpoint for Docker / k8s liveness probes."""
    return {
        "status": "ok",
        "service": settings.otel_service_name,
    }


class GenerateNarrativeRequest(BaseModel):
    patient_id: str
    language: str = "en"
    scope: str = "full"
    force_regenerate: bool = False


@app.post("/narrative/generate", response_class=JSONResponse)
async def generate(request: GenerateNarrativeRequest) -> dict[str, Any]:
    """HTTP endpoint for NestJS proxy to call.

    The gRPC path is preferred in production; this HTTP path is provided
    for Slice 2 integration simplicity before grpc-js is wired in NestJS.
    """
    output = await generate_narrative(
        patient_id=request.patient_id,
        language=request.language,
        scope=request.scope,
        pool=_db_pool,  # type: ignore[arg-type]
        model=_model,
    )

    provenance_list = [
        {
            "sentence_index": p.sentence_index,
            "char_start": p.char_start,
            "char_end": p.char_end,
            "sources": p.sources,
        }
        for p in output.provenance
    ]

    return {
        "narrative_id": output.narrative_id,
        "patient_id": output.patient_id,
        "text": output.text,
        "fallback_message": output.fallback_message,
        "provenance": provenance_list,
        "model_version": output.model_version,
        "prompt_template_version": output.prompt_template_version,
        "generated_at": output.generated_at,
        "language": output.language,
        "scope": output.scope,
        "blocklist_triggered": output.blocklist_triggered,
        "blocklist_retries": output.blocklist_retries,
    }


class PatientRecapRequest(BaseModel):
    narrative_text: str
    language: str = "en"


@app.post("/narrative/patient-recap", response_class=JSONResponse)
async def patient_recap(request: PatientRecapRequest) -> dict[str, Any]:
    """Restyle an already-generated, already-blocklist-passed narrative
    into patient-friendly prose. See src/narrative/patient_recap.py.
    """
    text, blocklist_triggered, retries = await generate_patient_recap(
        narrative_text=request.narrative_text,
        language=request.language,
        model=_model,
    )
    return {
        "text": text,
        "fallback_message": None if text else "Plain-language recap unavailable. Showing the clinical summary instead.",
        "prompt_template_version": PATIENT_RECAP_TEMPLATE_VERSION,
        "blocklist_triggered": blocklist_triggered,
        "blocklist_retries": retries,
    }


class InterpreterRequest(BaseModel):
    text: str
    source_language: str = "en"
    target_language: str = "ar"


@app.post("/narrative/interpret", response_class=JSONResponse)
async def interpret(request: InterpreterRequest) -> dict[str, Any]:
    """Translate an ad-hoc clinician<->patient communication message.

    See src/narrative/interpreter.py. Not tied to a stored narrative --
    this translates whatever short message text the caller supplies.
    """
    text, blocklist_triggered, retries = await translate_message(
        text=request.text,
        source_language=request.source_language,
        target_language=request.target_language,
        model=_model,
    )
    return {
        "text": text,
        "fallback_message": None if text else "Translation unavailable. Please rephrase or use an in-person interpreter.",
        "prompt_template_version": INTERPRETER_TEMPLATE_VERSION,
        "blocklist_triggered": blocklist_triggered,
        "blocklist_retries": retries,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=5001,
        reload=False,
        log_config=None,  # Use structlog
    )
