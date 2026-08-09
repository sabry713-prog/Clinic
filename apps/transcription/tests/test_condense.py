"""Ambient section condensation tests.

Covers:
  - validate_condensation(): blocklist violation rejected, new-word-not-in-
    source rejected, reordering/filler-removal-only accepted, empty rejected.
  - condense_section(): non-condensable section key is a no-op passthrough
    (no model call); compliant model output is accepted; retries-then-
    fallback exhaustion returns the ORIGINAL verbatim text unchanged.
  - word_containment_check(): direct unit coverage of the core safety check.
  - Stub model is safe by construction (subtractive-only).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from transcription.condense import (  # noqa: E402
    MAX_RETRIES,
    CONDENSABLE_SECTIONS,
    _StubCondenseModel,
    condense_section,
    validate_condensation,
    word_containment_check,
)

SOURCE = "Patient reports a cough for three days and mentioned some fever last night."


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


def test_word_containment_allows_reordering_and_dropped_filler():
    assert word_containment_check("cough three days, fever last night", SOURCE)


def test_word_containment_rejects_a_new_clinical_term():
    # "infection" is not present anywhere in SOURCE -- must be rejected even
    # though it sounds like a plausible summary.
    assert not word_containment_check("patient has an infection", SOURCE)


def test_word_containment_empty_condensed_is_trivially_true():
    assert word_containment_check("", SOURCE)


def test_validate_condensation_rejects_new_clinical_term():
    assert not validate_condensation("patient has an infection", SOURCE, "en")


def test_validate_condensation_accepts_faithful_tightening():
    assert validate_condensation("cough three days, fever last night", SOURCE, "en")


def test_validate_condensation_rejects_blocklisted_language_even_if_contained():
    # "concerning" is drawn from the source's own words but is itself an
    # interpretive/judgment adjective the blocklist forbids regardless of
    # containment.
    source_with_word = "Patient reports symptoms that the family found concerning."
    assert not validate_condensation("concerning symptoms reported", source_with_word, "en")


def test_validate_condensation_rejects_empty_output():
    assert not validate_condensation("", SOURCE, "en")
    assert not validate_condensation("   ", SOURCE, "en")


@pytest.mark.asyncio
async def test_non_condensable_section_is_a_no_op_passthrough():
    assert "assessment" not in CONDENSABLE_SECTIONS
    model = _FixedModel("should never be called")
    result = await condense_section("assessment", "I think this is bronchitis.", "en", model)

    assert result.text == "I think this is bronchitis."
    assert result.condensed is False
    assert result.retries == 0
    assert model.calls == 0


@pytest.mark.asyncio
async def test_empty_text_is_a_no_op_passthrough():
    model = _FixedModel("should never be called")
    result = await condense_section("chief_complaint", "   ", "en", model)

    assert result.condensed is False
    assert model.calls == 0


@pytest.mark.asyncio
async def test_compliant_condensation_is_accepted():
    model = _FixedModel("cough three days, fever last night")
    result = await condense_section("chief_complaint", SOURCE, "en", model)

    assert result.text == "cough three days, fever last night"
    assert result.condensed is True
    assert result.retries == 0
    assert model.calls == 1


@pytest.mark.asyncio
async def test_recovers_after_one_failed_attempt():
    bad = "patient likely has an infection"  # introduces a new term
    good = "cough three days, fever last night"
    model = _SequenceModel([bad, good])
    result = await condense_section("chief_complaint", SOURCE, "en", model)

    assert result.text == good
    assert result.condensed is True
    assert result.retries == 1
    assert model.calls == 2


@pytest.mark.asyncio
async def test_exhausted_retries_falls_back_to_original_verbatim_text_unchanged():
    model = _FixedModel("patient likely has a serious infection")  # always fabricates
    result = await condense_section("history", SOURCE, "en", model)

    assert result.text == SOURCE
    assert result.condensed is False
    assert result.retries == MAX_RETRIES
    assert model.calls == MAX_RETRIES + 1


@pytest.mark.asyncio
async def test_stub_model_only_removes_words_never_adds():
    model = _StubCondenseModel()
    noisy = "Um, the patient said, you know, they've had a cough for three days."
    result = await condense_section("chief_complaint", noisy, "en", model)

    # Subtractive-only: every word in the output must already be in the input.
    assert word_containment_check(result.text, noisy)
    assert "um" not in result.text.lower()


@pytest.mark.asyncio
async def test_stub_model_tidies_punctuation_orphaned_by_filler_removal():
    model = _StubCondenseModel()
    noisy = "Um, the patient said, you know, they have had a cough for three days and, uh, some fever last night, I think."
    result = await condense_section("chief_complaint", noisy, "en", model)

    assert result.condensed is True
    # No dangling comma runs or leading commas left behind by the removals.
    assert ", ," not in result.text
    assert not result.text.startswith(",")
    assert result.text == "they have had a cough for three days and some fever last night."
