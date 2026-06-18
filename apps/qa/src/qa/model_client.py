"""Model provider protocol, stub, and on-prem local provider for Q&A synthesis."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import httpx


@dataclass
class ModelParams:
    temperature: float = 0.0
    top_p: float = 1.0
    max_tokens: int = 600
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0


@runtime_checkable
class ModelProvider(Protocol):
    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str: ...

    def version(self) -> str: ...


# Simple pattern to extract question from prompt
_QUESTION_RE = re.compile(r"QUESTION:\s*(.+?)(?:\n|$)", re.DOTALL)
_CHUNK_RE = re.compile(r'"content_text":\s*"([^"]{10,400})"')

# Question words that carry no retrieval signal
_STOPWORDS = frozenset({
    "what", "whats", "which", "when", "where", "who", "how", "does", "did",
    "the", "his", "her", "their", "this", "that", "about", "have", "has",
    "are", "was", "were", "any", "and", "for", "with", "show", "tell",
    "list", "give", "need", "know", "please", "patient", "patients",
    "record", "documented", "value", "values", "result", "results",
    "level", "levels", "latest", "last", "recent", "current", "now",
})

# Map common question terms to the chunk vocabulary used by retrieval
_TERM_ALIASES = {
    "allergies": "allergy", "allergic": "allergy",
    "medications": "medication", "meds": "medication", "drugs": "medication",
    "drug": "medication", "prescriptions": "medication", "prescription": "medication",
    "conditions": "condition", "problems": "condition", "diagnoses": "condition",
    "labs": "laboratory", "lab": "laboratory",
    "vitals": "vital", "notes": "note", "encounters": "encounter",
    "admissions": "encounter", "admission": "encounter", "visits": "encounter",
    "hb": "hemoglobin", "hgb": "hemoglobin",
    "bp": "blood pressure", "temp": "temperature",
    "cr": "creatinine", "glu": "glucose", "sugar": "glucose",
    # Arabic clinical vocabulary → English chunk vocabulary
    # (chunk text is English; Arabic questions must map to it)
    "اشعه": "imaging", "اشعة": "imaging", "اشاعات": "imaging", "اشاعه": "imaging",
    "أشعة": "imaging", "أشعه": "imaging", "تصوير": "imaging",
    "تحاليل": "laboratory", "تحليل": "laboratory", "مختبر": "laboratory",
    "فحوصات": "laboratory", "فحص": "laboratory",
    "ادويه": "medication", "ادوية": "medication", "أدوية": "medication",
    "دواء": "medication", "علاج": "medication", "علاجات": "medication",
    "وصفات": "medication", "وصفه": "medication",
    "حساسيه": "allergy", "حساسية": "allergy", "حساسيات": "allergy",
    "امراض": "condition", "مرض": "condition", "مشاكل": "condition",
    "سكر": "glucose", "السكري": "glucose", "جلوكوز": "glucose",
    "ضغط": "blood pressure", "حراره": "temperature", "حرارة": "temperature",
    "نبض": "heart rate", "اكسجين": "spo2", "أكسجين": "spo2",
    "هيموجلوبين": "hemoglobin", "كرياتينين": "creatinine",
    "صوديوم": "sodium", "بوتاسيوم": "potassium",
    "ملاحظات": "note", "تقارير": "note", "تقرير": "note",
    "تنويم": "encounter", "دخول": "encounter", "زيارات": "encounter",
    "علامات": "vital", "حيويه": "vital", "حيوية": "vital",
    "اعراض": "symptom", "أعراض": "symptom", "عرض": "symptom",
    "شكوى": "symptom", "شكاوى": "symptom",
    "عيادة": "clinic", "عياده": "clinic", "عيادات": "clinic",
    # Arabic symptom names → English chunk vocabulary (seeded symptom set)
    "صداع": "headache",
    "دوخة": "dizziness", "دوخه": "dizziness", "دوار": "dizziness",
    "سعال": "cough", "كحة": "cough", "كحه": "cough",
    "غثيان": "nausea", "استفراغ": "nausea",
    "تعب": "fatigue", "ارهاق": "fatigue", "إرهاق": "fatigue", "خمول": "fatigue",
    "الم": "pain", "ألم": "pain", "آلام": "pain", "الام": "pain", "وجع": "pain",
    "صدر": "chest", "بطن": "abdominal", "ظهر": "back",
    "مفاصل": "joint", "مفصل": "joint",
    "حلق": "throat", "زور": "throat",
    "خفقان": "palpitations",
    "تنفس": "breath", "نهجان": "breath",
    "تنميل": "numbness", "خدر": "numbness", "خدران": "numbness",
    "رؤية": "vision", "رؤيه": "vision", "نظر": "vision",
    "عين": "eye", "عيون": "eye",
    "اذن": "ear", "أذن": "ear",
    "ارق": "insomnia", "أرق": "insomnia",
    "حكة": "itching", "حكه": "itching", "هرش": "itching",
    "عطاس": "sneezing",
    "رعشة": "tremor", "رعشه": "tremor", "رجفة": "tremor", "رجفه": "tremor",
    "تورم": "swelling", "انتفاخ": "swelling", "كاحل": "ankle",
    "عطش": "thirst", "تبول": "urination",
    # English plurals → singular used in chunk text
    "symptoms": "symptom", "clinics": "clinic", "headaches": "headache",
}

# Summary-style questions ask for the record as a whole rather than one
# record type; answered with a factual cross-section instead of keyword match
_SUMMARY_TERMS = frozenset({
    "summary", "summarize", "summarise", "overview", "history",
    "ملخص", "موجز", "نبذة", "نبذه", "خلاصة", "خلاصه", "تلخيص", "تاريخ",
})

# Arabic stopwords (question filler that carries no retrieval signal)
_STOPWORDS_AR = frozenset({
    "ما", "ماذا", "هل", "كيف", "متى", "اين", "أين", "من", "عن", "في", "على",
    "هي", "هو", "هذا", "هذه", "ذلك", "محتاج", "محتاجه", "اعرف", "أعرف",
    "اريد", "أريد", "ابغى", "أبغى", "تفاصيل", "اكتر", "أكثر", "اكثر",
    "المريض", "المريضه", "المريضة", "السابقه", "السابقة", "الحاليه", "الحالية",
    "الاخيره", "الأخيرة", "الاخيرة", "نتائج", "نتيجة", "قيم", "قيمة",
    # question filler: "did he suffer / complain ... before / previously"
    "عانى", "يعاني", "تعاني", "عانت", "اشتكى", "يشتكي", "تشتكي", "اشتكت",
    "مسبق", "مسبقا", "سابق", "سابقا", "قبل", "يوجد", "توجد", "فيه", "عند", "لديه", "لديها",
})


def _normalize_token(t: str) -> str:
    # Strip Arabic definite article so "الاشاعات" matches "اشاعات"
    if len(t) > 4 and t.startswith("ال"):
        return t[2:]
    return t


def _is_summary_question(question: str) -> bool:
    tokens = re.findall(r"[\w^/%]+", question.lower())
    return any(
        t in _SUMMARY_TERMS or _normalize_token(t) in _SUMMARY_TERMS
        for t in tokens
    )


def _question_terms(question: str) -> list[str]:
    # \w covers Arabic letters in Python 3 and excludes Arabic punctuation (، ؛ ؟)
    tokens = re.findall(r"[\w^/%]+", question.lower())
    terms = []
    for raw in tokens:
        for t in (raw, _normalize_token(raw)):
            if t in _STOPWORDS or t in _STOPWORDS_AR:
                break
            if t in _TERM_ALIASES:
                terms.append(_TERM_ALIASES[t])
                break
        else:
            if len(raw) >= 3:
                terms.append(raw)
    return terms


class StubModelProvider:
    """
    Stub model provider for testing.
    Produces factual-only answers that always pass the blocklist.
    Selects retrieved chunks by keyword overlap with the question.
    """

    def version(self) -> str:
        return "stub-qa-v1"

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
        # Extract question and requested language
        q_match = _QUESTION_RE.search(user_prompt)
        question = q_match.group(1).strip() if q_match else ""
        lang_match = re.search(r"LANGUAGE:\s*(\w+)", user_prompt)
        lang = lang_match.group(1).strip().lower() if lang_match else "en"
        no_data = (
            "لا توجد بيانات مطابقة في سجل هذا المريض."
            if lang == "ar"
            else "No matching data found in this patient's record."
        )
        preamble = "حسب السجل الموثق:" if lang == "ar" else "Based on the documented record:"

        # Extract chunk contents for grounding
        chunk_matches = _CHUNK_RE.findall(user_prompt)
        if not chunk_matches:
            return no_data

        # Summary-style question: reproduce a cross-section of the record,
        # round-robin across record types so no single type dominates.
        # Factual reproduction only — no synthesis or prioritization.
        if _is_summary_question(question):
            by_type: dict[str, list[str]] = {}
            for chunk in chunk_matches:
                kind = chunk.split(":", 1)[0].strip().lower()
                by_type.setdefault(kind, []).append(chunk)
            queues = list(by_type.values())
            selected: list[str] = []
            i = 0
            while len(selected) < 8 and any(queues):
                queue = queues[i % len(queues)]
                if queue:
                    selected.append(queue.pop(0))
                i += 1
            bullets = "\n".join(f"• {c}" for c in selected)
            return f"{preamble}\n{bullets}"

        # Score chunks by how many question terms they contain
        terms = _question_terms(question)
        scored: list[tuple[int, str]] = []
        for chunk in chunk_matches:
            content_lower = chunk.lower()
            score = sum(1 for t in terms if t in content_lower)
            if score > 0:
                scored.append((score, chunk))

        if not scored:
            return no_data

        scored.sort(key=lambda s: s[0], reverse=True)
        top = [c for _, c in scored[:8]]
        if len(top) == 1:
            return f"{preamble} {top[0]}"
        bullets = "\n".join(f"• {c}" for c in top)
        return f"{preamble}\n{bullets}"


class LocalModelProvider:
    """
    On-prem model provider calling an OpenAI-compatible /chat/completions endpoint
    (e.g. vLLM or Ollama running in-Kingdom). No data leaves the premises.

    PHI safety: the endpoint MUST be a local/in-Kingdom server (see
    docs/architecture/on-prem-model.md and CLAUDE.md §7). This client never
    targets a public cloud API.
    """

    def __init__(
        self,
        endpoint_url: str,
        model_name: str,
        api_key: str = "EMPTY",
        timeout_s: float = 30.0,
    ) -> None:
        self._url = endpoint_url.rstrip("/") + "/chat/completions"
        self._model = model_name
        self._api_key = api_key
        self._timeout = timeout_s

    def version(self) -> str:
        return f"local:{self._model}"

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        params: ModelParams,
    ) -> str:
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
    """Select the synthesis model provider from settings (stub | local)."""
    from .config import settings

    if settings.qa_model_provider.lower() == "local" and settings.model_name:
        return LocalModelProvider(
            endpoint_url=settings.model_endpoint_url,
            model_name=settings.model_name,
            api_key=settings.model_api_key,
            timeout_s=settings.model_timeout_s,
        )
    return StubModelProvider()
