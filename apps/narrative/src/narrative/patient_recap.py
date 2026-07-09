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

_SYSTEM = """\
You restyle an already-approved factual clinical summary into a version a patient can read comfortably. You do NOT generate new clinical content.

ABSOLUTE RULES:
1. Reproduce ONLY the facts already present in the source summary. Do not add, infer, expand, or supply any clinical content, finding, diagnosis, recommendation, or value not already stated.
2. Do NOT omit any documented fact from the source. Every condition, medication, lab value, and date in the source must still appear.
3. Preserve VERBATIM: diagnosis/condition names, drug names, lab test names, numeric values, units, reference ranges, and dates. Do not substitute a lay synonym for any clinical term (e.g. do not change "hypertension" to "high blood pressure") -- reproduce the term exactly as documented.
4. You MAY: shorten and simplify sentence structure, write in second person ("Your record shows..."), spell out abbreviations, and use a warmer tone.
5. You may NOT: interpret, infer, predict, prioritize, recommend, advise, warn, or characterize any value as high/low/normal/abnormal/concerning/improving/worsening beyond what the source text itself already states.
6. Write in the SAME language as the source summary.
7. If the source is empty or says "Not documented", say so plainly -- do not invent content.

Output ONLY the restyled recap text -- no preamble, no commentary.\
"""


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
