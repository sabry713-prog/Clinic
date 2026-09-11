"""Tests for LLM-assisted checklist extraction and its deterministic gate.

The governance-critical property: an item proposed by the model survives
only if its supporting quote is verbatim in the transcript. A fabricated
or paraphrased quote drops the whole item — the model is never trusted on
its own word (CLAUDE.md Principle 1 applied to checklist proposals).
"""
from __future__ import annotations

import pytest

from model_router import verify_checklist_items


TRANSCRIPT = (
    "clinician: Blood pressure is 148 over 92. "
    "clinician: Let's get an ECG and review your lipid profile. "
    "clinician: We should image his chest, then follow up in a week."
)


class TestVerifyChecklistItems:
    def test_verbatim_quote_survives(self) -> None:
        items = [
            {"label": "Order ECG", "supporting_quote": "Let's get an ECG"},
        ]
        assert verify_checklist_items(TRANSCRIPT, items) == items

    def test_case_and_whitespace_insensitive_but_verbatim_anchored(self) -> None:
        items = [
            {"label": "Arrange follow-up", "supporting_quote": "  FOLLOW UP in a week."},
        ]
        assert verify_checklist_items(TRANSCRIPT, items) == items

    def test_fabricated_quote_drops_the_item(self) -> None:
        items = [
            {"label": "Start metformin", "supporting_quote": "start metformin 500mg"},
        ]
        assert verify_checklist_items(TRANSCRIPT, items) == []

    def test_paraphrased_quote_drops_the_item(self) -> None:
        items = [
            {"label": "Cardiology referral", "supporting_quote": "refer the patient to the cardiology service"},
        ]
        assert verify_checklist_items(TRANSCRIPT, items) == []

    def test_mixed_batch_keeps_only_verified(self) -> None:
        items = [
            {"label": "Order ECG", "supporting_quote": "Let's get an ECG"},
            {"label": "Invented", "supporting_quote": "not in transcript at all"},
            {"label": "Order imaging", "supporting_quote": "image his chest"},
        ]
        kept = verify_checklist_items(TRANSCRIPT, items)
        assert [i["label"] for i in kept] == ["Order ECG", "Order imaging"]

    def test_empty_quote_drops_the_item(self) -> None:
        assert verify_checklist_items(TRANSCRIPT, [{"label": "X", "supporting_quote": ""}]) == []


@pytest.mark.asyncio
async def test_generate_checklist_stub_provider_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    import model_router

    monkeypatch.setenv("ORCHESTRATOR_MODEL_PROVIDER", "stub")
    result = await model_router.generate_checklist(TRANSCRIPT)
    assert result == []


@pytest.mark.asyncio
async def test_generate_checklist_verifies_llm_output(monkeypatch: pytest.MonkeyPatch) -> None:
    """End-to-end: model output flows through the gate before returning."""
    import model_router
    import deepseek_client

    monkeypatch.setenv("ORCHESTRATOR_MODEL_PROVIDER", "deepseek")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    async def fake_extract(transcript: str, *, client=None):  # noqa: ANN001
        return [
            {"label": "Order ECG", "supporting_quote": "Let's get an ECG"},
            {"label": "Hallucinated", "supporting_quote": "order an MRI brain"},
        ]

    monkeypatch.setattr(deepseek_client, "extract_checklist", fake_extract)
    result = await model_router.generate_checklist(TRANSCRIPT)
    assert [i["label"] for i in result] == ["Order ECG"]
