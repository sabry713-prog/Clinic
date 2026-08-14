"""Load LLM prompt text from docs/prompts/ markdown templates.

Every prompt used by model-complete calls in this monorepo is defined
authoritatively in a ``docs/prompts/*.md`` file.  The file contains the
prompt text inside a fenced code block (```` ``` ````) under a specific
markdown section heading (e.g. ``## System prompt``, ``## User prompt
template``, ``## Stricter suffix``).

Usage in a consuming module::

    from prompt_loader import load_prompt

    _SYSTEM = load_prompt("interpreter-prompt.md")

    # With a custom section (defaults to "System prompt"):
    _USER = load_prompt("narrative-prompt.md", section="User prompt template")

The module-level call means the file is read once at import time and the
result is cached; repeated calls with the same ``(filename, section)`` pair
return the cached string without re-reading the file.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

# Resolve docs/prompts/ relative to this file's installed/editable location.
#   this file:  packages/prompt_loader/src/prompt_loader/__init__.py
#   parents[4]: repo root
_PROMPTS_DIR = Path(__file__).resolve().parents[4] / "docs" / "prompts"

_cache: dict[tuple[str, str], str] = {}

# Regex: ## Section Heading (case-sensitive, level 2)
_SECTION_RE = re.compile(r"^##\s+(.+)$", re.MULTILINE)

# Regex: fenced code block
_FENCED_RE = re.compile(
    r"```(?:\w*\n)?(.*?)```",
    re.DOTALL,
)


def load_prompt(md_filename: str, section: str = "System prompt") -> str:
    """Extract the fenced code-block text from a section of a prompt template.

    Args:
        md_filename: Name of the file inside ``docs/prompts/``
            (e.g. ``"narrative-prompt.md"``).
        section: Markdown ``##`` heading that precedes the code block
            (default ``"System prompt"``).

    Returns:
        The raw prompt text with leading/trailing whitespace stripped.

    Raises:
        FileNotFoundError: If the ``.md`` file does not exist.
        ValueError: If the section heading or a fenced code block under it
            cannot be found.
    """
    key = (md_filename, section)
    if key in _cache:
        return _cache[key]

    path = _PROMPTS_DIR / md_filename
    if not path.exists():
        raise FileNotFoundError(
            f"Prompt template not found: {path}  "
            f"(resolved _PROMPTS_DIR={_PROMPTS_DIR})"
        )

    text = path.read_text(encoding="utf-8")

    # Find the section heading position.
    section_pos: Optional[int] = None
    for m in _SECTION_RE.finditer(text):
        if m.group(1).strip() == section:
            section_pos = m.end()
            break

    if section_pos is None:
        raise ValueError(
            f"Section '## {section}' not found in {md_filename}"
        )

    # Slice to the text after this heading, up to the next ## heading (or EOF).
    remainder = text[section_pos:]
    next_section = _SECTION_RE.search(remainder)
    scope = remainder[: next_section.start()] if next_section else remainder

    # Extract the *first* fenced code block in that scope.
    m = _FENCED_RE.search(scope)
    if m is None:
        raise ValueError(
            f"No fenced code block found under '## {section}' in {md_filename}"
        )

    prompt = m.group(1).strip()
    _cache[key] = prompt
    return prompt
