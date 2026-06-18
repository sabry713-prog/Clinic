"""Classifier model-layer selection: stub (default) or on-prem local model.

The model layer is the *fallback* for the ~5% of questions the deterministic
rules don't decide. It is fail-safe: any error or unparseable response yields
REFUSED, never a silent ALLOW.

PHI safety: the local endpoint MUST be in-Kingdom/on-prem (CLAUDE.md §7,
docs/architecture/on-prem-model.md). This never targets a public cloud API.
"""
from __future__ import annotations

import json

import httpx
import structlog
from classifier.model_layer import StubModelClassifier  # type: ignore[import-untyped]
from classifier.types import ClassifierResult  # type: ignore[import-untyped]

from .config import settings

logger = structlog.get_logger()

_SYSTEM = (
    "You are a safety classifier for a non-diagnostic clinical record assistant. "
    "Decide whether a clinician's question is a FACTUAL LOOKUP of documented record "
    "data (ALLOWED) or asks for interpretation, diagnosis, risk, prognosis, treatment, "
    "medication-safety, referral, trend, comparison, or red-flag judgement (REFUSED). "
    "When uncertain, choose REFUSED. "
    'Respond with ONLY compact JSON: {"label":"ALLOWED|REFUSED",'
    '"category":"<one of TREND_INTERPRETATION,DIAGNOSTIC_SUGGESTION,RISK_ASSESSMENT,'
    "TREATMENT_RECOMMENDATION,MEDICATION_SAFETY_JUDGMENT,REFERRAL_RECOMMENDATION,"
    "LAB_INTERPRETATION,PROGNOSTIC_QUESTION,RED_FLAG_IDENTIFICATION,COMPARATIVE_JUDGMENT,"
    'DIFFERENTIAL_DIAGNOSIS,OUT_OF_SCOPE,OTHER_INTERPRETIVE or null>"}'
)


class LocalModelClassifier:
    """Second-pass classifier backed by an on-prem OpenAI-compatible endpoint."""

    def __init__(self, endpoint_url: str, model_name: str, api_key: str = "EMPTY",
                 timeout_s: float = 30.0) -> None:
        self._url = endpoint_url.rstrip("/") + "/chat/completions"
        self._model = model_name
        self._api_key = api_key
        self._timeout = timeout_s

    def version(self) -> str:
        return f"local-classifier:{self._model}"

    async def classify(self, question: str, language: str) -> ClassifierResult:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"LANGUAGE: {language}\nQUESTION: {question}"},
            ],
            "temperature": 0.0,
            "max_tokens": 60,
            "stream": False,
        }
        headers = {"Authorization": f"Bearer {self._api_key}"}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(self._url, json=payload, headers=headers)
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
            verdict = json.loads(content)
            label = "ALLOWED" if str(verdict.get("label")).upper() == "ALLOWED" else "REFUSED"
        except Exception as exc:  # noqa: BLE001 — fail safe
            logger.warning("model_classifier_failed_failsafe_refuse", error=str(exc))
            return ClassifierResult(
                label="REFUSED", confidence=0.99, layer="model",
                refusal_category="OTHER_INTERPRETIVE", rule_matches=[],
                reason_for_caution="Model layer error — fail-safe refusal",
            )

        if label == "ALLOWED":
            return ClassifierResult(
                label="ALLOWED", confidence=0.85, layer="model",
                refusal_category=None, rule_matches=[],
            )
        return ClassifierResult(
            label="REFUSED", confidence=0.85, layer="model",
            refusal_category=verdict.get("category") or "OTHER_INTERPRETIVE",
            rule_matches=[], reason_for_caution="Model-layer interpretive judgement",
        )


def get_classifier_model() -> object:
    """Select the classifier model-layer provider (stub | local)."""
    if settings.qa_model_provider.lower() == "local" and settings.model_name:
        return LocalModelClassifier(
            endpoint_url=settings.model_endpoint_url,
            model_name=settings.model_name,
            api_key=settings.model_api_key,
            timeout_s=settings.model_timeout_s,
        )
    return StubModelClassifier()
