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
from src.transcription.reformat_llm import faithful_reformat
from src.transcription.segment import SectionSpec, get_segmentation_model, segment_transcript
from src.transcription.condense import condense_section, get_condense_model, validate_condensation
from src.transcription.extract_terms import extract_terms, get_term_extraction_model

logger = structlog.get_logger()
app = FastAPI(title="Clinical Copilot Transcription Service", version="0.1.0")

_engine = get_engine()
_segment_model = get_segmentation_model()
_condense_model = get_condense_model()
_term_extraction_model = get_term_extraction_model()


class TranscribeRequest(BaseModel):
    audio_base64: str
    language: str = "en"


class ReformatRequest(BaseModel):
    text: str
    language: str = "en"


class SectionSpecRequest(BaseModel):
    key: str
    title: str


class SegmentRequest(BaseModel):
    text: str
    sections: list[SectionSpecRequest]
    language: str = "en"


class CondenseRequest(BaseModel):
    section_key: str
    text: str
    language: str = "en"


class ValidateCondensationRequest(BaseModel):
    condensed_text: str
    source_text: str
    language: str = "en"


class ExtractTermsRequest(BaseModel):
    text: str
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
        # Faithful on-prem LLM reformat if enabled+available; else deterministic.
        # A blank/whitespace-only LLM response is treated the same as a failed
        # call (falls back to light_reformat) -- otherwise a real, successfully
        # transcribed dictation (non-empty `raw`) could be silently wiped to
        # nothing by an empty LLM completion.
        polished = await faithful_reformat(raw, lang)
        text = polished if polished else light_reformat(raw)
        reformat = "llm" if polished else "light"
    except Exception as exc:  # noqa: BLE001
        logger.error("transcription_failed", error=str(exc), engine=_engine.name())
        raise HTTPException(status_code=500, detail="Transcription failed") from exc

    # Log metadata only — never audio or transcript content (PHI).
    logger.info("transcribed", engine=_engine.name(), language=lang, chars=len(text), reformat=reformat)
    # raw_text is returned so the clinician can confirm fidelity before accepting.
    return {"text": text, "raw_text": light_reformat(raw), "engine": _engine.name(), "reformat": reformat}


@app.post("/reformat", response_class=JSONResponse)
async def reformat(body: ReformatRequest) -> dict[str, str]:
    """Faithfully polish text the clinician TYPED (no audio) — same rules as
    dictation reformat (docs/prompts/reformat-prompt.md). Returns the original
    alongside the polished text so the clinician can confirm fidelity."""
    lang = body.language if body.language in ("en", "ar") else "en"
    polished = await faithful_reformat(body.text, lang)
    mode = "llm" if polished is not None else "light"
    text = polished if polished is not None else light_reformat(body.text)
    logger.info("reformatted", language=lang, chars=len(text), reformat=mode)
    return {"text": text, "raw_text": body.text, "reformat": mode}


@app.post("/segment", response_class=JSONResponse)
async def segment(body: SegmentRequest) -> dict[str, object]:
    """Classify an ambient-capture transcript into note sections. See
    src/transcription/segment.py — every returned section is server-side
    verified to be a verbatim substring of the transcript before being trusted;
    nothing is ever paraphrased, added, or silently dropped (docs/prompts/
    ambient-segmentation-prompt.md)."""
    lang = body.language if body.language in ("en", "ar") else "en"
    specs = [SectionSpec(key=s.key, title=s.title) for s in body.sections]
    result = await segment_transcript(body.text, specs, lang, _segment_model)
    logger.info(
        "segmented",
        language=lang,
        chars=len(body.text),
        sections=list(result.sections.keys()),
        has_unclassified=bool(result.unclassified_text),
        retries=result.retries,
    )
    return {
        "sections": [{"key": k, "text": v} for k, v in result.sections.items()],
        "unclassified_text": result.unclassified_text,
        "retries": result.retries,
    }


@app.post("/condense", response_class=JSONResponse)
async def condense(body: CondenseRequest) -> dict[str, object]:
    """Lightly condense ONE ambient note section into tighter note-style prose.
    See src/transcription/condense.py -- restricted to non-judgment sections
    (CONDENSABLE_SECTIONS), validated against the blocklist AND a content-word
    containment check before being trusted; falls back to the original
    verbatim text on failure (docs/prompts/ambient-condensation-prompt.md,
    pending CTO + Clinical Advisor + Regulatory Consultant sign-off)."""
    lang = body.language if body.language in ("en", "ar") else "en"
    result = await condense_section(body.section_key, body.text, lang, _condense_model)
    logger.info(
        "condensed",
        section_key=body.section_key,
        language=lang,
        condensed=result.condensed,
        retries=result.retries,
    )
    return {"text": result.text, "condensed": result.condensed, "retries": result.retries}


@app.post("/validate-condensation", response_class=JSONResponse)
async def validate_condensation_route(body: ValidateCondensationRequest) -> dict[str, bool]:
    """Validation-only (no generation) -- used by apps/core to re-verify a
    condensed section server-side at draft-creation time, never trusting a
    client-supplied "this passed" claim."""
    lang = body.language if body.language in ("en", "ar") else "en"
    ok = validate_condensation(body.condensed_text, body.source_text, lang)
    return {"valid": ok}


@app.post("/extract-terms", response_class=JSONResponse)
async def extract_terms_route(body: ExtractTermsRequest) -> dict[str, object]:
    """Point out medical terminology already present in a dictation transcript
    -- reference-only output, never submitted into a draft. See
    src/transcription/extract_terms.py -- every returned term is server-side
    verified to be a verbatim substring of the transcript before being
    trusted; a fabricated term is always dropped, never shown (docs/prompts/
    ambient-term-extraction-prompt.md)."""
    lang = body.language if body.language in ("en", "ar") else "en"
    result = await extract_terms(body.text, lang, _term_extraction_model)
    logger.info(
        "terms_extracted",
        language=lang,
        chars=len(body.text),
        term_count=len(result.terms),
        retries=result.retries,
    )
    return {
        "terms": [{"term": t.term, "category": t.category} for t in result.terms],
        "retries": result.retries,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=5003, reload=False, log_config=None)
