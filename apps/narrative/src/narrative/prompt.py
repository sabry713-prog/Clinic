"""Narrative prompt template — loaded from docs/prompts/narrative-prompt.md.

Exact text from docs/prompts/narrative-prompt.md.
"""
from __future__ import annotations

from prompt_loader import load_prompt

from .assembly import AssembledPatientData

PROMPT_TEMPLATE_VERSION = "v1.1"

SYSTEM_PROMPT_TEMPLATE = load_prompt("narrative-prompt.md", "System prompt")

USER_PROMPT_TEMPLATE = load_prompt("narrative-prompt.md", "User prompt template")


def fill_prompt(
    data: AssembledPatientData,
    language: str,
    scope: str,
) -> tuple[str, str]:
    """Return (system_prompt, user_prompt) with all placeholders filled.

    Any placeholder that maps to an empty JSON value will show the raw empty
    JSON (``"[]"`` or ``"{}"``) — the system prompt already instructs the model
    to produce "Not documented" sections for empty data.
    """
    system = SYSTEM_PROMPT_TEMPLATE.format(language=language)
    user = USER_PROMPT_TEMPLATE.format(
        language=language,
        scope=scope,
        patient_demographics_json=data.patient_demographics_json or "{}",
        current_encounter_json=data.current_encounter_json or "{}",
        conditions_json=data.conditions_json or "[]",
        allergies_json=data.allergies_json or "[]",
        active_medications_json=data.active_medications_json or "[]",
        recent_observations_json=data.recent_observations_json or "[]",
        recent_documents_json=data.recent_documents_json or "[]",
        prior_admissions_json=data.prior_admissions_json or "[]",
    )
    return system, user
