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


# ──────────────────────────────────────────────────────────────────────────────
# REFUSED rules — ordered: first match wins (most specific first within category)
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
        "TREND_INTERPRETATION:ar_tadahwur",
        re.compile(r"\b(يتدهور|يتحسن|تدهور|تحسن|اتجاه)\b"),
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
        "TREATMENT_RECOMMENDATION:ar_madha_a3ti",
        re.compile(r"\b(ماذا أعطي|ماذا أصف|ماذا أفعل|الخطوة التالية|توصية)\b"),
    ),
    # MEDICATION_SAFETY_JUDGMENT
    (
        "MEDICATION_SAFETY_JUDGMENT",
        "MEDICATION_SAFETY_JUDGMENT:safe_in",
        re.compile(
            r"\b(safe|ok|appropriate|contraindicated)\b.{0,30}\b(in|for|with|despite|given)\b",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
    (
        "MEDICATION_SAFETY_JUDGMENT",
        "MEDICATION_SAFETY_JUDGMENT:will_interact",
        re.compile(r"\b(interact|interaction)\b", re.IGNORECASE),
    ),
    (
        "MEDICATION_SAFETY_JUDGMENT",
        "MEDICATION_SAFETY_JUDGMENT:dose_adjustment",
        re.compile(r"\b(adjust|reduce|increase) (the )?dose\b", re.IGNORECASE),
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
    # COMPARATIVE_JUDGMENT
    (
        "COMPARATIVE_JUDGMENT",
        "COMPARATIVE_JUDGMENT:worse_than",
        re.compile(r"\b(worse|better|higher|lower) than\b", re.IGNORECASE),
    ),
    (
        "COMPARATIVE_JUDGMENT",
        "COMPARATIVE_JUDGMENT:compared_to",
        re.compile(r"\bcompared to\b", re.IGNORECASE),
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

# Admitting diagnosis guard
_ADMITTING_DIAGNOSIS = re.compile(
    r"\badmitting (diagnosis|diagnos[ei]s)\b", re.IGNORECASE
)
_AR_ADMITTING_DIAGNOSIS = re.compile(r"\bتشخيص الدخول\b")


def _is_admitting_diagnosis_question(text: str) -> bool:
    """Return True if the question is asking about admitting diagnosis (ALLOWED)."""
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
    refused_category: Optional[str] = None

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
        if refused_category is None:
            refused_category = category

    if refused_category is not None:
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
