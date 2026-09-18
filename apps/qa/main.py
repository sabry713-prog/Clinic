from __future__ import annotations
import os

# --- workspace package resolution -------------------------------------------
# The uv editable installs (.pth files under site-packages pointing at each
# package's src/) are present and the packages are installed, but in this
# environment those paths are intermittently never applied to sys.path — at
# which point blocklist / classifier / retrieval / phi_guard all disappear and
# the service cannot start. Resolve them explicitly so startup does not depend
# on that. Harmless when the venv is healthy (paths already present are skipped).
import sys as _sys
from pathlib import Path as _Path

_REPO_ROOT = _Path(__file__).resolve().parents[2]
for _p in (_Path(__file__).resolve().parent, *( _d / "src" for _d in (_REPO_ROOT / "packages").iterdir() if (_d / "src").is_dir())):
    if str(_p) not in _sys.path:
        _sys.path.insert(0, str(_p))
# ----------------------------------------------------------------------------

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
from src.qa.synthesis import BlocklistUnavailableError
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


async def _fetch_patient_names(patient_id: str) -> list[str]:
    """Names for the PHI egress guard to redact before any external call.

    Regexes cannot detect personal names, so the guard is given the ones on
    record for this patient (full name plus its parts, so a partial mention
    in free text is caught too).
    """
    if _db_pool is None:
        return []
    async with _db_pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT display_name, given_name, family_name
               FROM hospital.patient WHERE id = $1""",
            patient_id,
        )
    if not row:
        return []
    names: list[str] = []
    for value in (row["display_name"], row["given_name"], row["family_name"]):
        if value and str(value).strip():
            names.extend(_name_variants(str(value).strip()))
    # Longest first so "Ahmad Al-Bishi" is redacted before its parts.
    unique = list(dict.fromkeys(names))
    unique.sort(key=len, reverse=True)
    return unique


def _name_variants(name: str) -> list[str]:
    """Expand a name into the forms that may appear in free text.

    A note may use the full name, a single token, or part of a hyphenated
    surname ("Al-Bishi" from "Ahmad Fakename-Al-Bishi"), so each of those has
    to be redactable on its own.
    """
    variants: list[str] = [name]
    for token in name.split():
        if len(token) > 2:
            variants.append(token)
        if "-" in token:
            parts = token.split("-")
            # Hyphen-joined suffixes: Fakename-Al-Bishi -> Al-Bishi -> Bishi
            for i in range(1, len(parts)):
                suffix = "-".join(parts[i:])
                if len(suffix) > 2:
                    variants.append(suffix)
            for part in parts:
                if len(part) > 2:
                    variants.append(part)
    return variants


def _configured_embedder() -> Any:
    """The embedding provider this deployment has, or None.

    ``create_embedder()`` returns None for the development stub, whose vectors are
    seeded from a hash: ranking by cosine distance over them would present an
    arbitrary order as relevance.  Returning None keeps retrieval lexical, and the
    route is logged, so an answer never claims vector grounding it did not have.
    """
    try:
        from retrieval.embedder import create_embedder

        embedder = create_embedder()
        logger.info(
            "qa_embedder_configured",
            model_id=embedder.model_id() if embedder is not None else "none",
        )
        return embedder
    except Exception as exc:  # noqa: BLE001
        logger.warning("qa_embedder_unavailable", error=str(exc))
        return None


@app.post("/qa/answer", response_class=JSONResponse)
async def ask(body: AskRequest) -> dict:
    """Classify and answer a factual question about a patient."""
    try:
        patient_names = await _fetch_patient_names(body.patient_id)

        result = await qa_answer(
            patient_id=body.patient_id,
            question=body.question,
            language=body.language,
            conversation_id=body.conversation_id,
            pool=_db_pool,
            # None when the deployment has no *evaluated* embedding model, which
            # keeps retrieval lexical instead of ranking a stub's vectors
            embedder=_configured_embedder(),
            # names handed to the PHI egress guard for redaction
            model=get_model(patient_names=patient_names),
            classifier_model=get_classifier_model(),
        )
        return asdict(result)
    except BlocklistUnavailableError as exc:
        # Safety control missing — surface it as a distinct, unmistakable
        # failure rather than a generic 500, so a broken deployment is
        # obvious instead of looking like a transient model error.
        logger.error("qa_blocklist_unavailable", error=str(exc))
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("qa_answer_error", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.environ.get("SERVICE_HOST", "127.0.0.1"),
        port=5002,
        reload=False,
        log_config=None,
    )
