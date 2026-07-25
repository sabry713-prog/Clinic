"""Inter-agent message bus -- event-driven routing between AI Team agents.

Implements the handoff chain specified for Sprint 10:

    NSCRE critical finding
        -> ConsultantAgent   escalates it
        -> PharmacistAgent   screens alternative medications
        -> NphiesAgent       re-verifies coverage for what survived screening
        -> ScribeAgent       drafts a Plan-section update

Every hop emits an `agent_handoff` event so the Right Pane activity stream can
render the chain as it happens.

*** GROUNDING INVARIANT (CLAUDE.md principle 1) ***
No hop invents a clinical fact. Each one calls NSCRE and forwards what the
graph returned:

  - critical findings      NSCRE /evaluate-encounter
  - alternatives           NSCRE /alternative-candidates  (Sprint 10, Module D)
  - coverage               NSCRE /check-order
  - plan prose             DeepSeek, formatting ONLY, over facts already fixed
                           by the hops above

`evidence_chain` objects are copied through byte-for-byte, never regenerated --
the same invariant `agent_handlers.py` established in Sprint 8, which is what
lets the tests assert grounding by object equality instead of by judgement.

*** SCOPE NOTE -- the Pharmacist hop ***
The spec describes this hop as "auto-evaluates alternative medications". It was
confirmed before implementation that alternatives must be GRAPH-DERIVED ONLY.
So this hop reports drugs that PASSED deterministic screening (no
contraindication edge against the patient's current medications, no renal dose
rule violated by their latest eGFR) and does NOT assert that any of them should
be substituted. "Nothing in the graph contradicts this drug" is a fact the graph
can support; "switch the patient to it" is a prescribing decision, and no agent
here makes it. The payload field is deliberately named `screened_candidates`,
and the Scribe hop below carries that framing into the note.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import httpx
import structlog

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepseek_client import format_agent_prose  # noqa: E402

logger = structlog.get_logger()

NSCRE_API_URL = os.environ.get("NSCRE_API_URL", "http://localhost:5004")

# Event types on the bus.
EVENT_CRITICAL_FINDING = "nscre.critical_finding"
EVENT_CONSULTANT_ESCALATION = "consultant.escalation"
EVENT_ALTERNATIVES_SCREENED = "pharmacist.alternatives_screened"
EVENT_COVERAGE_VERIFIED = "nphies.coverage_verified"
EVENT_PLAN_UPDATED = "scribe.plan_updated"

# What the UI activity stream subscribes to.
HANDOFF_EVENT = "agent_handoff"

__all__ = [
    "AgentEvent",
    "AgentBus",
    "EVENT_CRITICAL_FINDING",
    "EVENT_CONSULTANT_ESCALATION",
    "EVENT_ALTERNATIVES_SCREENED",
    "EVENT_COVERAGE_VERIFIED",
    "EVENT_PLAN_UPDATED",
    "HANDOFF_EVENT",
    "build_default_bus",
    "detect_critical_findings",
    "run_critical_finding_chain",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@dataclass
class AgentEvent:
    """One structured task handed from one agent to the next."""

    event_type: str
    patient_id: str
    source_agent: str
    target_agent: str
    payload: dict[str, Any] = field(default_factory=dict)
    # Ties every hop of one chain together so the UI can group them.
    correlation_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    sequence: int = 0
    at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event": HANDOFF_EVENT,
            "event_type": self.event_type,
            "patient_id": self.patient_id,
            "source_agent": self.source_agent,
            "target_agent": self.target_agent,
            "payload": self.payload,
            "correlation_id": self.correlation_id,
            "sequence": self.sequence,
            "at": self.at,
        }


Handler = Callable[["AgentBus", AgentEvent], Awaitable[Optional[AgentEvent]]]


class AgentBus:
    """Async event router.

    A handler may return a follow-on `AgentEvent`, which the bus publishes in
    turn -- that is what makes the chain a chain rather than four separate
    calls. `max_hops` bounds it so a mis-registered handler cannot loop forever.
    """

    def __init__(self, *, max_hops: int = 12) -> None:
        self._handlers: dict[str, list[Handler]] = defaultdict(list)
        self._history: list[AgentEvent] = []
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self.max_hops = max_hops

    # -- registration --
    def on(self, event_type: str, handler: Handler) -> None:
        self._handlers[event_type].append(handler)

    # -- UI fan-out --
    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=128)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)

    def _fan_out(self, event: AgentEvent) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event.to_dict())
            except asyncio.QueueFull:
                # A stalled reader must never stall the chain.
                logger.warning("agent_handoff_dropped_slow_subscriber")

    @property
    def history(self) -> list[AgentEvent]:
        return list(self._history)

    # -- routing --
    async def publish(self, event: AgentEvent) -> list[AgentEvent]:
        """Publish an event and follow the chain it triggers.

        Returns every event emitted, in order, including the one passed in.
        """
        emitted: list[AgentEvent] = []
        queue: list[AgentEvent] = [event]
        hops = 0

        while queue:
            current = queue.pop(0)
            hops += 1
            if hops > self.max_hops:
                logger.error(
                    "agent_bus_max_hops_exceeded",
                    correlation_id=current.correlation_id,
                    max_hops=self.max_hops,
                )
                break

            current.sequence = len(emitted)
            self._history.append(current)
            emitted.append(current)
            self._fan_out(current)
            logger.info(
                "agent_handoff",
                event_type=current.event_type,
                source=current.source_agent,
                target=current.target_agent,
                correlation_id=current.correlation_id,
            )

            for handler in self._handlers.get(current.event_type, []):
                try:
                    follow_on = await handler(self, current)
                except Exception as exc:  # noqa: BLE001
                    # One broken hop must not silently swallow the chain --
                    # emit a visible error event instead of ending quietly.
                    logger.error(
                        "agent_handler_failed",
                        event_type=current.event_type,
                        error=str(exc),
                    )
                    err = AgentEvent(
                        event_type=f"{current.event_type}.failed",
                        patient_id=current.patient_id,
                        source_agent=current.target_agent,
                        target_agent="system",
                        payload={"error": str(exc), "failed_step": current.event_type},
                        correlation_id=current.correlation_id,
                    )
                    err.sequence = len(emitted)
                    self._history.append(err)
                    emitted.append(err)
                    self._fan_out(err)
                    continue
                if follow_on is not None:
                    follow_on.correlation_id = current.correlation_id
                    queue.append(follow_on)

        return emitted


# ---------------------------------------------------------------- NSCRE calls
async def _nscre_post(path: str, body: dict[str, Any], client: httpx.AsyncClient) -> dict[str, Any]:
    resp = await client.post(f"{NSCRE_API_URL.rstrip('/')}{path}", json=body)
    resp.raise_for_status()
    return resp.json()


def detect_critical_findings(evaluation: dict[str, Any]) -> list[dict[str, Any]]:
    """Pick the findings that warrant escalation, using only flags NSCRE set.

    Severity/flag values are read from the graph payload -- this function never
    decides that something is critical on its own.
    """
    findings: list[dict[str, Any]] = []

    for violation in evaluation.get("dose_safety", []) or []:
        if str(violation.get("flag", "")).upper() == "CRITICAL_OVERRIDE":
            findings.append(
                {
                    "kind": "dose_safety",
                    "medication": violation.get("medication"),
                    "flag": violation.get("flag"),
                    "rationale": violation.get("rationale"),
                    "evidence_chain": violation.get("evidence_chain"),
                }
            )

    for interaction in evaluation.get("drug_interactions", []) or []:
        if str(interaction.get("severity", "")).lower() == "severe":
            findings.append(
                {
                    "kind": "drug_interaction",
                    "medication": interaction.get("drug_a"),
                    "interacting_with": interaction.get("drug_b"),
                    "severity": interaction.get("severity"),
                    "rationale": interaction.get("rationale"),
                    "evidence_chain": interaction.get("evidence_chain"),
                }
            )

    return findings


# ---------------------------------------------------------------- agent hops
async def consultant_hop(bus: AgentBus, event: AgentEvent) -> Optional[AgentEvent]:
    """Consultant receives the critical finding and escalates it to Pharmacy.

    It forwards the finding untouched -- including its evidence chain -- rather
    than restating it, so nothing can drift between hops.
    """
    finding = event.payload.get("finding", {})
    return AgentEvent(
        event_type=EVENT_CONSULTANT_ESCALATION,
        patient_id=event.patient_id,
        source_agent="consultant",
        target_agent="pharmacist",
        payload={
            "reason": "critical_finding_escalated",
            "finding": finding,
            "evidence_chain": finding.get("evidence_chain"),
        },
    )


def _make_pharmacist_hop(client: httpx.AsyncClient) -> Handler:
    async def pharmacist_hop(bus: AgentBus, event: AgentEvent) -> Optional[AgentEvent]:
        """Screens alternatives for the flagged drug -- graph-derived only."""
        finding = event.payload.get("finding", {})
        flagged = finding.get("medication")
        if not flagged:
            return None

        result = await _nscre_post(
            "/api/v1/nscre/alternative-candidates",
            {"patient_id": event.patient_id, "flagged_drug_key": str(flagged).lower(), "limit": 5},
            client,
        )
        return AgentEvent(
            event_type=EVENT_ALTERNATIVES_SCREENED,
            patient_id=event.patient_id,
            source_agent="pharmacist",
            target_agent="nphies",
            payload={
                "flagged_medication": flagged,
                # Named for what it is: passed screening, not recommended.
                "screened_candidates": result.get("screened_candidates", []),
                "rejected_candidates": result.get("rejected_candidates", []),
                "disclaimer": result.get("disclaimer"),
                "finding": finding,
            },
        )

    return pharmacist_hop


def _make_nphies_hop(client: httpx.AsyncClient) -> Handler:
    async def nphies_hop(bus: AgentBus, event: AgentEvent) -> Optional[AgentEvent]:
        """Re-verifies coverage for each screened candidate.

        A candidate whose necessity cannot be established is reported as
        `unknown`, never optimistically as covered.
        """
        candidates = event.payload.get("screened_candidates", []) or []
        coverage: list[dict[str, Any]] = []

        for cand in candidates:
            key = cand.get("medication_key") or cand.get("medication")
            verdict: dict[str, Any] = {
                "medication": cand.get("medication"),
                "status": "unknown",
                "detail": "No NPHIES necessity rule matched this candidate.",
            }
            try:
                checked = await _nscre_post(
                    "/api/v1/nscre/check-order",
                    {"patient_id": event.patient_id, "necessity_code": key},
                    client,
                )
                necessity = checked.get("necessity")
                if necessity:
                    verdict = {
                        "medication": cand.get("medication"),
                        "status": necessity.get("status", "unknown"),
                        "pre_auth_required": necessity.get("pre_auth_required"),
                        "suggested_codes": necessity.get("suggested_codes", []),
                        "detail": None,
                    }
            except httpx.HTTPError as exc:
                verdict = {
                    "medication": cand.get("medication"),
                    "status": "unknown",
                    "detail": f"Coverage check unavailable: {exc}",
                }
            coverage.append(verdict)

        return AgentEvent(
            event_type=EVENT_COVERAGE_VERIFIED,
            patient_id=event.patient_id,
            source_agent="nphies",
            target_agent="scribe",
            payload={
                "flagged_medication": event.payload.get("flagged_medication"),
                "screened_candidates": candidates,
                "coverage": coverage,
                "finding": event.payload.get("finding"),
            },
        )

    return nphies_hop


async def scribe_hop(bus: AgentBus, event: AgentEvent) -> Optional[AgentEvent]:
    """Drafts a Plan-section update.

    DeepSeek is given the already-fixed facts and asked only to phrase them.
    The structured `plan_facts` travel alongside the prose so the UI (and the
    tests) can verify the note against the graph rather than against the model.
    The draft is never auto-applied -- `applied: False` is returned and the
    clinician edits the Plan field themselves.
    """
    finding = event.payload.get("finding", {}) or {}
    plan_facts = {
        "flagged_medication": event.payload.get("flagged_medication"),
        "finding_kind": finding.get("kind"),
        "finding_rationale": finding.get("rationale"),
        "screened_candidates": [
            c.get("medication") for c in event.payload.get("screened_candidates", []) or []
        ],
        "coverage": event.payload.get("coverage", []),
    }

    prose = ""
    if plan_facts["flagged_medication"]:
        prose = await format_agent_prose(plan_facts, agent_role="Scribe")

    return AgentEvent(
        event_type=EVENT_PLAN_UPDATED,
        patient_id=event.patient_id,
        source_agent="scribe",
        target_agent="clinician",
        payload={
            "section": "plan",
            "draft_text": prose,
            "plan_facts": plan_facts,
            # Human-in-the-loop: the agent drafts, the clinician commits.
            "applied": False,
            "evidence_chain": finding.get("evidence_chain"),
        },
    )


# ---------------------------------------------------------------- assembly
def build_default_bus(client: httpx.AsyncClient) -> AgentBus:
    """Wire the specified chain onto a fresh bus."""
    bus = AgentBus()
    bus.on(EVENT_CRITICAL_FINDING, consultant_hop)
    bus.on(EVENT_CONSULTANT_ESCALATION, _make_pharmacist_hop(client))
    bus.on(EVENT_ALTERNATIVES_SCREENED, _make_nphies_hop(client))
    bus.on(EVENT_COVERAGE_VERIFIED, scribe_hop)
    return bus


async def run_critical_finding_chain(
    patient_id: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
    bus: Optional[AgentBus] = None,
) -> list[dict[str, Any]]:
    """Entry point: evaluate the encounter and run the chain for each critical
    finding NSCRE reports. Returns every handoff emitted, in order.

    No critical finding means no chain -- agents are never invited to
    manufacture an escalation when the graph found nothing.
    """
    owns_client = client is None
    client = client or httpx.AsyncClient(timeout=30.0)
    try:
        evaluation = await _nscre_post(
            "/api/v1/nscre/evaluate-encounter", {"patient_id": patient_id}, client
        )
        findings = detect_critical_findings(evaluation)
        if not findings:
            logger.info("agent_bus_no_critical_findings", patient_id=patient_id)
            return []

        active_bus = bus or build_default_bus(client)
        emitted: list[dict[str, Any]] = []
        for finding in findings:
            events = await active_bus.publish(
                AgentEvent(
                    event_type=EVENT_CRITICAL_FINDING,
                    patient_id=patient_id,
                    source_agent="nscre",
                    target_agent="consultant",
                    payload={"finding": finding, "evidence_chain": finding.get("evidence_chain")},
                )
            )
            emitted.extend(e.to_dict() for e in events)
        return emitted
    finally:
        if owns_client:
            await client.aclose()
