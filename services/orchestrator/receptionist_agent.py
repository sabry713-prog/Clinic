"""AI Receptionist & post-care automation.

Parses finalized discharge orders and drafts the post-encounter package:
follow-up appointment slots, plain-language care instructions and lab-prep
reminders, and SMS/WhatsApp notification payloads.

*** BOUNDARY NOTE -- read before wiring this to a real messaging provider ***

`apps/core/src/patient-engagement/reminder-connector.service.ts` enforces a
deliberate control on patient messaging:

    "reminder text is always a FIXED, factual template (date/time/appointment
     type/location only) -- never a reason-for-visit or any clinical detail,
     and never model-generated. ... the caller supplies only a reference, never
     message content or a raw phone/email, which is what stops this endpoint
     being usable to message arbitrary numbers."

This module produces the opposite: model-generated, clinically-specific patient
text carried as a message body. That conflict was raised explicitly and the
requester chose to build it as specified. It is recorded here rather than
quietly absorbed, because two properties of the original control do not survive
this change and someone will need them back before this ships to real patients:

  1. Model-written clinical text can reach a patient. Every draft here is
     therefore marked `requires_clinician_review: True` and this module never
     dispatches anything -- `build_dispatch_payload()` returns a payload, and a
     human presses send in the UI.
  2. A free-text body makes the send path capable of carrying arbitrary
     content. This module never accepts a destination address: payloads carry a
     `patient_id` reference and the connector re-derives the real contact
     server-side, which is the half of the original control worth keeping and
     which is kept.

The existing template-based connector is left untouched, so nothing that
already relies on that guarantee is weakened by this file.

Facts still come from the record, not the model: appointment timing comes from
`follow_up_interval_days` on the discharge order, lab prep comes from a static
reference table, and DeepSeek only rephrases text that is handed to it.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import structlog

sys.path.insert(0, str(Path(__file__).resolve().parent))

from model_router import format_agent_prose  # noqa: E402

logger = structlog.get_logger()

__all__ = [
    "LAB_PREP_INSTRUCTIONS",
    "draft_followup_slots",
    "build_lab_prep_reminders",
    "generate_care_instructions",
    "build_dispatch_payload",
    "run_post_care_workflow",
]

# Static, reviewable reference data -- deliberately NOT model-generated. Keyed
# by lowercase lab/order name fragment. Anything not listed here yields no prep
# instruction rather than an invented one.
LAB_PREP_INSTRUCTIONS: dict[str, str] = {
    "lipid": "Do not eat or drink anything except water for 9-12 hours before this test.",
    "glucose": "Do not eat or drink anything except water for 8 hours before this test.",
    "hba1c": "No fasting is required for this test.",
    "cbc": "No fasting is required for this test.",
    "creatinine": "No fasting is required for this test.",
    "electrolyte": "No fasting is required for this test.",
    "thyroid": "No fasting is required for this test. Take medication as usual unless told otherwise.",
}

# Clinic hours used to place draft slots. Slots are DRAFTS only -- nothing here
# reserves capacity; the booking system remains the source of truth.
_SLOT_HOURS = (9, 11, 14)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def draft_followup_slots(
    discharge_order: dict[str, Any],
    *,
    count: int = 3,
    now: Optional[datetime] = None,
) -> list[dict[str, Any]]:
    """Draft candidate follow-up slots from the order's own interval.

    `follow_up_interval_days` comes from the finalized discharge order. When it
    is absent, no slots are drafted -- the interval is a clinical decision and
    this function will not pick one.
    """
    interval = discharge_order.get("follow_up_interval_days")
    if not interval:
        return []

    base = (now or _now()) + timedelta(days=int(interval))
    slots: list[dict[str, Any]] = []
    day_offset = 0
    while len(slots) < count:
        day = base + timedelta(days=day_offset)
        # Skip Friday/Saturday (the KSA weekend).
        if day.weekday() not in (4, 5):
            for hour in _SLOT_HOURS:
                if len(slots) >= count:
                    break
                slot = day.replace(hour=hour, minute=0, second=0, microsecond=0)
                slots.append(
                    {
                        "starts_at": slot.isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "department": discharge_order.get("follow_up_department"),
                        "appointment_type": discharge_order.get("follow_up_type", "follow-up"),
                        "status": "draft",
                    }
                )
        day_offset += 1
        if day_offset > 14:  # guard against a pathological interval
            break
    return slots


def build_lab_prep_reminders(discharge_order: dict[str, Any]) -> list[dict[str, Any]]:
    """Map ordered labs onto prep instructions from the static table above.

    An order with no matching entry produces nothing -- never a guessed
    preparation rule.
    """
    reminders: list[dict[str, Any]] = []
    for lab in discharge_order.get("labs", []) or []:
        name = str(lab.get("display", "")).lower()
        for fragment, instruction in LAB_PREP_INSTRUCTIONS.items():
            if fragment in name:
                reminders.append(
                    {
                        "lab": lab.get("display"),
                        "instruction": instruction,
                        "source": "static_reference_table",
                    }
                )
                break
    return reminders


async def generate_care_instructions(
    discharge_order: dict[str, Any],
    *,
    patient_id: Optional[str] = None,
    client: Optional[Any] = None,
) -> dict[str, Any]:
    """Plain-language care instructions for the patient.

    The model is handed only what the discharge order already states and asked
    to rephrase it. The structured `source_facts` are returned alongside the
    prose so a reviewer (and the tests) can check the text against the record
    rather than against the model.
    """
    source_facts = {
        "diagnosis": discharge_order.get("diagnosis_display"),
        "medications": [m.get("display") for m in discharge_order.get("medications", []) or []],
        "labs": [l.get("display") for l in discharge_order.get("labs", []) or []],
        "follow_up_interval_days": discharge_order.get("follow_up_interval_days"),
        "activity_restrictions": discharge_order.get("activity_restrictions"),
    }
    has_content = any(v for v in source_facts.values())
    text = ""
    generation_error: Optional[str] = None
    if has_content:
        try:
            text = await format_agent_prose(
                source_facts, agent_role="Receptionist", patient_id=patient_id, client=client
            )
        except Exception as exc:  # noqa: BLE001
            # The prose is the ONLY part of the post-care package that needs a
            # model. Follow-up slots and lab-prep reminders are computed
            # deterministically, so an unavailable or misconfigured DeepSeek
            # must degrade this one field rather than fail the whole workflow
            # and leave the clinician with nothing.
            logger.error("care_instructions_generation_failed", error=str(exc))
            generation_error = "Care instructions could not be drafted; the rest of the package is unaffected."

    return {
        "text": text,
        "source_facts": source_facts,
        # Model-written clinical text: a clinician signs off before it can be sent.
        "requires_clinician_review": True,
        "generation_error": generation_error,
    }


def build_dispatch_payload(
    patient_id: str,
    channel: str,
    body: str,
    *,
    kind: str,
    appointment_ref: Optional[str] = None,
) -> dict[str, Any]:
    """Build one SMS/WhatsApp payload.

    Deliberately carries `patient_id`, never a phone number or address -- the
    connector re-derives the real contact server-side from confirmed records,
    which keeps this from being usable to message an arbitrary destination.

    Returns a payload only. Nothing here sends: `status` is always `draft`, and
    dispatch is a separate, human-initiated action in the UI.
    """
    if channel not in ("sms", "whatsapp"):
        raise ValueError(f"unsupported channel: {channel!r}")
    return {
        "patient_id": patient_id,
        "channel": channel,
        "kind": kind,
        "body": body,
        "appointment_ref": appointment_ref,
        "status": "draft",
        "requires_clinician_review": True,
    }


async def run_post_care_workflow(
    patient_id: str,
    discharge_order: dict[str, Any],
    *,
    client: Optional[Any] = None,
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Full post-care package for one finalized discharge order.

    Everything returned is a DRAFT for clinician review. This function performs
    no booking and sends no message.
    """
    slots = draft_followup_slots(discharge_order, now=now)
    lab_prep = build_lab_prep_reminders(discharge_order)
    instructions = await generate_care_instructions(discharge_order, patient_id=patient_id, client=client)

    payloads: list[dict[str, Any]] = []
    if instructions["text"]:
        payloads.append(
            build_dispatch_payload(
                patient_id, "whatsapp", instructions["text"], kind="care_instructions"
            )
        )
    for reminder in lab_prep:
        payloads.append(
            build_dispatch_payload(
                patient_id,
                "sms",
                f"{reminder['lab']}: {reminder['instruction']}",
                kind="lab_prep",
            )
        )

    logger.info(
        "post_care_workflow_drafted",
        patient_id=patient_id,
        slot_count=len(slots),
        lab_prep_count=len(lab_prep),
        payload_count=len(payloads),
    )

    return {
        "patient_id": patient_id,
        "followup_slots": slots,
        "lab_prep_reminders": lab_prep,
        "care_instructions": instructions,
        "dispatch_payloads": payloads,
        "requires_clinician_review": True,
        "disclaimer": (
            "All items are drafts for clinician review. No appointment has been booked and "
            "no message has been sent."
        ),
    }
