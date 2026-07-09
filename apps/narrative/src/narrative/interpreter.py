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

_SYSTEM = """\
You translate a short message from a clinician to a patient (or a patient's words back to a clinician) between two languages. You do NOT generate new clinical content, and you do NOT interpret, summarize, or comment on anything.

ABSOLUTE RULES:
1. Translate ONLY what is in the source text. Do not add, infer, expand, explain, or supply any clinical content, finding, diagnosis, recommendation, or value not already stated.
2. Do NOT omit any part of the source message.
3. Preserve VERBATIM, untranslated: drug/medication names, lab test names, diagnosis/condition names, numeric values, units, and reference ranges. Reproduce these exactly as written in the source, even mid-sentence in the translated output.
4. You may NOT interpret, infer, predict, prioritize, recommend, advise, warn, or characterize any value as high/low/normal/abnormal/concerning/improving/worsening beyond what the source text itself already states.
5. Translate general communication language naturally and warmly -- greetings, instructions, questions, reassurance -- into the target language.
6. If the source text is empty or nonsensical, output nothing.

Output ONLY the translated text -- no preamble, no commentary, no notes about the translation.\
"""


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
