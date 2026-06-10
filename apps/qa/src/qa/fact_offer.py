"""Fetch offerable facts for refusal responses.

Queries structured data from the database to provide factual context
alongside refusal messages.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    import asyncpg

# ──────────────────────────────────────────────────────────────────────────────
# Term → LOINC code group mapping
# ──────────────────────────────────────────────────────────────────────────────

TERM_TO_LOINC: dict[str, list[str]] = {
    "creatinine": ["2160-0"],
    "kidney function": ["2160-0", "3094-0"],
    "renal function": ["2160-0", "3094-0"],
    "bun": ["3094-0"],
    "blood pressure": ["8480-6", "8462-4"],
    "systolic": ["8480-6"],
    "diastolic": ["8462-4"],
    "hemoglobin": ["718-7"],
    "wbc": ["6690-2"],
    "white blood cell": ["6690-2"],
    "sodium": ["2951-2"],
    "potassium": ["2823-3"],
    "glucose": ["2345-7"],
    "hba1c": ["4548-4"],
    "troponin": ["10839-9"],
    "bilirubin": ["1975-2"],
    "alt": ["1742-6"],
    "ast": ["1920-8"],
    "albumin": ["1751-7"],
    "lactate": ["2524-7"],
    "oxygen saturation": ["59408-5"],
    "heart rate": ["8867-4"],
    "temperature": ["8310-5"],
}

_TERM_PATTERNS = {
    term: re.compile(re.escape(term), re.IGNORECASE) for term in TERM_TO_LOINC
}


def _infer_loinc_codes(question: str) -> list[str]:
    """Map question text to LOINC codes using the lookup table."""
    codes: list[str] = []
    for term, pattern in _TERM_PATTERNS.items():
        if pattern.search(question):
            codes.extend(TERM_TO_LOINC[term])
    # deduplicate
    seen: set[str] = set()
    result = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            result.append(c)
    return result


async def fetch_offerable_facts(
    question: str,
    category: str,
    patient_id: str,
    language: str,
    pool: Optional["asyncpg.Pool[Any]"],
) -> dict[str, list[dict[str, Any]]]:
    """
    Return structured facts to offer alongside the refusal message.
    Returns empty dicts gracefully when pool is None or queries fail.
    """
    if pool is None:
        return {}

    result: dict[str, list[dict[str, Any]]] = {}

    try:
        if category in ("TREND_INTERPRETATION", "COMPARATIVE_JUDGMENT"):
            loinc_codes = _infer_loinc_codes(question)
            if loinc_codes:
                rows = await pool.fetch(
                    """
                    SELECT code, code_display, value_numeric, value_text, unit,
                           ref_range_low, ref_range_high, ref_range_text, effective_at
                    FROM hospital.observation
                    WHERE patient_id = $1
                      AND code = ANY($2::text[])
                      AND status = 'final'
                    ORDER BY effective_at DESC
                    LIMIT 5
                    """,
                    patient_id,
                    loinc_codes,
                )
                result["values"] = [dict(r) for r in rows]

        elif category == "DIAGNOSTIC_SUGGESTION":
            rows = await pool.fetch(
                """
                SELECT code, code_display, status, onset_date
                FROM hospital.condition
                WHERE patient_id = $1 AND status = 'active'
                ORDER BY onset_date DESC
                LIMIT 20
                """,
                patient_id,
            )
            result["conditions"] = [dict(r) for r in rows]

        elif category == "TREATMENT_RECOMMENDATION":
            rows = await pool.fetch(
                """
                SELECT medication_display, code, dose, route, frequency, started_at
                FROM hospital.medication_request
                WHERE patient_id = $1 AND status = 'active'
                ORDER BY started_at DESC
                LIMIT 20
                """,
                patient_id,
            )
            result["medications"] = [dict(r) for r in rows]

        elif category == "MEDICATION_SAFETY_JUDGMENT":
            med_rows = await pool.fetch(
                """
                SELECT medication_display, code, dose, route, frequency, started_at
                FROM hospital.medication_request
                WHERE patient_id = $1 AND status = 'active'
                ORDER BY started_at DESC
                """,
                patient_id,
            )
            allergy_rows = await pool.fetch(
                """
                SELECT code_display, reaction
                FROM hospital.allergy
                WHERE patient_id = $1
                ORDER BY recorded_at DESC
                """,
                patient_id,
            )
            lab_rows = await pool.fetch(
                """
                SELECT code, code_display, value_numeric, value_text, unit,
                       ref_range_low, ref_range_high, ref_range_text, effective_at
                FROM hospital.observation
                WHERE patient_id = $1
                  AND code = ANY(ARRAY['2160-0','3094-0','1742-6','1920-8','1751-7'])
                ORDER BY effective_at DESC
                LIMIT 10
                """,
                patient_id,
            )
            result["medications"] = [dict(r) for r in med_rows]
            result["allergies"] = [dict(r) for r in allergy_rows]
            result["labs"] = [dict(r) for r in lab_rows]

    except Exception:  # noqa: BLE001
        # Graceful degradation — return what we have
        pass

    return result


# ──────────────────────────────────────────────────────────────────────────────
# Formatting helpers
# ──────────────────────────────────────────────────────────────────────────────


def format_values(values: list[dict[str, Any]] | None, language: str = "en") -> str:
    if not values:
        return "No values found." if language == "en" else "لا توجد قيم."
    lines = []
    for v in values:
        date = str(v.get("effective_at", ""))[:10]
        display = v.get("code_display") or v.get("code") or ""
        val = v.get("value_numeric") or v.get("value_text") or ""
        unit = v.get("unit") or ""
        ref_low = v.get("ref_range_low")
        ref_high = v.get("ref_range_high")
        ref_text = v.get("ref_range_text") or ""
        line = f"• {date} — {display} {val} {unit}".strip()
        if ref_low is not None and ref_high is not None:
            line += f" (reference range: {ref_low}–{ref_high} {unit})".strip()
        elif ref_text:
            line += f" ({ref_text})"
        lines.append(line)
    return "\n".join(lines)


def format_conditions(conditions: list[dict[str, Any]] | None, language: str = "en") -> str:
    if not conditions:
        return "No active conditions documented." if language == "en" else "لا توجد حالات موثقة."
    lines = []
    for c in conditions:
        display = c.get("code_display") or c.get("code") or ""
        onset = str(c.get("onset_date", ""))[:10]
        line = f"• {display}"
        if onset:
            line += f" (onset: {onset})"
        lines.append(line)
    return "\n".join(lines)


def format_medications(medications: list[dict[str, Any]] | None, language: str = "en") -> str:
    if not medications:
        return "No active medications documented." if language == "en" else "لا توجد أدوية موثقة."
    lines = []
    for m in medications:
        display = m.get("medication_display") or m.get("code") or ""
        dose = m.get("dose") or ""
        route = m.get("route") or ""
        freq = m.get("frequency") or ""
        parts = [display, dose, route, freq]
        line = "• " + " ".join(p for p in parts if p)
        lines.append(line)
    return "\n".join(lines)


def format_allergies(allergies: list[dict[str, Any]] | None, language: str = "en") -> str:
    if not allergies:
        return "No allergies documented." if language == "en" else "لا توجد حساسيات موثقة."
    lines = []
    for a in allergies:
        display = a.get("code_display") or ""
        reaction = a.get("reaction") or ""
        line = f"• {display}"
        if reaction:
            line += f" — {reaction}"
        lines.append(line)
    return "\n".join(lines)


def format_labs(labs: list[dict[str, Any]] | None, language: str = "en") -> str:
    return format_values(labs, language)
