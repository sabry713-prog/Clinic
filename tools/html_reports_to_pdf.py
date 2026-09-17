#!/usr/bin/env python3
"""Print the Veritas-Medica HTML report set to PDF and verify the output (pypdf).

Usage:  python tools/html_reports_to_pdf.py <html_dir> <pdf_dir>
Requires Chrome (headless) and pypdf.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

# html slug -> published PDF filename
TITLES = {
    "findings-and-recommendations-register": "00-findings-and-recommendations-register.pdf",
    "saudi-market-opportunity-report": "01-saudi-market-opportunity-and-innovation-report.pdf",
    "saudi-regulatory-research": "02-saudi-regulatory-and-market-research.pdf",
    "saudi-competitors-research": "03-saudi-competitor-landscape.pdf",
    "global-west-research": "04-global-west-innovation-research.pdf",
    "global-east-ecosystem-research": "05-global-east-and-regional-ecosystem-research.pdf",
    "pre-demo-readiness-assessment": "06-independent-solution-readiness-assessment.pdf",
    "handover-verification-audit": "11-handover-verification-audit.pdf",
    "regulatory-changelog": "07-verification-changelog-regulatory.pdf",
    "competitors-changelog": "08-verification-changelog-competitors.pdf",
    "west-changelog": "09-verification-changelog-global-west.pdf",
    "east-changelog": "10-verification-changelog-global-east.pdf",
}
ORDER = list(TITLES)


def find_chrome() -> str:
    for c in CHROME_CANDIDATES:
        if Path(c).exists():
            return c
    found = shutil.which("chrome") or shutil.which("msedge")
    if not found:
        raise SystemExit("No Chrome/Edge binary found; cannot print HTML to PDF.")
    return found


def print_pdf(chrome: str, html: Path, pdf: Path) -> None:
    pdf.parent.mkdir(parents=True, exist_ok=True)
    url = "file:///" + str(html).replace("\\", "/")
    cmd = [
        chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
        "--run-all-compositor-stages-before-draw", "--virtual-time-budget=10000",
        f"--print-to-pdf={pdf}", url,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if not pdf.exists():
        raise SystemExit(f"Chrome failed for {html.name}:\n{res.stdout}\n{res.stderr}")


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    html_dir, pdf_dir = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    chrome = find_chrome()
    print(f"using {chrome}")
    produced = []
    for slug in ORDER:
        html = html_dir / f"{slug}.html"
        if not html.exists():
            print(f"SKIP (no html): {slug}")
            continue
        pdf = pdf_dir / TITLES[slug]
        print_pdf(chrome, html, pdf)
        produced.append(pdf)
        print(f"OK  {pdf.name}  ({pdf.stat().st_size // 1024} KB)")

    index_html = html_dir / "index.html"
    if index_html.exists():
        pdf = pdf_dir / "00-report-set-index.pdf"
        print_pdf(chrome, index_html, pdf)
        print(f"OK  {pdf.name}  ({pdf.stat().st_size // 1024} KB)")

    # verify
    try:
        from pypdf import PdfReader
    except ImportError:
        print("pypdf missing - skipping page/text verification")
        return 0
    print("\n--- verification ---")
    for pdf in sorted(pdf_dir.glob("*.pdf")):
        reader = PdfReader(str(pdf))
        text = (reader.pages[0].extract_text() or "").strip()
        first_line = next((ln for ln in text.splitlines() if ln.strip()), "")
        print(f"{reader.get_num_pages():>3} pages | {pdf.name} | first line: {first_line[:70]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
