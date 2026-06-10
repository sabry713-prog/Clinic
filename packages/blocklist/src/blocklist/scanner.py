"""Blocklist scanner — runs compiled patterns against generated text.

Quote-aware: text between « and » markers is stripped before scanning so that
verbatim source quotes containing blocklisted words are not rejected.
"""
from __future__ import annotations

import re

from .patterns import AR_PATTERNS, EN_PATTERNS
from .types import BlocklistMatch, BlocklistResult, Category

# Matches «...» quoted spans (non-greedy)
_QUOTE_RE = re.compile(r"«[^»]*»", re.UNICODE)

BLOCKLIST_VERSION = "v1.0"


def _strip_quotes(text: str) -> tuple[str, list[tuple[int, int]]]:
    """Replace «...» spans with spaces of equal length.

    Returns the scrubbed text and a list of (start, end) spans that were
    replaced so callers can map positions back if needed.
    """
    stripped_spans: list[tuple[int, int]] = []
    result = list(text)
    for m in _QUOTE_RE.finditer(text):
        stripped_spans.append((m.start(), m.end()))
        # Replace with spaces to preserve character positions
        for i in range(m.start(), m.end()):
            result[i] = " "
    return "".join(result), stripped_spans


def scan(text: str, language: str = "en") -> BlocklistResult:
    """Scan *text* for interpretive language.

    Parameters
    ----------
    text:
        The generated text to scan (may contain «...» source quotes).
    language:
        ``"en"`` or ``"ar"``.  Selects the pattern set.  Unknown values
        fall back to English patterns.

    Returns
    -------
    BlocklistResult
        ``.passed`` is ``True`` when no patterns match.
    """
    scrubbed, _quoted_spans = _strip_quotes(text)

    patterns = AR_PATTERNS if language == "ar" else EN_PATTERNS

    matches: list[BlocklistMatch] = []
    for category, compiled_list in patterns.items():
        for compiled in compiled_list:
            for m in compiled.finditer(scrubbed):
                matches.append(
                    BlocklistMatch(
                        pattern=compiled.pattern,
                        span=(m.start(), m.end()),
                        category=category.value,
                        matched_text=text[m.start() : m.end()],
                    )
                )

    return BlocklistResult(
        passed=len(matches) == 0,
        matches=matches,
        language=language,
    )
