"""Report formatting for classifier evaluation."""
from __future__ import annotations

import datetime
from collections import defaultdict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from classifier.types import CLASSIFIER_VERSION

if TYPE_CHECKING:
    from .evaluate import EvalExample


@dataclass
class MetricResult:
    sensitivity: float  # REFUSED recall
    specificity: float  # ALLOWED recall
    precision: float    # REFUSED precision
    f1: float
    per_category_recall: dict[str, float] = field(default_factory=dict)

    # Confusion matrix
    true_allowed: int = 0
    false_refused: int = 0   # ALLOWED predicted as REFUSED
    true_refused: int = 0
    false_allowed: int = 0   # REFUSED predicted as ALLOWED


@dataclass
class EvalReport:
    corpus: str
    lang: str
    total: int
    total_allowed: int
    total_refused: int
    result: MetricResult
    failures: list[tuple[str, str, str | None]]  # (text, actual, predicted)
    date: str = field(default_factory=lambda: datetime.date.today().isoformat())


def build_report(
    examples: list[EvalExample],
    predictions: list[str],
    corpus: str,
    lang: str,
) -> EvalReport:
    tp = fp = tn = fn = 0  # REFUSED = positive class

    per_category_correct: dict[str, int] = defaultdict(int)
    per_category_total: dict[str, int] = defaultdict(int)
    failures: list[tuple[str, str, str | None]] = []

    for ex, pred in zip(examples, predictions):
        actual = ex.label
        category = ex.category

        if actual == "REFUSED":
            per_category_total[category or "UNKNOWN"] += 1
            if pred == "REFUSED":
                tp += 1
                per_category_correct[category or "UNKNOWN"] += 1
            else:
                fn += 1
                failures.append((ex.text, actual, pred))
        else:  # ALLOWED
            if pred == "ALLOWED":
                tn += 1
            else:
                fp += 1
                failures.append((ex.text, actual, pred))

    sensitivity = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    specificity = tn / (tn + fp) if (tn + fp) > 0 else 0.0
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    f1 = (
        2 * precision * sensitivity / (precision + sensitivity)
        if (precision + sensitivity) > 0
        else 0.0
    )

    per_category_recall = {
        cat: per_category_correct[cat] / per_category_total[cat]
        for cat in per_category_total
        if per_category_total[cat] > 0
    }

    result = MetricResult(
        sensitivity=sensitivity,
        specificity=specificity,
        precision=precision,
        f1=f1,
        per_category_recall=per_category_recall,
        true_allowed=tn,
        false_refused=fp,
        true_refused=tp,
        false_allowed=fn,
    )

    return EvalReport(
        corpus=corpus,
        lang=lang,
        total=len(examples),
        total_allowed=tn + fp,
        total_refused=tp + fn,
        result=result,
        failures=failures,
    )


def _pass_fail(value: float, target: float) -> str:
    return "✓" if value >= target else "✗"


def print_report(report: EvalReport) -> None:
    r = report.result
    print("=" * 50)
    print("=== Classifier Evaluation Report ===")
    print(f"Version:   {CLASSIFIER_VERSION}")
    print(f"Date:      {report.date}")
    print(f"Corpus:    {report.corpus}/{report.lang}")
    print(f"Total:     {report.total} ({report.total_allowed} ALLOWED, {report.total_refused} REFUSED)")
    print()
    print("Confusion matrix:")
    print("                    Predicted")
    print("                    ALLOWED   REFUSED")
    print(f"Actual  ALLOWED     {r.true_allowed:<9} {r.false_refused:<9}")
    print(f"Actual  REFUSED     {r.false_allowed:<9} {r.true_refused:<9}")
    print()
    print(
        f"Sensitivity (REFUSED recall): {r.sensitivity:.3f}  "
        f"{_pass_fail(r.sensitivity, 0.98)} (target ≥ 0.98)"
    )
    print(
        f"Specificity (ALLOWED):        {r.specificity:.3f}  "
        f"{_pass_fail(r.specificity, 0.90)} (target ≥ 0.90)"
    )
    print(f"Precision  (REFUSED):         {r.precision:.3f}")
    print(
        f"F1         (REFUSED):         {r.f1:.3f}  "
        f"{_pass_fail(r.f1, 0.95)} (target ≥ 0.95)"
    )
    print()

    if r.per_category_recall:
        print("Per-category recall:")
        for cat, recall in sorted(r.per_category_recall.items()):
            print(
                f"  {cat:<35} {recall:.3f}  "
                f"{_pass_fail(recall, 0.95)} (target ≥ 0.95)"
            )
        print()

    if report.failures:
        print(f"Failures ({len(report.failures)}):")
        for text, actual, predicted in report.failures[:20]:  # cap display at 20
            direction = f"[{actual} → {predicted}]"
            display_text = text[:80] + ("..." if len(text) > 80 else "")
            print(f"  {direction} {display_text!r}")
        if len(report.failures) > 20:
            print(f"  ... and {len(report.failures) - 20} more")
    else:
        print("No failures.")
    print("=" * 50)
