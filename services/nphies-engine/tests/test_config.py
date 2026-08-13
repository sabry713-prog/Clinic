"""Tests for config.SimConfig -- the typed SIM_* reader.

Per docs/build/04-testing.md: one test file per source file, Arrange-Act-
Assert, external boundaries only (here: an explicit env dict standing in for
os.environ, never the real process environment).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config import get_sim_config  # noqa: E402


def test_defaults_to_stub_and_sim_default_true_on_empty_env():
    cfg = get_sim_config({})
    assert cfg.sim_nphies_connector == "stub"
    assert cfg.sim_his_feed == "stub"
    assert cfg.sim_sms_otp == "stub"
    assert cfg.sim_default is True


def test_reads_live_mode_case_insensitively():
    cfg = get_sim_config({"SIM_NPHIES_CONNECTOR": "LIVE"})
    assert cfg.sim_nphies_connector == "live"


def test_unrecognised_mode_value_falls_back_to_stub():
    """Never fail open into "live" on a typo -- same fail-closed posture as
    packages/phi-guard's policy parsing."""
    cfg = get_sim_config({"SIM_HIS_FEED": "sure why not"})
    assert cfg.sim_his_feed == "stub"


def test_sim_default_false_is_parsed():
    cfg = get_sim_config({"SIM_DEFAULT": "false"})
    assert cfg.sim_default is False


def test_sim_default_missing_key_uses_the_true_default():
    cfg = get_sim_config({"SOME_OTHER_KEY": "x"})
    assert cfg.sim_default is True


def test_each_key_is_read_independently():
    cfg = get_sim_config(
        {"SIM_NPHIES_CONNECTOR": "live", "SIM_HIS_FEED": "stub", "SIM_SMS_OTP": "live"}
    )
    assert cfg.sim_nphies_connector == "live"
    assert cfg.sim_his_feed == "stub"
    assert cfg.sim_sms_otp == "live"
