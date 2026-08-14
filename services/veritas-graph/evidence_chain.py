"""Symbolic evidence chain builder for the NSCRE (services/veritas-graph/nscre_engine.py).

Every deduction NSCRE makes traces back to the exact graph nodes/edges that
produced it -- this module turns that trail into a structured payload for the
UI's "hover-to-source" / "Show Reasoning" feature, plus a human-readable
rendering in the shape the Sprint 7 task itself specified:

    Patient(mrn=102) -> LabResult(eGFR=28) -> Contraindication(drug=Metformin, condition=eGFR < 30) -> Rule(flag=CRITICAL_OVERRIDE)

The task's own example mixes positional notation ("Contraindication(Metformin,
"eGFR < 30")") with key=value notation ("Rule(Flag=...)"). This module
standardizes on key=value throughout for consistent, unambiguous rendering --
a formatting normalization, not a change to the underlying facts.

S4.1 adds the terminal cutaway: chains can also carry the exact Cypher
statements whose results produced the deduction (`cypher`), so the UI can
show "the query that was run" alongside "the facts it returned". The query
text is passed in by the caller from the same module-level constant the
engine executes -- it is never reconstructed or paraphrased here, so the
displayed query and the executed query cannot drift apart.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class EvidenceStep:
    """One hop in the reasoning chain: a graph node (or a symbolic rule
    outcome) and the properties that matter for this deduction."""

    node_type: str
    properties: dict[str, Any] = field(default_factory=dict)

    def render(self) -> str:
        props = ", ".join(f"{k}={v}" for k, v in self.properties.items())
        return f"{self.node_type}({props})"


def build_evidence_chain(
    steps: list[EvidenceStep],
    cypher: list[str] | None = None,
) -> dict[str, Any]:
    """Return the structured step list (for the UI), a rendered arrow-chain
    string (for logs/audit display), and optionally the exact Cypher
    statements executed to produce the deduction -- all from the same inputs,
    so the representations can never drift apart.

    `cypher` entries are verbatim query texts supplied by the caller from the
    same module-level constants the engine runs; omitted when a deduction had
    no graph query of its own.
    """
    chain: dict[str, Any] = {
        "steps": [{"node_type": s.node_type, "properties": s.properties} for s in steps],
        "rendered": " -> ".join(s.render() for s in steps),
    }
    if cypher:
        chain["cypher"] = list(cypher)
    return chain
