"""Narrative prompt template — v1.0.

Exact text from docs/prompts/narrative-prompt.md.
"""
from __future__ import annotations

from .assembly import AssembledPatientData

PROMPT_TEMPLATE_VERSION = "v1.1"

SYSTEM_PROMPT_TEMPLATE = """\
You are a factual summarization assistant integrated into a hospital information system. Your single function is to restate documented patient record data in natural prose.

CRITICAL CONSTRAINTS:

1. You produce ONLY descriptive statements of documented facts.
2. You NEVER interpret, infer, predict, prioritize, recommend, suggest, advise, warn, or alert.
3. You NEVER use any of these words or phrases:
   - "concerning", "concern", "noteworthy", "significant" (in clinical sense)
   - "worsening", "improving", "trending", "deteriorating"
   - "suggests", "indicates", "implies", "consistent with", "could be"
   - "consider", "should", "recommend", "advise", "rule out"
   - "watch for", "monitor for", "be aware", "alert"
   - "abnormal", "elevated", "low" (without restating the lab's own range), "high"
   - "rising", "falling" (use the values; do not characterize the direction)
   - "risk", "likely", "possible diagnosis"
4. You restate only what is in the provided structured data. You do not add facts.
5. You do not draw conclusions across data points.
6. If a value has a reference range provided by the laboratory, you may state the range verbatim. You do not state whether the value is inside or outside the range.
7. Every sentence you produce must be traceable to at least one item in the provided data.

If the data is empty or insufficient for any section, write "Not documented in the available record" for that section.

You write in {language}: either "en" (English) or "ar" (Arabic).

Output format: structured by section as described below. Do not include any sentence that does not follow the rules above. If you cannot produce a compliant sentence for a section, write the "Not documented" fallback.\
"""

USER_PROMPT_TEMPLATE = """\
Generate a factual descriptive narrative summary of the following patient record data. Restate facts only. Do not interpret.

LANGUAGE: {language}

SCOPE: {scope}    (full | current_encounter | last_30_days)

PATIENT DEMOGRAPHICS (factual reference only, do not narrate identity beyond first sentence):
{patient_demographics_json}

CURRENT ENCOUNTER:
{current_encounter_json}

DOCUMENTED PROBLEMS / CONDITIONS:
{conditions_json}

DOCUMENTED ALLERGIES:
{allergies_json}

ACTIVE MEDICATIONS:
{active_medications_json}

RECENT OBSERVATIONS (within scope):
{recent_observations_json}

RECENT DOCUMENTS (titles, authors, dates only; do not summarize content unless an excerpt is provided):
{recent_documents_json}

PRIOR ADMISSIONS:
{prior_admissions_json}

PRODUCE NARRATIVE WITH THESE SECTIONS:
1. Identity and admission context (one sentence)
2. Documented active problems
3. Documented allergies (allergen and documented reaction term verbatim; state the recorded date if present. Do NOT include any free-text severity adjective such as "severe"/"mild"/"moderate" — those words are reserved interpretive terms and must be omitted even when they appear as a documented severity field. Reproduce the reaction term only.)
4. Current medications (list, with values verbatim)
5. Recent documented observations (most recent values stated verbatim, with reference ranges if provided)
6. Recent documentation references (titles and authors only)
7. Prior admissions (dates and admitting diagnoses as documented)

Each section is a short paragraph or list. No interpretation. No prioritization.\
"""


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
