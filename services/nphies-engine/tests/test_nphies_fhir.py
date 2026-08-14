"""Integration tests for the NPHIES FHIR layer.

Schema validation here is real, not asserted: every generated bundle is fed to
`fhir.resources`' R4B models, which reject structurally invalid FHIR the same way
a server-side validator would. `test_validator_actually_rejects_bad_bundles`
proves the validator has teeth, so a passing suite can't be a false positive.

R4B rather than the library default (R5): NPHIES is built on FHIR R4, and the
Claim / CoverageEligibilityRequest / ClaimResponse resources are identical between
R4 and R4B. The library ships no separate R4 namespace.

Network is never touched -- httpx transports are mocked with canned NPHIES
sandbox-shaped payloads.
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import httpx
import pytest
from fhir.resources.R4B.bundle import Bundle
from fhir.resources.R4B.claim import Claim
from fhir.resources.R4B.claimresponse import ClaimResponse
from fhir.resources.R4B.coverageeligibilityrequest import CoverageEligibilityRequest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fhir_client import (  # noqa: E402
    NphiesEgressBlocked,
    NphiesFhirClient,
    NphiesNotConfigured,
    build_eligibility_bundle,
    build_prior_auth_bundle,
    encode_clinical_document,
    interpret_claim_response,
    load_profiles,
)
from tasks import (  # noqa: E402
    EVENT_NAME,
    StatusBroker,
    check_eligibility_task,
    submit_prior_auth_task,
)

SOAP_NOTE = (
    "S: Lower back pain radiating to the left leg for 6 weeks.\n"
    "O: Positive straight-leg raise on the left.\n"
    "A: Sciatica.\n"
    "P: Lumbar MRI without contrast."
)

# Canned NPHIES-sandbox-shaped responses.
APPROVED_RESPONSE = {
    "resourceType": "Bundle",
    "type": "message",
    "entry": [
        {
            "resource": {
                "resourceType": "ClaimResponse",
                "identifier": [
                    {"system": "http://nphies.sa/identifier/claim", "value": "PA-2026-0001"}
                ],
                "status": "active",
                "type": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/claim-type",
                            "code": "institutional",
                        }
                    ]
                },
                "use": "preauthorization",
                "patient": {"reference": "Patient/1"},
                "created": "2026-07-25T10:00:00Z",
                "insurer": {"reference": "Organization/payer"},
                "outcome": "complete",
                "preAuthRef": "PA-2026-0001",
                "disposition": "Approved",
            }
        }
    ],
}

PENDED_RESPONSE = {
    "resourceType": "Bundle",
    "type": "message",
    "entry": [
        {
            "resource": {
                "resourceType": "ClaimResponse",
                "status": "active",
                "type": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/claim-type",
                            "code": "institutional",
                        }
                    ]
                },
                "use": "preauthorization",
                "patient": {"reference": "Patient/1"},
                "created": "2026-07-25T10:00:00Z",
                "insurer": {"reference": "Organization/payer"},
                "outcome": "queued",
                "disposition": "Under review by the payer.",
            }
        }
    ],
}

TOKEN_RESPONSE = {"access_token": "test-token", "expires_in": 3600}


def _live_client(handler, **overrides) -> NphiesFhirClient:
    """Live-mode client whose network is a mock transport."""
    transport = httpx.MockTransport(handler)
    kwargs = {
        "base_url": "https://sandbox.nphies.sa",
        "client_id": "cid",
        "client_secret": "secret",
        "mode": "live",
        "http_client": httpx.AsyncClient(transport=transport),
    }
    kwargs.update(overrides)
    return NphiesFhirClient(**kwargs)


def _responder(final_payload: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json=TOKEN_RESPONSE)
        return httpx.Response(200, json=final_payload)

    return handler


def _claim_from(bundle: dict) -> dict:
    return next(
        e["resource"] for e in bundle["entry"] if e["resource"]["resourceType"] == "Claim"
    )


@pytest.fixture(autouse=True)
def _inkingdom(monkeypatch):
    """NPHIES is in-Kingdom in reality; the guard needs it declared."""
    monkeypatch.setenv("PHI_INKINGDOM_HOSTS", "sandbox.nphies.sa")


# ---------------------------------------------------------------- schema validation
def test_eligibility_bundle_passes_r4_schema_validation():
    bundle = build_eligibility_bundle("1234567890", "PAYER-001")
    validated = Bundle.model_validate(bundle)
    assert validated.type == "message"

    request = next(
        e["resource"]
        for e in bundle["entry"]
        if e["resource"]["resourceType"] == "CoverageEligibilityRequest"
    )
    CoverageEligibilityRequest.model_validate(request)


def test_prior_auth_bundle_passes_r4_schema_validation():
    bundle = build_prior_auth_bundle("enc-1", "M54.3", "58721-00-10", SOAP_NOTE)
    Bundle.model_validate(bundle)
    Claim.model_validate(_claim_from(bundle))


def test_validator_actually_rejects_bad_bundles():
    """Guards against a false-positive suite: if this passes trivially, the
    validation in the tests above proves nothing."""
    with pytest.raises(Exception):
        Bundle.model_validate({"resourceType": "Bundle"})  # missing required `type`
    with pytest.raises(Exception):
        Claim.model_validate({"resourceType": "Claim", "status": "active"})  # missing required fields


def test_canned_sandbox_responses_are_themselves_valid_fhir():
    """The mock payloads must be realistic, or the tests validate nothing real."""
    for payload in (APPROVED_RESPONSE, PENDED_RESPONSE):
        Bundle.model_validate(payload)
        ClaimResponse.model_validate(payload["entry"][0]["resource"])


# ---------------------------------------------------------------- bundle content
def test_prior_auth_carries_exactly_the_codes_given():
    bundle = build_prior_auth_bundle("enc-1", "M54.3", "58721-00-10", SOAP_NOTE)
    claim = _claim_from(bundle)
    assert claim["diagnosis"][0]["diagnosisCodeableConcept"]["coding"][0]["code"] == "M54.3"
    assert claim["item"][0]["productOrService"]["coding"][0]["code"] == "58721-00-10"
    # The item must reference the diagnosis -- an unlinked item is a rejection cause.
    assert claim["item"][0]["diagnosisSequence"] == [1]


def test_clinical_document_is_attached_and_recoverable():
    bundle = build_prior_auth_bundle("enc-1", "M54.3", "58721-00-10", SOAP_NOTE)
    attachment = _claim_from(bundle)["supportingInfo"][0]["valueAttachment"]
    assert base64.b64decode(attachment["data"]).decode("utf-8") == SOAP_NOTE


def test_attachment_content_type_reflects_actual_bytes():
    """A text SOAP note must not be declared application/pdf."""
    assert encode_clinical_document("plain text")[0] == "text/plain"
    assert encode_clinical_document(b"%PDF-1.4 ...")[0] == "application/pdf"


def test_profile_urls_come_from_config_not_source():
    profiles = load_profiles()
    bundle = build_prior_auth_bundle("enc-1", "M54.3", "58721-00-10", SOAP_NOTE)
    assert _claim_from(bundle)["meta"]["profile"] == [profiles["profiles"]["claim_prior_auth"]]


def test_shipped_profiles_are_flagged_unverified():
    """The placeholder NPHIES canonicals must never claim to be IG-verified."""
    assert load_profiles()["_meta"]["verified_against_official_ig"] is False


@pytest.mark.parametrize("missing", ["encounter_id", "icd10_code", "sbs_code"])
def test_prior_auth_rejects_missing_required_codes(missing):
    args = {"encounter_id": "e", "icd10_code": "M54.3", "sbs_code": "58721", "clinical_document": SOAP_NOTE}
    args[missing] = ""
    with pytest.raises(ValueError):
        build_prior_auth_bundle(**args)


# ---------------------------------------------------------------- response interpretation
def test_approved_response_yields_authorization_number():
    result = interpret_claim_response(APPROVED_RESPONSE)
    assert result["status"] == "approved"
    assert result["authorization_number"] == "PA-2026-0001"


def test_queued_response_is_pended_with_no_authorization_number():
    result = interpret_claim_response(PENDED_RESPONSE)
    assert result["status"] == "pended"
    assert result["authorization_number"] is None


@pytest.mark.parametrize(
    "outcome,expected",
    [("complete", "approved"), ("partial", "pended"), ("queued", "pended"), ("error", "error")],
)
def test_outcome_mapping(outcome, expected):
    payload = {"resourceType": "ClaimResponse", "outcome": outcome}
    assert interpret_claim_response(payload)["status"] == expected


def test_unrecognised_outcome_is_never_approved():
    """Fail safe: an outcome we don't understand must not render as approved."""
    assert interpret_claim_response({"resourceType": "ClaimResponse", "outcome": "wat"})["status"] == "pended"


def test_missing_claim_response_is_an_error_not_an_approval():
    assert interpret_claim_response({"resourceType": "Bundle", "entry": []})["status"] == "error"


# ---------------------------------------------------------------- live transport
async def test_live_submit_prior_auth_parses_approval():
    client = _live_client(_responder(APPROVED_RESPONSE))
    try:
        result = await client.submit_prior_auth("enc-1", "M54.3", "58721-00-10", SOAP_NOTE)
    finally:
        await client.aclose()
    assert result["mode"] == "live"
    assert result["status"] == "approved"
    assert result["authorization_number"] == "PA-2026-0001"


async def test_live_submit_sends_valid_fhir_over_the_wire():
    """Validate the bundle as the server would receive it, not as we built it."""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json=TOKEN_RESPONSE)
        captured["body"] = json.loads(request.content)
        captured["auth"] = request.headers.get("Authorization")
        captured["content_type"] = request.headers.get("Content-Type")
        return httpx.Response(200, json=APPROVED_RESPONSE)

    client = _live_client(handler)
    try:
        await client.submit_prior_auth("enc-1", "M54.3", "58721-00-10", SOAP_NOTE)
    finally:
        await client.aclose()

    Bundle.model_validate(captured["body"])
    assert captured["auth"] == "Bearer test-token"
    assert captured["content_type"] == "application/fhir+json"


async def test_token_is_reused_across_calls():
    calls = {"token": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth2/token"):
            calls["token"] += 1
            return httpx.Response(200, json=TOKEN_RESPONSE)
        return httpx.Response(200, json=APPROVED_RESPONSE)

    client = _live_client(handler)
    try:
        await client.submit_prior_auth("e", "M54.3", "587", SOAP_NOTE)
        await client.submit_prior_auth("e", "M54.3", "587", SOAP_NOTE)
    finally:
        await client.aclose()
    assert calls["token"] == 1


async def test_live_mode_without_credentials_is_refused():
    client = NphiesFhirClient(base_url="https://sandbox.nphies.sa", client_id="", client_secret="", mode="live")
    try:
        with pytest.raises(NphiesNotConfigured):
            await client.submit_prior_auth("e", "M54.3", "587", SOAP_NOTE)
    finally:
        await client.aclose()


async def test_egress_blocked_for_uncertified_endpoint(monkeypatch):
    """The SOAP note must not leave for an endpoint nobody certified in-Kingdom."""
    monkeypatch.setenv("PHI_INKINGDOM_HOSTS", "")
    client = _live_client(_responder(APPROVED_RESPONSE))
    try:
        with pytest.raises(NphiesEgressBlocked):
            await client.submit_prior_auth("e", "M54.3", "587", SOAP_NOTE)
    finally:
        await client.aclose()


# ---------------------------------------------------------------- stub mode
async def test_stub_mode_makes_no_network_call_and_marks_itself():
    client = NphiesFhirClient(mode="stub")
    try:
        result = await client.submit_prior_auth("enc-1", "M54.3", "58721-00-10", SOAP_NOTE)
    finally:
        await client.aclose()
    assert result["mode"] == "stub"
    assert "not a payer decision" in result["response"]["disposition"]


async def test_stub_authorization_number_cannot_pass_as_real():
    client = NphiesFhirClient(mode="stub")
    try:
        result = await client.submit_prior_auth("enc-1", "M54.3", "58721-00-10", SOAP_NOTE)
    finally:
        await client.aclose()
    # Stub never approves, so no authorization number is surfaced at all; the
    # canned identifier that DOES exist stays visibly prefixed as a stub value.
    assert result["authorization_number"] is None
    identifier_value = result["response"]["identifier"][0]["value"]
    assert identifier_value.startswith("STUB-NOT-A-REAL-AUTH-")


async def test_stub_prior_auth_never_simulates_an_approval():
    """Across a wide sweep of submission keys, the stub must only ever produce
    undecided outcomes -- the badge resolves to pended, never green. A green
    badge must have a real payer `complete` outcome behind it, and there is no
    payer in stub mode."""
    client = NphiesFhirClient(mode="stub")
    outcomes: set[str] = set()
    try:
        for i in range(40):
            result = await client.submit_prior_auth(
                f"enc-{i}", "M54.3", "58721-00-10", SOAP_NOTE
            )
            assert result["status"] == "pended"
            assert result["authorization_number"] is None
            outcomes.add(str(result["outcome"]))
    finally:
        await client.aclose()
    # The full realistic range of undecided states is exercised, deterministically.
    assert outcomes == {"queued", "partial", "processing"}
    assert "complete" not in outcomes


async def test_stub_outcome_is_deterministic_per_submission():
    client = NphiesFhirClient(mode="stub")
    try:
        first = await client.submit_prior_auth("enc-det", "I10", "11700-00-10", SOAP_NOTE)
        second = await client.submit_prior_auth("enc-det", "I10", "11700-00-10", SOAP_NOTE)
        other = await client.submit_prior_auth("enc-other", "I10", "11700-00-10", SOAP_NOTE)
    finally:
        await client.aclose()
    assert first["outcome"] == second["outcome"]
    assert first["response"]["identifier"][0]["value"] == (
        second["response"]["identifier"][0]["value"]
    )
    # Deterministic, not constant: a different submission key may map elsewhere.
    assert first["response"]["identifier"][0]["value"] != (
        other["response"]["identifier"][0]["value"]
    )


async def test_stub_eligibility_covers_pended_states_and_only_confirms_on_complete():
    client = NphiesFhirClient(mode="stub")
    outcomes: set[str] = set()
    try:
        for i in range(40):
            result = await client.check_eligibility(f"10{i:09d}", "payer-1")
            outcome = str(result["response"]["outcome"])
            outcomes.add(outcome)
            if outcome != "complete":
                assert result["eligible"] is False
                assert result["response"]["insurance"] == []
            else:
                assert result["eligible"] is True
                assert result["response"]["insurance"] == [{"inforce": True}]
    finally:
        await client.aclose()
    assert outcomes == {"complete", "queued", "partial"}


async def test_stub_bundle_is_still_valid_fhir():
    client = NphiesFhirClient(mode="stub")
    try:
        result = await client.submit_prior_auth("enc-1", "M54.3", "58721-00-10", SOAP_NOTE)
    finally:
        await client.aclose()
    Bundle.model_validate(result["request_bundle"])


# ---------------------------------------------------------------- broker / tasks
async def test_broker_delivers_to_subscribers_of_that_encounter_only():
    b = StatusBroker()
    mine = await b.subscribe("enc-1")
    theirs = await b.subscribe("enc-2")
    await b.publish("enc-1", {"status": "approved"})
    assert mine.get_nowait()["status"] == "approved"
    assert theirs.empty()


async def test_unsubscribe_stops_delivery():
    b = StatusBroker()
    q = await b.subscribe("enc-1")
    await b.unsubscribe("enc-1", q)
    assert await b.publish("enc-1", {"status": "approved"}) == 0


async def test_prior_auth_task_publishes_status_event(monkeypatch):
    import tasks as tasks_mod

    b = StatusBroker()
    monkeypatch.setattr(tasks_mod, "broker", b)
    queue = await b.subscribe("enc-1")

    event = await submit_prior_auth_task(
        "enc-1", "order-1", "M54.3", "58721-00-10", SOAP_NOTE,
        client=_live_client(_responder(APPROVED_RESPONSE)),
    )
    assert event["event"] == EVENT_NAME
    assert event["status"] == "approved"
    assert event["authorization_number"] == "PA-2026-0001"
    assert queue.get_nowait() == event


async def test_prior_auth_task_converts_failure_into_error_event(monkeypatch):
    """A background task must not raise into nowhere -- it must emit an event
    the UI can render."""
    import tasks as tasks_mod

    b = StatusBroker()
    monkeypatch.setattr(tasks_mod, "broker", b)
    await b.subscribe("enc-1")

    def failing(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json=TOKEN_RESPONSE)
        return httpx.Response(500, json={"error": "payer down"})

    event = await submit_prior_auth_task(
        "enc-1", "order-1", "M54.3", "587", SOAP_NOTE, client=_live_client(failing)
    )
    assert event["status"] == "error"


async def test_eligibility_task_publishes_eligible(monkeypatch):
    import tasks as tasks_mod

    b = StatusBroker()
    monkeypatch.setattr(tasks_mod, "broker", b)
    await b.subscribe("enc-1")

    # Civil id 10000000001 deterministically maps to a `complete` stub outcome
    # for payer PAYER-001 (see _stub_outcome), so this exercises the eligible path.
    event = await check_eligibility_task(
        "enc-1", "10000000001", "PAYER-001", client=NphiesFhirClient(mode="stub")
    )
    assert event["status"] == "eligible"


async def test_eligibility_task_publishes_pended_for_undecided_outcome(monkeypatch):
    """An eligibility response that arrives queued/partial is PENDED -- it must
    never read as eligible, and "not eligible" would overstate what the payer
    said (badge discipline: only a complete outcome decides)."""
    import tasks as tasks_mod

    b = StatusBroker()
    monkeypatch.setattr(tasks_mod, "broker", b)
    await b.subscribe("enc-pend")

    # Civil id 10000000000 deterministically maps to a `queued` stub outcome.
    event = await check_eligibility_task(
        "enc-pend", "10000000000", "PAYER-001", client=NphiesFhirClient(mode="stub")
    )
    assert event["status"] == "pended"


# ---------------------------------------------------------------- HTTP surface
def test_api_routes():
    from fastapi.testclient import TestClient

    import api_router

    with TestClient(api_router.app) as client:
        health = client.get("/health").json()
        assert health["service"] == "nphies-engine"
        assert health["profiles_verified"] is False

        queued = client.post(
            "/api/v1/nphies/prior-auth",
            json={
                "encounter_id": "enc-1",
                "order_id": "order-1",
                "icd10_code": "M54.3",
                "sbs_code": "58721-00-10",
                "clinical_document": SOAP_NOTE,
            },
        )
        # Returns immediately; the payer round-trip happens in the background.
        assert queued.status_code == 200
        assert queued.json()["status"] == "queued"
