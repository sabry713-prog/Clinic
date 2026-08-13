"""Scripted model responder -- the ORCHESTRATOR_MODEL_PROVIDER=stub fallback.

Selected via model_router.py, never called directly by agent_handlers.py /
agent_bus.py / receptionist_agent.py (they import from model_router, which
picks this module or the real deepseek_client based on the env switch).

Same scope contract as the real path it stands in for (CLAUDE.md Core
Principles 1 & 2, mirrored in deepseek_client.py's own docstring): this
module ONLY rephrases facts/transcript text it was already handed. It never
invents a clinical fact, drug, dose, or code that was not already present in
its input. The "canned" part is the phrasing template and the per-patient
colour (name, ward context) used to make that phrasing read naturally --
never the clinical content itself, which always comes from the caller's
`facts` dict or `transcript` string, exactly as it would for the real
DeepSeek path.

Never-empty guarantee: `format_agent_prose` returns "" only when `facts` is
itself empty (matching deepseek_client's own contract -- nothing to
say, if there is nothing to say, is not a failure). Any NON-empty `facts`
input always produces non-empty text. `generate_soap_note` matches
deepseek_client's own empty-transcript contract (empty in, empty out) and
is otherwise guaranteed non-empty on real content.
"""
from __future__ import annotations

from typing import Any

SOAP_FIELDS = ("subjective", "objective", "assessment", "plan")

# Per-patient colour, keyed by MRN -- the one identifier that stays stable
# across a fresh `just seed` run. `hospital.patient.id` is a DB-generated
# UUID (gen_random_uuid() in apps/core/src/seed/dev.ts) and differs on every
# reseed, so a lookup keyed by it would silently stop matching the moment
# someone re-ran the seed. MRN is assigned once in dev.ts and never changes.
# `patient_id` is still accepted by every function below (for a uniform
# call signature with deepseek_client / model_router) but is used only as a
# best-effort key: callers that already resolved an MRN can pass it in
# `patient_id` directly and get a match; anything else (a real UUID, an
# unknown value, None) falls through to _DEFAULT_COLOR below, which is
# still specific enough to read as real prose rather than a placeholder.
_PATIENT_COLOR: dict[str, dict[str, str]] = {
    "MRN-006": {"name": "the patient (Omar, MRN-006)", "ward": "Ward-4A", "context": "a hypertension follow-up"},
    "MRN-007": {"name": "the patient (Hana, MRN-007)", "ward": "Ward-4A", "context": "an asthma review"},
    "MRN-008": {"name": "the patient (Yousef, MRN-008)", "ward": "Ward-4A", "context": "a chronic kidney disease and diabetes review"},
    "MRN-009": {"name": "the patient (Sara, MRN-009)", "ward": "Ward-4A", "context": "a migraine and hypothyroidism review"},
    "MRN-010": {"name": "the patient (Ahmad, MRN-010)", "ward": "Ward-4A", "context": "an atrial fibrillation follow-up"},
}
_DEFAULT_COLOR = {"name": "the patient", "ward": "the ward", "context": "this encounter"}


def _resolve_color(patient_id: str | None) -> dict[str, str]:
    if patient_id and patient_id in _PATIENT_COLOR:
        return _PATIENT_COLOR[patient_id]
    return _DEFAULT_COLOR


def _render_value(value: Any) -> str:
    """Render one fact value as plain text, never fabricating structure the
    value doesn't have. Lists render as a comma-joined list; dicts as
    key=value pairs; scalars via str()."""
    if isinstance(value, list):
        if not value:
            return "none recorded"
        rendered = [_render_value(v) for v in value]
        return "; ".join(rendered)
    if isinstance(value, dict):
        pairs = [f"{k}={_render_value(v)}" for k, v in value.items()]
        return ", ".join(pairs) if pairs else "none recorded"
    return str(value)


# Human-readable labels for the fact keys this codebase's agents actually
# send (services/orchestrator/agent_handlers.py, agent_bus.py,
# receptionist_agent.py). An unrecognised key still renders -- via the
# fallback title-casing below -- so a new fact key never breaks this path,
# it just reads slightly less polished until a label is added here.
_KEY_LABELS = {
    "drug_interactions": "Drug interactions",
    "dose_safety": "Dose-safety findings",
    "necessity": "NPHIES necessity findings",
    "finding_kind": "Finding type",
    "finding_rationale": "Rationale",
    "flagged_medication": "Flagged medication",
    "screened_candidates": "Candidates that passed screening",
    "coverage": "Coverage verdicts",
    "diagnosis": "Diagnosis",
    "medications": "Medications",
    "labs": "Labs",
    "follow_up_interval_days": "Follow-up interval (days)",
    "activity_restrictions": "Activity restrictions",
}


def _label(key: str) -> str:
    return _KEY_LABELS.get(key, key.replace("_", " ").capitalize())


async def format_agent_prose(
    facts: dict[str, Any],
    agent_role: str,
    *,
    patient_id: str | None = None,
) -> str:
    """Deterministic, template-based restatement of `facts` for one agent.

    Same contract as deepseek_client.format_agent_prose: empty `facts` ->
    "". Non-empty `facts` -> non-empty text that states only what `facts`
    already contains -- every line below is `_label(key): _render_value(value)`
    for a key `facts` actually has, nothing added.
    """
    if not facts:
        return ""

    color = _resolve_color(patient_id)
    lines = [f"[Scripted {agent_role} summary -- {color['context']} for {color['name']}]"]
    said_something = False
    for key, value in facts.items():
        if value in (None, "", [], {}):
            continue
        lines.append(f"- {_label(key)}: {_render_value(value)}")
        said_something = True

    if not said_something:
        # `facts` was non-empty but every value was falsy -- still must not
        # return "" per the never-empty guarantee on non-empty input.
        lines.append("- No findings to report for this encounter.")

    lines.append("[end scripted summary -- ORCHESTRATOR_MODEL_PROVIDER=stub, no model call made]")
    return "\n".join(lines)


def _split_transcript_lines(transcript: str) -> list[str]:
    return [line.strip() for line in transcript.splitlines() if line.strip()]


# Heuristic keyword cues for coarse SOAP bucketing -- deliberately simple and
# over-inclusive (a line can and often will show up nowhere or in more than
# one bucket) rather than clever, because a wrong guess here must never
# fabricate content: worst case a real line lands under Subjective instead
# of Objective, never that a line becomes something that was never said.
_OBJECTIVE_CUES = ("bp ", "blood pressure", "heart rate", "hr ", "spo2", "saturation", "temperature", "exam", "sounds", "auscult")
_PLAN_CUES = ("let's get", "we'll", "follow up", "follow-up", "order", "prescri", "refer", "schedule", "plan:")
_ASSESSMENT_CUES = ("known ", "history of", "diagnosed", "assessment:")


async def generate_soap_note(
    transcript: str,
    *,
    patient_id: str | None = None,
) -> dict[str, str]:
    """Coarse, keyword-cued transcript -> SOAP bucketing.

    Same empty-input contract as deepseek_client.generate_soap_note: blank
    transcript -> all four fields empty. Non-blank transcript -> every line
    is preserved VERBATIM under exactly one bucket (chosen by simple keyword
    cues, defaulting to Subjective) -- this is coarser than the real
    DeepSeek-structured note, but it never invents a measurement, medication,
    or finding the transcript didn't contain, which is the one property that
    actually matters for a fallback path.
    """
    if not transcript or not transcript.strip():
        return {field: "" for field in SOAP_FIELDS}

    buckets: dict[str, list[str]] = {field: [] for field in SOAP_FIELDS}
    for line in _split_transcript_lines(transcript):
        lowered = line.lower()
        if any(cue in lowered for cue in _OBJECTIVE_CUES):
            buckets["objective"].append(line)
        elif any(cue in lowered for cue in _PLAN_CUES):
            buckets["plan"].append(line)
        elif any(cue in lowered for cue in _ASSESSMENT_CUES):
            buckets["assessment"].append(line)
        else:
            buckets["subjective"].append(line)

    return {field: " ".join(buckets[field]) for field in SOAP_FIELDS}
