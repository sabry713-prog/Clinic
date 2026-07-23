"""phi-guard — data-residency enforcement for outbound model calls.

Prevents patient data from leaving the Kingdom by default (CLAUDE.md §7 /
PDPL). Every provider that can target a non-local endpoint must route its
prompts through `guard_outbound` before making the request.
"""

from .deidentify import DeidentificationResult, Deidentifier
from .policy import (
    ALLOW_ACK_PHRASE,
    EgressPolicy,
    GuardDecision,
    PhiEgressBlocked,
    current_policy,
    guard_outbound,
)
from .residency import Residency, classify_endpoint, in_kingdom_allowlist

__all__ = [
    "ALLOW_ACK_PHRASE",
    "DeidentificationResult",
    "Deidentifier",
    "EgressPolicy",
    "GuardDecision",
    "PhiEgressBlocked",
    "Residency",
    "classify_endpoint",
    "current_policy",
    "guard_outbound",
    "in_kingdom_allowlist",
]
