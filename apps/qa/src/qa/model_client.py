"""Model provider protocol and stub for Q&A synthesis."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable


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
    # Filler verbs/prepositions that appear in chunk boilerplate (e.g. an
    # encounter reads "... from <date> to <date>"), so they must not count
    # as retrieval signal or they match unrelated rows.
    "from", "into", "out", "off", "did", "made", "make", "makes", "making",
    "suffer", "suffers", "suffering", "suffered", "related", "relate",
    "relating", "relation", "been", "being", "had", "him", "she", "they",
    "them", "may", "can", "could", "would", "should", "get", "got", "there",
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
    "حالة": "condition", "حالات": "condition", "الحالات": "condition",
    "تشخيصات": "condition", "التشخيصات": "condition",
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

# Detail-style questions ask for the documented clinical picture of a case:
# the recorded symptoms, diagnostics, medications and the doctor's notes.
# Answered with a factual reproduction grouped into clinical sections. This
# restates what the record contains; it does NOT assert how anything was
# caused or resolved (that would be interpretation -- see CLAUDE.md 2-3).
#
# Deliberately excludes "diagnosis"/"treatment" and their Arabic equivalents:
# those phrasings read as asking the system to diagnose or recommend, which
# the classifier refuses upstream (correctly). The factual triggers below are
# the ones the classifier allows.
_DETAIL_TERMS = frozenset({
    "detail", "details", "تفاصيل",
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


def _is_detail_question(question: str) -> bool:
    tokens = re.findall(r"[\w^/%]+", question.lower())
    return any(
        t in _DETAIL_TERMS or _normalize_token(t) in _DETAIL_TERMS
        for t in tokens
    )


# Per-clinic breakdown: group the documented record by the clinic each fact
# was reported at. Triggered when the question names clinics AND asks for a
# per/each/by breakdown or the visit history.
_CLINIC_WORDS = ("clinic", "clinics", "عيادة", "عياده", "عيادات")
_GROUP_WORDS = (
    "each", "per", "every", "by clinic", "across", "visited", "visit", "visits",
    "كل", "لكل", "زار", "زيارة", "زياره", "زيارات",
)
# Pull the clinic name out of a chunk: "... reported at <X> Clinic ...",
# "<X> Clinic visit ...", or "... ward: <X> Clinic ...".
_CLINIC_RE = re.compile(
    r"(?:reported at|ward:)\s*([\w/]+(?: [\w/]+)*? Clinic)|\b([\w/]+(?: [\w/]+)*? Clinic) visit",
    re.IGNORECASE,
)
_REPORTED_AT_RE = re.compile(r"\s*\(reported at [^)]+\)")
_CODE_PAREN_RE = re.compile(r"\s*\(code: [^)]+\)")


def _is_per_clinic_question(question: str) -> bool:
    ql = question.lower()
    return any(c in ql for c in _CLINIC_WORDS) and any(g in ql for g in _GROUP_WORDS)


def _clinic_of(chunk: str) -> Optional[str]:
    m = _CLINIC_RE.search(chunk)
    if not m:
        return None
    return (m.group(1) or m.group(2)).strip()


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

        # Per-clinic breakdown: group the documented symptoms / diagnoses
        # (conditions) under the clinic each was reported at. Medications are
        # listed separately because the record does not tie them to a specific
        # clinic. Pure factual regrouping — no synthesis or interpretation.
        if _is_per_clinic_question(question):
            by_clinic: dict[str, list[str]] = {}
            meds: list[str] = []
            for chunk in chunk_matches:
                prefix = chunk.split(":", 1)[0].strip().lower()
                body = chunk.split(":", 1)[1].strip() if ":" in chunk else chunk
                if prefix == "condition":
                    clinic = _clinic_of(chunk) or "Other"
                    body = _REPORTED_AT_RE.sub("", body)
                    body = _CODE_PAREN_RE.sub("", body).strip()
                    by_clinic.setdefault(clinic, []).append(body)
                elif prefix == "medication":
                    meds.append(body)
            lines: list[str] = []
            for clinic in sorted(by_clinic):
                for body in by_clinic[clinic][:10]:
                    lines.append(f"• {clinic}: {body}")
            for med in meds[:8]:
                lines.append(f"• Medication: {med}")
            if not lines:
                return no_data
            return f"{preamble}\n" + "\n".join(lines)

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

        # Detail-style question: reproduce the documented clinical picture
        # grouped into sections in clinical order — symptoms/conditions,
        # diagnostics (labs & imaging), medications (treatment), allergies,
        # and the doctor's notes. Encounters are omitted as administrative.
        # Pure factual reproduction; the blocklist remains the final gate.
        if _is_detail_question(question):
            buckets: dict[str, list[str]] = {
                "condition": [], "diagnostic": [], "medication": [],
                "allergy": [], "note": [],
            }
            for chunk in chunk_matches:
                prefix = chunk.split(":", 1)[0].strip().lower()
                if prefix.startswith("note"):
                    buckets["note"].append(chunk)
                elif prefix == "condition":
                    buckets["condition"].append(chunk)
                elif prefix in ("laboratory", "imaging", "vital-signs"):
                    buckets["diagnostic"].append(chunk)
                elif prefix == "medication":
                    buckets["medication"].append(chunk)
                elif prefix == "allergy":
                    buckets["allergy"].append(chunk)
            caps = {
                "condition": 10, "diagnostic": 8, "medication": 8,
                "allergy": 4, "note": 4,
            }
            selected = []
            for key in ("condition", "diagnostic", "medication", "allergy", "note"):
                selected.extend(buckets[key][: caps[key]])
            if not selected:
                return no_data
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
