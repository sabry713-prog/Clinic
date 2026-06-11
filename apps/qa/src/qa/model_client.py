"""Model provider protocol and stub for Q&A synthesis."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass
class ModelParams:
    temperature: float = 0.0
    top_p: float = 1.0
    max_tokens: int = 600
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0


@runtime_checkable
class ModelProvider(Protocol):
    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str: ...

    def version(self) -> str: ...


# Simple pattern to extract question from prompt
_QUESTION_RE = re.compile(r"QUESTION:\s*(.+?)(?:\n|$)", re.DOTALL)
_CHUNK_RE = re.compile(r'"content_text":\s*"([^"]{10,400})"')

# Question words that carry no retrieval signal
_STOPWORDS = frozenset({
    "what", "whats", "which", "when", "where", "who", "how", "does", "did",
    "the", "his", "her", "their", "this", "that", "about", "have", "has",
    "are", "was", "were", "any", "and", "for", "with", "show", "tell",
    "list", "give", "need", "know", "please", "patient", "patients",
    "record", "documented", "value", "values", "result", "results",
    "level", "levels", "latest", "last", "recent", "current", "now",
})

# Map common question terms to the chunk vocabulary used by retrieval
_TERM_ALIASES = {
    "allergies": "allergy", "allergic": "allergy",
    "medications": "medication", "meds": "medication", "drugs": "medication",
    "drug": "medication", "prescriptions": "medication", "prescription": "medication",
    "conditions": "condition", "problems": "condition", "diagnoses": "condition",
    "labs": "laboratory", "lab": "laboratory",
    "vitals": "vital", "notes": "note", "encounters": "encounter",
    "admissions": "encounter", "admission": "encounter", "visits": "encounter",
    "hb": "hemoglobin", "hgb": "hemoglobin",
    "bp": "blood pressure", "temp": "temperature",
    "cr": "creatinine", "glu": "glucose", "sugar": "glucose",
}


def _question_terms(question: str) -> list[str]:
    tokens = re.findall(r"[a-zA-Z0-9^/%؀-ۿ]+", question.lower())
    terms = []
    for t in tokens:
        if t in _STOPWORDS:
            continue
        if t in _TERM_ALIASES:
            terms.append(_TERM_ALIASES[t])
        elif len(t) >= 3:
            terms.append(t)
    return terms


class StubModelProvider:
    """
    Stub model provider for testing.
    Produces factual-only answers that always pass the blocklist.
    Selects retrieved chunks by keyword overlap with the question.
    """

    def version(self) -> str:
        return "stub-qa-v1"

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
        # Extract question
        q_match = _QUESTION_RE.search(user_prompt)
        question = q_match.group(1).strip() if q_match else ""

        # Extract chunk contents for grounding
        chunk_matches = _CHUNK_RE.findall(user_prompt)
        if not chunk_matches:
            return "No matching data found in this patient's record."

        # Score chunks by how many question terms they contain
        terms = _question_terms(question)
        scored: list[tuple[int, str]] = []
        for chunk in chunk_matches:
            content_lower = chunk.lower()
            score = sum(1 for t in terms if t in content_lower)
            if score > 0:
                scored.append((score, chunk))

        if not scored:
            return "No matching data found in this patient's record."

        scored.sort(key=lambda s: s[0], reverse=True)
        top = [c for _, c in scored[:5]]
        if len(top) == 1:
            return f"Based on the documented record: {top[0]}"
        bullets = "\n".join(f"• {c}" for c in top)
        return f"Based on the documented record:\n{bullets}"
