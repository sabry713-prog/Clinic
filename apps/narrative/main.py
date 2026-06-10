from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import structlog
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from src.narrative.config import settings
from src.narrative.grpc_server import create_grpc_server
from src.narrative.logging_config import configure_logging
from src.narrative.model_client import StubModelProvider
from src.narrative.narrative_service import generate_narrative
from src.narrative.tracing import configure_tracing

configure_logging(settings.otel_service_name)
configure_tracing(settings.otel_service_name, settings.otel_exporter_otlp_endpoint)

logger = structlog.get_logger()

# gRPC server singleton
_grpc_server = None

# Model provider — replaced with real implementation when model is selected
_model = StubModelProvider()


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    global _grpc_server  # noqa: PLW0603
    _grpc_server = create_grpc_server(settings.narrative_grpc_port)
    _grpc_server.start()
    logger.info(
        "grpc_server_started",
        port=settings.narrative_grpc_port,
        service=settings.otel_service_name,
    )
    yield
    _grpc_server.stop(grace=5)
    logger.info("grpc_server_stopped")


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
    # In Slice 2 the database pool is None — assembly falls back gracefully
    # (real pool injected at Slice 3 when DB is fully wired)
    output = await generate_narrative(
        patient_id=request.patient_id,
        language=request.language,
        scope=request.scope,
        pool=None,  # type: ignore[arg-type]
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=5001,
        reload=False,
        log_config=None,  # Use structlog
    )
