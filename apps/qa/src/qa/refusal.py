"""Deterministic refusal builder — no LLM involvement.

Safety-critical: refusal text must never contain interpretive language.
The blocklist filter is applied as a safety net even though text is template-driven.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any, Optional

from .fact_offer import (
    fetch_offerable_facts,
    format_allergies,
    format_conditions,
    format_labs,
    format_medications,
    format_values,
)
from .types import AnswerSource, RefusalResponse

if TYPE_CHECKING:
    import asyncpg

REFUSAL_TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "TREND_INTERPRETATION": (
            "I don't interpret clinical trends. Here are the documented {measurable} values:\n\n"
            "{values_list}\n\n"
            "Laboratory-provided reference range, when available, is shown alongside each value."
        ),
        "DIAGNOSTIC_SUGGESTION": (
            "I don't suggest diagnoses. The documented problems for this patient are:\n\n"
            "{conditions_list}"
        ),
        "RISK_ASSESSMENT": (
            "I don't perform risk assessments. I can show you specific documented facts "
            "if you have a more specific factual question."
        ),
        "TREATMENT_RECOMMENDATION": (
            "I don't recommend treatments. The currently documented active medications are:\n\n"
            "{medications_list}"
        ),
        "MEDICATION_SAFETY_JUDGMENT": (
            "I don't assess medication safety. The patient's current medications, allergies, "
            "and recent laboratory values are:\n\n"
            "Medications:\n{medications_list}\n\n"
            "Allergies:\n{allergies_list}\n\n"
            "Recent labs:\n{relevant_labs_list}"
        ),
        "DIFFERENTIAL_DIAGNOSIS": (
            "I don't suggest differential diagnoses. Documented problems and recent observations "
            "are available — ask me a specific factual question."
        ),
        "PROGNOSTIC_QUESTION": (
            "I don't predict outcomes. I can show you the current encounter status "
            "and history of prior admissions."
        ),
        "RED_FLAG_IDENTIFICATION": (
            "I don't identify clinical red flags. You can ask me specific factual questions "
            "about labs, vitals, medications, allergies, or documented problems."
        ),
        "COMPARATIVE_JUDGMENT": (
            "I show values without characterizing them as better or worse. "
            "Here are the values you asked about:\n\n{values_list}"
        ),
        "OUT_OF_SCOPE": (
            "I can only answer factual questions about the currently selected patient. "
            "Cross-patient or cohort questions are not supported in this version."
        ),
        "OTHER_INTERPRETIVE": (
            "I answer factual questions about this patient's record. The question you asked "
            "requires interpretation, which I do not perform. Please rephrase as a factual "
            "lookup, or review the record directly."
        ),
    },
    "ar": {
        "TREND_INTERPRETATION": (
            "لا أقوم بتفسير الاتجاهات السريرية. هذه هي القيم الموثقة:\n\n"
            "{values_list}\n\n"
            "النطاق المرجعي من المختبر معروض بجانب كل قيمة عند توفره."
        ),
        "DIAGNOSTIC_SUGGESTION": (
            "لا أقترح تشخيصات. المشاكل الموثقة لهذا المريض هي:\n\n"
            "{conditions_list}"
        ),
        "RISK_ASSESSMENT": (
            "لا أقوم بتقييم المخاطر. يمكنني عرض حقائق موثقة محددة إذا كان لديك سؤال أكثر تحديداً."
        ),
        "TREATMENT_RECOMMENDATION": (
            "لا أوصي بالعلاجات. الأدوية الفعّالة الموثقة حالياً هي:\n\n"
            "{medications_list}"
        ),
        "MEDICATION_SAFETY_JUDGMENT": (
            "لا أقيّم سلامة الأدوية. أدوية المريض الحالية والحساسيات والقيم المخبرية الأخيرة هي:\n\n"
            "الأدوية:\n{medications_list}\n\n"
            "الحساسيات:\n{allergies_list}\n\n"
            "المخبريات الأخيرة:\n{relevant_labs_list}"
        ),
        "DIFFERENTIAL_DIAGNOSIS": (
            "لا أقترح تشخيصات افتراضية. المشاكل الموثقة والملاحظات الأخيرة متاحة — "
            "اسألني سؤالاً واقعياً محدداً."
        ),
        "PROGNOSTIC_QUESTION": (
            "لا أتنبأ بالنتائج. يمكنني عرض حالة اللقاء الحالية وسجل الدخول السابق."
        ),
        "RED_FLAG_IDENTIFICATION": (
            "لا أحدد الإشارات التحذيرية السريرية. يمكنك سؤالي عن المخبريات أو العلامات الحيوية "
            "أو الأدوية أو الحساسيات أو المشاكل الموثقة."
        ),
        "COMPARATIVE_JUDGMENT": (
            "أعرض القيم دون توصيفها بالأفضل أو الأسوأ. "
            "هذه هي القيم التي سألت عنها:\n\n{values_list}"
        ),
        "OUT_OF_SCOPE": (
            "يمكنني فقط الإجابة على الأسئلة الواقعية عن المريض الحالي. "
            "الاستفسارات عن المرضى المتعددين أو المجموعة غير مدعومة في هذا الإصدار."
        ),
        "OTHER_INTERPRETIVE": (
            "أجيب على الأسئلة الواقعية حول سجل المريض. السؤال الذي طرحته يتطلب تفسيراً لا أقوم به. "
            "يرجى إعادة الصياغة كبحث واقعي، أو مراجعة السجل مباشرة."
        ),
    },
}

CATEGORIES_WITH_FACT_OFFERS = {
    "TREND_INTERPRETATION",
    "COMPARATIVE_JUDGMENT",
    "DIAGNOSTIC_SUGGESTION",
    "TREATMENT_RECOMMENDATION",
    "MEDICATION_SAFETY_JUDGMENT",
}

PROMPT_TEMPLATE_VERSION = "refusal-v1.0"


def _generic_refusal(language: str, category: str) -> RefusalResponse:
    """Fallback when blocklist triggers on our own template (should not happen)."""
    text = (
        "I answer factual questions about this patient's record. "
        "Please rephrase as a factual lookup."
        if language == "en"
        else "أجيب على الأسئلة الواقعية حول سجل المريض. يرجى إعادة الصياغة كبحث واقعي."
    )
    return RefusalResponse(text=text, sources=[], refusal_category=category)


async def build_refusal(
    question: str,
    category: str,
    patient_id: str,
    language: str,
    pool: Optional["asyncpg.Pool[Any]"],
) -> RefusalResponse:
    """
    Build a deterministic refusal response.
    No LLM is called. Blocklist is applied as a safety net.
    """
    lang = language if language in ("en", "ar") else "en"
    cat = category if category in REFUSAL_TEMPLATES["en"] else "OTHER_INTERPRETIVE"

    template = REFUSAL_TEMPLATES[lang][cat]

    offered: dict[str, Any] = {}
    sources: list[AnswerSource] = []

    if cat in CATEGORIES_WITH_FACT_OFFERS:
        offered = await fetch_offerable_facts(question, cat, patient_id, lang, pool)

    values_list = format_values(offered.get("values"), lang)  # type: ignore[arg-type]
    conditions_list = format_conditions(offered.get("conditions"), lang)  # type: ignore[arg-type]
    medications_list = format_medications(offered.get("medications"), lang)  # type: ignore[arg-type]
    allergies_list = format_allergies(offered.get("allergies"), lang)  # type: ignore[arg-type]
    relevant_labs_list = format_labs(offered.get("labs"), lang)  # type: ignore[arg-type]

    # Infer measurable term for TREND_INTERPRETATION template
    measurable = _infer_measurable_term(question) or ("values" if lang == "en" else "القيم")

    try:
        text = template.format(
            measurable=measurable,
            values_list=values_list,
            conditions_list=conditions_list,
            medications_list=medications_list,
            allergies_list=allergies_list,
            relevant_labs_list=relevant_labs_list,
        )
    except KeyError:
        text = template

    # Build sources from offered facts
    for val in offered.get("values", []):
        sources.append(
            AnswerSource(
                fact_segment=str(val.get("code_display") or val.get("code") or ""),
                type="Observation",
                id=str(val.get("id", "")),
                code=str(val.get("code") or ""),
                source_system="hospital",
                field="value_numeric",
            )
        )
    for med in offered.get("medications", []):
        sources.append(
            AnswerSource(
                fact_segment=str(med.get("medication_display") or ""),
                type="MedicationRequest",
                id=str(med.get("id", "")),
                code=str(med.get("code") or ""),
                source_system="hospital",
                field="medication_display",
            )
        )

    # Safety net: blocklist check (import here to avoid circular at module level)
    try:
        from blocklist import scan  # type: ignore[import-untyped]
        scan_result = scan(text, language=lang)
        if not scan_result.passed:
            return _generic_refusal(lang, cat)
    except ImportError:
        pass  # blocklist package not installed in test environment

    return RefusalResponse(text=text, sources=sources, refusal_category=cat)


def _infer_measurable_term(question: str) -> str | None:
    """Extract a human-readable measurable term from the question."""
    import re
    terms = [
        "creatinine", "kidney function", "renal function", "blood pressure",
        "hemoglobin", "sodium", "potassium", "glucose", "troponin",
        "bilirubin", "ALT", "AST", "WBC", "temperature", "heart rate",
        "oxygen saturation", "HbA1c", "albumin", "lactate",
    ]
    for term in terms:
        if re.search(re.escape(term), question, re.IGNORECASE):
            return term.lower()
    return None
