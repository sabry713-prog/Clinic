"""Model provider protocol, stub, and on-prem local provider."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx


@dataclass
class ModelParams:
    temperature: float = 0.1
    top_p: float = 0.9
    max_tokens: int = 1200
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0


@runtime_checkable
class ModelProvider(Protocol):
    """Protocol that all LLM backends must satisfy."""

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
        """Return generated text given system + user prompts."""
        ...

    def version(self) -> str:
        """Return a string identifier for the model / configuration."""
        ...


class StubModelProvider:
    """Returns a canned factual narrative for testing.

    The returned text is designed to pass the blocklist 100% of the time:
    - No interpretive verbs
    - No trend language
    - No recommendations
    - No alert language
    - Values always accompanied by reference ranges when present
    """

    def version(self) -> str:  # noqa: D102
        return "stub-v1"

    @staticmethod
    def _extract_json(user_prompt: str, start_marker: str, end_marker: str) -> object:
        """Extract the JSON blob between two section markers in the user prompt."""
        try:
            idx = user_prompt.find(start_marker)
            end_idx = user_prompt.find(end_marker)
            if idx == -1 or end_idx == -1:
                return None
            blob = user_prompt[idx:end_idx]
            # JSON starts after the marker line (which may include a trailing colon/text)
            brace = min(
                (i for i in (blob.find("{"), blob.find("[")) if i != -1),
                default=-1,
            )
            if brace == -1:
                return None
            return json.loads(blob[brace:].strip())
        except (json.JSONDecodeError, ValueError):
            return None

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
        """Extract structured data from user_prompt and build a factual narrative.

        Bilingual: structural labels/section titles render in the requested
        language; clinical values (names, codes, numbers, dates, units) are kept
        verbatim in source form per CLAUDE.md §8.
        """
        ex = self._extract_json
        demographics = ex(user_prompt, "PATIENT DEMOGRAPHICS", "CURRENT ENCOUNTER:") or {}
        conditions = ex(user_prompt, "DOCUMENTED PROBLEMS / CONDITIONS:", "DOCUMENTED ALLERGIES:") or []
        allergies = ex(user_prompt, "DOCUMENTED ALLERGIES:", "ACTIVE MEDICATIONS:") or []
        medications = ex(user_prompt, "ACTIVE MEDICATIONS:", "RECENT OBSERVATIONS") or []
        observations = ex(user_prompt, "RECENT OBSERVATIONS", "RECENT DOCUMENTS") or []
        documents = ex(user_prompt, "RECENT DOCUMENTS", "PRIOR ADMISSIONS:") or []
        priors = ex(user_prompt, "PRIOR ADMISSIONS:", "\nOUTPUT") or []
        if not isinstance(demographics, dict):
            demographics = {}

        lang_match = re.search(r"LANGUAGE:\s*(\w+)", user_prompt)
        ar = bool(lang_match and lang_match.group(1).strip().lower() == "ar")

        # Label sets — Arabic vs English. Only structural text is localized.
        L = {
            "titles": [
                "١. السياق التعريفي والدخول", "٢. المشاكل النشطة الموثقة",
                "٣. الحساسيات الموثقة", "٤. الأدوية الحالية",
                "٥. الملاحظات الموثقة الحديثة", "٦. مراجع التوثيق الحديثة",
                "٧. حالات الدخول السابقة",
            ] if ar else [
                "1. Identity and Admission Context", "2. Documented Active Problems",
                "3. Documented Allergies", "4. Current Medications",
                "5. Recent Documented Observations", "6. Recent Documentation References",
                "7. Prior Admissions",
            ],
            "status": "الحالة" if ar else "status",
            "onset": "تاريخ البدء" if ar else "onset",
            "reaction": "رد الفعل الموثق" if ar else "documented reaction",
            "recorded": "تاريخ التسجيل" if ar else "recorded",
            "started": "تاريخ البدء" if ar else "started",
            "ref": "النطاق المرجعي" if ar else "reference range",
            "recorded_in": "سُجِّل في" if ar else "recorded",
            "author": "المؤلف" if ar else "author",
            "dated": "بتاريخ" if ar else "dated",
            "from": "من" if ar else "from",
            "to": "إلى" if ar else "to",
            "no_problems": "لا توجد مشاكل نشطة موثقة." if ar else "No active problems documented.",
            "no_allergies": "لا توجد حساسيات موثقة." if ar else "No allergies documented.",
            "no_meds": "لا توجد أدوية نشطة موثقة." if ar else "No active medications documented.",
            "no_obs": "لا توجد ملاحظات حديثة موثقة." if ar else "No recent observations documented.",
            "no_docs": "لا توجد مستندات حديثة في السجل." if ar else "No recent documents in the record.",
            "no_priors": "لا توجد حالات دخول سابقة موثقة." if ar else "No prior admissions documented.",
        }

        display_name = str(demographics.get("display_name") or ("المريض" if ar else "the patient"))
        dob = demographics.get("date_of_birth")
        sex_raw = str(demographics.get("sex") or "")
        sex = ({"male": "ذكر", "female": "أنثى"}.get(sex_raw.lower(), sex_raw)) if ar else sex_raw
        ward = demographics.get("ward") or ("الجناح الموثق" if ar else "the documented ward")

        def _fmt_condition(c: dict) -> str:
            parts = [str(c.get("code_display") or c.get("code") or ("حالة غير محددة" if ar else "Unspecified condition"))]
            if c.get("clinical_status"):
                parts.append(f"{L['status']}: {c['clinical_status']}")
            if c.get("onset_date"):
                parts.append(f"{L['onset']}: {c['onset_date']}")
            return ("، " if ar else ", ").join(parts) + "."

        def _fmt_allergy(a: dict) -> str:
            parts = [str(a.get("code_display") or ("مُحسِّس غير محدد" if ar else "Unspecified allergen"))]
            if a.get("reaction"):
                parts.append(f"{L['reaction']}: {a['reaction']}")
            if a.get("recorded_at"):
                parts.append(f"{L['recorded']}: {a['recorded_at']}")
            return ("، " if ar else ", ").join(parts) + "."

        def _fmt_medication(m: dict) -> str:
            parts = [str(m.get("medication_display") or m.get("code") or ("دواء غير محدد" if ar else "Unspecified medication"))]
            for key in ("dose", "route", "frequency"):
                if m.get(key):
                    parts.append(str(m[key]))
            if m.get("started_at"):
                parts.append(f"{L['started']}: {m['started_at']}")
            return ("، " if ar else ", ").join(parts) + "."

        def _fmt_observation(o: dict) -> str:
            label = str(o.get("code_display") or o.get("code") or ("ملاحظة" if ar else "Observation"))
            if o.get("value_numeric") is not None:
                value = f"{o['value_numeric']} {o.get('unit') or ''}".strip()
            else:
                value = str(o.get("value_text") or ("لا قيمة موثقة" if ar else "no value documented"))
            ref = ""
            if o.get("ref_range_low") is not None and o.get("ref_range_high") is not None:
                unit = f" {o['unit']}" if o.get("unit") else ""
                ref = f" ({L['ref']}: {o['ref_range_low']}-{o['ref_range_high']}{unit})"
            elif o.get("ref_range_text"):
                ref = f" ({L['ref']}: {o['ref_range_text']})"
            when = f"، {L['recorded_in']} {o['effective_at']}" if (ar and o.get("effective_at")) else (f", {L['recorded_in']} {o['effective_at']}" if o.get("effective_at") else "")
            return f"{label}: {value}{ref}{when}."

        def _fmt_document(d: dict) -> str:
            parts = [str(d.get("type_display") or ("مستند" if ar else "Document"))]
            if d.get("author_display"):
                parts.append(f"{L['author']}: {d['author_display']}")
            if d.get("authored_at"):
                parts.append(f"{L['dated']}: {d['authored_at']}")
            return ("، " if ar else ", ").join(parts) + "."

        def _fmt_prior(p: dict) -> str:
            parts = [str(p.get("encounter_type") or ("زيارة" if ar else "Encounter"))]
            if p.get("started_at"):
                parts.append(f"{L['from']} {p['started_at']}")
            if p.get("ended_at"):
                parts.append(f"{L['to']} {p['ended_at']}")
            return " ".join(parts) + "."

        def _section(items: object, fmt, empty: str) -> list[str]:
            if isinstance(items, list) and items:
                return [fmt(i) for i in items if isinstance(i, dict)]
            return [empty]

        if ar:
            identity = (
                f"{display_name} موثق كمريض"
                + (f" (تاريخ الميلاد: {dob})" if dob else "")
                + (f"، الجنس: {sex}" if sex else "")
                + f"، تم إدخاله إلى {ward}."
            )
        else:
            identity = (
                f"{display_name} is documented as a patient"
                + (f" (date of birth: {dob})" if dob else "")
                + (f", sex: {sex}" if sex else "")
                + f", admitted to {ward}."
            )

        t = L["titles"]
        lines = [
            t[0], identity, "",
            t[1], *_section(conditions, _fmt_condition, L["no_problems"]), "",
            t[2], *_section(allergies, _fmt_allergy, L["no_allergies"]), "",
            t[3], *_section(medications, _fmt_medication, L["no_meds"]), "",
            t[4], *_section(observations, _fmt_observation, L["no_obs"]), "",
            t[5], *_section(documents, _fmt_document, L["no_docs"]), "",
            t[6], *_section(priors, _fmt_prior, L["no_priors"]),
        ]
        return "\n".join(lines)


class LocalModelProvider:
    """
    On-prem model provider calling an OpenAI-compatible /chat/completions endpoint
    (vLLM/Ollama, in-Kingdom). No data leaves the premises — see
    docs/architecture/on-prem-model.md and CLAUDE.md §7. Never a public cloud API.
    """

    def __init__(self, endpoint_url: str, model_name: str, api_key: str = "EMPTY",
                 timeout_s: float = 60.0) -> None:
        self._url = endpoint_url.rstrip("/") + "/chat/completions"
        self._model = model_name
        self._api_key = api_key
        self._timeout = timeout_s

    def version(self) -> str:
        return f"local:{self._model}"

    async def complete(self, system_prompt: str, user_prompt: str,
                       params: ModelParams) -> str:
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": params.temperature,
            "top_p": params.top_p,
            "max_tokens": params.max_tokens,
            "frequency_penalty": params.frequency_penalty,
            "presence_penalty": params.presence_penalty,
            "stream": False,
        }
        headers = {"Authorization": f"Bearer {self._api_key}"}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(self._url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        return str(data["choices"][0]["message"]["content"]).strip()


def get_model() -> ModelProvider:
    """Select the narrative model provider from settings (stub | local)."""
    from .config import settings

    if settings.narrative_model_provider.lower() == "local" and settings.model_name:
        return LocalModelProvider(
            endpoint_url=settings.model_endpoint_url,
            model_name=settings.model_name,
            api_key=settings.model_api_key,
            timeout_s=settings.model_timeout_s,
        )
    return StubModelProvider()
