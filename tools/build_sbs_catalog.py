#!/usr/bin/env python3
"""Build data/ontologies/nphies_services.json (generated) from the official CHI catalogue.

Source, committed alongside this script:
  data/ontologies/_sources/SBS_V2_Code_list.xlsx
  Saudi Billing System (SBS) V2.0, published by the Council of Health Insurance (CHI),
  March 2023 -- https://www.chi.gov.sa/en/Rules/Pages/Saudi-Billing-Systems.aspx
  Retrieved 2026-09-18. The workbook carries CHI's own acknowledgements sheet; attribution
  stays with the file rather than being restated here.

Why generated: the previous file was an illustrative 10-code subset with `licensed: false`.
The SBS is the published national standard for service coding, so the graph should carry the
real catalogue, and a generator keeps it reproducible from the source rather than drifting by
hand. The output is .gitignored for size; regenerate before ingesting.

What the source does NOT carry: any pre-authorization or coverage column. Verified against the
workbook's own "Column Definitions" sheet -- the columns are code, hyphenated code, short and
long description, chapter, block, definition, includes, excludes, guidelines, and the
effective/inactive/revised dates. Coverage rules are payer-specific and arrive per insurer
(the pre-authorization use case obtains them as a Table of Benefits during eligibility), not
from this file. Do not invent a flag here.

Usage:  uv run --with openpyxl python tools/build_sbs_catalog.py
"""
from __future__ import annotations

import json
from pathlib import Path

import openpyxl

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / "data" / "ontologies" / "_sources" / "SBS_V2_Code_list.xlsx"
OUT = REPO / "data" / "ontologies" / "nphies_services.json"
SHEET = "SBS V2.0 Tabular List "


def main() -> None:
    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb[SHEET]
    rows = ws.iter_rows(values_only=True)
    header = [str(c).strip() if c is not None else "" for c in next(rows)]
    idx = {name: header.index(name) for name in
           ("SBS Code", "SBS Code (Hyphenated)", "Short Description", "Long Description", "Chapter", "Block")}
    nodes, seen = [], set()
    for row in rows:
        code = str(row[idx["SBS Code (Hyphenated)"]] or "").strip()
        if not code or code in seen:
            continue
        seen.add(code)
        nodes.append({
            "sbs_code": code,
            "code_unhyphenated": str(row[idx["SBS Code"]] or "").strip(),
            "description": str(row[idx["Long Description"]] or row[idx["Short Description"]] or "").strip(),
            "short_description": str(row[idx["Short Description"]] or "").strip(),
            "chapter": str(row[idx["Chapter"]] or "").strip(),
            "block": str(row[idx["Block"]] or "").strip(),
        })
    payload = {
        "_meta": {
            "ontology": "NPHIES Service (SBS V2.0)",
            "source": "CHI Saudi Billing System V2.0, March 2023",
            "source_url": "https://www.chi.gov.sa/en/Rules/Pages/Saudi-Billing-Systems.aspx",
            "source_file": "data/ontologies/_sources/SBS_V2_Code_list.xlsx",
            "retrieved": "2026-09-18",
            "licensed": True,
            "generated_by": "tools/build_sbs_catalog.py",
            "note": "Published national standard. Carries no pre-authorization column -- coverage "
                    "rules are payer-specific and arrive per insurer, never from this file.",
        },
        "nodes": nodes,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    print(f"wrote {OUT} -- {len(nodes):,} services, {OUT.stat().st_size:,} bytes")
    for probe in ("55113-00-00", "63001-00-10", "11700-00-00", "90901-03-60", "73050-18-50", "11506-00-00", "57518-03-11"):
        hit = next((n for n in nodes if n["sbs_code"] == probe), None)
        print(f"  {probe:13s} {'OK  ' + hit['description'][:52] if hit else 'NOT IN THE OFFICIAL CATALOGUE'}")


if __name__ == "__main__":
    main()
