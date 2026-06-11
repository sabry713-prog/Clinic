"""Tests for rule-based classifier layer.

Every positive + negative example from docs/classifier/02-rules.md.
"""
from __future__ import annotations

import pytest
from classifier.rules import apply_rules


# ──────────────────────────────────────────────────────────────────────────────
# TREND_INTERPRETATION
# ──────────────────────────────────────────────────────────────────────────────

class TestTrendInterpretation:
    def test_is_getting_worse(self):
        cat, matches = apply_rules("Is his creatinine getting worse?")
        assert cat == "TREND_INTERPRETATION"

    def test_is_becoming_elevated(self):
        cat, _ = apply_rules("Are the values becoming elevated?")
        assert cat == "TREND_INTERPRETATION"

    def test_improving(self):
        cat, _ = apply_rules("Is the patient improving?")
        assert cat == "TREND_INTERPRETATION"

    def test_worsening(self):
        cat, _ = apply_rules("Is his kidney function worsening?")
        assert cat == "TREND_INTERPRETATION"

    def test_trending(self):
        cat, _ = apply_rules("What is his creatinine trending?")
        assert cat == "TREND_INTERPRETATION"

    def test_stable_question(self):
        cat, _ = apply_rules("Is he stable?")
        assert cat == "TREND_INTERPRETATION"

    def test_unstable(self):
        cat, _ = apply_rules("Is he unstable?")
        assert cat == "TREND_INTERPRETATION"

    def test_ar_tadahwur(self):
        cat, _ = apply_rules("هل يتدهور وضعه؟")
        assert cat == "TREND_INTERPRETATION"

    def test_ar_tahassun(self):
        cat, _ = apply_rules("هل يتحسن المريض؟")
        assert cat == "TREND_INTERPRETATION"

    # Negative: not trend
    def test_not_trend_factual_value(self):
        cat, _ = apply_rules("What was the last creatinine value?")
        assert cat != "TREND_INTERPRETATION"

    def test_not_trend_on_metformin(self):
        cat, _ = apply_rules("Is he on metformin?")
        assert cat != "TREND_INTERPRETATION"


# ──────────────────────────────────────────────────────────────────────────────
# DIAGNOSTIC_SUGGESTION
# ──────────────────────────────────────────────────────────────────────────────

class TestDiagnosticSuggestion:
    def test_could_be(self):
        cat, _ = apply_rules("Could this be pneumonia?")
        assert cat == "DIAGNOSTIC_SUGGESTION"

    def test_what_is_causing(self):
        cat, _ = apply_rules("What is causing his fever?")
        assert cat == "DIAGNOSTIC_SUGGESTION"

    def test_diagnosis_word(self):
        cat, _ = apply_rules("What is the diagnosis?")
        assert cat == "DIAGNOSTIC_SUGGESTION"

    def test_differential(self):
        cat, _ = apply_rules("What is the differential?")
        assert cat == "DIAGNOSTIC_SUGGESTION"

    def test_ar_tashkhis(self):
        cat, _ = apply_rules("ما هو التشخيص؟")
        assert cat == "DIAGNOSTIC_SUGGESTION"

    # Negative examples (guards)
    def test_polite_phrasing_could_you(self):
        cat, _ = apply_rules("Could you tell me the BP?")
        assert cat != "DIAGNOSTIC_SUGGESTION"

    def test_admitting_diagnosis_en(self):
        cat, _ = apply_rules("What is the admitting diagnosis?")
        assert cat != "DIAGNOSTIC_SUGGESTION"

    def test_ar_admitting_diagnosis(self):
        cat, _ = apply_rules("ما هو تشخيص الدخول؟")
        assert cat != "DIAGNOSTIC_SUGGESTION"


# ──────────────────────────────────────────────────────────────────────────────
# RISK_ASSESSMENT
# ──────────────────────────────────────────────────────────────────────────────

class TestRiskAssessment:
    def test_at_risk_of(self):
        cat, _ = apply_rules("Is he at risk of AKI?")
        assert cat == "RISK_ASSESSMENT"

    def test_how_serious(self):
        cat, _ = apply_rules("How serious is his condition?")
        assert cat == "RISK_ASSESSMENT"

    def test_how_critical(self):
        cat, _ = apply_rules("How critical is she?")
        assert cat == "RISK_ASSESSMENT"

    def test_ar_khatar(self):
        cat, _ = apply_rules("هل هو معرض لخطر التدهور؟")
        assert cat == "RISK_ASSESSMENT"


# ──────────────────────────────────────────────────────────────────────────────
# TREATMENT_RECOMMENDATION
# ──────────────────────────────────────────────────────────────────────────────

class TestTreatmentRecommendation:
    def test_what_should_i_give(self):
        cat, _ = apply_rules("What should I give for his infection?")
        assert cat == "TREATMENT_RECOMMENDATION"

    def test_should_we_start(self):
        cat, _ = apply_rules("Should we start antibiotics?")
        assert cat == "TREATMENT_RECOMMENDATION"

    def test_recommend(self):
        cat, _ = apply_rules("Do you recommend any treatment?")
        assert cat == "TREATMENT_RECOMMENDATION"

    def test_next_steps(self):
        cat, _ = apply_rules("What are the next steps?")
        assert cat == "TREATMENT_RECOMMENDATION"

    def test_ar_madha(self):
        cat, _ = apply_rules("ماذا أعطي للمريض؟")
        assert cat == "TREATMENT_RECOMMENDATION"


# ──────────────────────────────────────────────────────────────────────────────
# MEDICATION_SAFETY_JUDGMENT
# ──────────────────────────────────────────────────────────────────────────────

class TestMedicationSafetyJudgment:
    def test_safe_in(self):
        cat, _ = apply_rules("Is metformin safe in renal failure?")
        assert cat == "MEDICATION_SAFETY_JUDGMENT"

    def test_interact(self):
        cat, _ = apply_rules("Will metformin interact with lisinopril?")
        assert cat == "MEDICATION_SAFETY_JUDGMENT"

    def test_dose_adjustment(self):
        cat, _ = apply_rules("Should we adjust the dose of vancomycin?")
        assert cat == "MEDICATION_SAFETY_JUDGMENT"

    def test_contraindicated(self):
        cat, _ = apply_rules("Is aspirin contraindicated for this patient?")
        assert cat == "MEDICATION_SAFETY_JUDGMENT"


# ──────────────────────────────────────────────────────────────────────────────
# DIFFERENTIAL_DIAGNOSIS
# ──────────────────────────────────────────────────────────────────────────────

class TestDifferentialDiagnosis:
    def test_what_could_cause(self):
        cat, _ = apply_rules("What could cause his elevated troponin?")
        assert cat == "DIFFERENTIAL_DIAGNOSIS"

    def test_what_might_explain(self):
        cat, _ = apply_rules("What might explain his confusion?")
        assert cat == "DIFFERENTIAL_DIAGNOSIS"


# ──────────────────────────────────────────────────────────────────────────────
# PROGNOSTIC_QUESTION
# ──────────────────────────────────────────────────────────────────────────────

class TestPrognosticQuestion:
    def test_will_he_recover(self):
        cat, _ = apply_rules("Will he recover from this?")
        assert cat == "PROGNOSTIC_QUESTION"

    def test_will_she_need(self):
        cat, _ = apply_rules("Will she need dialysis?")
        assert cat == "PROGNOSTIC_QUESTION"

    def test_how_long_until(self):
        cat, _ = apply_rules("How long until he can be discharged?")
        assert cat == "PROGNOSTIC_QUESTION"

    def test_prognosis(self):
        cat, _ = apply_rules("What is the prognosis?")
        assert cat == "PROGNOSTIC_QUESTION"


# ──────────────────────────────────────────────────────────────────────────────
# RED_FLAG_IDENTIFICATION
# ──────────────────────────────────────────────────────────────────────────────

class TestRedFlagIdentification:
    def test_anything_concerning(self):
        cat, _ = apply_rules("Is there anything concerning in his labs?")
        assert cat == "RED_FLAG_IDENTIFICATION"

    def test_should_i_worry(self):
        cat, _ = apply_rules("Should I be worried about his potassium?")
        assert cat == "RED_FLAG_IDENTIFICATION"

    def test_red_flags(self):
        cat, _ = apply_rules("Are there any red flags?")
        assert cat == "RED_FLAG_IDENTIFICATION"

    def test_ar_yastadi_alqalaq(self):
        cat, _ = apply_rules("هل وضعه يستدعي القلق؟")
        assert cat == "RED_FLAG_IDENTIFICATION"

    def test_ar_muthir_lilqalaq(self):
        cat, _ = apply_rules("هل الكرياتينين في مستوى مثير للقلق؟")
        assert cat == "RED_FLAG_IDENTIFICATION"

    def test_ar_muqliq(self):
        cat, _ = apply_rules("هل التحاليل مقلقة؟")
        assert cat == "RED_FLAG_IDENTIFICATION"

    def test_ar_khatir(self):
        cat, _ = apply_rules("هل وضعه خطير؟")
        assert cat == "RED_FLAG_IDENTIFICATION"

    def test_ar_tabiei(self):
        cat, _ = apply_rules("هل نسبة السكر طبيعية؟")
        assert cat == "RED_FLAG_IDENTIFICATION"

    def test_ar_factual_not_refused(self):
        # Plain factual Arabic lookup must not trip the new rules
        cat, _ = apply_rules("ما هي قيم الكرياتينين الموثقة؟")
        assert cat is None


# ──────────────────────────────────────────────────────────────────────────────
# COMPARATIVE_JUDGMENT
# ──────────────────────────────────────────────────────────────────────────────

class TestComparativeJudgment:
    def test_worse_than(self):
        cat, _ = apply_rules("Is his creatinine worse than last week?")
        assert cat == "COMPARATIVE_JUDGMENT"

    def test_compared_to(self):
        cat, _ = apply_rules("How does his BP today compare to yesterday?")
        assert cat == "COMPARATIVE_JUDGMENT"


# ──────────────────────────────────────────────────────────────────────────────
# OUT_OF_SCOPE
# ──────────────────────────────────────────────────────────────────────────────

class TestOutOfScope:
    def test_all_patients(self):
        cat, _ = apply_rules("Show me all patients with CKD.")
        assert cat == "OUT_OF_SCOPE"

    def test_cohort(self):
        cat, _ = apply_rules("Query the cohort of diabetic patients.")
        assert cat == "OUT_OF_SCOPE"

    def test_statistics(self):
        cat, _ = apply_rules("What is the average creatinine of patients here?")
        assert cat == "OUT_OF_SCOPE"

    def test_ward_aggregate(self):
        cat, _ = apply_rules("How many patients are in the ICU with sepsis?")
        assert cat == "OUT_OF_SCOPE"


# ──────────────────────────────────────────────────────────────────────────────
# ALLOWED rules
# ──────────────────────────────────────────────────────────────────────────────

class TestAllowedRules:
    def test_what_is_last(self):
        cat, matches = apply_rules("What is the last creatinine?")
        assert cat == "ALLOWED_FACTUAL"
        assert any("value_lookup" in m for m in matches)

    def test_show_me(self):
        cat, _ = apply_rules("Show me the medications.")
        assert cat == "ALLOWED_FACTUAL"

    def test_list_labs(self):
        cat, _ = apply_rules("List all lab results.")
        assert cat == "ALLOWED_FACTUAL"

    def test_when_was(self):
        cat, _ = apply_rules("When was the last dialysis?")
        assert cat == "ALLOWED_FACTUAL"

    def test_has_patient_received(self):
        cat, _ = apply_rules("Has the patient received contrast dye?")
        assert cat == "ALLOWED_FACTUAL"

    def test_admitting_diagnosis_is_allowed(self):
        cat, _ = apply_rules("What is the admitting diagnosis?")
        # Should be ALLOWED_FACTUAL not DIAGNOSTIC_SUGGESTION
        assert cat == "ALLOWED_FACTUAL" or cat is None


# ──────────────────────────────────────────────────────────────────────────────
# Special cases
# ──────────────────────────────────────────────────────────────────────────────

class TestSpecialCases:
    def test_could_you_tell_me_bp(self):
        cat, _ = apply_rules("Could you tell me the BP?")
        assert cat != "DIAGNOSTIC_SUGGESTION"

    def test_is_he_on_metformin(self):
        cat, _ = apply_rules("Is he on metformin?")
        assert cat not in ("TREND_INTERPRETATION", "RISK_ASSESSMENT", "DIAGNOSTIC_SUGGESTION")

    def test_multi_intent_creatinine_getting_worse(self):
        cat, _ = apply_rules("What's the last creatinine, and is it getting worse?")
        assert cat == "TREND_INTERPRETATION"

    def test_arabic_last_creatinine(self):
        # ما هو آخر creatinine؟ — pure factual, no refused pattern
        cat, _ = apply_rules("ما هو آخر creatinine؟")
        # Should not be REFUSED by Arabic trend/diagnostic rules
        assert cat not in (
            "TREND_INTERPRETATION",
            "DIAGNOSTIC_SUGGESTION",
            "RISK_ASSESSMENT",
        )
