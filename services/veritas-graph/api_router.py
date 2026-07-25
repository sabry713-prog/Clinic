"""NSCRE HTTP API -- exposes nscre_engine.py's deterministic checks over
REST. This service (services/veritas-graph) had no HTTP surface before this
file; it was purely a library used by ingestion scripts. Kept deliberately
lean compared to apps/qa|narrative|transcription's main.py (no gRPC, no
Postgres pool -- this service only talks to Neo4j).

Usage:
    NEO4J_URI=bolt://localhost:7687 NEO4J_AUTH=neo4j/password \
        python services/veritas-graph/api_router.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Optional

import structlog
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent))

from graph_client import GraphError, get_client  # noqa: E402
from nscre_engine import (  # noqa: E402
    check_order,
    evaluate_encounter,
    screen_alternative_candidates,
)

structlog.configure(processors=[structlog.processors.JSONRenderer()])
logger = structlog.get_logger()

app = FastAPI(title="Veritas-Medica NSCRE", version="0.1.0")


class EvaluateEncounterRequest(BaseModel):
    patient_id: str


class AlternativeCandidatesRequest(BaseModel):
    patient_id: str
    flagged_drug_key: str
    limit: int = 5


class CheckOrderRequest(BaseModel):
    patient_id: str
    proposed_drug_key: Optional[str] = None
    necessity_code: Optional[str] = None
    icd10_code: Optional[str] = None


@app.get("/health", response_class=JSONResponse)
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "veritas-graph-nscre"}


@app.post("/api/v1/nscre/evaluate-encounter", response_class=JSONResponse)
async def evaluate_encounter_route(body: EvaluateEncounterRequest) -> dict[str, Any]:
    graph = get_client()
    try:
        result = evaluate_encounter(body.patient_id, client=graph)
    except GraphError as exc:
        logger.error("nscre_evaluate_encounter_failed", error=str(exc))
        raise HTTPException(status_code=503, detail="Graph query failed") from exc
    finally:
        graph.close()
    # Metadata only -- never patient-identifying values -- in logs (CLAUDE.md sec 7 discipline).
    logger.info(
        "nscre_evaluate_encounter",
        interaction_count=len(result["drug_interactions"]),
        dose_safety_count=len(result["dose_safety"]),
        necessity_count=len(result["necessity"]),
    )
    return result


@app.post("/api/v1/nscre/check-order", response_class=JSONResponse)
async def check_order_route(body: CheckOrderRequest) -> dict[str, Any]:
    graph = get_client()
    try:
        result = check_order(
            body.patient_id,
            proposed_drug_key=body.proposed_drug_key,
            necessity_code=body.necessity_code,
            icd10_code=body.icd10_code,
            client=graph,
        )
    except GraphError as exc:
        logger.error("nscre_check_order_failed", error=str(exc))
        raise HTTPException(status_code=503, detail="Graph query failed") from exc
    finally:
        graph.close()
    logger.info(
        "nscre_check_order",
        interaction_count=len(result["drug_interactions"]),
        dose_safety_count=len(result["dose_safety"]),
        necessity_checked=result["necessity"] is not None,
    )
    return result


@app.post("/api/v1/nscre/alternative-candidates", response_class=JSONResponse)
async def alternative_candidates_route(body: AlternativeCandidatesRequest) -> dict[str, Any]:
    """Deterministic screening of possible alternatives to a flagged drug.

    Returns candidates that PASSED graph screening -- not a recommendation to
    substitute. See screen_alternative_candidates() for the boundary.
    """
    graph = get_client()
    try:
        result = screen_alternative_candidates(
            body.patient_id, body.flagged_drug_key, limit=body.limit, client=graph
        )
    except GraphError as exc:
        logger.error("nscre_alternative_candidates_failed", error=str(exc))
        raise HTTPException(status_code=503, detail="Graph query failed") from exc
    finally:
        graph.close()
    logger.info(
        "nscre_alternative_candidates",
        screened_count=len(result["screened_candidates"]),
        rejected_count=len(result["rejected_candidates"]),
    )
    return result


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5004)
