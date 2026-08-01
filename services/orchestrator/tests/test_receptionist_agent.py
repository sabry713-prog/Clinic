"""Tests for the AI Receptionist / post-care engine (Sprint 10).

Focus is on the two boundaries that matter operationally: nothing is invented
(intervals and lab prep come from the record or a static table, never the
model), and nothing leaves the building on its own (everything is a draft, and
payloads carry a patient reference rather than a destination address).
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import receptionist_agent  # noqa: E402
from receptionist_agent import (  # noqa: E402
    LAB_PREP_INSTRUCTIONS,
    build_dispatch_payload,
    build_lab_prep_reminders,
    draft_followup_slots,
    generate_care_instructions,
    run_post_care_workflow,
)

# A Wednesday, so slot drafting doesn't collide with the KSA weekend by accident.
NOW = datetime(2026, 7, 22, 8, 0, tzinfo=timezone.utc)

DISCHARGE_ORDER = {
    "diagnosis_display": "Essential (primary) hypertension",
    "medications": [{"display": "Amlodipine 5 mg"}],
    "labs": [{"display": "Lipid profile"}, {"display": "HbA1c"}],
    "follow_up_interval_days": 7,
    "follow_up_department": "Cardiology",
    "activity_restrictions": "No heavy lifting for one week.",
}


@pytest.fixture(autouse=True)
def _fake_prose(monkeypatch):
    async def fake(facts, agent_role, **kwargs):
        return f"[{agent_role}] rephrased"

    monkeypatch.setattr(receptionist_agent, "format_agent_prose", fake)


# ---------------------------------------------------------------- slots
def test_slots_are_drafted_from_the_orders_own_interval():
    slots = draft_followup_slots(DISCHARGE_ORDER, now=NOW)
    assert len(slots) == 3
    # 2026-07-22 + 7 days = 2026-07-29.
    assert all(s["starts_at"].startswith("2026-07-29") for s in slots)
    assert all(s["status"] == "draft" for s in slots)


def test_no_interval_means_no_slots():
    """Choosing a follow-up interval is a clinical decision, not a default."""
    assert draft_followup_slots({**DISCHARGE_ORDER, "follow_up_interval_days": None}) == []


def test_slots_avoid_the_ksa_weekend():
    # +3 days from Wednesday 22 Jul lands on Saturday 25 Jul, which must be skipped.
    slots = draft_followup_slots({**DISCHARGE_ORDER, "follow_up_interval_days": 3}, now=NOW)
    for slot in slots:
        weekday = datetime.fromisoformat(slot["starts_at"].replace("Z", "+00:00")).weekday()
        assert weekday not in (4, 5)


def test_slots_carry_the_department_from_the_order():
    assert draft_followup_slots(DISCHARGE_ORDER, now=NOW)[0]["department"] == "Cardiology"


# ---------------------------------------------------------------- lab prep
def test_lab_prep_comes_from_the_static_table():
    reminders = build_lab_prep_reminders(DISCHARGE_ORDER)
    labs = {r["lab"]: r for r in reminders}
    assert "9-12 hours" in labs["Lipid profile"]["instruction"]
    assert all(r["source"] == "static_reference_table" for r in reminders)


def test_unknown_lab_gets_no_invented_preparation_rule():
    reminders = build_lab_prep_reminders({"labs": [{"display": "Obscure novel assay"}]})
    assert reminders == []


def test_every_static_instruction_is_plain_and_factual():
    """Guards against prep text drifting into clinical advice."""
    for instruction in LAB_PREP_INSTRUCTIONS.values():
        lowered = instruction.lower()
        assert "should" not in lowered and "recommend" not in lowered


# ---------------------------------------------------------------- instructions
async def test_care_instructions_return_their_source_facts():
    result = await generate_care_instructions(DISCHARGE_ORDER)
    assert result["source_facts"]["diagnosis"] == "Essential (primary) hypertension"
    assert result["source_facts"]["medications"] == ["Amlodipine 5 mg"]


async def test_care_instructions_are_flagged_for_clinician_review():
    """Model-written clinical text must never be sendable unreviewed."""
    result = await generate_care_instructions(DISCHARGE_ORDER)
    assert result["requires_clinician_review"] is True


async def test_empty_order_produces_no_instruction_text():
    result = await generate_care_instructions({})
    assert result["text"] == ""


# ---------------------------------------------------------------- payloads
def test_payload_carries_a_patient_reference_not_an_address():
    """The half of the original connector control that is deliberately kept:
    the caller cannot name a destination."""
    payload = build_dispatch_payload("pat-1", "sms", "hello", kind="lab_prep")
    assert payload["patient_id"] == "pat-1"
    assert "phone" not in payload and "to" not in payload and "address" not in payload


def test_payload_is_always_a_draft():
    payload = build_dispatch_payload("pat-1", "whatsapp", "hello", kind="care_instructions")
    assert payload["status"] == "draft"
    assert payload["requires_clinician_review"] is True


def test_unsupported_channel_is_rejected():
    with pytest.raises(ValueError):
        build_dispatch_payload("pat-1", "carrier_pigeon", "hello", kind="lab_prep")


# ---------------------------------------------------------------- workflow
async def test_workflow_assembles_the_full_package():
    result = await run_post_care_workflow("pat-1", DISCHARGE_ORDER, now=NOW)
    assert len(result["followup_slots"]) == 3
    assert len(result["lab_prep_reminders"]) == 2
    assert result["care_instructions"]["text"]
    # one care-instruction message + one per lab prep reminder
    assert len(result["dispatch_payloads"]) == 3


async def test_workflow_sends_nothing_and_books_nothing():
    result = await run_post_care_workflow("pat-1", DISCHARGE_ORDER, now=NOW)
    assert result["requires_clinician_review"] is True
    assert all(p["status"] == "draft" for p in result["dispatch_payloads"])
    assert all(s["status"] == "draft" for s in result["followup_slots"])
    assert "no message has been sent" in result["disclaimer"]


async def test_empty_discharge_order_produces_no_outreach():
    result = await run_post_care_workflow("pat-1", {}, now=NOW)
    assert result["followup_slots"] == []
    assert result["lab_prep_reminders"] == []
    assert result["dispatch_payloads"] == []


# ---------------------------------------------------------------- LLM outage
async def test_care_instructions_degrade_when_the_model_is_unavailable(monkeypatch):
    """A missing DEEPSEEK_API_KEY must not blank the whole package."""
    async def boom(facts, agent_role, **kwargs):
        raise RuntimeError("DEEPSEEK_API_KEY is not set.")

    monkeypatch.setattr(receptionist_agent, "format_agent_prose", boom)
    result = await generate_care_instructions(DISCHARGE_ORDER)
    assert result["text"] == ""
    assert result["generation_error"]
    # Source facts still travel, so a reviewer can write the text by hand.
    assert result["source_facts"]["diagnosis"] == "Essential (primary) hypertension"


async def test_workflow_still_returns_slots_and_lab_prep_without_the_model(monkeypatch):
    """The deterministic half of the package survives an LLM outage."""
    async def boom(facts, agent_role, **kwargs):
        raise RuntimeError("DEEPSEEK_API_KEY is not set.")

    monkeypatch.setattr(receptionist_agent, "format_agent_prose", boom)
    result = await run_post_care_workflow("pat-1", DISCHARGE_ORDER, now=NOW)

    assert len(result["followup_slots"]) == 3
    assert len(result["lab_prep_reminders"]) == 2
    # Only the care-instruction message is lost; lab-prep messages remain.
    assert all(p["kind"] == "lab_prep" for p in result["dispatch_payloads"])
