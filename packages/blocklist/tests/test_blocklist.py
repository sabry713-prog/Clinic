"""Tests for the interpretive-language blocklist.

AC-4 exit gate:
  - 100% pass on should_block.txt  (every line returns passed=False)
  - 0 false positives on should_allow.txt (every line returns passed=True)
"""
from __future__ import annotations

from pathlib import Path

import pytest

from blocklist import scan, Category
from blocklist.scanner import _strip_quotes  # type: ignore[attr-defined]

CORPORA = Path(__file__).parent / "corpora"


# ── Corpus-based parametrized tests ──────────────────────────────────────────

def _load_corpus(filename: str) -> list[str]:
    lines = (CORPORA / filename).read_text(encoding="utf-8").splitlines()
    return [ln for ln in lines if ln.strip()]


_SHOULD_BLOCK = _load_corpus("should_block.txt")
_SHOULD_ALLOW = _load_corpus("should_allow.txt")


@pytest.mark.parametrize("text", _SHOULD_BLOCK)
def test_corpus_should_block(text: str) -> None:
    """Every line in should_block.txt must produce passed=False."""
    # Detect language heuristically: if the text contains Arabic script, use "ar"
    language = "ar" if any("؀" <= ch <= "ۿ" for ch in text) else "en"
    result = scan(text, language=language)
    assert not result.passed, (
        f"Expected blocklist to trigger on: {text!r}\n"
        f"  language={language}, matches={result.matches}"
    )
    assert len(result.matches) > 0


@pytest.mark.parametrize("text", _SHOULD_ALLOW)
def test_corpus_should_allow(text: str) -> None:
    """Every line in should_allow.txt must produce passed=True (no false positives)."""
    language = "ar" if any("؀" <= ch <= "ۿ" for ch in text) else "en"
    result = scan(text, language=language)
    assert result.passed, (
        f"False positive on: {text!r}\n"
        f"  language={language}, matches={result.matches}"
    )


# ── Quote stripping ───────────────────────────────────────────────────────────

def test_quote_stripping_basic() -> None:
    text = "The patient was documented as «improving» in the notes."
    scrubbed, spans = _strip_quotes(text)
    assert "improving" not in scrubbed.lower()
    assert len(spans) == 1


def test_quote_stripping_does_not_block() -> None:
    result = scan(
        "The patient was documented as «improving» in the progress note.",
        language="en",
    )
    assert result.passed, f"Should pass; matches={result.matches}"


def test_quote_stripping_multiple() -> None:
    text = "Diagnosis: «severe sepsis». Status: «worsening»."
    result = scan(text, language="en")
    assert result.passed, f"Quoted terms should not block; matches={result.matches}"


def test_non_quoted_still_blocked() -> None:
    result = scan("The patient is worsening.", language="en")
    assert not result.passed


# ── Per-category unit tests ───────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected_category", [
    ("This suggests renal failure.", Category.INTERPRETIVE_VERB),
    ("The lab indicates an infection.", Category.INTERPRETIVE_VERB),
    ("The result is consistent with pneumonia.", Category.INTERPRETIVE_VERB),
])
def test_interpretive_verb(text: str, expected_category: Category) -> None:
    result = scan(text, language="en")
    assert not result.passed
    categories = {m.category for m in result.matches}
    assert expected_category.value in categories


@pytest.mark.parametrize("text,expected_category", [
    ("The value is concerning.", Category.CLINICAL_JUDGMENT_ADJECTIVE),
    ("WBC is abnormally high.", Category.CLINICAL_JUDGMENT_ADJECTIVE),
    ("Creatinine is elevated.", Category.CLINICAL_JUDGMENT_ADJECTIVE),
])
def test_clinical_judgment_adjective(text: str, expected_category: Category) -> None:
    result = scan(text, language="en")
    assert not result.passed
    categories = {m.category for m in result.matches}
    assert expected_category.value in categories


@pytest.mark.parametrize("text,expected_category", [
    ("The condition is worsening.", Category.TREND_LANGUAGE),
    ("Renal function is declining.", Category.TREND_LANGUAGE),
    ("Blood pressure is rising.", Category.TREND_LANGUAGE),
])
def test_trend_language(text: str, expected_category: Category) -> None:
    result = scan(text, language="en")
    assert not result.passed
    categories = {m.category for m in result.matches}
    assert expected_category.value in categories


@pytest.mark.parametrize("text,expected_category", [
    ("Consider nephrology referral.", Category.RECOMMENDATION),
    ("Recommend holding metformin.", Category.RECOMMENDATION),
    ("She should avoid NSAIDs.", Category.RECOMMENDATION),
])
def test_recommendation(text: str, expected_category: Category) -> None:
    result = scan(text, language="en")
    assert not result.passed
    categories = {m.category for m in result.matches}
    assert expected_category.value in categories


@pytest.mark.parametrize("text,expected_category", [
    ("Monitor for respiratory failure.", Category.ALERT_LANGUAGE),
    ("Be aware of the potassium level.", Category.ALERT_LANGUAGE),
    ("Flag this for urgent review.", Category.ALERT_LANGUAGE),
])
def test_alert_language(text: str, expected_category: Category) -> None:
    result = scan(text, language="en")
    assert not result.passed
    categories = {m.category for m in result.matches}
    assert expected_category.value in categories


@pytest.mark.parametrize("text,expected_category", [
    ("Rule out pulmonary embolism.", Category.DIAGNOSTIC_INFERENCE),
    ("Could be early heart failure.", Category.DIAGNOSTIC_INFERENCE),
    ("The differential diagnosis includes AKI.", Category.DIAGNOSTIC_INFERENCE),
])
def test_diagnostic_inference(text: str, expected_category: Category) -> None:
    result = scan(text, language="en")
    assert not result.passed
    categories = {m.category for m in result.matches}
    assert expected_category.value in categories


@pytest.mark.parametrize("text,expected_category", [
    ("The patient is at risk of AKI.", Category.RISK_LANGUAGE),
    ("High risk of deterioration.", Category.RISK_LANGUAGE),
])
def test_risk_language(text: str, expected_category: Category) -> None:
    result = scan(text, language="en")
    assert not result.passed
    categories = {m.category for m in result.matches}
    assert expected_category.value in categories


@pytest.mark.parametrize("text,expected_category", [
    ("The patient will need dialysis.", Category.PROGNOSTIC),
    ("Expected to recover in two weeks.", Category.PROGNOSTIC),
    ("Prognosis is poor.", Category.PROGNOSTIC),
])
def test_prognostic(text: str, expected_category: Category) -> None:
    result = scan(text, language="en")
    assert not result.passed
    categories = {m.category for m in result.matches}
    assert expected_category.value in categories


# ── Arabic unit tests ─────────────────────────────────────────────────────────

def test_arabic_interpretive_verb() -> None:
    result = scan("يشير إلى تدهور الحالة الكلوية", language="ar")
    assert not result.passed


def test_arabic_prognostic() -> None:
    result = scan("من المتوقع تحسن الحالة خلال أسبوع", language="ar")
    assert not result.passed


def test_arabic_factual_passes() -> None:
    result = scan("الكرياتينين: 168 ميكرومول/لتر في 24 مايو 2026.", language="ar")
    assert result.passed


# ── Edge cases ────────────────────────────────────────────────────────────────

def test_empty_string() -> None:
    assert scan("", language="en").passed
    assert scan("", language="ar").passed


def test_case_insensitive() -> None:
    assert not scan("WORSENING renal function", language="en").passed
    assert not scan("Consistent With sepsis", language="en").passed


def test_result_language_field() -> None:
    r = scan("Normal text.", language="ar")
    assert r.language == "ar"
