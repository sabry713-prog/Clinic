from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from src.qa.config import settings
from src.qa.grpc_server import create_grpc_server
from src.qa.logging_config import configure_logging
from src.qa.tracing import configure_tracing

configure_logging(settings.otel_service_name)
configure_tracing(settings.otel_service_name, settings.otel_exporter_otlp_endpoint)

logger = structlog.get_logger()

_grpc_server = None


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncGenerator[None, None]:
    global _grpc_server  # noqa: PLW0603
    _grpc_server = create_grpc_server(settings.qa_grpc_port)
    _grpc_server.start()
    logger.info(
        "grpc_server_started",
        port=settings.qa_grpc_port,
        service=settings.otel_service_name,
    )
    yield
    _grpc_server.stop(grace=5)
    logger.info("grpc_server_stopped")


app = FastAPI(
    title="Clinical Copilot Q&A Service",
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=5002,
        reload=False,
        log_config=None,
    )
