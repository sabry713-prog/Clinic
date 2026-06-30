"""Narrative generation orchestration pipeline.

Pipeline: assemble → prompt → model → blocklist → provenance → output.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

import structlog

from blocklist import BLOCKLIST_VERSION, scan

from .assembly import assemble_patient_data
from .model_client import ModelParams, ModelProvider
from .prompt import PROMPT_TEMPLATE_VERSION, fill_prompt
from .provenance import verify_provenance
from .types import NarrativeOutput

if TYPE_CHECKING:
    import asyncpg
    from retrieval.embedder import EmbeddingProvider

logger = structlog.get_logger()

MAX_RETRIES = 2
FALLBACK_MESSAGE = "Narrative summary unavailable. Please review the record directly."
DISCLAIMER = (
    "Auto-generated descriptive summary. Not a clinical interpretation. "
    "For clinician review only."
)


async def generate_narrative(
    patient_id: str,
    language: str,
    scope: str,
    pool: "asyncpg.Pool[asyncpg.Record] | None",
    model: ModelProvider,
    embedder: "EmbeddingProvider | None" = None,
) -> NarrativeOutput:
    """Run the full narrative generation pipeline.

    Retries up to MAX_RETRIES times if the blocklist rejects the output.
    Returns a fallback NarrativeOutput if all retries are exhausted.

    Parameters
    ----------
    patient_id:
        UUID of the patient.
    language:
        ``"en"`` or ``"ar"``.
    scope:
        ``"full"`` | ``"current_encounter"`` | ``"last_30_days"``.
    pool:
        asyncpg connection pool.
    model:
        ModelProvider implementation (real or stub).
    embedder:
        Optional EmbeddingProvider; reserved for future retrieval-augmented pipeline.
    """
    narrative_id = str(uuid.uuid4())
    generated_at = datetime.now(tz=timezone.utc).isoformat()

    blocklist_triggered = False
    retries = 0

    for attempt in range(MAX_RETRIES + 1):
        data = await assemble_patient_data(patient_id, scope, pool)
        system_prompt, user_prompt = fill_prompt(data, language, scope)

        if attempt > 0:
            user_prompt += (
                "\n\nSTRICTER: A previous attempt violated the constraints. "
                "Be more conservative. Restate only the literal field values."
            )

        raw = await model.complete(system_prompt, user_prompt, ModelParams())

        # Empty-output guard: a reasoning model can spend the whole token budget
        # on its hidden reasoning trace and return empty text. An empty string
        # trivially "passes" the blocklist, so without this it would surface a
        # blank narrative. Treat empty as a failed attempt and retry.
        if not raw.strip():
            logger.warning("narrative_empty_output", narrative_id=narrative_id, attempt=attempt)
            continue

        scan_result = scan(raw, language=language)

        if scan_result.passed:
            provenance = verify_provenance(raw, data)
            logger.info(
                "narrative_generated",
                narrative_id=narrative_id,
                patient_id=patient_id,
                # PHI: do NOT log the narrative text
                language=language,
                scope=scope,
                attempt=attempt,
                blocklist_version=BLOCKLIST_VERSION,
            )
            return NarrativeOutput(
                narrative_id=narrative_id,
                patient_id=patient_id,
                text=raw,
                fallback_message=None,
                provenance=provenance,
                model_version=model.version(),
                prompt_template_version=PROMPT_TEMPLATE_VERSION,
                generated_at=generated_at,
                language=language,
                scope=scope,
                blocklist_triggered=blocklist_triggered,
                blocklist_retries=retries,
            )
        else:
            blocklist_triggered = True
            retries = attempt + 1
            logger.warning(
                "blocklist_triggered",
                narrative_id=narrative_id,
                patient_id=patient_id,
                attempt=attempt,
                num_matches=len(scan_result.matches),
                categories=[m.category for m in scan_result.matches],
                # Do NOT log narrative text or matched_text — PHI-adjacent
            )

    # All retries exhausted
    logger.error(
        "narrative_fallback",
        narrative_id=narrative_id,
        patient_id=patient_id,
        blocklist_retries=retries,
    )
    return NarrativeOutput(
        narrative_id=narrative_id,
        patient_id=patient_id,
        text=None,
        fallback_message=FALLBACK_MESSAGE,
        provenance=[],
        model_version=model.version(),
        prompt_template_version=PROMPT_TEMPLATE_VERSION,
        generated_at=generated_at,
        language=language,
        scope=scope,
        blocklist_triggered=True,
        blocklist_retries=retries,
    )
