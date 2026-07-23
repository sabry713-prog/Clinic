"""Tests for the PHI egress guard.

The behaviour that matters: patient data must not reach a non-in-Kingdom
endpoint unless someone deliberately and explicitly configured it to.
"""
from __future__ import annotations

import pytest

from phi_guard import (
    ALLOW_ACK_PHRASE,
    Deidentifier,
    EgressPolicy,
    PhiEgressBlocked,
    Residency,
    classify_endpoint,
    current_policy,
    guard_outbound,
)

RECORD_PROMPT = (
    "QUESTION: what are his current medications\n"
    "RETRIEVED FACTS:\n"
    "Patient Ahmad Fakename-Al-Bishi, MRN-010, national ID 1054887723, "
    "DOB 1962-08-25, patient_id 0e94de72-7fec-4ec4-8dba-69a1a5c0e507.\n"
    "Medication: Warfarin 5 mg, oral, once daily.\n"
    "Laboratory: Creatinine 116.6 umol/L [59-104 umol/L] on 2026-06-11."
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in ("PHI_EGRESS_POLICY", "PHI_EGRESS_ALLOW_ACK", "PHI_INKINGDOM_HOSTS"):
        monkeypatch.delenv(var, raising=False)


# ---------------------------------------------------------------- residency
@pytest.mark.parametrize("url", [
    "http://127.0.0.1:1234/v1/chat/completions",
    "http://localhost:1234/v1",
    "http://10.20.0.5:8000/v1",
    "http://192.168.1.40/v1",
    "http://llm.internal/v1",
    "http://model.svc.cluster.local/v1",
])
def test_local_and_private_endpoints_are_in_kingdom(url):
    assert classify_endpoint(url) is Residency.IN_KINGDOM


@pytest.mark.parametrize("url", [
    "https://api.deepseek.com/chat/completions",
    "https://api.openai.com/v1",
    "https://generativelanguage.googleapis.com",
    "http://8.8.8.8/v1",
])
def test_public_endpoints_are_external(url):
    assert classify_endpoint(url) is Residency.EXTERNAL


@pytest.mark.parametrize("url", [None, "", "not a url", "://broken"])
def test_unparseable_endpoints_fail_closed_as_external(url):
    assert classify_endpoint(url) is Residency.EXTERNAL


def test_operator_allowlist_marks_host_in_kingdom(monkeypatch):
    monkeypatch.setenv("PHI_INKINGDOM_HOSTS", "llm.hospital.sa")
    assert classify_endpoint("https://llm.hospital.sa/v1") is Residency.IN_KINGDOM
    assert classify_endpoint("https://api.deepseek.com/v1") is Residency.EXTERNAL


# ---------------------------------------------------------------- policy
def test_default_policy_is_block():
    assert current_policy() is EgressPolicy.BLOCK


def test_unknown_policy_value_falls_back_to_block(monkeypatch):
    monkeypatch.setenv("PHI_EGRESS_POLICY", "yolo")
    assert current_policy() is EgressPolicy.BLOCK


def test_phi_to_external_endpoint_is_blocked_by_default():
    with pytest.raises(PhiEgressBlocked) as exc:
        guard_outbound("https://api.deepseek.com/chat/completions", "sys", RECORD_PROMPT)
    assert "block" in str(exc.value).lower()


def test_in_kingdom_endpoint_passes_through_untouched():
    d = guard_outbound("http://127.0.0.1:1234/v1/chat/completions", "sys", RECORD_PROMPT)
    assert d.residency is Residency.IN_KINGDOM
    assert d.user_prompt == RECORD_PROMPT      # nothing rewritten
    assert d.redaction_count == 0


def test_non_phi_payload_may_go_external():
    d = guard_outbound(
        "https://api.deepseek.com/v1", "sys", "Reformat this heading.", contains_phi=False,
    )
    assert d.residency is Residency.EXTERNAL
    assert d.user_prompt == "Reformat this heading."


# ---------------------------------------------------------------- deidentify
def test_deidentify_policy_strips_identifiers_before_egress(monkeypatch):
    monkeypatch.setenv("PHI_EGRESS_POLICY", "deidentify")
    d = guard_outbound(
        "https://api.deepseek.com/v1", "sys", RECORD_PROMPT,
        patient_names=["Ahmad Fakename-Al-Bishi"],
    )
    sent = d.user_prompt
    # Direct identifiers gone
    assert "Ahmad Fakename-Al-Bishi" not in sent
    assert "MRN-010" not in sent
    assert "1054887723" not in sent
    assert "1962-08-25" not in sent
    assert "0e94de72-7fec-4ec4-8dba-69a1a5c0e507" not in sent
    # Clinical content preserved — that is the whole point of the call
    assert "Warfarin 5 mg" in sent
    assert "Creatinine 116.6 umol/L" in sent
    assert d.redaction_count >= 5


def test_deidentified_reply_is_restored_for_the_clinician(monkeypatch):
    monkeypatch.setenv("PHI_EGRESS_POLICY", "deidentify")
    d = guard_outbound(
        "https://api.deepseek.com/v1", "sys", RECORD_PROMPT,
        patient_names=["Ahmad Fakename-Al-Bishi"],
    )
    # Model replies using the placeholders it was given
    placeholder = next(p for p, v in d._deid.mapping.items() if v == "MRN-010")
    restored = d.restore(f"Patient {placeholder} takes Warfarin 5 mg.")
    assert "MRN-010" in restored


def test_deidentifier_reuses_one_placeholder_per_value():
    deid = Deidentifier()
    res = deid.scrub("MRN-010 appears twice: MRN-010.")
    assert res.redaction_count == 1
    assert res.text.count("[[MRN_1]]") == 2


def test_deidentifier_handles_empty_text():
    assert Deidentifier().scrub("").text == ""


# ---------------------------------------------------------------- allow
def test_allow_policy_requires_explicit_acknowledgement(monkeypatch):
    monkeypatch.setenv("PHI_EGRESS_POLICY", "allow")
    with pytest.raises(PhiEgressBlocked) as exc:
        guard_outbound("https://api.deepseek.com/v1", "sys", RECORD_PROMPT)
    assert "PHI_EGRESS_ALLOW_ACK" in str(exc.value)


def test_allow_policy_with_acknowledgement_passes_through(monkeypatch):
    monkeypatch.setenv("PHI_EGRESS_POLICY", "allow")
    monkeypatch.setenv("PHI_EGRESS_ALLOW_ACK", ALLOW_ACK_PHRASE)
    d = guard_outbound("https://api.deepseek.com/v1", "sys", RECORD_PROMPT)
    assert d.user_prompt == RECORD_PROMPT
    assert d.residency is Residency.EXTERNAL


def test_wrong_acknowledgement_string_still_blocks(monkeypatch):
    monkeypatch.setenv("PHI_EGRESS_POLICY", "allow")
    monkeypatch.setenv("PHI_EGRESS_ALLOW_ACK", "sure whatever")
    with pytest.raises(PhiEgressBlocked):
        guard_outbound("https://api.deepseek.com/v1", "sys", RECORD_PROMPT)
