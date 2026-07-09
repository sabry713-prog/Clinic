"""Ambient transcript segmentation tests.

Covers:
  - Happy path: model returns a fully verbatim, valid classification.
  - Verbatim violation: model paraphrases/fabricates content every attempt,
    retries exhausted, caller gets the ENTIRE original transcript preserved as
    unclassified (no data loss, nothing fabricated admitted).
  - Recovers after one failed attempt.
  - Unparseable response retries then falls back the same way.
  - Empty transcript short-circuits without calling the model.
  - An all-"unclassified" response is a valid, fully-verbatim outcome.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from transcription.segment import MAX_RETRIES, SectionSpec, segment_transcript  # noqa: E402

SECTIONS = [
    SectionSpec(key="chief_complaint", title="Chief Complaint"),
    SectionSpec(key="assessment", title="Assessment"),
    SectionSpec(key="plan", title="Plan"),
]

TRANSCRIPT = (
    "Patient reports a cough for three days. I think this is bronchitis. "
    "Start amoxicillin 500mg three times daily for seven days."
)


class _FixedModel:
    def __init__(self, response: str) -> None:
        self._response = response
        self.calls = 0

    def version(self) -> str:
        return "fixed-test"

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        self.calls += 1
        return self._response


class _SequenceModel:
    def __init__(self, responses: list[str]) -> None:
        self._responses = responses
        self.calls = 0

    def version(self) -> str:
        return "sequence-test"

    async def complete(self, system_prompt: str, user_prompt: str) -> str:
        response = self._responses[min(self.calls, len(self._responses) - 1)]
        self.calls += 1
        return response


@pytest.mark.asyncio
async def test_compliant_classification_returned_unchanged():
    response = json.dumps({
        "chief_complaint": "Patient reports a cough for three days.",
        "assessment": "I think this is bronchitis.",
        "plan": "Start amoxicillin 500mg three times daily for seven days.",
        "unclassified": "",
    })
    model = _FixedModel(response)
    result = await segment_transcript(TRANSCRIPT, SECTIONS, "en", model)

    assert result.sections["chief_complaint"] == "Patient reports a cough for three days."
    assert result.sections["assessment"] == "I think this is bronchitis."
    assert result.sections["plan"] == "Start amoxicillin 500mg three times daily for seven days."
    assert result.unclassified_text == ""
    assert result.retries == 0
    assert model.calls == 1


@pytest.mark.asyncio
async def test_paraphrased_content_exhausts_retries_and_preserves_full_transcript():
    response = json.dumps({
        "chief_complaint": "Patient has had a cough for a few days.",  # paraphrased, not verbatim
        "assessment": "",
        "plan": "",
        "unclassified": "",
    })
    model = _FixedModel(response)
    result = await segment_transcript(TRANSCRIPT, SECTIONS, "en", model)

    assert result.sections == {}
    assert result.unclassified_text == TRANSCRIPT
    assert result.retries == MAX_RETRIES
    assert model.calls == MAX_RETRIES + 1


@pytest.mark.asyncio
async def test_fabricated_addition_is_never_admitted():
    response = json.dumps({
        "chief_complaint": "",
        "assessment": "Likely bacterial bronchitis, high risk of complications.",  # fabricated
        "plan": "",
        "unclassified": "",
    })
    model = _FixedModel(response)
    result = await segment_transcript(TRANSCRIPT, SECTIONS, "en", model)

    assert result.sections == {}
    # The fabricated "high risk of complications" text never appears anywhere in
    # the output -- the fallback is the original transcript, verbatim.
    assert "risk" not in result.unclassified_text.lower()
    assert result.unclassified_text == TRANSCRIPT


@pytest.mark.asyncio
async def test_recovers_after_one_failed_attempt():
    bad = json.dumps({"chief_complaint": "Cough for a few days.", "assessment": "", "plan": "", "unclassified": ""})
    good = json.dumps({
        "chief_complaint": "Patient reports a cough for three days.",
        "assessment": "I think this is bronchitis.",
        "plan": "Start amoxicillin 500mg three times daily for seven days.",
        "unclassified": "",
    })
    model = _SequenceModel([bad, good])
    result = await segment_transcript(TRANSCRIPT, SECTIONS, "en", model)

    assert result.sections["chief_complaint"] == "Patient reports a cough for three days."
    assert result.retries == 1
    assert model.calls == 2


@pytest.mark.asyncio
async def test_unparseable_response_retries_then_falls_back():
    model = _FixedModel("not valid json at all")
    result = await segment_transcript(TRANSCRIPT, SECTIONS, "en", model)

    assert result.sections == {}
    assert result.unclassified_text == TRANSCRIPT
    assert result.retries == MAX_RETRIES
    assert model.calls == MAX_RETRIES + 1


@pytest.mark.asyncio
async def test_empty_transcript_short_circuits():
    model = _FixedModel("should never be called")
    result = await segment_transcript("   ", SECTIONS, "en", model)

    assert result.sections == {}
    assert result.unclassified_text == ""
    assert result.retries == 0
    assert model.calls == 0


@pytest.mark.asyncio
async def test_all_unclassified_response_is_a_valid_outcome():
    response = json.dumps({
        "chief_complaint": "",
        "assessment": "",
        "plan": "",
        "unclassified": TRANSCRIPT,
    })
    model = _FixedModel(response)
    result = await segment_transcript(TRANSCRIPT, SECTIONS, "en", model)

    assert result.sections == {}
    assert result.unclassified_text == TRANSCRIPT
    assert result.retries == 0
