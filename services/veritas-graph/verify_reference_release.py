#!/usr/bin/env python3
"""M11: Verify reference-data checksums against the release manifest.

Run before `just graph-seed` to confirm the reference files haven't been
modified since the manifest was generated. A checksum mismatch means the
data was hand-edited outside governance — the ingestion is refused.

Usage: uv run python scripts/verify_reference_release.py
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent  # services/veritas-graph -> repo root
MANIFEST_PATH = REPO_ROOT / "data" / "reference-release-manifest.json"


def main() -> int:
    if not MANIFEST_PATH.exists():
        print(f"ERROR: Manifest not found: {MANIFEST_PATH}")
        return 1

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    entries = manifest.get("entries", [])
    if not entries:
        print("ERROR: Manifest has no entries")
        return 1

    failures: list[str] = []
    checked = 0

    for entry in entries:
        filepath = REPO_ROOT / "data" / entry["file"]
        if not filepath.exists():
            failures.append(f"MISSING: {entry['file']}")
            continue

        actual_sha = hashlib.sha256(filepath.read_bytes()).hexdigest()
        expected_sha = entry["sha256"]
        checked += 1

        if actual_sha != expected_sha:
            failures.append(
                f"CHECKSUM MISMATCH: {entry['file']}\n"
                f"  expected: {expected_sha}\n"
                f"  actual:   {actual_sha}"
            )

    # Check for untracked files (new files not in the manifest)
    ontology_dir = REPO_ROOT / "data" / "ontologies"
    manifest_files = {e["file"] for e in entries}
    for f in sorted(ontology_dir.glob("*.json")) + sorted(ontology_dir.glob("*.csv")):
        rel = f"ontologies/{f.name}"
        if rel not in manifest_files:
            failures.append(f"UNTRACKED: {rel} (not in manifest — add it or remove the file)")

    if failures:
        print(f"❌ Reference-release verification FAILED ({len(failures)} issue(s)):")
        for f in failures:
            print(f"  {f}")
        print("\nThe reference data does not match the governed release manifest.")
        print("If the change is intentional: update the manifest and get the approver's sign-off.")
        return 1

    print(f"✅ Reference-release verified: {checked} files match manifest v{manifest.get('version', '?')}")
    licensed_count = sum(1 for e in entries if e.get("licensed") is True)
    if licensed_count == 0:
        print(f"⚠️  All {checked} files are ILLUSTRATIVE (licensed=false) — not for clinical use")
    return 0


if __name__ == "__main__":
    sys.exit(main())
