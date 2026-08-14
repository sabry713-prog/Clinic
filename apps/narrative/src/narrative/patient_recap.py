"""Patient-facing plain-language recap.

Takes an ALREADY-GENERATED, already-blocklist-passed clinician narrative
and restates it in friendlier prose for the patient to read -- shorter
sentences, second-person address, spelled-out abbreviations. It does
NOT translate clinical terminology into lay synonyms: per CLAUDE.md §8,
"clinical terminology (drug names, lab codes, diagnoses) [is] preserved
in source form; do not translate" -- diagnosis names, drug names, and
lab names are reproduced verbatim, only sentence structure and framing
change. Same blocklist gate, same retry/fallback pattern as the main
narrative pipeline: this is restyling of already-approved facts, not a
second content-generation pass.
"""
from __future__ import annotations

import structlog

from blocklist import scan

from .model_client import ModelParams, ModelProvider

logger = structlog.get_logger()

MAX_RETRIES = 2
FALLBACK_MESSAGE = "Plain-language recap unavailable. Showing the clinical summary instead."

PATIENT_RECAP_TEMPLATE_VERSION = "v1.0"

from prompt_loader import load_prompt

_SYSTEM = load_prompt("patient-recap-prompt.md")


async def generate_patient_recap(
    narrative_text: str,
    language: str,
    model: ModelProvider,
) -> tuple[str | None, bool, int]:
    """Return (recap_text_or_none, blocklist_triggered, retries).

    recap_text is None only if all retries were exhausted and the caller
    should fall back to showing the original clinician narrative.
    """
    if not narrative_text.strip():
        return None, False, 0

    user_prompt = (
        f"LANGUAGE: {language}\n\n"
        f"SOURCE CLINICAL SUMMARY (restyle this faithfully -- do not add or change facts):\n{narrative_text}"
    )
    blocklist_triggered = False

    for attempt in range(MAX_RETRIES + 1):
        prompt = user_prompt
        if attempt > 0:
            prompt += (
                "\n\nYour previous attempt used interpretive language. Restate using ONLY "
                "the facts and terms already in the source, with no characterization of any value."
            )

        params = ModelParams(temperature=0.0, max_tokens=1024)
        raw = await model.complete(_SYSTEM, prompt, params)
        if not raw.strip():
            continue

        result = scan(raw, language=language)
        if result.passed:
            return raw.strip(), blocklist_triggered, attempt
        blocklist_triggered = True
        logger.warning(
            "patient_recap_blocklist_triggered",
            attempt=attempt,
            num_matches=len(result.matches),
        )

    return None, blocklist_triggered, MAX_RETRIES
