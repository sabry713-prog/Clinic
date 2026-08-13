"""Selective simulation substrate -- typed reader for the SIM_* env keys.

See the block comment above SIM_NPHIES_CONNECTOR in .env.example for the
full picture. Short version: the real LLM and real local ASR run by
default; SimConfig only documents, in a typed way, which external-
integration seams this environment is running in stub mode. It does not
gate any real-integration code path by itself -- ORCHESTRATOR_MODEL_PROVIDER
(read directly by model_router.py) is the actual switch for this service.

Note on scope: none of the four SIM_* keys currently has a seam inside this
service. SIM_NPHIES_CONNECTOR belongs to services/nphies-engine (and the
pre-existing, untouched NPHIES_CONNECTOR in apps/core); SIM_HIS_FEED and
SIM_SMS_OTP belong to apps/core (his-connector, patient-engagement). This
dataclass is still provided here -- same shape as the other two Python
services -- so any orchestrator code that wants to know the demo posture
(e.g. a future status endpoint) can read it without reaching into os.environ
directly (05-coding-standards.md: "No global state. Inject dependencies").
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

SimMode = Literal["stub", "live"]


@dataclass(frozen=True)
class SimConfig:
    sim_nphies_connector: SimMode = "stub"
    sim_his_feed: SimMode = "stub"
    sim_sms_otp: SimMode = "stub"
    sim_default: bool = True


def _parse_mode(raw: str | None) -> SimMode:
    return "live" if (raw or "").strip().lower() == "live" else "stub"


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    return raw.strip().lower() == "true"


def get_sim_config(env: dict[str, str] | None = None) -> SimConfig:
    """Pure given `env`; defaults to the real process environment."""
    source = env if env is not None else os.environ
    return SimConfig(
        sim_nphies_connector=_parse_mode(source.get("SIM_NPHIES_CONNECTOR")),
        sim_his_feed=_parse_mode(source.get("SIM_HIS_FEED")),
        sim_sms_otp=_parse_mode(source.get("SIM_SMS_OTP")),
        sim_default=_parse_bool(source.get("SIM_DEFAULT"), True),
    )
