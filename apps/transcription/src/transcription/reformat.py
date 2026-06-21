"""Light reformat — deterministic cleanup ONLY.

This NEVER rewrites, expands, or reinterprets clinical content. It does:
- remove disfluencies / filler words
- collapse whitespace, normalise punctuation spacing
- capitalise sentence starts (Latin only) and ensure terminal punctuation

The clinician is always the author; the model contributes no clinical meaning.
Crossing beyond this is SaMD (CLAUDE.md §2) — do not add semantic rewriting here.
"""
from __future__ import annotations

import re

# Filler / disfluency tokens (EN + common Arabic), whole-word, case-insensitive.
_FILLER = re.compile(
    r"\b(um+|uh+|erm+|hmm+|you know|i mean|like,)\b|(?<!\w)(اه+|ايه+|يعني|طيب يعني)(?!\w)",
    re.IGNORECASE,
)
_MULTISPACE = re.compile(r"[ \t]+")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.;:?!،؛؟])")
_MULTI_NEWLINE = re.compile(r"\n{3,}")


def light_reformat(text: str) -> str:
    if not text:
        return ""
    t = _FILLER.sub("", text)
    t = _SPACE_BEFORE_PUNCT.sub(r"\1", t)
    t = _MULTISPACE.sub(" ", t)
    t = _MULTI_NEWLINE.sub("\n\n", t)

    # Per-line: trim, capitalise first Latin letter, ensure terminal punctuation.
    out_lines: list[str] = []
    for line in t.split("\n"):
        s = line.strip()
        if not s:
            out_lines.append("")
            continue
        # Capitalise a leading ASCII letter (leaves Arabic untouched).
        if s[0].isascii() and s[0].isalpha():
            s = s[0].upper() + s[1:]
        if s[-1] not in ".?!،؛؟:":
            s += "."
        out_lines.append(s)
    return "\n".join(out_lines).strip()
