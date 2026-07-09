"""Verbatim-substring check — Python port of the same invariant enforced in
apps/core/src/draft/draft.service.ts's isClinicianAuthoredOnly(): a clinician-
authored-only text is trusted content ONLY if it is (whitespace/case-insensitive)
already present in the source, verbatim. No paraphrase, no addition, no rewrite.
"""
from __future__ import annotations

import re

_WS_RE = re.compile(r"\s+")


def normalize_ws(s: str) -> str:
    return _WS_RE.sub(" ", s).strip().lower()


def is_verbatim_substring(text: str, source: str) -> bool:
    """True if *text* is empty, or a normalized substring of *source*."""
    t = text.strip()
    if t == "":
        return True
    return normalize_ws(t) in normalize_ws(source)
