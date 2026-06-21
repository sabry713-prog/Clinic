"""Dictation transcription service.

POST /transcribe { audio_base64, language } -> { text, engine }

Scope: transcribe + light reformat ONLY. The clinician is the author; this
service introduces no clinical content (CLAUDE.md §2). Dictated audio is PHI:
it is never logged or persisted (CLAUDE.md §7), and the engine runs on-prem.
"""
from __future__ import annotations

import base64

import structlog
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.transcription.config import settings
from src.transcription.engine import get_engine
from src.transcription.reformat import light_reformat

logger = structlog.get_logger()
app = FastAPI(title="Clinical Copilot Transcription Service", version="0.1.0")

_engine = get_engine()


class TranscribeRequest(BaseModel):
    audio_base64: str
    language: str = "en"


@app.get("/health", response_class=JSONResponse)
async def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.otel_service_name, "engine": _engine.name()}


@app.post("/transcribe", response_class=JSONResponse)
async def transcribe(body: TranscribeRequest) -> dict[str, str]:
    try:
        audio = base64.b64decode(body.audio_base64)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid audio_base64") from exc

    lang = body.language if body.language in ("en", "ar") else "en"
    try:
        raw = _engine.transcribe(audio, lang)          # PHI — never logged
        text = light_reformat(raw)                     # deterministic cleanup only
    except Exception as exc:  # noqa: BLE001
        logger.error("transcription_failed", error=str(exc), engine=_engine.name())
        raise HTTPException(status_code=500, detail="Transcription failed") from exc

    # Log metadata only — never audio or transcript content (PHI).
    logger.info("transcribed", engine=_engine.name(), language=lang, chars=len(text))
    return {"text": text, "engine": _engine.name()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5003, reload=False, log_config=None)
