"""Verbatim-substring check tests — mirrors draft.policy.spec.ts's assertions
for isClinicianAuthoredOnly (apps/core/src/draft/draft.service.ts)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from transcription.verbatim import is_verbatim_substring  # noqa: E402

SOURCE = "Patient reports headache for 2 days. Denies fever. Wants to try ibuprofen."


def test_accepts_verbatim_substring():
    assert is_verbatim_substring("Patient reports headache for 2 days.", SOURCE) is True


def test_accepts_full_source():
    assert is_verbatim_substring(SOURCE, SOURCE) is True


def test_is_whitespace_case_tolerant():
    assert is_verbatim_substring("  patient   REPORTS headache for 2 days.  ", SOURCE) is True


def test_accepts_empty_text():
    assert is_verbatim_substring("", SOURCE) is True
    assert is_verbatim_substring("   ", SOURCE) is True


def test_rejects_paraphrased_text():
    assert is_verbatim_substring("Patient has had a headache for two days.", SOURCE) is False


def test_rejects_fabricated_addition():
    assert is_verbatim_substring("Patient reports headache for 2 days, likely migraine.", SOURCE) is False
