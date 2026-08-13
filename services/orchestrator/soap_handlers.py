"""SOAP note generation handler -- exposes model_router.generate_soap_note
as a POST endpoint for the core proxy layer.

This is formatting-only: DeepSeek structures the raw transcript into the four
SOAP sections (Subjective, Objective, Assessment, Plan) without interpreting
clinical data -- matching the Non-SaMD Health IT classification under SFDA
MDS-G027.
"""
from __future__ import annotations

from typing import Any

from fastapi.responses import JSONResponse


async def generate_soap(body: dict[str, Any]) -> dict[str, str]:
    """Generate a SOAP note from the encounter transcript.

    Routes to DeepSeek or the scripted stub depending on
    ORCHESTRATOR_MODEL_PROVIDER (same as every other LLM endpoint).
    """
    from model_router import generate_soap_note  # noqa: WPS433

    transcript = str(body.get("transcript", ""))
    patient_id = body.get("patient_id")
    return await generate_soap_note(transcript, patient_id=patient_id)
