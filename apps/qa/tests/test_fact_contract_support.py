"""C03: the citation's existence was checked, its support was not."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from qa.fact_contract import AnswerSource, checkable_tokens, verify_support  # noqa: E402


def src(text: str, sid: str = "s1") -> AnswerSource:
    return AnswerSource(fact_segment=text, type="medication", id=sid, code="", source_system="hospital", field="")


def test_a_source_whose_text_shares_nothing_is_unsupported():
    answer = "The patient is on metformin 500mg twice daily."
    kept, dropped = verify_support(answer, [src("Warfarin 5mg at bedtime", "s-warfarin")])
    assert dropped and not kept


def test_frequency_words_alone_do_not_keep_a_citation():
    """Found by accident while writing the test above: `daily` was the only token in
    common, and it kept a warfarin citation for a metformin answer."""
    answer = "The patient is on metformin 500mg twice daily."
    kept, dropped = verify_support(answer, [src("Warfarin 5mg once daily", "s-w")])
    assert dropped and not kept


def test_a_source_that_shares_a_value_is_supported():
    answer = "The patient is on metformin 500mg twice daily."
    kept, dropped = verify_support(answer, [src("metformin 500mg twice daily", "s-meta")])
    assert kept and not dropped


def test_a_shared_number_alone_is_enough_to_keep_it():
    """Deliberately weak, and said so in the docstring: this is a floor, not entailment."""
    answer = "Latest creatinine 260 umol/L."
    kept, dropped = verify_support(answer, [src("sodium 260 mmol/L", "s-na")])
    assert kept, "a shared value keeps the citation; meaning is not checked here"


def test_a_source_with_nothing_checkable_is_not_discarded():
    answer = "Reviewed today."
    kept, dropped = verify_support(answer, [src("", "s-empty")])
    assert kept and not dropped


def test_checkable_tokens_ignores_glue_words():
    assert "patient" not in checkable_tokens("the patient with metformin")
    assert "metformin" in checkable_tokens("the patient with metformin")


def test_mixed_sources_split_correctly():
    answer = "Started metformin 500mg for diabetes."
    a = src("metformin 500mg", "s-ok")
    b = src("amoxicillin 875mg for sinusitis", "s-other")
    kept, dropped = verify_support(answer, [a, b])
    assert [s.id for s in kept] == ["s-ok"]
    assert [s.id for s in dropped] == ["s-other"]
