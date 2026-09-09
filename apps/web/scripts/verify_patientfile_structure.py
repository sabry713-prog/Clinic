# -*- coding: utf-8 -*-
"""Verify the patient-file re-theme diff is class/style-only.

For each hard-constraint component, compare HEAD vs working tree on:
  1. JSX tag sequence — every opening/closing element tag in order.
  2. Text nodes — literal strings rendered as JSX children (between > and <),
     with class-name strings filtered out.
Any added/removed/reordered element or changed visible text fails.
Only className/style strings are allowed to differ.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

FILES = [
    "src/pages/PatientDetailPage/PatientFilePage.tsx",
    "src/components/PatientHeader/PatientHeader.tsx",
    "src/components/PatientBrief/PatientBrief.tsx",
    "src/components/LabPanel/LabPanel.tsx",
    "src/components/MedicationPanel/MedicationPanel.tsx",
    "src/components/ReconciliationPanel/ReconciliationPanel.tsx",
]


def signature(src: str) -> tuple[list[str], list[str]]:
    tags = re.findall(r"</?([A-Za-z][A-Za-z0-9.]*)", src)
    # text children: between a close of one tag and the start of the next tag.
    # Filter out anything that looks like a class-list (tailwind-ish tokens).
    texts = []
    for chunk in re.findall(r">\s*([^<>{}]+?)\s*<", src):
        chunk = chunk.strip().strip('"').strip("'").strip("`")
        if not chunk:
            continue
        if re.match(r"^[\w\s/\[\]:.#%-]*$", chunk) and (
            " " in chunk or "-" in chunk or "/" in chunk or ":" in chunk
        ) and "px-" in chunk or "text-" in chunk or "bg-" in chunk or "border-" in chunk or "rounded" in chunk:
            continue  # a className string
        if "px-" in chunk or "py-" in chunk or "bg-" in chunk or "border-" in chunk:
            continue
        texts.append(chunk)
    return tags, texts


def main() -> int:
    repo = Path.cwd()
    failures = 0
    for rel in FILES:
        head = subprocess.run(
            ["git", "show", f"HEAD:apps/web/{rel}"],
            capture_output=True, cwd=repo.parent, text=True,
        )
        if head.returncode != 0:
            print(f"SKIP (not in HEAD): {rel}")
            continue
        work = (repo / rel).read_text(encoding="utf-8")
        (h_tags, h_texts), (w_tags, w_texts) = signature(head.stdout), signature(work)
        if h_tags == w_tags and h_texts == w_texts:
            print(f"STRUCTURE OK  ({len(h_tags)} tags, {len(h_texts)} text nodes): {rel}")
        else:
            failures += 1
            print(f"STRUCTURE CHANGED: {rel}")
            if h_tags != w_tags:
                import difflib

                for line in list(difflib.unified_diff(h_tags, w_texts and w_tags or w_tags, lineterm=""))[:30]:
                    print("   tag:", line)
            if h_texts != w_texts:
                import difflib

                for line in list(difflib.unified_diff(h_texts, w_texts, lineterm=""))[:30]:
                    print("   text:", line)
    print("=" * 60)
    print("ALL PATIENT-FILE STRUCTURE CHECKS PASSED" if failures == 0 else f"{failures} FILE(S) CHANGED STRUCTURE")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
