"""Reversible de-identification of direct identifiers in prompt text.

Replaces direct identifiers with stable placeholders (``[[NAME_1]]``,
``[[MRN_1]]`` …) and can restore them in the model's reply. Clinical content —
drug names, doses, lab values, codes — is deliberately left untouched, because
altering it would corrupt the very facts the model is asked to reformat.

This is a defence-in-depth control, NOT a certification of anonymity. Free-text
clinical notes can carry identifying detail no pattern will catch. Use
``PHI_EGRESS_POLICY=block`` when that residual risk is unacceptable.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

__all__ = ["Deidentifier", "DeidentificationResult"]


@dataclass
class DeidentificationResult:
    text: str
    mapping: dict[str, str] = field(default_factory=dict)

    @property
    def redaction_count(self) -> int:
        return len(self.mapping)

    def restore(self, model_output: str) -> str:
        """Put the original values back into a model reply."""
        out = model_output
        for placeholder, original in self.mapping.items():
            out = out.replace(placeholder, original)
        return out


# Patterns for direct identifiers. Ordered: most specific first, so a national
# ID is not first consumed by the generic long-number rule.
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    # Saudi national / iqama ID: 10 digits starting 1 or 2
    ("NID", re.compile(r"\b[12]\d{9}\b")),
    # MRN like MRN-010 / MRN010 / SYN-1001
    ("MRN", re.compile(r"\b(?:MRN|SYN)[-_ ]?\d{3,8}\b", re.IGNORECASE)),
    # UUIDs (patient_id, encounter_id …)
    ("UUID", re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)),
    # Emails
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
    # Saudi mobile numbers (+9665…, 05…)
    ("PHONE", re.compile(r"(?:\+966|00966|0)5\d{8}\b")),
    # Full dates — dates of birth and admission dates are identifiers
    ("DATE", re.compile(r"\b\d{4}-\d{2}-\d{2}\b")),
)


class Deidentifier:
    """Scrubs direct identifiers from text, reversibly.

    ``extra_names`` lets the caller pass known patient/clinician names pulled
    from the record, which regexes alone cannot reliably detect.
    """

    def __init__(self, extra_names: list[str] | None = None) -> None:
        self._extra_names = [n.strip() for n in (extra_names or []) if n and len(n.strip()) > 2]

    def scrub(self, text: str) -> DeidentificationResult:
        if not text:
            return DeidentificationResult(text="", mapping={})

        mapping: dict[str, str] = {}
        seen: dict[str, str] = {}  # original -> placeholder (stable reuse)
        counters: dict[str, int] = {}
        out = text

        def placeholder_for(kind: str, original: str) -> str:
            if original in seen:
                return seen[original]
            counters[kind] = counters.get(kind, 0) + 1
            ph = f"[[{kind}_{counters[kind]}]]"
            seen[original] = ph
            mapping[ph] = original
            return ph

        # Known names first — longest first so "Ahmad Al-Bishi" wins over "Ahmad".
        for name in sorted(self._extra_names, key=len, reverse=True):
            pattern = re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE)
            if pattern.search(out):
                out = pattern.sub(lambda m: placeholder_for("NAME", m.group(0)), out)

        for kind, pattern in _PATTERNS:
            out = pattern.sub(lambda m, k=kind: placeholder_for(k, m.group(0)), out)

        return DeidentificationResult(text=out, mapping=mapping)
