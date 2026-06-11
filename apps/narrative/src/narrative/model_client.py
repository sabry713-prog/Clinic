"""Model provider protocol and stub implementation."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass
class ModelParams:
    temperature: float = 0.1
    top_p: float = 0.9
    max_tokens: int = 1200
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0


@runtime_checkable
class ModelProvider(Protocol):
    """Protocol that all LLM backends must satisfy."""

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
        """Return generated text given system + user prompts."""
        ...

    def version(self) -> str:
        """Return a string identifier for the model / configuration."""
        ...


class StubModelProvider:
    """Returns a canned factual narrative for testing.

    The returned text is designed to pass the blocklist 100% of the time:
    - No interpretive verbs
    - No trend language
    - No recommendations
    - No alert language
    - Values always accompanied by reference ranges when present
    """

    def version(self) -> str:  # noqa: D102
        return "stub-v1"

    @staticmethod
    def _extract_json(user_prompt: str, start_marker: str, end_marker: str) -> object:
        """Extract the JSON blob between two section markers in the user prompt."""
        try:
            idx = user_prompt.find(start_marker)
            end_idx = user_prompt.find(end_marker)
            if idx == -1 or end_idx == -1:
                return None
            blob = user_prompt[idx:end_idx]
            # JSON starts after the marker line (which may include a trailing colon/text)
            brace = min(
                (i for i in (blob.find("{"), blob.find("[")) if i != -1),
                default=-1,
            )
            if brace == -1:
                return None
            return json.loads(blob[brace:].strip())
        except (json.JSONDecodeError, ValueError):
            return None

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
        """Extract structured data from user_prompt and build a factual narrative."""
        ex = self._extract_json
        demographics = ex(user_prompt, "PATIENT DEMOGRAPHICS", "CURRENT ENCOUNTER:") or {}
        conditions = ex(user_prompt, "DOCUMENTED PROBLEMS / CONDITIONS:", "DOCUMENTED ALLERGIES:") or []
        allergies = ex(user_prompt, "DOCUMENTED ALLERGIES:", "ACTIVE MEDICATIONS:") or []
        medications = ex(user_prompt, "ACTIVE MEDICATIONS:", "RECENT OBSERVATIONS") or []
        observations = ex(user_prompt, "RECENT OBSERVATIONS", "RECENT DOCUMENTS") or []
        documents = ex(user_prompt, "RECENT DOCUMENTS", "PRIOR ADMISSIONS:") or []
        priors = ex(user_prompt, "PRIOR ADMISSIONS:", "\nOUTPUT") or []
        if not isinstance(demographics, dict):
            demographics = {}

        display_name = str(demographics.get("display_name") or "the patient")
        dob = demographics.get("date_of_birth")
        sex = demographics.get("sex", "")
        ward = demographics.get("ward") or "the documented ward"

        def _fmt_condition(c: dict) -> str:
            parts = [str(c.get("code_display") or c.get("code") or "Unspecified condition")]
            if c.get("clinical_status"):
                parts.append(f"status: {c['clinical_status']}")
            if c.get("onset_date"):
                parts.append(f"onset: {c['onset_date']}")
            return ", ".join(parts) + "."

        def _fmt_allergy(a: dict) -> str:
            parts = [str(a.get("code_display") or "Unspecified allergen")]
            if a.get("reaction"):
                parts.append(f"documented reaction: {a['reaction']}")
            if a.get("recorded_at"):
                parts.append(f"recorded: {a['recorded_at']}")
            return ", ".join(parts) + "."

        def _fmt_medication(m: dict) -> str:
            parts = [str(m.get("medication_display") or m.get("code") or "Unspecified medication")]
            for key in ("dose", "route", "frequency"):
                if m.get(key):
                    parts.append(str(m[key]))
            if m.get("started_at"):
                parts.append(f"started: {m['started_at']}")
            return ", ".join(parts) + "."

        def _fmt_observation(o: dict) -> str:
            label = str(o.get("code_display") or o.get("code") or "Observation")
            if o.get("value_numeric") is not None:
                value = f"{o['value_numeric']} {o.get('unit') or ''}".strip()
            else:
                value = str(o.get("value_text") or "no value documented")
            ref = ""
            if o.get("ref_range_low") is not None and o.get("ref_range_high") is not None:
                unit = f" {o['unit']}" if o.get("unit") else ""
                ref = f" (reference range: {o['ref_range_low']}-{o['ref_range_high']}{unit})"
            elif o.get("ref_range_text"):
                ref = f" (reference range: {o['ref_range_text']})"
            when = f", recorded {o['effective_at']}" if o.get("effective_at") else ""
            return f"{label}: {value}{ref}{when}."

        def _fmt_document(d: dict) -> str:
            parts = [str(d.get("type_display") or "Document")]
            if d.get("author_display"):
                parts.append(f"author: {d['author_display']}")
            if d.get("authored_at"):
                parts.append(f"dated: {d['authored_at']}")
            return ", ".join(parts) + "."

        def _fmt_prior(p: dict) -> str:
            parts = [str(p.get("encounter_type") or "Encounter")]
            if p.get("started_at"):
                parts.append(f"from {p['started_at']}")
            if p.get("ended_at"):
                parts.append(f"to {p['ended_at']}")
            return ", ".join(parts) + "."

        def _section(items: object, fmt, empty: str) -> list[str]:
            if isinstance(items, list) and items:
                return [fmt(i) for i in items if isinstance(i, dict)]
            return [empty]

        # Build factual narrative sections — no interpretive language
        lines = [
            "1. Identity and Admission Context",
            f"{display_name} is documented as a patient"
            + (f" (date of birth: {dob})" if dob else "")
            + (f", sex: {sex}" if sex else "")
            + f", admitted to {ward}.",
            "",
            "2. Documented Active Problems",
            *_section(conditions, _fmt_condition, "No active problems documented."),
            "",
            "3. Documented Allergies",
            *_section(allergies, _fmt_allergy, "No allergies documented."),
            "",
            "4. Current Medications",
            *_section(medications, _fmt_medication, "No active medications documented."),
            "",
            "5. Recent Documented Observations",
            *_section(observations, _fmt_observation, "No recent observations documented."),
            "",
            "6. Recent Documentation References",
            *_section(documents, _fmt_document, "No recent documents in the record."),
            "",
            "7. Prior Admissions",
            *_section(priors, _fmt_prior, "No prior admissions documented."),
        ]
        return "\n".join(lines)
