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
_CHUNK_RE = re.compile(r'"content_text":\s*"([^"]{10,200})"')


class StubModelProvider:
    """
    Stub model provider for testing.
    Produces factual-only answers that always pass the blocklist.
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
        question = q_match.group(1).strip() if q_match else "the question"

        # Extract first chunk content for grounding
        chunk_matches = _CHUNK_RE.findall(user_prompt)

        if chunk_matches:
            first_chunk = chunk_matches[0]
            return (
                f"Based on the documented record: {first_chunk}"
            )
        return "No matching data found in this patient's record."
