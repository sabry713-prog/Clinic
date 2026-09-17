"""Tests for the derived-eGFR helper.

The reference values are worked through the published equation by hand so the
assertions do not simply re-run the implementation:

    Scr 1.0 mg/dL, age 50, male      -> 91.7 mL/min/1.73m2
        ratio = 1.0/0.9 = 1.1111
        min^a = 1.0^-0.302 = 1.0
        max^-1.2 = 1.1111^-1.2 = 0.88125
        0.9938^50 = 0.73284
        142 x 0.88125 x 0.73284 = 91.72

    Scr 1.0 mg/dL, age 50, female    -> 68.6 mL/min/1.73m2
        ratio = 1.0/0.7 = 1.42857
        min^a = 1.0 (ratio > 1)
        max^-1.2 = 1.42857^-1.2 = 0.65415
        0.9938^50 = 0.73284, x 1.012
        142 x 0.65415 x 0.73284 x 1.012 = 68.63

    Note the direction, because it is the easy thing to get backwards: at the same
    creatinine a woman scores LOWER than a man (68.6 against 91.7 here). The
    assertions check the hand-computed points, the properties a clinician would
    notice (rising creatinine lowers the value, age lowers it, monotonicity), and
    that direction explicitly.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

# the service directory is not a package; the other specs in this suite add it to
# sys.path the same way
SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from egfr import (  # noqa: E402
    CREATININE_LOINC,
    EGFR_LOINC,
    FORMULA,
    age_at,
    egfr_ckdepi_2021,
)


def test_hand_computed_male_scr_1_mg_dl_age_50():
    # 1.0 mg/dL in umol/L
    result = egfr_ckdepi_2021(88.4, 50, "male")
    assert result is not None
    assert result.value == pytest.approx(91.7, abs=0.6)
    assert result.creatinine_mg_dl == pytest.approx(1.0, abs=0.001)


def test_unit_conversion_is_the_88_4_factor():
    # If the conversion were dropped, umol/L would be treated as mg/dL and this
    # value would be ~26 rather than ~92.
    result = egfr_ckdepi_2021(88.4, 50, "male")
    assert result is not None
    assert 80 < result.value < 100


def test_hand_computed_female_scr_1_mg_dl_age_50():
    # 149.0 in the docstring was a slip; the branch matters. ratio = 1.0/0.7 =
    # 1.42857 > 1, so min picks 1.0 and max picks the ratio:
    #   142 x 1.0 x 1.42857^-1.2 x 0.9938^50 x 1.012
    #   = 142 x 0.654153 x 0.732842 x 1.012 = 68.63
    result = egfr_ckdepi_2021(88.4, 50, "female")
    assert result is not None
    assert result.value == pytest.approx(68.6, abs=0.3)


def test_the_same_creatinine_is_a_lower_egfr_for_a_woman():
    """Clinically the point of the sex terms, and easy to get backwards.

    The same serum creatinine means worse kidney function in a woman (less muscle
    mass means a lower baseline), so the equation assigns her a LOWER eGFR. An
    implementation that returned the opposite here would still look plausible
    while being wrong in the direction that matters for dosing.
    """
    female = egfr_ckdepi_2021(88.4, 50, "female")
    male = egfr_ckdepi_2021(88.4, 50, "male")
    assert female is not None and male is not None
    assert female.value < male.value


def test_higher_creatinine_lowers_egfr():
    values = [egfr_ckdepi_2021(c, 50, "male").value for c in (60.0, 88.4, 200.0, 400.0)]
    assert values == sorted(values, reverse=True)


def test_older_age_lowers_egfr():
    young = egfr_ckdepi_2021(88.4, 30, "male")
    old = egfr_ckdepi_2021(88.4, 80, "male")
    assert young is not None and old is not None
    assert young.value > old.value


def test_sex_spellings_are_accepted():
    for spelling in ("F", "female", " Female "):
        assert egfr_ckdepi_2021(88.4, 50, spelling) is not None
    for spelling in ("M", "male", "Male"):
        assert egfr_ckdepi_2021(88.4, 50, spelling) is not None


@pytest.mark.parametrize(
    "creatinine,age,sex",
    [
        (None, 50, "male"),        # no creatinine in the record
        (0.0, 50, "male"),         # implausible value
        (-5.0, 50, "male"),        # implausible value
        (88.4, None, "male"),      # no date of birth to age from
        (88.4, 12, "male"),        # the equation is for adults
        (88.4, 50, None),          # sex not recorded
        (88.4, 50, "unknown"),     # sex recorded unhelpfully
    ],
)
def test_returns_nothing_rather_than_a_default(creatinine, age, sex):
    assert egfr_ckdepi_2021(creatinine, age, sex) is None


def test_result_carries_its_own_provenance():
    result = egfr_ckdepi_2021(132.6, 63, "female")
    assert result is not None
    assert result.derived is True
    assert result.formula == FORMULA
    assert result.creatinine_umol_l == 132.6
    assert result.age_years == 63

    observation = result.as_observation()
    assert observation["code"] == EGFR_LOINC
    assert observation["derived"] is True
    assert observation["formula"] == FORMULA
    assert observation["derived_from"] == {
        "code": CREATININE_LOINC,
        "value": 132.6,
        "unit": "umol/L",
    }
    # rounded for display, and the unrounded value is still available
    assert observation["value_numeric"] == round(result.value, 1)


def test_age_at_counts_completed_years():
    assert age_at(date(1980, 6, 15), date(2026, 6, 14)) == 45
    assert age_at(date(1980, 6, 15), date(2026, 6, 15)) == 46
    assert age_at(date(1980, 12, 31), date(2026, 1, 1)) == 45
