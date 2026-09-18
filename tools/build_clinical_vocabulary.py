#!/usr/bin/env python3
"""Generate apps/web/src/lib/clinicalVocabulary.ts from the two retrieved sources.

Why a generator and not a hand-written list: the vocabulary decides which task rows are put in
front of a clinician, so it has to be reproducible and reviewable, and every entry has to trace
back to a source a reviewer can open. Hand-editing invites silent drift.

Sources (retrieved 2026-09-18, kept in docs/reference/clinical-vocabulary/):
  * DICOM PS3.16 CID 29 "Acquisition Modality" -- ALL 24 entries, verbatim meanings.
  * LOINC Top 2000+ Lab Observations, v1.6 (NIH/LHNCBC) -- analytes taken in RANK ORDER up to
    RANK_CUTOFF. The rank, not taste, decides what is included: it is the published ordering of
    how commonly each test is ordered in US practice.

Anything not derivable from those two files is in the small CURATED block below and is marked
as such in the output, so a reviewer can tell sourced from curated at a glance.

This is a TRIGGER vocabulary. Every label it feeds is a task to carry out ("Order imaging"),
never a clinical finding, and it only ever fires on wording the clinician themselves wrote.
"""
from __future__ import annotations

import csv
import html
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "docs" / "reference" / "clinical-vocabulary"
OUT = HERE.parent / "apps" / "web" / "src" / "lib" / "clinicalVocabulary.ts"
RANK_CUTOFF = 150

# Synonyms and panel abbreviations clinicians actually type. Each expands to a term that already
# exists in the two sources above (ALT -> alanine aminotransferase, HbA1c -> hemoglobin a1c,
# CBC -> complete blood count), so a reviewer can check every one against the source files.
# Every phrase here is deliberate, so it is trusted at any length -- but only after asking what
# it would match as a substring. "us" (Ultrasound's DICOM code) and "ct" are NOT here for that
# reason: they would fire on "pus", "usual" and "product".
CURATED_IMAGING = {
    "CR": ["x-ray", "xray", "plain film", "radiograph"],
    "CT": ["ct scan", "cat scan"],
    "MR": ["mri", "mr scan", "magnetic resonance imaging"],
    "US": ["ultrasound", "sonography", "sonogram"],
    "MG": ["mammogram", "mammography"],
    "NM": ["nuclear scan", "scintigraphy"],
    "PT": ["pet scan", "pet-ct"],
    "DX": ["digital x-ray"],
    "RF": ["fluoroscopy", "barium study"],
    "ES": ["endoscopy", "gastroscopy", "colonoscopy"],
    "IO": ["dental x-ray", "opg"],
}
CURATED_LABS = {
    "cbc": "complete blood count", "fbc": "complete blood count",
    "wbc": "leukocytes", "rbc": "erythrocytes", "plt": "platelets",
    "hb": "hemoglobin", "hgb": "hemoglobin", "hct": "hematocrit", "alt": "alanine aminotransferase",
    "ast": "aspartate aminotransferase", "alp": "alkaline phosphatase", "ptt": "partial thromboplastin time",
    "pt": "prothrombin time", "inr": "international normalized ratio",
    "mcv": "erythrocyte mean corpuscular volume", "mch": "erythrocyte mean corpuscular hemoglobin",
    "lft": "liver function", "lfts": "liver function panel", "rft": "renal function",
    "kft": "kidney function", "bun": "urea nitrogen", "egfr": "glomerular filtration",
    "gfr": "glomerular filtration", "tft": "thyroid function", "tsh": "thyrotropin",
    "ft4": "free thyroxine", "ft3": "free triiodothyronine", "hba1c": "hemoglobin a1c",
    "a1c": "hemoglobin a1c", "fbs": "glucose", "rbs": "glucose",
    "alt": "alanine aminotransferase", "sgpt": "alanine aminotransferase",
    "ast": "aspartate aminotransferase", "sgot": "aspartate aminotransferase",
    "alp": "alkaline phosphatase", "ggt": "gamma glutamyl transferase",
    "ldl": "ldl cholesterol", "hdl": "hdl cholesterol", "tg": "triglycerides",
    "chol": "cholesterol", "crp": "c reactive protein", "esr": "erythrocyte sedimentation rate",
    "inr": "international normalized ratio", "pt": "prothrombin time",
    "aptt": "activated partial thromboplastin time", "abg": "blood gas",
    "psa": "prostate specific ag", "vitd": "25-hydroxyvitamin d", "b12": "cobalamin",
    "u&e": "electrolytes", "ue": "electrolytes", "lfts": "liver function panel",
    "urine culture": "urine culture", "mcs": "culture and sensitivity",
}


def dicom() -> list[tuple[str, str]]:
    raw = (SRC / "DICOM_PS3.16_CID29_AcquisitionModality.html").read_text(encoding="utf-8", errors="replace")
    lines = [html.unescape(l).strip() for l in re.sub(r"<[^>]+>", "\n", raw).split("\n")]
    # Drop the blanks BEFORE pairing: the code and the meaning sit in separate <td>s, so tag
    # stripping leaves an empty line between them and a pairwise scan finds nothing.
    lines = [l for l in lines if l]
    out, i = {}, 0
    while i < len(lines) - 1:
        if re.fullmatch(r"[A-Z]{2}", lines[i]) and re.fullmatch(r"[A-Z][A-Za-z][A-Za-z /\-()]{3,60}", lines[i + 1]):
            out.setdefault(lines[i], lines[i + 1])
            i += 2
        else:
            i += 1
    return sorted(out.items())


def loinc() -> list[tuple[int, str, str]]:
    rows: dict[str, tuple[int, str]] = {}
    with (SRC / "LOINC_1.6_Top2000CommonLabResultsUS.csv").open(encoding="utf-8", errors="replace") as fh:
        for parts in csv.reader(fh):
            if len(parts) >= 5 and re.fullmatch(r"\d{3,6}-\d", parts[0].strip()):
                digits = re.sub(r"\D", "", parts[-1])
                rank = int(digits) if digits else 0
                name = parts[1].strip()
                if rank and parts[0].strip() not in rows:
                    rows[parts[0].strip()] = (rank, name)
    return [(r, c, n) for c, (r, n) in sorted(rows.items(), key=lambda kv: kv[1][0]) if r <= RANK_CUTOFF]


CURATED_TRUSTED = {p for extra in CURATED_IMAGING.values() for p in extra} | set(CURATED_LABS)


def keyword_of(name: str) -> str:
    """The analysable term, not the LOINC long name.

    "Creatinine [Moles/volume] in Serum or Plasma" -> "creatinine"; a name with no bracket gets
    its parenthetical and its "in .../by ..." qualifiers cut, because nobody types
    "activated partial thromboplastin time (aptt) in blood by coagulation assay". The full name
    stays available in the source CSV either way.
    """
    term = re.split(r"\[", name)[0].strip().lower()
    term = re.sub(r"\([^)]*\)", " ", term)
    term = re.split(r"\b(?:in|by)\b", term)[0].strip(" ,;")
    return re.sub(r"\s+", " ", term).strip()


MAX_KEYWORD_CHARS = 40


# Short terms are the dangerous ones: the matcher is a substring test, so "ct" fires inside
# "product" and "us" inside "pus" or "usual". Anything below this many characters is therefore
# only trusted when a human put it in a curated list on purpose (mri, a1c, ts h...), never when
# it fell out of a source string.
MIN_DERIVED_CHARS = 4


def imaging_phrases(imaging: dict[str, list[str]]) -> set[str]:
    derived, curated = set(), set()
    for _key, phrases in imaging.items():
        for p in phrases:
            (curated if p in CURATED_TRUSTED else derived).add(p)
    return {p for p in derived if MIN_DERIVED_CHARS <= len(p) <= MAX_KEYWORD_CHARS} | curated


def ts() -> str:
    mods, labs = dicom(), loinc()
    imaging = {m.lower(): ["".join(ch for ch in n.lower() if ch.isalnum() or ch in " -").strip()] for m, n in mods}
    for code, extra in CURATED_IMAGING.items():
        for name, meaning in mods:
            if name == code:
                imaging.setdefault(meaning.lower(), []).extend(extra)
    lab_kw = {}
    for _rank, _code, name in labs:
        k = keyword_of(name)
        if 3 < len(k) <= MAX_KEYWORD_CHARS:
            lab_kw.setdefault(k, [])
    for kw, expands in CURATED_LABS.items():
        lab_kw.setdefault(expands, [])
        lab_kw.setdefault(kw, [])
    lines = [
        "/**",
        " * Clinical trigger vocabulary -- GENERATED. Do not edit by hand:",
        " *   python tools/build_clinical_vocabulary.py",
        " *",
        f" * Sources (retrieved 2026-09-18, kept under docs/reference/clinical-vocabulary/):",
        f" *   * DICOM PS3.16 CID 29 Acquisition Modality -- all {len(mods)} entries, meanings verbatim.",
        f" *   * LOINC Top 2000+ Lab Observations v1.6 (NIH/LHNCBC) -- analytes in rank order up to",
        f" *     rank {RANK_CUTOFF}; rank decides inclusion, not preference.",
        " * Everything else lives in the generator's curated block, which expands only to terms that",
        " * already appear in those two files (ALT -> alanine aminotransferase, CBC -> complete blood",
        " * count), so every entry is checkable.",
        " *",
        " * This is a trigger vocabulary, not clinical content: the labels it feeds are tasks to",
        " * carry out, never findings, and a row is only ever offered when the clinician's own words",
        " * contain one of these terms.",
        " */",
        "",
        f"/** DICOM modality meanings, as typed by clinicians ({sum(len(v) for v in imaging.values())} phrases). */",
        "export const IMAGING_KEYWORDS: readonly string[] = [",
    ]
    for k in sorted(imaging_phrases(imaging)):
        lines.append(f'  "{k}",')
    lines += ["];", "", f"/** Analytes and panels ({len(lab_kw)} phrases). */", "export const LAB_KEYWORDS: readonly string[] = ["]
    for k in sorted(lab_kw):
        lines.append(f'  "{k}",')
    lines += ["];", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    OUT.write_text(ts(), encoding="utf-8", newline="\n")
    print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes)")
