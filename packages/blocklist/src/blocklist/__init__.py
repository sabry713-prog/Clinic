"""Interpretive-language blocklist filter.

Guards generated text from crossing the Health IT → SaMD boundary.

Usage::

    from blocklist import scan, BlocklistResult, BlocklistMatch, Category

    result = scan("The creatinine is elevated.", language="en")
    assert not result.passed
    assert result.matches[0].category == "CLINICAL_JUDGMENT_ADJECTIVE"

Backwards-compatible ``check()`` shim is retained for Slice 0 callers.
"""
from __future__ import annotations

from .scanner import BLOCKLIST_VERSION, scan
from .types import BlocklistMatch, BlocklistResult, Category


def check(text: str, language: str = "ar") -> BlocklistResult:
    """Backwards-compatible shim for Slice 0 callers.

    Delegates to ``scan()`` with the same semantics.
    """
    return scan(text, language=language)


__all__ = [
    "scan",
    "check",
    "BlocklistResult",
    "BlocklistMatch",
    "Category",
    "BLOCKLIST_VERSION",
]
