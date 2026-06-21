"""Light-reformat tests — cleanup only, never semantic rewriting."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from transcription.reformat import light_reformat  # noqa: E402


def test_removes_filler_and_capitalizes_and_punctuates():
    out = light_reformat("um patient reviewed on the morning round")
    assert out == "Patient reviewed on the morning round."


def test_collapses_whitespace_and_fixes_punct_spacing():
    assert light_reformat("vitals   stable , continue meds") == "Vitals stable, continue meds."


def test_preserves_arabic_and_terminal_punct():
    out = light_reformat("تمت مراجعة المريض")
    assert "تمت مراجعة المريض" in out
    assert out.endswith(".")


def test_does_not_invent_content():
    # Cleanup must not add words beyond punctuation/capitalisation.
    src = "labs reviewed continue current plan"
    out = light_reformat(src)
    for word in src.split():
        assert word in out.lower()
    assert out == "Labs reviewed continue current plan."


def test_empty():
    assert light_reformat("") == ""
