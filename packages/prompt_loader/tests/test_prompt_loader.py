"""Tests for packages/prompt_loader."""
from __future__ import annotations

import os
import textwrap
from pathlib import Path
from unittest.mock import patch

import pytest

# Import the module under test.  We need to ensure the package src is on
# sys.path first.
SERVICE_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = SERVICE_DIR / "src"

import sys  # noqa: E402
sys.path.insert(0, str(SRC_DIR))

from prompt_loader import load_prompt, _cache  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_cache():
    """Each test starts with a fresh cache."""
    _cache.clear()
    yield
    _cache.clear()


def _write_tmp_md(tmp_path: Path, content: str, filename: str = "test.md") -> Path:
    """Write a temp .md file and return its path."""
    p = tmp_path / filename
    p.write_text(textwrap.dedent(content), encoding="utf-8")
    return p


class TestLoadPrompt:
    def test_extracts_system_prompt_from_code_block(self, tmp_path):
        md = _write_tmp_md(
            tmp_path,
            """\
            # Some Title

            ## System prompt

            ```
            You are a test assistant.
            Rule 1: do X.
            ```
            """,
        )
        with patch("prompt_loader._PROMPTS_DIR", tmp_path):
            result = load_prompt("test.md")
        assert result == "You are a test assistant.\nRule 1: do X."

    def test_extracts_custom_section(self, tmp_path):
        md = _write_tmp_md(
            tmp_path,
            """\
            ## System prompt

            ```
            system text
            ```

            ## User prompt template

            ```
            user text with {placeholder}
            ```
            """,
        )
        with patch("prompt_loader._PROMPTS_DIR", tmp_path):
            result = load_prompt("test.md", section="User prompt template")
        assert result == "user text with {placeholder}"

    def test_strips_leading_trailing_whitespace(self, tmp_path):
        _write_tmp_md(
            tmp_path,
            """\
            ## System prompt

            ```
              spaced line 1
                spaced line 2

            ```
            """,
        )
        with patch("prompt_loader._PROMPTS_DIR", tmp_path):
            result = load_prompt("test.md")
        # Only leading/trailing whitespace is stripped, internal spacing preserved.
        assert result.startswith("spaced line 1")
        assert "spaced line 2" in result
        assert not result.endswith("\n")

    def test_stops_at_next_heading(self, tmp_path):
        _write_tmp_md(
            tmp_path,
            """\
            ## System prompt

            ```
            correct prompt
            ```

            ## User prompt template

            ```
            wrong prompt
            ```
            """,
        )
        with patch("prompt_loader._PROMPTS_DIR", tmp_path):
            result = load_prompt("test.md")
        assert result == "correct prompt"

    def test_caches_result(self, tmp_path):
        _write_tmp_md(
            tmp_path,
            """\
            ## System prompt

            ```
            cached text
            ```
            """,
        )
        with patch("prompt_loader._PROMPTS_DIR", tmp_path):
            first = load_prompt("test.md")
            # Overwrite the file — cached copy should still be returned.
            _write_tmp_md(
                tmp_path,
                """\
                ## System prompt

                ```
                new text
                ```
                """,
            )
            second = load_prompt("test.md")
        assert first == second == "cached text"

    def test_raises_on_missing_file(self, tmp_path):
        with patch("prompt_loader._PROMPTS_DIR", tmp_path):
            with pytest.raises(FileNotFoundError, match="test.md"):
                load_prompt("test.md")

    def test_raises_on_missing_section(self, tmp_path):
        _write_tmp_md(
            tmp_path,
            """\
            ## Other section

            ```
            text
            ```
            """,
        )
        with patch("prompt_loader._PROMPTS_DIR", tmp_path):
            with pytest.raises(ValueError, match="System prompt"):
                load_prompt("test.md")

    def test_raises_on_missing_code_block(self, tmp_path):
        _write_tmp_md(
            tmp_path,
            """\
            ## System prompt

            No code block here, just prose.
            """,
        )
        with patch("prompt_loader._PROMPTS_DIR", tmp_path):
            with pytest.raises(ValueError, match="fenced code block"):
                load_prompt("test.md")

    def test_handles_multiline_prompt(self, tmp_path):
        _write_tmp_md(
            tmp_path,
            """\
            ## System prompt

            ```
            Line one.
            Line two.
            Line three with {var} and {other_var}.
            ```
            """,
        )
        with patch("prompt_loader._PROMPTS_DIR", tmp_path):
            result = load_prompt("test.md")
        assert "{var}" in result
        assert "{other_var}" in result

    def test_loads_real_narrative_prompt(self):
        """Integration: loads the actual narrative-prompt.md from docs/prompts/."""
        result = load_prompt("narrative-prompt.md")
        assert "factual summarization assistant" in result
        assert "{language}" in result
