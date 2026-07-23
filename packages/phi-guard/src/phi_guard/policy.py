"""PHI egress policy — the single decision point for outbound model calls.

Policy is set by PHI_EGRESS_POLICY:

    block       (default) PHI-bearing prompts may never go to an external
                endpoint. The call is refused with PhiEgressBlocked.
    deidentify  Direct identifiers are stripped before the call and restored
                in the reply. Residual re-identification risk remains.
    allow       No protection. Requires PHI_EGRESS_ALLOW_ACK to be set to the
                exact acknowledgement string, so it cannot be enabled by a
                stray env var alone.

In-Kingdom endpoints are never restricted — the policy only governs data
leaving the trust boundary.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum

from .deidentify import Deidentifier, DeidentificationResult
from .residency import Residency, classify_endpoint

__all__ = [
    "EgressPolicy", "PhiEgressBlocked", "GuardDecision", "guard_outbound",
    "ALLOW_ACK_PHRASE",
]

ALLOW_ACK_PHRASE = "I ACCEPT PHI LEAVING THE KINGDOM"


class EgressPolicy(str, Enum):
    BLOCK = "block"
    DEIDENTIFY = "deidentify"
    ALLOW = "allow"


class PhiEgressBlocked(RuntimeError):
    """Raised when policy forbids sending PHI to an external endpoint."""


@dataclass
class GuardDecision:
    """Outcome of the guard for one outbound call."""
    residency: Residency
    policy: EgressPolicy
    system_prompt: str
    user_prompt: str
    redaction_count: int = 0
    _deid: DeidentificationResult | None = None

    def restore(self, model_output: str) -> str:
        """Re-insert original identifiers into the model reply (no-op unless
        the prompt was de-identified)."""
        return self._deid.restore(model_output) if self._deid else model_output


def current_policy() -> EgressPolicy:
    raw = os.environ.get("PHI_EGRESS_POLICY", EgressPolicy.BLOCK.value).strip().lower()
    try:
        return EgressPolicy(raw)
    except ValueError:
        # Unknown value must not silently weaken protection.
        return EgressPolicy.BLOCK


def guard_outbound(
    endpoint_url: str | None,
    system_prompt: str,
    user_prompt: str,
    *,
    contains_phi: bool = True,
    patient_names: list[str] | None = None,
) -> GuardDecision:
    """Apply the egress policy to one outbound model call.

    Returns the (possibly rewritten) prompts to send. Raises PhiEgressBlocked
    when policy forbids the call.
    """
    residency = classify_endpoint(endpoint_url)
    policy = current_policy()

    # Inside the trust boundary, or nothing sensitive to protect.
    if residency is Residency.IN_KINGDOM or not contains_phi:
        return GuardDecision(residency, policy, system_prompt, user_prompt)

    if policy is EgressPolicy.ALLOW:
        if os.environ.get("PHI_EGRESS_ALLOW_ACK", "").strip() != ALLOW_ACK_PHRASE:
            raise PhiEgressBlocked(
                "PHI_EGRESS_POLICY=allow requires PHI_EGRESS_ALLOW_ACK to be set to "
                f'"{ALLOW_ACK_PHRASE}". Refusing to send PHI to {endpoint_url!r}.'
            )
        return GuardDecision(residency, policy, system_prompt, user_prompt)

    if policy is EgressPolicy.DEIDENTIFY:
        deid = Deidentifier(extra_names=patient_names)
        # The system prompt is static instruction text; only the user prompt
        # carries record content.
        scrubbed = deid.scrub(user_prompt)
        return GuardDecision(
            residency=residency,
            policy=policy,
            system_prompt=system_prompt,
            user_prompt=scrubbed.text,
            redaction_count=scrubbed.redaction_count,
            _deid=scrubbed,
        )

    raise PhiEgressBlocked(
        f"Refusing to send patient data to external endpoint {endpoint_url!r}. "
        "PHI_EGRESS_POLICY=block (default). Use an in-Kingdom endpoint, or set "
        "PHI_EGRESS_POLICY=deidentify to strip direct identifiers first."
    )
