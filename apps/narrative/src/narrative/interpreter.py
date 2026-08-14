"""Medical Interpreter — ad-hoc clinician <-> patient communication translation.

Translates a clinician-authored message (an explanation, instruction, or
answer to a patient question) into another language for bedside
communication. This is a COMMUNICATION aid, not a clinical-content
generator: it does not read or summarize the patient record, and it must
not introduce, infer, or characterize any clinical content that was not
already in the source text.

Per CLAUDE.md §8, clinical terminology is preserved in source form and
never translated: drug names, lab test names, diagnosis/condition names,
and numeric values with their units stay exactly as written, even when
the surrounding sentence is translated into the target language. Same
blocklist gate and retry/fallback pattern as the rest of the narrative
pipeline.
"""
from __future__ import annotations

import structlog

from blocklist import scan

from .model_client import ModelParams, ModelProvider

logger = structlog.get_logger()

MAX_RETRIES = 2
FALLBACK_MESSAGE = "Translation unavailable. Please rephrase or use an in-person interpreter."

INTERPRETER_TEMPLATE_VERSION = "v1.0"

from prompt_loader import load_prompt

_SYSTEM = load_prompt("interpreter-prompt.md")


async def translate_message(
    text: str,
    source_language: str,
    target_language: str,
    model: ModelProvider,
) -> tuple[str | None, bool, int]:
    """Return (translated_text_or_none, blocklist_triggered, retries).

    translated_text is None only if all retries were exhausted; the caller
    should show the fallback message and suggest an in-person interpreter.
    """
    if not text.strip():
        return None, False, 0

    user_prompt = (
        f"SOURCE LANGUAGE: {source_language}\n"
        f"TARGET LANGUAGE: {target_language}\n\n"
        f"MESSAGE TO TRANSLATE (translate faithfully -- do not add or change meaning; "
        f"keep drug names, lab names, diagnosis names, and numeric values verbatim):\n{text}"
    )
    blocklist_triggered = False

    for attempt in range(MAX_RETRIES + 1):
        prompt = user_prompt
        if attempt > 0:
            prompt += (
                "\n\nYour previous attempt used interpretive language. Retranslate using ONLY "
                "the meaning already in the source, with no characterization of any value."
            )

        params = ModelParams(temperature=0.0, max_tokens=512)
        raw = await model.complete(_SYSTEM, prompt, params)
        if not raw.strip():
            continue

        result = scan(raw, language=target_language)
        if result.passed:
            return raw.strip(), blocklist_triggered, attempt
        blocklist_triggered = True
        logger.warning(
            "interpreter_blocklist_triggered",
            attempt=attempt,
            num_matches=len(result.matches),
        )

    return None, blocklist_triggered, MAX_RETRIES
