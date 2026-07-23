"""Live SOAP-note structuring from streaming consultation transcript.

Receives transcript chunks as a consultation happens and returns a structured
SOAP note, streamed back over Server-Sent Events so the UI fills in while the
clinician is still talking.

Two hard rules shape this module:

1. PHI residency (packages/phi-guard). A consultation transcript is PHI. Every
   call to the external DeepSeek endpoint goes through `guard_outbound`, which
   blocks or de-identifies according to PHI_EGRESS_POLICY. Identifiers are
   restored before the note reaches the clinician.

2. Formatting only (CLAUDE.md Principle 1). The model reorganises what was
   said; it never invents a finding, value, medication or dose. The Smart
   Checklist is a deterministic keyword lookup, not a model judgement.
"""
from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepseek_client import (  # noqa: E402
    SOAP_FIELDS,
    DeepSeekError,
    _extract_json_object,
    generate_soap_note,
)

__all__ = [
    "LiveScribeSession",
    "SOAP_FIELDS",
    "checklist_for_transcript",
    "stream_soap_updates",
    "SYMPTOM_CHECKS",
]


# ---------------------------------------------------------------------------
# Smart Checklist
#
# Deterministic symptom -> documentation-check mapping. Deliberately NOT model
# generated: CLAUDE.md Principle 1 forbids the LLM producing clinical facts,
# and a hallucinated "recommended test" is exactly that. Each entry is a
# documentation prompt tied to a symptom the clinician actually said.
# ---------------------------------------------------------------------------
SYMPTOM_CHECKS: dict[str, tuple[str, ...]] = {
    "chest pain": (
        "Document onset, duration and character of chest pain",
        "Record vital signs including blood pressure",
        "Note whether pain occurs at rest or on exertion",
        "ECG considered and documented",
    ),
    "shortness of breath": (
        "Record respiratory rate and oxygen saturation",
        "Document exertional tolerance",
        "Chest examination findings documented",
    ),
    "fever": (
        "Record temperature",
        "Document duration of fever",
        "Note associated symptoms (cough, rash, urinary)",
    ),
    "cough": (
        "Document cough duration and whether productive",
        "Record respiratory examination findings",
    ),
    "headache": (
        "Document headache onset, site and severity",
        "Note visual or neurological symptoms",
    ),
    "dizziness": (
        "Record lying and standing blood pressure",
        "Document duration and triggers",
    ),
    "abdominal pain": (
        "Document pain site and radiation",
        "Record abdominal examination findings",
    ),
    "palpitations": (
        "Record heart rate and rhythm",
        "Document duration and triggers",
    ),
    "nausea": ("Document duration and relation to meals",),
    "vomiting": ("Document frequency and any blood",),
    "swelling": ("Document site and pitting status",),
    "numbness": ("Document distribution and duration",),
    "fatigue": ("Document duration and impact on activity",),
    "weight loss": ("Record current weight and timeframe of loss",),
    "rash": ("Document distribution and appearance",),
}

# Longest first so "chest pain" matches before "pain"-like shorter keys.
_SYMPTOM_KEYS = sorted(SYMPTOM_CHECKS, key=len, reverse=True)


def checklist_for_transcript(transcript: str) -> list[dict[str, Any]]:
    """Return checklist items triggered by symptoms mentioned in the text.

    Pure string matching over what was actually said — no inference.
    """
    if not transcript:
        return []
    lowered = transcript.lower()
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for symptom in _SYMPTOM_KEYS:
        if symptom in lowered:
            for label in SYMPTOM_CHECKS[symptom]:
                if label not in seen:
                    seen.add(label)
                    items.append({"symptom": symptom, "label": label, "done": False})
    return items


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------
@dataclass
class LiveScribeSession:
    """Accumulates transcript chunks and the latest structured note."""

    session_id: str
    patient_names: list[str] = field(default_factory=list)
    chunks: list[str] = field(default_factory=list)
    soap: dict[str, str] = field(
        default_factory=lambda: {f: "" for f in SOAP_FIELDS}
    )

    @property
    def transcript(self) -> str:
        return " ".join(c.strip() for c in self.chunks if c.strip())

    def add_chunk(self, text: str) -> None:
        if text and text.strip():
            self.chunks.append(text.strip())

    def checklist(self) -> list[dict[str, Any]]:
        return checklist_for_transcript(self.transcript)

    def snapshot(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "soap": dict(self.soap),
            "checklist": self.checklist(),
            "transcript_chars": len(self.transcript),
        }


def _changed_fields(before: dict[str, str], after: dict[str, str]) -> list[str]:
    """Which SOAP sections changed — lets the UI highlight just those."""
    return [f for f in SOAP_FIELDS if before.get(f, "") != after.get(f, "")]


async def structure_transcript(
    session: LiveScribeSession,
    *,
    client: Optional[Any] = None,
) -> dict[str, Any]:
    """Re-structure the session's transcript into SOAP.

    Returns the new note plus which sections changed. Raises DeepSeekError if
    the model call fails or the PHI guard blocks the call.
    """
    before = dict(session.soap)
    soap = await generate_soap_note(
        session.transcript,
        client=client,
        patient_names=session.patient_names,
    )
    session.soap = soap
    return {
        "soap": soap,
        "changed": _changed_fields(before, soap),
        "checklist": session.checklist(),
    }


def _sse(event: str, data: dict[str, Any]) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_soap_updates(
    session: LiveScribeSession,
    chunks: AsyncGenerator[str, None],
    *,
    client: Optional[Any] = None,
    restructure_every: int = 2,
) -> AsyncGenerator[str, None]:
    """Consume transcript chunks and yield SSE frames as the note develops.

    Emits:
        transcript — each chunk, echoed straight back (no model involved)
        soap       — the restructured note + which sections changed
        checklist  — triggered documentation items
        error      — a model/guard failure, without killing the stream
        done       — final snapshot

    The note is re-derived every `restructure_every` chunks rather than on
    every word, so a fast speaker does not mean a model call per syllable.
    """
    received = 0
    async for chunk in chunks:
        session.add_chunk(chunk)
        received += 1
        yield _sse("transcript", {"text": chunk, "index": received})

        checklist = session.checklist()
        if checklist:
            yield _sse("checklist", {"items": checklist})

        if received % restructure_every == 0:
            try:
                result = await structure_transcript(session, client=client)
                yield _sse("soap", result)
            except DeepSeekError as exc:
                # Surface it, keep streaming the transcript — losing the
                # structuring step must not lose the clinician's words.
                yield _sse("error", {"message": str(exc), "stage": "structuring"})

    # Final pass so the last chunks are always reflected.
    try:
        result = await structure_transcript(session, client=client)
        yield _sse("soap", result)
    except DeepSeekError as exc:
        yield _sse("error", {"message": str(exc), "stage": "final"})

    yield _sse("done", session.snapshot())
