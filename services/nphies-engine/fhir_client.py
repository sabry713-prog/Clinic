"""NPHIES FHIR client -- eligibility and prior-authorization transactions.

Design notes, because two of them are load-bearing:

1. **Bundle builders are pure functions, separate from I/O.** `build_*_bundle()`
   takes plain data and returns a plain dict. That makes the FHIR structure
   independently testable against a real R4 validator (tests/test_nphies_fhir.py
   runs every bundle through fhir.resources) without a network or credentials.

2. **Every NPHIES/CCHI-specific canonical URL comes from config/nphies_profiles.json,
   never from source.** This service was built without CCHI onboarding, sandbox
   credentials, or a copy of the official NPHIES Implementation Guide, so the
   shipped profile values are structurally plausible placeholders, NOT verified
   conformance. A wrong profile URL is a leading cause of NPHIES rejection --
   exactly the failure this product exists to prevent -- so the values live in an
   editable config file that gets overwritten at onboarding without touching code,
   and `profiles_verified()` reports whether that has happened yet.

Connector modes mirror apps/core/src/nphies/connector.service.ts: `stub` returns
canned, unmistakably-labelled development responses so the whole workflow runs
without onboarding; `live` performs real HTTP. Every response records its mode so
stub data can never be mistaken for a payer decision.

Usage:
    NPHIES_CONNECTOR=live NPHIES_BASE_URL=https://sandbox.nphies.sa \\
    NPHIES_CLIENT_ID=... NPHIES_CLIENT_SECRET=... \\
    PHI_INKINGDOM_HOSTS=sandbox.nphies.sa \\
        python -m uvicorn api_router:app --port 5006
"""
from __future__ import annotations

import base64
import json
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
import structlog
from phi_guard.residency import Residency, classify_endpoint

logger = structlog.get_logger()

_CONFIG_PATH = Path(__file__).resolve().parent / "config" / "nphies_profiles.json"

# Token is refreshed this many seconds before its stated expiry.
_TOKEN_REFRESH_MARGIN_S = 60

__all__ = [
    "NphiesError",
    "NphiesNotConfigured",
    "NphiesEgressBlocked",
    "NphiesFhirClient",
    "build_eligibility_bundle",
    "build_prior_auth_bundle",
    "interpret_claim_response",
    "load_profiles",
    "profiles_verified",
    "connector_mode",
]


# ---------------------------------------------------------------- errors
class NphiesError(RuntimeError):
    """Any NPHIES transaction failure."""


class NphiesNotConfigured(NphiesError):
    """Live mode selected without the credentials it requires."""


class NphiesEgressBlocked(NphiesError):
    """Outbound endpoint is not certified in-Kingdom (fail closed)."""


# ---------------------------------------------------------------- config
_profiles_cache: Optional[dict[str, Any]] = None


def load_profiles(*, refresh: bool = False) -> dict[str, Any]:
    """Load the NPHIES conformance config. Cached; pass refresh=True to reload."""
    global _profiles_cache
    if _profiles_cache is None or refresh:
        with _CONFIG_PATH.open(encoding="utf-8") as fh:
            _profiles_cache = json.load(fh)
    return _profiles_cache


def profiles_verified() -> bool:
    """True once an operator has replaced the placeholder canonical URLs with
    values from the official NPHIES IG and flipped the flag in the config."""
    return bool(load_profiles().get("_meta", {}).get("verified_against_official_ig", False))


def connector_mode() -> str:
    """`stub` (default) or `live` -- same switch name as apps/core's connector."""
    return "live" if os.environ.get("NPHIES_CONNECTOR", "stub").strip().lower() == "live" else "stub"


def _profile(key: str) -> str:
    return str(load_profiles()["profiles"][key])


def _system(group: str, key: str) -> str:
    return str(load_profiles()[group][key])


def _default(key: str) -> Any:
    return load_profiles()["defaults"][key]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _urn() -> str:
    return f"urn:uuid:{uuid.uuid4()}"


# ---------------------------------------------------------------- attachment
def encode_clinical_document(document: bytes | str) -> tuple[str, str]:
    """Base64-encode the clinical justification, returning (contentType, data).

    The spec calls this a "PDF/base64 attachment", but the draft SOAP note this
    service actually receives is usually plain text. Declaring `application/pdf`
    on a text payload would be a false statement inside the claim bundle -- and a
    payer that tries to render it gets a corrupt document -- so the content type
    is derived from the bytes rather than assumed: real PDFs (detected by the
    %PDF- magic number) are declared as PDF, anything else as text/plain.
    """
    raw = document.encode("utf-8") if isinstance(document, str) else document
    content_type = "application/pdf" if raw[:5] == b"%PDF-" else "text/plain"
    return content_type, base64.b64encode(raw).decode("ascii")


# ---------------------------------------------------------------- bundle builders
def build_eligibility_bundle(
    patient_civil_id: str,
    payer_id: str,
    *,
    provider_license: Optional[str] = None,
    purpose: Optional[str] = None,
) -> dict[str, Any]:
    """Build a CoverageEligibilityRequest bundle (FHIR R4, NPHIES-profiled).

    `patient_civil_id` is the Saudi national ID / Iqama; `payer_id` the payer's
    NPHIES license identifier.
    """
    if not patient_civil_id or not patient_civil_id.strip():
        raise ValueError("patient_civil_id is required")
    if not payer_id or not payer_id.strip():
        raise ValueError("payer_id is required")

    provider_license = provider_license or os.environ.get("NPHIES_PROVIDER_LICENSE", "UNSET-PROVIDER-LICENSE")
    now = _now_iso()
    patient_urn, provider_urn, payer_urn, request_urn = _urn(), _urn(), _urn(), _urn()

    patient = {
        "resourceType": "Patient",
        "id": patient_urn.rsplit(":", 1)[-1],
        "meta": {"profile": [_profile("patient")]},
        "identifier": [
            {"system": _system("identifier_systems", "national_id"), "value": patient_civil_id}
        ],
    }
    provider = {
        "resourceType": "Organization",
        "id": provider_urn.rsplit(":", 1)[-1],
        "meta": {"profile": [_profile("organization")]},
        "identifier": [
            {"system": _system("identifier_systems", "provider_license"), "value": provider_license}
        ],
        "active": True,
        "name": os.environ.get("NPHIES_PROVIDER_NAME", "Provider Organization"),
    }
    payer = {
        "resourceType": "Organization",
        "id": payer_urn.rsplit(":", 1)[-1],
        "meta": {"profile": [_profile("organization")]},
        "identifier": [
            {"system": _system("identifier_systems", "payer_license"), "value": payer_id}
        ],
        "active": True,
        "name": f"Payer {payer_id}",
    }
    request = {
        "resourceType": "CoverageEligibilityRequest",
        "id": request_urn.rsplit(":", 1)[-1],
        "meta": {"profile": [_profile("coverage_eligibility_request")]},
        "identifier": [
            {"system": _system("identifier_systems", "eligibility_request"), "value": str(uuid.uuid4())}
        ],
        "status": "active",
        "purpose": [purpose or _default("eligibility_purpose_code")],
        "patient": {"reference": patient_urn},
        "created": now,
        "provider": {"reference": provider_urn},
        "insurer": {"reference": payer_urn},
    }

    return {
        "resourceType": "Bundle",
        "id": str(uuid.uuid4()),
        "meta": {"profile": [_profile("bundle")]},
        "type": "message",
        "timestamp": now,
        "entry": [
            {"fullUrl": request_urn, "resource": request},
            {"fullUrl": patient_urn, "resource": patient},
            {"fullUrl": provider_urn, "resource": provider},
            {"fullUrl": payer_urn, "resource": payer},
        ],
    }


def build_prior_auth_bundle(
    encounter_id: str,
    icd10_code: str,
    sbs_code: str,
    clinical_document: bytes | str,
    *,
    patient_civil_id: Optional[str] = None,
    payer_id: Optional[str] = None,
    provider_license: Optional[str] = None,
    icd10_display: Optional[str] = None,
    sbs_display: Optional[str] = None,
) -> dict[str, Any]:
    """Build a prior-authorization Claim bundle with the clinical justification
    attached as a base64 `supportingInfo` document.

    Every code that lands in the bundle is passed in by the caller -- this
    function never infers, maps, or substitutes a code (CLAUDE.md sec 1).
    """
    for name, value in (("encounter_id", encounter_id), ("icd10_code", icd10_code), ("sbs_code", sbs_code)):
        if not value or not str(value).strip():
            raise ValueError(f"{name} is required")

    provider_license = provider_license or os.environ.get("NPHIES_PROVIDER_LICENSE", "UNSET-PROVIDER-LICENSE")
    payer_id = payer_id or os.environ.get("NPHIES_DEFAULT_PAYER_ID", "UNSET-PAYER-ID")
    content_type, encoded = encode_clinical_document(clinical_document)
    now = _now_iso()

    patient_urn, provider_urn, payer_urn, encounter_urn, claim_urn = (_urn() for _ in range(5))

    patient: dict[str, Any] = {
        "resourceType": "Patient",
        "id": patient_urn.rsplit(":", 1)[-1],
        "meta": {"profile": [_profile("patient")]},
    }
    if patient_civil_id:
        patient["identifier"] = [
            {"system": _system("identifier_systems", "national_id"), "value": patient_civil_id}
        ]

    provider = {
        "resourceType": "Organization",
        "id": provider_urn.rsplit(":", 1)[-1],
        "meta": {"profile": [_profile("organization")]},
        "identifier": [
            {"system": _system("identifier_systems", "provider_license"), "value": provider_license}
        ],
        "active": True,
        "name": os.environ.get("NPHIES_PROVIDER_NAME", "Provider Organization"),
    }
    payer = {
        "resourceType": "Organization",
        "id": payer_urn.rsplit(":", 1)[-1],
        "meta": {"profile": [_profile("organization")]},
        "identifier": [
            {"system": _system("identifier_systems", "payer_license"), "value": payer_id}
        ],
        "active": True,
        "name": f"Payer {payer_id}",
    }
    encounter = {
        "resourceType": "Encounter",
        "id": encounter_urn.rsplit(":", 1)[-1],
        "meta": {"profile": [_profile("encounter")]},
        "identifier": [
            {"system": _system("identifier_systems", "encounter"), "value": encounter_id}
        ],
        "status": "in-progress",
        "class": {
            "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            "code": "AMB",
            "display": "ambulatory",
        },
        "subject": {"reference": patient_urn},
    }

    claim: dict[str, Any] = {
        "resourceType": "Claim",
        "id": claim_urn.rsplit(":", 1)[-1],
        "meta": {"profile": [_profile("claim_prior_auth")]},
        "identifier": [
            {"system": _system("identifier_systems", "claim"), "value": str(uuid.uuid4())}
        ],
        "status": "active",
        "type": {
            "coding": [
                {
                    "system": _system("code_systems", "claim_type"),
                    "code": _default("claim_type_code"),
                }
            ]
        },
        "use": _default("claim_use"),
        "patient": {"reference": patient_urn},
        "created": now,
        "provider": {"reference": provider_urn},
        "priority": {
            "coding": [
                {"system": "http://terminology.hl7.org/CodeSystem/processpriority", "code": "normal"}
            ]
        },
        "insurer": {"reference": payer_urn},
        "supportingInfo": [
            {
                "sequence": 1,
                "category": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/claiminformationcategory",
                            "code": "info",
                        }
                    ]
                },
                "valueAttachment": {
                    "contentType": content_type,
                    "data": encoded,
                    "title": _default("attachment_title"),
                    "creation": now,
                },
            }
        ],
        "diagnosis": [
            {
                "sequence": 1,
                "diagnosisCodeableConcept": {
                    "coding": [
                        {
                            "system": _system("code_systems", "icd10_am"),
                            "code": icd10_code,
                            **({"display": icd10_display} if icd10_display else {}),
                        }
                    ]
                },
            }
        ],
        "insurance": [
            {"sequence": 1, "focal": True, "coverage": {"display": f"Payer {payer_id}"}}
        ],
        "item": [
            {
                "sequence": 1,
                "diagnosisSequence": [1],
                "productOrService": {
                    "coding": [
                        {
                            "system": _system("code_systems", "sbs"),
                            "code": sbs_code,
                            **({"display": sbs_display} if sbs_display else {}),
                        }
                    ]
                },
            }
        ],
    }

    return {
        "resourceType": "Bundle",
        "id": str(uuid.uuid4()),
        "meta": {"profile": [_profile("bundle")]},
        "type": "message",
        "timestamp": now,
        "entry": [
            {"fullUrl": claim_urn, "resource": claim},
            {"fullUrl": patient_urn, "resource": patient},
            {"fullUrl": encounter_urn, "resource": encounter},
            {"fullUrl": provider_urn, "resource": provider},
            {"fullUrl": payer_urn, "resource": payer},
        ],
    }


# ---------------------------------------------------------------- response parsing
def interpret_claim_response(bundle: dict[str, Any]) -> dict[str, Any]:
    """Map a ClaimResponse bundle onto the UI badge state.

    Only an explicit `complete` outcome yields `approved`; `queued`/`partial`
    become `pended`, and anything unrecognised becomes `pended` too -- an
    undecided or unparseable payer response must never render as approved.
    The authorization number is read from the response, never generated here.
    """
    status_map: dict[str, str] = load_profiles()["response_status_map"]
    claim_response: Optional[dict[str, Any]] = None

    for entry in bundle.get("entry", []) or []:
        resource = entry.get("resource") or {}
        if resource.get("resourceType") == "ClaimResponse":
            claim_response = resource
            break

    if claim_response is None:
        if bundle.get("resourceType") == "ClaimResponse":
            claim_response = bundle
        else:
            return {
                "status": "error",
                "authorization_number": None,
                "disposition": "No ClaimResponse resource found in the payer response.",
                "outcome": None,
            }

    outcome = claim_response.get("outcome")
    status = status_map.get(str(outcome), "pended")

    authorization_number: Optional[str] = None
    if status == "approved":
        identifiers = claim_response.get("identifier") or []
        if isinstance(identifiers, list) and identifiers:
            authorization_number = identifiers[0].get("value")
        authorization_number = authorization_number or claim_response.get("preAuthRef")

    return {
        "status": status,
        "authorization_number": authorization_number,
        "disposition": claim_response.get("disposition"),
        "outcome": outcome,
    }


# ---------------------------------------------------------------- client
@dataclass
class _Token:
    value: str
    expires_at: float

    def valid(self) -> bool:
        return bool(self.value) and time.time() < self.expires_at - _TOKEN_REFRESH_MARGIN_S


class NphiesFhirClient:
    """Async NPHIES FHIR client.

    In `stub` mode no network call is made and canned, clearly-labelled
    development responses are returned. In `live` mode the outbound endpoint must
    first pass the data-residency guard: a prior-auth bundle carries the patient's
    clinical note, so an endpoint that is not certified in-Kingdom is refused
    (fail closed). NPHIES is in-Kingdom in reality, but the guard cannot know that
    until an operator declares it via PHI_INKINGDOM_HOSTS -- the same mechanism
    used for on-prem model endpoints.
    """

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
        mode: Optional[str] = None,
        http_client: Optional[httpx.AsyncClient] = None,
        timeout: float = 30.0,
    ) -> None:
        self.base_url = (base_url or os.environ.get("NPHIES_BASE_URL", "")).rstrip("/")
        self.client_id = client_id or os.environ.get("NPHIES_CLIENT_ID", "")
        self.client_secret = client_secret or os.environ.get("NPHIES_CLIENT_SECRET", "")
        self.mode = (mode or connector_mode()).lower()
        self._owns_client = http_client is None
        self._http = http_client or httpx.AsyncClient(timeout=timeout)
        self._token: Optional[_Token] = None

        if self.mode == "live" and not profiles_verified():
            # Loud, but not fatal: the sandbox is exactly where you'd shake these
            # values out. Blocking here would make the config unusable to fix.
            logger.warning(
                "nphies_profiles_unverified",
                detail=(
                    "Sending live NPHIES traffic with placeholder profile URLs from "
                    "config/nphies_profiles.json. Replace them with the official IG "
                    "values and set verified_against_official_ig=true."
                ),
            )

    # -- lifecycle --
    async def aclose(self) -> None:
        if self._owns_client:
            await self._http.aclose()

    async def __aenter__(self) -> "NphiesFhirClient":
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    # -- guards --
    def _assert_live_configured(self) -> None:
        missing = [
            name
            for name, value in (
                ("NPHIES_BASE_URL", self.base_url),
                ("NPHIES_CLIENT_ID", self.client_id),
                ("NPHIES_CLIENT_SECRET", self.client_secret),
            )
            if not value
        ]
        if missing:
            raise NphiesNotConfigured(
                "NPHIES live connector selected but not configured -- missing "
                f"{', '.join(missing)}. Live mode also requires CCHI onboarding and "
                "the mTLS certificates issued with it."
            )

    def _assert_egress_allowed(self) -> None:
        """A prior-auth bundle carries the clinical note, so the destination must
        be certified in-Kingdom before anything leaves."""
        if classify_endpoint(self.base_url) is not Residency.IN_KINGDOM:
            raise NphiesEgressBlocked(
                f"Refusing to send patient data to {self.base_url!r}: endpoint is not "
                "certified in-Kingdom. NPHIES is in-Kingdom in reality -- declare it "
                "explicitly with PHI_INKINGDOM_HOSTS=<nphies host> (CLAUDE.md sec 7 / PDPL)."
            )

    # -- auth --
    async def _access_token(self) -> str:
        if self._token and self._token.valid():
            return self._token.value

        token_url = os.environ.get("NPHIES_TOKEN_URL") or f"{self.base_url}/oauth2/token"
        try:
            resp = await self._http.post(
                token_url,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise NphiesError(f"NPHIES token request failed: {exc}") from exc

        payload = resp.json()
        token = payload.get("access_token")
        if not token:
            raise NphiesError("NPHIES token response contained no access_token.")
        self._token = _Token(token, time.time() + float(payload.get("expires_in", 300)))
        return token

    # -- transport --
    async def _post_bundle(self, bundle: dict[str, Any]) -> dict[str, Any]:
        self._assert_live_configured()
        self._assert_egress_allowed()
        token = await self._access_token()
        try:
            resp = await self._http.post(
                f"{self.base_url}/$process-message",
                json=bundle,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/fhir+json",
                    "Accept": "application/fhir+json",
                },
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise NphiesError(f"NPHIES transaction failed: {exc}") from exc
        return resp.json()

    # -- public API (signatures per the sprint spec) --
    async def check_eligibility(self, patient_civil_id: str, payer_id: str) -> dict[str, Any]:
        """Build and send a CoverageEligibilityRequest."""
        bundle = build_eligibility_bundle(patient_civil_id, payer_id)

        if self.mode == "stub":
            logger.info("nphies_eligibility_stub", mode="stub")
            return {
                "mode": "stub",
                "eligible": True,
                "request_bundle": bundle,
                "response": {
                    "resourceType": "CoverageEligibilityResponse",
                    "outcome": "complete",
                    "disposition": "Stub connector -- canned development response, not a payer decision.",
                    "insurance": [{"inforce": True}],
                },
            }

        response = await self._post_bundle(bundle)
        # Metadata only in logs -- never patient identifiers (CLAUDE.md sec 7).
        logger.info("nphies_eligibility_sent", mode="live")
        return {"mode": "live", "request_bundle": bundle, "response": response}

    async def submit_prior_auth(
        self,
        encounter_id: str,
        icd10_code: str,
        sbs_code: str,
        clinical_document: bytes | str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Build and send a prior-authorization Claim, returning the interpreted
        badge state alongside the raw payer response."""
        bundle = build_prior_auth_bundle(
            encounter_id, icd10_code, sbs_code, clinical_document, **kwargs
        )

        if self.mode == "stub":
            # Stub authorization references are prefixed so a canned value can
            # never be mistaken for a real payer authorization in the UI or the
            # audit trail.
            stub_ref = f"STUB-NOT-A-REAL-AUTH-{uuid.uuid4().hex[:8].upper()}"
            response = {
                "resourceType": "ClaimResponse",
                "identifier": [
                    {"system": _system("identifier_systems", "claim"), "value": stub_ref}
                ],
                "outcome": "complete",
                "preAuthRef": stub_ref,
                "disposition": "Stub connector -- canned development response, not a payer decision.",
            }
            logger.info("nphies_prior_auth_stub", mode="stub")
            return {
                "mode": "stub",
                "request_bundle": bundle,
                "response": response,
                **interpret_claim_response(response),
            }

        response = await self._post_bundle(bundle)
        interpreted = interpret_claim_response(response)
        logger.info("nphies_prior_auth_sent", mode="live", status=interpreted["status"])
        return {"mode": "live", "request_bundle": bundle, "response": response, **interpreted}
