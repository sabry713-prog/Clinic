"""Endpoint data-residency classification.

Decides whether a model endpoint is inside the trust boundary (on-premise /
in-Kingdom) or outside it (public cloud). Everything that is not provably
inside is treated as OUTSIDE — fail closed, never fail open.
"""
from __future__ import annotations

import ipaddress
import os
from enum import Enum
from urllib.parse import urlparse

__all__ = ["Residency", "classify_endpoint", "in_kingdom_allowlist"]


class Residency(str, Enum):
    IN_KINGDOM = "in_kingdom"
    EXTERNAL = "external"


# Hosts that are unambiguously on the local machine / on-prem network.
_LOCAL_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"})

# Suffixes for in-cluster / on-prem service discovery.
_LOCAL_SUFFIXES = (".local", ".internal", ".svc", ".svc.cluster.local", ".lan")


def in_kingdom_allowlist() -> frozenset[str]:
    """Extra hostnames the operator declares in-Kingdom.

    Set PHI_INKINGDOM_HOSTS as a comma-separated list, e.g.
    "llm.hospital.sa,10.20.0.5". Use only for endpoints contractually and
    physically inside the Kingdom.
    """
    raw = os.environ.get("PHI_INKINGDOM_HOSTS", "")
    return frozenset(h.strip().lower() for h in raw.split(",") if h.strip())


def _is_private_ip(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback or ip.is_link_local


def classify_endpoint(url: str | None) -> Residency:
    """Classify a model endpoint URL.

    Anything not recognised as local, private-network, or explicitly
    allowlisted is EXTERNAL — including empty/malformed URLs.
    """
    if not url:
        return Residency.EXTERNAL

    parsed = urlparse(url if "//" in url else f"//{url}")
    host = (parsed.hostname or "").lower()
    if not host:
        return Residency.EXTERNAL

    if host in _LOCAL_HOSTNAMES:
        return Residency.IN_KINGDOM
    if _is_private_ip(host):
        return Residency.IN_KINGDOM
    if any(host.endswith(sfx) for sfx in _LOCAL_SUFFIXES):
        return Residency.IN_KINGDOM
    if host in in_kingdom_allowlist():
        return Residency.IN_KINGDOM

    return Residency.EXTERNAL
