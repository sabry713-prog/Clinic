"""Sentence-level provenance verification.

For each sentence in the generated narrative, identify which source records
the sentence is grounded in by matching dates, numeric values, codes, and
display names found in the assembled patient data.
"""
from __future__ import annotations

import re
from typing import Any

from .assembly import AssembledPatientData
from .types import ProvenanceEntry

# Match ISO date fragments (2026-05-24, 24 May 2026, May 2026, 2014, etc.)
_DATE_RE = re.compile(
    r"\b(\d{4}-\d{2}-\d{2}|\d{1,2} \w+ \d{4}|\w+ \d{4}|\d{4})\b",
    re.UNICODE,
)

# Match numeric values (168.0, 88, 10.8, etc.)
_NUM_RE = re.compile(r"\b\d+(?:\.\d+)?\b")


def _sentences(text: str) -> list[tuple[int, int, str]]:
    """Split text into (char_start, char_end, sentence) tuples."""
    parts: list[tuple[int, int, str]] = []
    pos = 0
    # Split on sentence-ending punctuation followed by whitespace
    for m in re.finditer(r"[.!?]\s+", text):
        end = m.end()
        sentence = text[pos:end].strip()
        if sentence:
            parts.append((pos, end, sentence))
        pos = end
    # Capture any remaining text as the last sentence
    tail = text[pos:].strip()
    if tail:
        parts.append((pos, len(text), tail))
    return parts


def _extract_tokens(text: str) -> set[str]:
    """Extract meaningful tokens from a text for matching."""
    tokens: set[str] = set()
    for m in _DATE_RE.finditer(text):
        tokens.add(m.group(0))
    for m in _NUM_RE.finditer(text):
        tokens.add(m.group(0))
    # Also extract word tokens longer than 4 chars (skips articles etc.)
    for word in re.findall(r"\b\w{5,}\b", text.lower()):
        tokens.add(word)
    return tokens


def _source_tokens_for(item: dict[str, Any]) -> set[str]:
    """Flatten all string/numeric fields of a record into a token set."""
    tokens: set[str] = set()
    for v in item.values():
        if isinstance(v, str):
            tokens.update(_extract_tokens(v))
        elif isinstance(v, (int, float)):
            tokens.add(str(v))
    return tokens


def _match_sentence(
    sentence_tokens: set[str],
    records: list[dict[str, Any]],
    source_type: str,
) -> list[dict[str, str]]:
    """Return source refs for records that share tokens with the sentence."""
    sources: list[dict[str, str]] = []
    for item in records:
        if not item:
            continue
        item_tokens = _source_tokens_for(item)
        if sentence_tokens & item_tokens:
            sources.append(
                {
                    "type": source_type,
                    "id": str(item.get("id", "")),
                    "field": "",
                }
            )
    return sources


def verify_provenance(
    generated_text: str,
    assembled_data: AssembledPatientData,
) -> list[ProvenanceEntry]:
    """Return per-sentence provenance entries.

    Each sentence is matched against all source record types.  If no match is
    found the sentence still gets an entry with an empty sources list (this
    never happens with StubModelProvider since the stub produces generic text
    that always references the record).
    """
    entries: list[ProvenanceEntry] = []
    sentence_spans = _sentences(generated_text)

    for idx, (char_start, char_end, sentence) in enumerate(sentence_spans):
        sent_tokens = _extract_tokens(sentence)

        sources: list[dict[str, str]] = []

        # Demographics is a single dict — check it
        if assembled_data.raw_demographics:
            demo_tokens = _source_tokens_for(assembled_data.raw_demographics)
            if sent_tokens & demo_tokens:
                sources.append({
                    "type": "Patient",
                    "id": assembled_data.patient_id,
                    "field": "demographics",
                })

        sources.extend(
            _match_sentence(sent_tokens, assembled_data.raw_observations, "Observation")
        )
        sources.extend(
            _match_sentence(sent_tokens, assembled_data.raw_conditions, "Condition")
        )
        sources.extend(
            _match_sentence(sent_tokens, assembled_data.raw_medications, "MedicationRequest")
        )
        sources.extend(
            _match_sentence(sent_tokens, assembled_data.raw_allergies, "AllergyIntolerance")
        )
        sources.extend(
            _match_sentence(sent_tokens, assembled_data.raw_encounters, "Encounter")
        )
        sources.extend(
            _match_sentence(sent_tokens, assembled_data.raw_documents, "DocumentReference")
        )

        # Deduplicate by (type, id)
        seen: set[tuple[str, str]] = set()
        deduped: list[dict[str, str]] = []
        for s in sources:
            key = (s["type"], s["id"])
            if key not in seen:
                seen.add(key)
                deduped.append(s)

        entries.append(
            ProvenanceEntry(
                sentence_index=idx,
                char_start=char_start,
                char_end=char_end,
                sources=deduped,
            )
        )

    return entries
