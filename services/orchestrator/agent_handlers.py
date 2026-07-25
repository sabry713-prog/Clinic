"""Tethered AI Team agent handlers -- the orchestration layer connecting the
front-end AI Team drawer (apps/web, `AiTeamDrawer.tsx` / `SullyContext.tsx`)
to the NSCRE graph engine (services/veritas-graph, Sprint 7) and DeepSeek's
formatting-only prose generator (`deepseek_client.py`, already built in the
2026-07-22 merge).

*** SCOPE FLAG -- read before relying on this module ***
The Consultant agent generates differential diagnostic considerations --
verbatim the first item on this project's original CLAUDE.md's forbidden
list. The Pharmacist agent's DeepSeek prompt is free to phrase a specific
dose recommendation, not just restate the NSCRE threshold fact. Both were
flagged explicitly and confirmed by the requester before this module was
written (see the Sprint 8 plan) -- same "your call, made knowingly" posture
as Sprint 7's Modules A/B. This module also ships with NO additional
blocklist/verification gate on the DeepSeek output, unlike every other
LLM-touching feature in this codebase (narrative, QA, condensation,
translation, term extraction) -- also explicitly confirmed, not a default.

Hard invariant this module DOES enforce regardless of the above: DeepSeek
only ever touches the PROSE. Every `evidence_chain` returned to the caller
is copied verbatim from NSCRE's own response -- never regenerated, reworded,
or touched by the LLM. This is what makes "agent outputs match the raw
NSCRE graph payload without hallucinated additions" (the task's own test
requirement) checkable as a deterministic object-equality assertion rather
than a judgment call -- see tests/test_agent_handlers.py.

All medical/dosage/NPHIES facts come from exactly one source, per the task's
own instruction: NSCRE's POST /api/v1/nscre/evaluate-encounter
(services/veritas-graph/api_router.py, Sprint 7, port 5004 by default) --
called over HTTP, since this service and veritas-graph are separate Python
services/venvs (the same reason deepseek_client.py already calls DeepSeek
over HTTP rather than importing it).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import httpx
import structlog
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepseek_client import format_agent_prose  # noqa: E402

structlog.configure(processors=[structlog.processors.JSONRenderer()])
logger = structlog.get_logger()

NSCRE_API_URL = os.environ.get("NSCRE_API_URL", "http://localhost:5004")

# Matches NphiesBadge.tsx's existing color convention (billing/claim-
# paperwork state only, never a clinical severity indicator).
STATUS_BADGES = {"GREEN": "\U0001f7e2", "YELLOW": "\U0001f7e1", "RED": "\U0001f534"}


async def fetch_nscre_evaluation(
    patient_id: str, *, client: Optional[httpx.AsyncClient] = None
) -> dict[str, Any]:
    """The ONE and only source of medical/dosage/NPHIES facts for every
    agent below -- POST /api/v1/nscre/evaluate-encounter, unmodified."""
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=30.0)
    try:
        resp = await client.post(
            f"{NSCRE_API_URL.rstrip('/')}/api/v1/nscre/evaluate-encounter",
            json={"patient_id": patient_id},
        )
        resp.raise_for_status()
        return resp.json()
    finally:
        if owns_client:
            await client.aclose()


def _collect_evidence_chains(*finding_lists: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Copies evidence_chain objects verbatim from NSCRE findings -- never
    regenerated, never touched by DeepSeek."""
    chains = []
    for findings in finding_lists:
        for f in findings:
            chain = f.get("evidence_chain")
            if chain:
                chains.append(chain)
    return chains


async def pharmacist_agent(
    patient_id: str, *, nscre_client: Optional[httpx.AsyncClient] = None
) -> dict[str, Any]:
    """Calls NSCRE's DDI and renal dose modules, formats a recommendation
    card. See the module docstring's scope flag re: dose-recommendation
    phrasing -- that phrasing lives entirely in DeepSeek's prose; the
    underlying facts and evidence chains are NSCRE's own, unmodified."""
    evaluation = await fetch_nscre_evaluation(patient_id, client=nscre_client)
    interactions = evaluation.get("drug_interactions", [])
    dose_safety = evaluation.get("dose_safety", [])
    facts = {"drug_interactions": interactions, "dose_safety": dose_safety}

    prose = ""
    if interactions or dose_safety:
        prose = await format_agent_prose(facts, agent_role="Pharmacist")

    return {
        "agent": "pharmacist",
        "patient_id": patient_id,
        "prose": prose,
        "findings": facts,
        "evidence_chains": _collect_evidence_chains(interactions, dose_safety),
    }


async def consultant_agent(
    patient_id: str, *, nscre_client: Optional[httpx.AsyncClient] = None
) -> dict[str, Any]:
    """Calls NSCRE's clinical evaluation, returns differential diagnostic
    considerations backed by whatever evaluate-encounter returns -- the
    ONLY NSCRE-sanctioned data source for this agent per the task's own
    "MUST come directly from the NSCRE API" instruction, not a separate
    new timeline query invented for this sprint. NSCRE itself never
    generates a diagnosis; only DeepSeek's prose does, per the explicitly
    confirmed scope decision (see module docstring)."""
    evaluation = await fetch_nscre_evaluation(patient_id, client=nscre_client)
    interactions = evaluation.get("drug_interactions", [])
    dose_safety = evaluation.get("dose_safety", [])
    necessity = evaluation.get("necessity", [])
    facts = {"drug_interactions": interactions, "dose_safety": dose_safety, "necessity": necessity}

    prose = ""
    if interactions or dose_safety or necessity:
        prose = await format_agent_prose(facts, agent_role="Consultant")

    return {
        "agent": "consultant",
        "patient_id": patient_id,
        "prose": prose,
        "findings": facts,
        "evidence_chains": _collect_evidence_chains(interactions, dose_safety, necessity),
    }


async def nphies_agent(
    patient_id: str, *, nscre_client: Optional[httpx.AsyncClient] = None
) -> dict[str, Any]:
    """Calls NSCRE's NPHIES evaluator, constructs an order-approval card per
    active medication with a GREEN/YELLOW/RED badge."""
    evaluation = await fetch_nscre_evaluation(patient_id, client=nscre_client)
    necessity = evaluation.get("necessity", [])

    cards = [
        {
            "medication": item.get("medication"),
            "status": item.get("status"),
            "badge": STATUS_BADGES.get(item.get("status", ""), "⚪"),
            "pre_auth_required": item.get("pre_auth_required"),
            "suggested_codes": item.get("suggested_codes", []),
            "evidence_chain": item.get("evidence_chain"),
        }
        for item in necessity
    ]

    prose = ""
    if necessity:
        prose = await format_agent_prose({"necessity": necessity}, agent_role="NPHIES")

    return {
        "agent": "nphies",
        "patient_id": patient_id,
        "prose": prose,
        "cards": cards,
        "evidence_chains": _collect_evidence_chains(necessity),
    }


AGENTS: dict[str, Any] = {
    "pharmacist": pharmacist_agent,
    "consultant": consultant_agent,
    "nphies": nphies_agent,
}


# -- HTTP / SSE surface (this service's first) --------------------------------

app = FastAPI(title="Veritas-Medica Agent Orchestrator", version="0.1.0")


@app.get("/health", response_class=JSONResponse)
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "orchestrator-agents"}


async def _run_named_agent(name: str, patient_id: str, client: httpx.AsyncClient) -> dict[str, Any]:
    try:
        return await AGENTS[name](patient_id, nscre_client=client)
    except Exception as exc:  # noqa: BLE001
        # Metadata only in logs -- never clinical content (CLAUDE.md sec 7).
        logger.error("agent_failed", agent=name, patient_id=patient_id, error=str(exc))
        return {"agent": name, "patient_id": patient_id, "error": "agent_failed"}


async def _agent_stream(patient_id: str) -> AsyncGenerator[str, None]:
    """Runs all three agents concurrently, emitting one `agent_update` SSE
    event as each completes (in completion order, not declaration order),
    then a final `done` event."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = [
            asyncio.ensure_future(_run_named_agent(name, patient_id, client)) for name in AGENTS
        ]
        for coro in asyncio.as_completed(tasks):
            result = await coro
            yield f"event: agent_update\ndata: {json.dumps(result)}\n\n"
    yield "event: done\ndata: {}\n\n"


@app.get("/api/v1/agents/stream")
async def agents_stream(patient_id: str) -> StreamingResponse:
    return StreamingResponse(_agent_stream(patient_id), media_type="text/event-stream")


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=5005)


if __name__ == "__main__":
    main()
