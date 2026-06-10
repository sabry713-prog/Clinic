"""Compiled regex patterns for the interpretive-language blocklist.

English patterns: case-insensitive, word-boundary, UNICODE.
Arabic patterns: word-boundary (\\b works on Arabic word chars with UNICODE flag).
"""
from __future__ import annotations

import re

from .types import Category

_FLAGS = re.IGNORECASE | re.UNICODE


def _compile(patterns: list[str]) -> list[re.Pattern[str]]:
    return [re.compile(p, _FLAGS) for p in patterns]


# ── English patterns ──────────────────────────────────────────────────────────

EN_PATTERNS: dict[Category, list[re.Pattern[str]]] = {
    Category.INTERPRETIVE_VERB: _compile([
        r"\bsuggests?\b",
        r"\bindicates?\b",
        r"\bimplies\b",
        r"\bappears? to be\b",
        r"\bseems\b",
        r"\blooks? like\b",
        r"\bconsistent with\b",
        r"\bcompatible with\b",
    ]),
    Category.CLINICAL_JUDGMENT_ADJECTIVE: _compile([
        r"\bconcerning\b",
        r"\bnoteworthy\b",
        r"\b(?:clinically )?significant\b",
        r"\babnormal(?:ly)?\b",
        r"\belevated\b",
        r"\bdepressed\b",
        r"\bsuboptimal\b",
        r"\bcritical(?:ly)?\b",
        r"\bsevere(?:ly)?\b",
    ]),
    Category.TREND_LANGUAGE: _compile([
        r"\bworsening\b",
        r"\bdeteriorat(?:ing|ion)\b",
        r"\bimprov(?:ing|ement)\b",
        r"\b(?:up|down) ?trend(?:ing)?\b",
        r"\btrending (?:up|down|upward|downward)\b",
        r"\brising\b",
        r"\bfalling\b",
        r"\bdeclin(?:ing|e)\b",
        r"\bclimbing?\b",
        r"\bdropp(?:ing|ed)\b",
    ]),
    Category.RECOMMENDATION: _compile([
        r"\bconsider(?:ing)?\b",
        r"\brecommend(?:ed|ation)?\b",
        r"\badvised?\b",
        r"\bshould (?:be|consider|order|hold|avoid|start|stop)\b",
        r"\bsuggested?\b",
        r"\bnext steps?\b",
        r"\bplanning? to\b",
        r"\bwarrant(?:s|ed)?\b",
    ]),
    Category.ALERT_LANGUAGE: _compile([
        r"\bwatch (?:out )?for\b",
        r"\bmonitor for\b",
        r"\bbe aware\b",
        r"\balert\b",
        r"\bflag\b",
        r"\bcaution\b",
        r"\bwarn(?:ing)?\b",
        r"\battention to\b",
    ]),
    Category.DIAGNOSTIC_INFERENCE: _compile([
        r"\brule out\b",
        r"\bdifferential(?: diagnosis)?\b",
        r"\bpossible diagnosis\b",
        r"\bcould be\b",
        r"\bmight be\b",
        r"\bmay represent\b",
        r"\blikely (?:diagnosis|cause|due to)\b",
    ]),
    Category.RISK_LANGUAGE: _compile([
        r"\bat risk (?:of|for)\b",
        r"\b(?:high|low|increased) risk\b",
        r"\blikely to (?:develop|deteriorate|need|require)\b",
        r"\bwill likely (?:develop|deteriorate|need|require)\b",
        r"\brisk (?:of|for)\b",
        r"\bprobability of (?:developing|having)\b",
    ]),
    Category.PROGNOSTIC: _compile([
        r"\bwill (?:improve|deteriorate|recover|need|require)\b",
        r"\bwill develop\b",
        r"\bexpect(?:ed)? to\b",
        r"\banticipated?\b",
        r"\bprognosis\b",
    ]),
}

# ── Arabic patterns ───────────────────────────────────────────────────────────

AR_PATTERNS: dict[Category, list[re.Pattern[str]]] = {
    Category.INTERPRETIVE_VERB: _compile([
        r"\bيشير إلى\b",
        r"\bيدل على\b",
        r"\bيعكس\b",
        r"\bيوحي\b",
        r"\bيبدو\b",
        r"\bمتوافق مع\b",
    ]),
    Category.CLINICAL_JUDGMENT_ADJECTIVE: _compile([
        r"\bمقلق[ةه]?\b",
        r"\bخطير[ةه]?\b",
        r"\bغير طبيعي\b",
        r"\bمرتفع[ةه]?\b",
        r"\bمنخفض[ةه]?\b",
        r"\bحرج[ةه]?\b",
        r"\bشديد[ةه]?\b",
    ]),
    Category.TREND_LANGUAGE: _compile([
        r"\bيتدهور\b",
        r"\bيتحسن\b",
        r"\bتدهور\b",
        r"\bتحسن\b",
        r"\bارتفاع\b",
        r"\bانخفاض\b",
        r"\bتراجع\b",
    ]),
    Category.RECOMMENDATION: _compile([
        r"\bأنصح\b",
        r"\bأوصي\b",
        r"\bيُنصح\b",
        r"\bيُوصى\b",
        r"\bالخطوة التالية\b",
        r"\bالخطوات التالية\b",
        r"\bيجب\b",
        r"\bينبغي\b",
    ]),
    Category.ALERT_LANGUAGE: _compile([
        r"\bانتبه إلى\b",
        r"\bحذار\b",
        r"\bتحذير\b",
        r"\bراقب\b",
    ]),
    Category.DIAGNOSTIC_INFERENCE: _compile([
        r"\bتشخيص محتمل\b",
        r"\bقد يكون\b",
        r"\bربما\b",
        r"\bمحتمل أن\b",
    ]),
    Category.RISK_LANGUAGE: _compile([
        r"\bمعرض لخطر\b",
        r"\bخطر الإصابة\b",
        r"\bاحتمال\b",
    ]),
    Category.PROGNOSTIC: _compile([
        r"\bالإنذار\b",
        r"\bمن المتوقع\b",
        r"\bسوف يحتاج\b",
        r"\bسوف يتدهور\b",
    ]),
}
