"""eGFR — derived, not stored.

The readiness assessment recorded that the NSCRE dose-safety/renal check can
never fire for the demo cohort because the cohort has no eGFR lab result: the 603
eGFR observations in the database all belong to ingested records outside the
cohort, and the seeded patients carry Creatinine only.

That is a sourcing problem with two possible answers, and only one of them is
honest:

  * invent an eGFR value per patient       -> a fabricated clinical fact, and the
    one thing this codebase refuses to do;
  * compute it from what the record holds  -> deterministic, reproducible, and
    open to inspection by anyone who knows the equation.

The cohort carries exactly what the equation needs: a Creatinine observation
(LOINC 2160-0, reported in umol/L), plus date_of_birth and sex on the patient.

    CKD-EPI 2021 (race-free), creatinine-based
    https://www.nejm.org/doi/full/10.1056/NEJMoa2102953  (Inker et al., NEJM 2021)

        eGFR = 142 x min(Scr/k, 1)^a x max(Scr/k, 1)^-1.200
                    x 0.9938^age x (1.012 if female else 1)

        Scr  serum creatinine in mg/dL
        k    0.7 (female) / 0.9 (male)
        a    -0.241 (female) / -0.302 (male)

Two consequences worth stating rather than hiding:

  * The equation is creatinine-based and assumes steady state. It is not valid in
    acute kidney injury, in pregnancy, or at the extremes of muscle mass. A value
    it returns for a patient whose creatinine is moving is a number, not a fact,
    so the projection labels it derived and keeps the creatinine it came from.
  * Units matter. The cohort reports umol/L, and the equation takes mg/dL; the
    88.4 factor below is the standard molar-mass conversion for creatinine. Silent
    unit confusion here would shift every result by more than an order of magnitude.

The result is written into the graph projection only -- never into
hospital.observation, which is the hospital's record of record. A derived value
belongs beside the evidence it came from, labelled as derived, not in the chart as
if a laboratory had measured it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal

UMOL_PER_L_TO_MG_PER_DL = 88.4

#: LOINC code the cohort's creatinine arrives under.
CREATININE_LOINC = "2160-0"

#: LOINC code for the derived value, so it can live beside real lab results
#: without pretending to be one. 98979-8 is "Glomerular filtration rate
#: [/volume] by Creatinine-based formula (CKD-EPI 2021)".
EGFR_LOINC = "98979-8"

FORMULA = "CKD-EPI 2021 (race-free, creatinine-based)"


@dataclass(frozen=True)
class EgfrResult:
    """A derived eGFR, with everything needed to re-derive it."""

    value: float
    formula: str
    derived: bool
    #: the inputs, so a reader can recompute rather than trust
    creatinine_umol_l: float
    creatinine_mg_dl: float
    age_years: int
    sex: str

    def as_observation(self) -> dict[str, object]:
        """Shape suitable for the graph projection (never for hospital.observation)."""
        return {
            "code": EGFR_LOINC,
            "code_display": "eGFR (CKD-EPI 2021, derived)",
            "value_numeric": round(self.value, 1),
            "unit": "mL/min/1.73m2",
            "derived": True,
            "formula": self.formula,
            "derived_from": {
                "code": CREATININE_LOINC,
                "value": self.creatinine_umol_l,
                "unit": "umol/L",
            },
        }


def _normalise_sex(sex: str | None) -> Literal["female", "male"] | None:
    if sex is None:
        return None
    s = sex.strip().lower()
    if s in {"f", "female"}:
        return "female"
    if s in {"m", "male"}:
        return "male"
    return None


def egfr_ckdepi_2021(
    creatinine_umol_l: float,
    age_years: int,
    sex: str | None,
) -> EgfrResult | None:
    """Compute eGFR (CKD-EPI 2021).

    Returns ``None`` -- never a default, never an estimate -- when an input is
    missing or implausible, because a fabricated renal function would silently
    decide whether a renally-cleared drug is flagged.
    """
    if creatinine_umol_l is None or creatinine_umol_l <= 0:
        return None
    if age_years is None or age_years < 18:
        # The equation is for adults.
        return None
    normalised = _normalise_sex(sex)
    if normalised is None:
        return None

    scr = creatinine_umol_l / UMOL_PER_L_TO_MG_PER_DL

    if normalised == "female":
        k, alpha, sex_factor = 0.7, -0.241, 1.012
    else:
        k, alpha, sex_factor = 0.9, -0.302, 1.0

    ratio = scr / k
    value = (
        142.0
        * min(ratio, 1.0) ** alpha
        * max(ratio, 1.0) ** -1.200
        * (0.9938 ** age_years)
        * sex_factor
    )

    return EgfrResult(
        value=value,
        formula=FORMULA,
        derived=True,
        creatinine_umol_l=creatinine_umol_l,
        creatinine_mg_dl=scr,
        age_years=age_years,
        sex=normalised,
    )


def age_at(dob: date, on: date) -> int:
    """Completed years between two dates."""
    years = on.year - dob.year
    if (on.month, on.day) < (dob.month, dob.day):
        years -= 1
    return years
