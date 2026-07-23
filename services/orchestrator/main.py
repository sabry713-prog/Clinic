"""Orchestrator HTTP service — live ambient scribe endpoints.

Endpoints
    GET  /health
    POST /scribe/sessions                 open a session
    POST /scribe/sessions/{id}/chunks     push transcript text, get SOAP back
    GET  /scribe/sessions/{id}/stream     Server-Sent Events as the note builds
    POST /scribe/structure                one-shot: transcript in, SOAP out
    GET  /scribe/checklist                deterministic symptom -> checks

Transcripts are PHI. Every model call goes through packages/phi-guard, so an
external endpoint is blocked or de-identified per PHI_EGRESS_POLICY.
"""
from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

# Resolve workspace packages without depending on the editable install, which
# has proved unreliable in this environment (see apps/qa/main.py).
_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parents[1]
for _p in (_HERE, *((_d / "src") for _d in (_REPO_ROOT / "packages").iterdir() if (_d / "src").is_dir())):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from deepseek_client import DeepSeekError  # noqa: E402
from live_scribe import (  # noqa: E402
    LiveScribeSession,
    checklist_for_transcript,
    stream_soap_updates,
    structure_transcript,
)
from phi_guard import PhiEgressBlocked  # noqa: E402

app = FastAPI(title="Veritas-Medica orchestrator", version="0.1.0")

# The web app runs on a different port in dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store. Fine for a single-process dev service; a real
# deployment would put this in Redis so any worker can serve the stream.
_SESSIONS: dict[str, LiveScribeSession] = {}
# Chunks pushed while an SSE stream is open, per session.
_QUEUES: dict[str, asyncio.Queue[Optional[str]]] = {}


class OpenSessionRequest(BaseModel):
    patient_names: list[str] = []


class ChunkRequest(BaseModel):
    text: str


class StructureRequest(BaseModel):
    transcript: str
    patient_names: list[str] = []


def _session(session_id: str) -> LiveScribeSession:
    session = _SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Unknown session {session_id}")
    return session


def _model_error(exc: Exception) -> HTTPException:
    """Map model/guard failures onto honest status codes."""
    if isinstance(exc, PhiEgressBlocked):
        # Not a server fault — a policy decision. Say so explicitly.
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=502, detail=str(exc))


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "orchestrator"}


@app.post("/scribe/sessions")
async def open_session(body: OpenSessionRequest) -> dict[str, Any]:
    session_id = str(uuid.uuid4())
    _SESSIONS[session_id] = LiveScribeSession(
        session_id=session_id, patient_names=list(body.patient_names)
    )
    _QUEUES[session_id] = asyncio.Queue()
    return {"session_id": session_id}


@app.post("/scribe/sessions/{session_id}/chunks")
async def push_chunk(session_id: str, body: ChunkRequest) -> dict[str, Any]:
    session = _session(session_id)
    session.add_chunk(body.text)

    # Feed any open SSE stream.
    queue = _QUEUES.get(session_id)
    if queue is not None:
        await queue.put(body.text)

    try:
        result = await structure_transcript(session)
    except (DeepSeekError, PhiEgressBlocked) as exc:
        raise _model_error(exc) from exc
    return result


@app.get("/scribe/sessions/{session_id}/stream")
async def stream(session_id: str) -> StreamingResponse:
    session = _session(session_id)
    queue = _QUEUES.setdefault(session_id, asyncio.Queue())

    async def chunk_source() -> AsyncGenerator[str, None]:
        while True:
            item = await queue.get()
            if item is None:  # sentinel: close the stream
                break
            yield item

    return StreamingResponse(
        stream_soap_updates(session, chunk_source()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/scribe/sessions/{session_id}/close")
async def close_session(session_id: str) -> dict[str, Any]:
    session = _session(session_id)
    queue = _QUEUES.get(session_id)
    if queue is not None:
        await queue.put(None)
    snapshot = session.snapshot()
    return snapshot


@app.post("/scribe/structure")
async def structure(body: StructureRequest) -> dict[str, Any]:
    """One-shot structuring — no session, useful for tests and mock audio."""
    session = LiveScribeSession(session_id="oneshot", patient_names=list(body.patient_names))
    session.add_chunk(body.transcript)
    try:
        return await structure_transcript(session)
    except (DeepSeekError, PhiEgressBlocked) as exc:
        raise _model_error(exc) from exc


@app.get("/scribe/checklist")
async def checklist(transcript: str = "") -> dict[str, Any]:
    """Deterministic symptom -> documentation checks. No model call."""
    return {"items": checklist_for_transcript(transcript)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5010, reload=False)
