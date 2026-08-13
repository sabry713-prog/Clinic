"""Selective simulation substrate -- typed reader for the SIM_* env keys.

See the block comment above SIM_NPHIES_CONNECTOR in .env.example for the
full picture. Short version: the real LLM and real local ASR run by
default; SimConfig only documents, in a typed way, which external-
integration seams this environment is running in stub mode. It does not
gate any real-integration code path by itself.

Note on scope: this is the one service where SIM_NPHIES_CONNECTOR names a
seam that actually lives here -- but the seam's real switch is, and stays,
`NPHIES_CONNECTOR` (read by fhir_client.connector_mode(), unchanged by this
task). SIM_NPHIES_CONNECTOR is additive, typed documentation of that same
posture for anything that wants to read it without special-casing yet
another os.environ key name; it deliberately does not replace or shadow the
existing switch.
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
