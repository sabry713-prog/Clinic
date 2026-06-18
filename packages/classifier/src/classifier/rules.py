"""Rule-based classifier layer.

All rules from docs/classifier/02-rules.md implemented here.
Safety-critical: do not modify without CTO + Clinical Advisor sign-off.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class RuleMatch:
    rule_id: str
    category: str
    span: tuple[int, int]


# When a question matches rules from more than one REFUSED category, the most
# specific category wins (lower number = more specific). This fixes category
# misattribution where a broad rule (e.g. "should I/we…", bare "recover") would
# otherwise shadow a precise one. It does NOT affect whether a question is
# refused — only which refusal category/template is shown. Kept in sync with
# docs/classifier/02-rules.md.
CATEGORY_PRECEDENCE: dict[str, int] = {
    "MEDICATION_SAFETY_JUDGMENT": 0,
    "REFERRAL_RECOMMENDATION": 1,
    "DIFFERENTIAL_DIAGNOSIS": 2,
    "PROGNOSTIC_QUESTION": 3,
    "RED_FLAG_IDENTIFICATION": 4,
    # TREND beats LAB so "becoming elevated" (directional) is a trend, while a
    # bare "is X elevated/abnormal" (no trend trigger) stays LAB.
    "TREND_INTERPRETATION": 5,
    "LAB_INTERPRETATION": 6,
    "COMPARATIVE_JUDGMENT": 7,
    "DIAGNOSTIC_SUGGESTION": 8,
    "RISK_ASSESSMENT": 9,
    "TREATMENT_RECOMMENDATION": 10,
    "OUT_OF_SCOPE": 11,
}


# ──────────────────────────────────────────────────────────────────────────────
# REFUSED rules — first match wins for matching; category chosen by precedence
# above when multiple categories match (most specific first within category)
# ──────────────────────────────────────────────────────────────────────────────

REFUSED_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    # TREND_INTERPRETATION
    (
        "TREND_INTERPRETATION",
        "TREND_INTERPRETATION:is_X_getting_worse",
        re.compile(
            r"\b(is|are|has|have)\b.{0,30}\b(getting|becoming|trending|growing)\b.{0,20}\b(worse|better|abnormal|elevated|low)\b",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
    (
        "TREND_INTERPRETATION",
        "TREND_INTERPRETATION:improving_or_worsening",
        re.compile(r"\b(improv|worsen|deteriorat|recover)(ing|ed)?\b", re.IGNORECASE),
    ),
    (
        "TREND_INTERPRETATION",
        "TREND_INTERPRETATION:trend_general",
        re.compile(r"\btrend(ing|s)?\b", re.IGNORECASE),
    ),
    (
        "TREND_INTERPRETATION",
        "TREND_INTERPRETATION:stable_or_unstable",
        re.compile(r"\b(stable|unstable|stabili[sz]ing)\b.{0,40}\?", re.IGNORECASE | re.DOTALL),
    ),
    (
        "TREND_INTERPRETATION",
        # Verb forms only — bare nouns تدهور/تحسن are dropped because they appear
        # in risk phrasing ("خطر التدهور" = risk of deterioration → RISK_ASSESSMENT).
        "TREND_INTERPRETATION:ar_tadahwur",
        re.compile(r"(يتدهور|تتدهور|يتحسن|تتحسن|تسوء|يسوء|اتجاه)"),
    ),
    (
        # Directional characterization of a value over time
        "TREND_INTERPRETATION",
        "TREND_INTERPRETATION:direction",
        re.compile(
            r"\b(dropping|dropped|rising|risen|climbing|falling|fallen|declining|plummeting|surging)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "TREND_INTERPRETATION",
        "TREND_INTERPRETATION:showing_change",
        re.compile(
            r"\b(show(s|ing)?|showed) (signs of )?(improvement|deterioration|worsening|decline|progression|تحسن|تدهور|a (rise|drop|fall|increase|decrease))\b"
            r"|\bsigns of (improvement|deterioration|تحسن|تدهور)",
            re.IGNORECASE,
        ),
    ),
    # DIAGNOSTIC_SUGGESTION (guarded — see _apply_refused_rules for exclusions)
    (
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:could_be_or_might_be",
        re.compile(
            r"\b(could|might|may|possibly)\b.{0,20}\b(be|have|indicate|represent|suggest)\b",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
    (
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:what_is_causing",
        re.compile(r"\bwhat (is|are|might|could) (caus|causing|behind)\b", re.IGNORECASE),
    ),
    (
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:diagnosis_question",
        re.compile(r"\b(diagnos(is|e)|differential|ddx)\b", re.IGNORECASE),
    ),
    (
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:ar_tashkhis",
        re.compile(r"\b(تشخيص|التشخيص|الأسباب المحتملة)\b"),
    ),
    (
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:do_you_think",
        re.compile(r"\bdo you think\b", re.IGNORECASE),
    ),
    (
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:consistent_with",
        re.compile(r"\bconsistent with\b", re.IGNORECASE),
    ),
    (
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:most_likely_wrong",
        re.compile(r"\b(most likely|what('?s| is) wrong with)\b", re.IGNORECASE),
    ),
    (
        # "Is this sepsis?" / "Is this pneumonia?" — naming a diagnosis.
        # Narrow: only fires on "is this <single-word>?" so it won't catch
        # "is this the latest value?" etc.
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:is_this_dx",
        re.compile(r"\bis this (a |an )?[a-z]+\?", re.IGNORECASE),
    ),
    (
        # Arabic: "what causes…", "…indicates/suggests…", "most likely"
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:ar_cause_indicate",
        re.compile(r"(يسبب|تسبب|ما الذي يسبب|تشير إلى|يشير إلى|تدل على|يدل على|على الأرجح)"),
    ),
    (
        # Arabic "is this <acute diagnosis>?" — naming a diagnosis. Enumerated
        # disease nouns keep false-positive risk near zero (vs. bare "هل هذا").
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:ar_is_this_dx",
        re.compile(r"هل هذا (الـ)?(إنتان|احتشاء|جلطة|سكتة|نزيف|انصمام|التهاب|عدوى|ورم|خثار|تسمم)"),
    ),
    (
        # Code-switching: "what is going on", "is it (an) infection?",
        # "هل هذا sepsis؟" (Arabic frame + Latin diagnosis name)
        "DIAGNOSTIC_SUGGESTION",
        "DIAGNOSTIC_SUGGESTION:code_switch_dx",
        re.compile(
            r"\bwhat is going on\b|\bis it (a |an )?(infection|sepsis|pneumonia|cancer|clot|stroke)\b"
            r"|هل هذا\s+[a-zA-Z]",
            re.IGNORECASE,
        ),
    ),
    # RISK_ASSESSMENT
    (
        "RISK_ASSESSMENT",
        "RISK_ASSESSMENT:at_risk",
        re.compile(r"\b(at|in) (risk|danger) (of|for|to)\b", re.IGNORECASE),
    ),
    (
        "RISK_ASSESSMENT",
        "RISK_ASSESSMENT:how_sick_serious",
        re.compile(r"\bhow (sick|serious|severe|bad|critical|stable)\b", re.IGNORECASE),
    ),
    (
        "RISK_ASSESSMENT",
        "RISK_ASSESSMENT:ar_khatar",
        re.compile(r"\b(معرض ل?خطر|في خطر|مدى الخطورة)\b"),
    ),
    (
        "RISK_ASSESSMENT",
        "RISK_ASSESSMENT:how_likely",
        re.compile(r"\bhow likely\b", re.IGNORECASE),
    ),
    (
        # Arabic: "severity/risk of the patient's condition", "prognosis/recovery outlook"
        "RISK_ASSESSMENT",
        "RISK_ASSESSMENT:ar_severity_prognosis",
        re.compile(r"(ما خطورة|مدى خطورة|خطورة وضع|توقعات الشفاء|توقعات التعافي|المآل|الإنذار)"),
    ),
    # TREATMENT_RECOMMENDATION
    (
        "TREATMENT_RECOMMENDATION",
        "TREATMENT_RECOMMENDATION:what_should_I",
        re.compile(
            r"\bwhat (should|would|could|do|do you|do I|can) (I|we|you|the doctor)\b.{0,40}\b(give|prescribe|do|order|start|stop|hold|increase|decrease|administer|recommend)\b",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
    (
        "TREATMENT_RECOMMENDATION",
        "TREATMENT_RECOMMENDATION:should_we",
        re.compile(r"\bshould (I|we|you|the team)\b", re.IGNORECASE),
    ),
    (
        "TREATMENT_RECOMMENDATION",
        "TREATMENT_RECOMMENDATION:recommend_or_suggest",
        re.compile(r"\b(recommend|suggest|advise)\b", re.IGNORECASE),
    ),
    (
        "TREATMENT_RECOMMENDATION",
        "TREATMENT_RECOMMENDATION:next_step",
        re.compile(r"\bnext step(s)?\b", re.IGNORECASE),
    ),
    (
        "TREATMENT_RECOMMENDATION",
        "TREATMENT_RECOMMENDATION:best_treatment",
        re.compile(
            r"\bbest (treatment|management|option|approach|antibiotic|drug|therapy)\b",
            re.IGNORECASE,
        ),
    ),
    (
        # "surgical candidate", "candidate for surgery/dialysis" — treatment suitability
        "TREATMENT_RECOMMENDATION",
        "TREATMENT_RECOMMENDATION:candidate",
        re.compile(r"\b(surgical candidate|candidate for)\b", re.IGNORECASE),
    ),
    (
        "TREATMENT_RECOMMENDATION",
        "TREATMENT_RECOMMENDATION:ar_madha_a3ti",
        re.compile(r"\b(ماذا أعطي|ماذا أصف|ماذا أفعل|الخطوة التالية|توصية)\b"),
    ),
    (
        # Arabic: "appropriate/best medication", "increase/adjust the dose"
        # (note: bare جرعة "dose" is NOT matched — that is a factual lookup)
        "TREATMENT_RECOMMENDATION",
        "TREATMENT_RECOMMENDATION:ar_appropriate_dose",
        re.compile(
            r"(الدواء المناسب|العلاج المناسب|الجرعة المناسبة|أفضل دواء|أفضل علاج|زيادة (ال)?جرعة|تعديل (ال)?جرعة|تخفيض (ال)?جرعة|يجب وصف|وصفه|المناسبة؟)"
        ),
    ),
    # MEDICATION_SAFETY_JUDGMENT
    (
        "MEDICATION_SAFETY_JUDGMENT",
        "MEDICATION_SAFETY_JUDGMENT:safe_in",
        re.compile(
            r"\b(safe|ok|appropriate|contraindicated)\b.{0,30}\b(in|for|with|despite|given|to)\b",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
    (
        # "contraindicated here" / "is it contraindicated?" — standalone judgment
        "MEDICATION_SAFETY_JUDGMENT",
        "MEDICATION_SAFETY_JUDGMENT:contraindicated",
        re.compile(r"\bcontraindicated\b", re.IGNORECASE),
    ),
    (
        "MEDICATION_SAFETY_JUDGMENT",
        "MEDICATION_SAFETY_JUDGMENT:will_interact",
        re.compile(r"\binteract(ion|ions|s|ing)?\b", re.IGNORECASE),
    ),
    (
        "MEDICATION_SAFETY_JUDGMENT",
        "MEDICATION_SAFETY_JUDGMENT:dose_adjustment",
        re.compile(r"\b(adjust|reduce|increase) (the )?dose\b", re.IGNORECASE),
    ),
    (
        # "Can I use contrast … given his kidney function?" — asking permission
        # to administer is a safety judgment.
        "MEDICATION_SAFETY_JUDGMENT",
        "MEDICATION_SAFETY_JUDGMENT:can_i_administer",
        re.compile(r"\bcan (i|we)\s+(use|give|start|continue|prescribe|administer)\b", re.IGNORECASE),
    ),
    (
        # Arabic: "is X safe…", "interaction between drugs"
        "MEDICATION_SAFETY_JUDGMENT",
        "MEDICATION_SAFETY_JUDGMENT:ar_safe_interact",
        re.compile(r"(آمن|آمنة|تفاعل|تفاعلات|موانع الاستعمال|مضاد استطباب)"),
    ),
    # DIFFERENTIAL_DIAGNOSIS
    (
        "DIFFERENTIAL_DIAGNOSIS",
        "DIFFERENTIAL_DIAGNOSIS:what_could_cause",
        re.compile(r"\bwhat (could|might|may) (cause|explain|account for)\b", re.IGNORECASE),
    ),
    # PROGNOSTIC_QUESTION
    (
        "PROGNOSTIC_QUESTION",
        "PROGNOSTIC_QUESTION:will_he",
        re.compile(
            r"\bwill (he|she|the patient|they) (need|require|develop|deteriorate|recover|improve|die|survive)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "PROGNOSTIC_QUESTION",
        "PROGNOSTIC_QUESTION:how_long",
        re.compile(r"\bhow long (until|before|will it take)\b", re.IGNORECASE),
    ),
    (
        "PROGNOSTIC_QUESTION",
        "PROGNOSTIC_QUESTION:prognosis",
        re.compile(r"\bprognosis\b", re.IGNORECASE),
    ),
    # RED_FLAG_IDENTIFICATION
    (
        "RED_FLAG_IDENTIFICATION",
        "RED_FLAG_IDENTIFICATION:concerning",
        re.compile(r"\b(anything )?(concerning|worrying|alarming|of concern)\b", re.IGNORECASE),
    ),
    (
        "RED_FLAG_IDENTIFICATION",
        "RED_FLAG_IDENTIFICATION:should_I_worry",
        re.compile(r"\bshould I (worry|be concerned|be worried)\b", re.IGNORECASE),
    ),
    (
        "RED_FLAG_IDENTIFICATION",
        "RED_FLAG_IDENTIFICATION:red_flag",
        re.compile(r"\bred flag(s)?\b", re.IGNORECASE),
    ),
    (
        # Arabic: قلق (worry/concern), مقلق (worrying), مثير للقلق (concerning),
        # يستدعي القلق (warrants concern), خطير (serious/dangerous)
        "RED_FLAG_IDENTIFICATION",
        "RED_FLAG_IDENTIFICATION:ar_qalaq",
        re.compile(r"(مثير للقلق|يستدعي القلق|\bمقلق(ة)?\b|\bالقلق\b|\bقلق(ة)?\b|\bخطير(ة)?\b)"),
    ),
    (
        # Arabic: "هل ... طبيعي/طبيعية" (is it normal?) — asks for value judgment
        "RED_FLAG_IDENTIFICATION",
        "RED_FLAG_IDENTIFICATION:ar_tabiei",
        re.compile(r"\bهل\b.{0,60}\bطبيعي(ة|ه)?\b", re.DOTALL),
    ),
    # LAB_INTERPRETATION — asking whether a value is abnormal/elevated/etc.
    # (a value judgment, vs. a factual "what is the value")
    (
        "LAB_INTERPRETATION",
        "LAB_INTERPRETATION:abnormal_elevated",
        re.compile(
            r"\b(abnormal|elevated|significant|too high|too low|dangerously|adequate|inadequate)\b"
            r"|\b(is|are|does)\b[^?]{0,40}\b(high|low|normal)\b"  # "is the creatinine high/normal?"
            r"|(مرتفع|منخفض|طبيعية النتيجة)",  # Arabic high/low (code-switching)
            re.IGNORECASE,
        ),
    ),
    # REFERRAL_RECOMMENDATION — asking whether to refer/consult/transfer
    (
        "REFERRAL_RECOMMENDATION",
        "REFERRAL_RECOMMENDATION:refer_consult",
        re.compile(
            r"\b(referral|refer (him|her|the patient|to)|consult(ed|ation)?|be consulted|transfer)\b",
            re.IGNORECASE,
        ),
    ),
    (
        # Arabic: referral/transfer to a service, request a consult, repeat a test
        "REFERRAL_RECOMMENDATION",
        "REFERRAL_RECOMMENDATION:ar_refer",
        re.compile(
            r"(تحويل (المريض )?(إلى|لطب|لقسم|للعناية|ل)|إحالة|طلب استشارة|استشارة \S+ية|تكرار (تحليل|الفحص|الاختبار)|إعادة (تحليل|الفحص|الاختبار))"
        ),
    ),
    # COMPARATIVE_JUDGMENT
    (
        "COMPARATIVE_JUDGMENT",
        "COMPARATIVE_JUDGMENT:worse_than",
        re.compile(r"\b(worse|better|higher|lower) than\b", re.IGNORECASE),
    ),
    (
        "COMPARATIVE_JUDGMENT",
        "COMPARATIVE_JUDGMENT:compared_to",
        # "compared to", "compare to/with/against", "versus/vs" — the temporal
        # comparison ("today vs yesterday", "compare to last admission") is a
        # value judgment, not a factual lookup.
        re.compile(r"\b(compared?\s+(to|with|against)|versus|vs\.?)\b", re.IGNORECASE),
    ),
    # OUT_OF_SCOPE
    (
        "OUT_OF_SCOPE",
        "OUT_OF_SCOPE:multi_patient",
        re.compile(
            r"\b(all patients|all the patients|every patient|across patients|cohort|patients with)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "OUT_OF_SCOPE",
        "OUT_OF_SCOPE:statistics",
        re.compile(
            r"\b(average|mean|median|how many patients|count of patients|percentage of patients)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "OUT_OF_SCOPE",
        "OUT_OF_SCOPE:ward_aggregate",
        re.compile(
            r"\b(in the ward|in the unit|on the floor|in ICU)\b.{0,30}\bhow many\b",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# ALLOWED rules — fire only when no REFUSED rule matched
# ──────────────────────────────────────────────────────────────────────────────

ALLOWED_RULES: list[tuple[str, str, re.Pattern[str]]] = [
    (
        "ALLOWED_FACTUAL",
        "ALLOWED_FACTUAL:value_lookup",
        re.compile(
            r"\bwhat (is|was|are|were) (the |his |her |their )?(last|latest|recent|current|first|admitting|documented)?\s?(value of |level of )?\b",
            re.IGNORECASE,
        ),
    ),
    (
        "ALLOWED_FACTUAL",
        "ALLOWED_FACTUAL:show_or_list",
        re.compile(r"\b(show|list|give|display)\s?(me )?\b", re.IGNORECASE),
    ),
    (
        "ALLOWED_FACTUAL",
        "ALLOWED_FACTUAL:when_or_date",
        re.compile(r"\bwhen (was|did|is)\b", re.IGNORECASE),
    ),
    (
        "ALLOWED_FACTUAL",
        "ALLOWED_FACTUAL:has_event_occurred",
        re.compile(
            r"\b(has|have|did) (he|she|the patient|they)\b.{0,20}\b(had|been|received|undergone|been admitted|been diagnosed)\b",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
]

# ──────────────────────────────────────────────────────────────────────────────
# Negative-example guards (ALLOWED overrides) — checked before REFUSED rules
# ──────────────────────────────────────────────────────────────────────────────

# Polite phrasing guard: "could you tell me" — should not fire DIAGNOSTIC_SUGGESTION
_COULD_YOU_TELL_ME = re.compile(r"\bcould you (tell|show|give|list|display)\b", re.IGNORECASE)

# Factual-diagnosis guard: asking for an already-DOCUMENTED diagnosis field is
# a factual lookup, not a request for the model to diagnose. Covers
# "admitting / documented / recorded / coded diagnosis".
_ADMITTING_DIAGNOSIS = re.compile(
    r"\b(admitting|documented|recorded|coded) (diagnosis|diagnos[ei]s)\b", re.IGNORECASE
)
_AR_ADMITTING_DIAGNOSIS = re.compile(r"\b(تشخيص الدخول|التشخيص الموثق|التشخيص المسجل)\b")


def _is_admitting_diagnosis_question(text: str) -> bool:
    """Return True if the question asks about a documented diagnosis field (ALLOWED)."""
    return bool(_ADMITTING_DIAGNOSIS.search(text)) or bool(_AR_ADMITTING_DIAGNOSIS.search(text))


def apply_rules(question: str) -> tuple[Optional[str], list[str]]:
    """
    Apply all rules to the question.

    Returns:
        (category_or_None, list_of_matched_rule_ids)
        category is None when no decisive rule fires (fall through to model).
        If a REFUSED rule fires, returns the refusal category.
        If only ALLOWED rules fire (and no REFUSED), returns "ALLOWED_FACTUAL".
    """
    refused_matches: list[str] = []
    matched_categories: list[str] = []

    for category, rule_id, pattern in REFUSED_RULES:
        m = pattern.search(question)
        if m is None:
            continue

        # Apply negative-example guards
        if rule_id in (
            "DIAGNOSTIC_SUGGESTION:could_be_or_might_be",
        ):
            if _COULD_YOU_TELL_ME.search(question):
                continue  # polite phrasing guard

        if rule_id in (
            "DIAGNOSTIC_SUGGESTION:diagnosis_question",
        ):
            if _is_admitting_diagnosis_question(question):
                continue  # admitting diagnosis guard

        if rule_id == "DIAGNOSTIC_SUGGESTION:ar_tashkhis":
            if _AR_ADMITTING_DIAGNOSIS.search(question):
                continue  # Arabic admitting diagnosis guard

        # Rule fires
        refused_matches.append(rule_id)
        matched_categories.append(category)

    if matched_categories:
        # Most specific category wins (see CATEGORY_PRECEDENCE)
        refused_category = min(
            matched_categories,
            key=lambda c: CATEGORY_PRECEDENCE.get(c, 99),
        )
        return refused_category, refused_matches

    # No REFUSED rule fired — check ALLOWED rules
    allowed_matches: list[str] = []
    for _category, rule_id, pattern in ALLOWED_RULES:
        if pattern.search(question):
            allowed_matches.append(rule_id)

    if allowed_matches:
        return "ALLOWED_FACTUAL", allowed_matches

    # No decisive rule — fall through to model
    return None, []
