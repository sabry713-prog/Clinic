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

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
        """Extract structured data from user_prompt and build a factual narrative."""
        # Extract JSON blobs from user_prompt for realistic stub output
        demographics: dict[str, object] = {}
        try:
            idx = user_prompt.find("PATIENT DEMOGRAPHICS")
            enc_idx = user_prompt.find("CURRENT ENCOUNTER:")
            if idx != -1 and enc_idx != -1:
                blob = user_prompt[idx + len("PATIENT DEMOGRAPHICS (factual reference only, do not narrate identity beyond first sentence):") : enc_idx].strip()
                if blob.startswith("{"):
                    demographics = json.loads(blob)
        except (json.JSONDecodeError, ValueError):
            pass

        display_name = str(demographics.get("display_name") or "the patient")
        dob = demographics.get("date_of_birth")
        sex = demographics.get("sex", "")
        ward = demographics.get("ward") or "the documented ward"

        # Build factual narrative sections — no interpretive language
        lines = [
            f"1. Identity and Admission Context",
            f"{display_name} is documented as a patient"
            + (f" (date of birth: {dob})" if dob else "")
            + (f", sex: {sex}" if sex else "")
            + f", admitted to {ward}.",
            "",
            "2. Documented Active Problems",
            "Active problems are as documented in the patient record.",
            "",
            "3. Documented Allergies",
            "Documented allergies are recorded in the patient record.",
            "",
            "4. Current Medications",
            "Current active medications are listed in the patient record.",
            "",
            "5. Recent Documented Observations",
            "Recent observation values are documented in the patient record with reference ranges as provided by the laboratory.",
            "",
            "6. Recent Documentation References",
            "Recent clinical documentation references are listed in the patient record.",
            "",
            "7. Prior Admissions",
            "Prior admission details including dates and admitting diagnoses are as documented in the patient record.",
        ]
        return "\n".join(lines)
