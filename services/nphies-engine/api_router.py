"""NPHIES engine HTTP surface (port 5006).

Lean by design, matching services/veritas-graph/api_router.py and
services/orchestrator/agent_handlers.py: no gRPC, no Postgres pool -- this
service talks to NPHIES, and the status broker fans events out to the
other replicas over Redis when REDIS_URL is set. Patient scope,
RBAC, and audit logging live in apps/core, which proxies these routes; nothing
here is intended to be reachable from a browser directly.

Usage:
    NPHIES_CONNECTOR=stub python -m uvicorn api_router:app --port 5006
"""
from __future__ import annotations

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import structlog
from fastapi import BackgroundTasks, FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fhir_client import connector_mode, profiles_verified  # noqa: E402
from tasks import (  # noqa: E402
    broker,
    check_eligibility_task,
    status_event_stream,
    submit_prior_auth_task,
)

structlog.configure(processors=[structlog.processors.JSONRenderer()])
logger = structlog.get_logger()

@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Join the status fan-out for the life of the process (M01).

    Without this the broker publishes into a void that only it can hear, and an SSE
    subscriber on another replica never learns that a prior-auth was approved.
    """
    await broker.start()
    try:
        yield
    finally:
        await broker.stop()


app = FastAPI(title="Veritas-Medica NPHIES Engine", version="0.1.0", lifespan=lifespan)


class PriorAuthRequest(BaseModel):
    encounter_id: str
    order_id: str
    icd10_code: str
    sbs_code: str
    clinical_document: str
    patient_civil_id: Optional[str] = None
    payer_id: Optional[str] = None
    icd10_display: Optional[str] = None
    sbs_display: Optional[str] = None


class EligibilityRequest(BaseModel):
    encounter_id: str
    patient_civil_id: str
    payer_id: str


class EncounterActivityEvent(BaseModel):
    """Fired by apps/core when an order or diagnosis is added to an active
    encounter -- the automatic trigger described in the sprint spec."""
    encounter_id: str
    patient_civil_id: str
    payer_id: str


@app.get("/health", response_class=JSONResponse)
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "nphies-engine",
        "connector_mode": connector_mode(),
        # Surfaced on /health so an operator can see at a glance whether the
        # placeholder NPHIES profile URLs have been replaced with real IG values.
        "profiles_verified": profiles_verified(),
    }


@app.post("/api/v1/nphies/prior-auth", response_class=JSONResponse)
async def prior_auth(body: PriorAuthRequest, background: BackgroundTasks) -> dict[str, Any]:
    """Queue a prior-authorization submission.

    Returns immediately with `queued`; the real outcome arrives over the SSE
    stream as an `nphies_status_updated` event, so the UI never blocks on a payer.
    """
    background.add_task(
        submit_prior_auth_task,
        body.encounter_id,
        body.order_id,
        body.icd10_code,
        body.sbs_code,
        body.clinical_document,
        patient_civil_id=body.patient_civil_id,
        payer_id=body.payer_id,
        icd10_display=body.icd10_display,
        sbs_display=body.sbs_display,
    )
    logger.info("nphies_prior_auth_queued", encounter_id=body.encounter_id, order_id=body.order_id)
    return {"status": "queued", "encounter_id": body.encounter_id, "order_id": body.order_id}


@app.post("/api/v1/nphies/eligibility", response_class=JSONResponse)
async def eligibility(body: EligibilityRequest, background: BackgroundTasks) -> dict[str, Any]:
    """Queue an eligibility check; result arrives over SSE."""
    background.add_task(
        check_eligibility_task, body.encounter_id, body.patient_civil_id, body.payer_id
    )
    logger.info("nphies_eligibility_queued", encounter_id=body.encounter_id)
    return {"status": "queued", "encounter_id": body.encounter_id}


@app.post("/api/v1/nphies/encounter-activity", response_class=JSONResponse)
async def encounter_activity(
    body: EncounterActivityEvent, background: BackgroundTasks
) -> dict[str, Any]:
    """Automatic trigger: an order or diagnosis was added to an active encounter.

    Runs the eligibility check in the background so coverage is already confirmed
    by the time the clinician reaches the pre-auth step.
    """
    background.add_task(
        check_eligibility_task, body.encounter_id, body.patient_civil_id, body.payer_id
    )
    logger.info("nphies_encounter_activity", encounter_id=body.encounter_id)
    return {"status": "queued", "encounter_id": body.encounter_id}


@app.get("/api/v1/nphies/stream")
async def nphies_stream(encounter_id: str) -> StreamingResponse:
    """SSE stream of `nphies_status_updated` events for one encounter."""
    return StreamingResponse(status_event_stream(encounter_id), media_type="text/event-stream")


def main() -> None:
    import uvicorn

    uvicorn.run(app, host=os.environ.get("SERVICE_HOST", "127.0.0.1"), port=5006)


if __name__ == "__main__":
    main()
