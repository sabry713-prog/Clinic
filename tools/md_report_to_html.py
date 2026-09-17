#!/usr/bin/env python3
"""Render the Veritas-Medica markdown report set to print-ready HTML (then PDF via Chrome).

Usage:  python tools/md_report_to_html.py <out_dir> <md_file> [<md_file> ...]
Writes one .html per input plus an index.html listing them.
"""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

import markdown

CSS = """
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
body {
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 10.2pt; line-height: 1.5; color: #1c1c1e; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 4mm; color: #0f2b46; border-bottom: 2.5px solid #0f2b46; padding-bottom: 2.5mm; }
h2 { font-size: 14pt; margin: 9mm 0 3mm; color: #0f2b46; border-bottom: 1px solid #cfd8e3; padding-bottom: 1.5mm; page-break-after: avoid; }
h3 { font-size: 11.6pt; margin: 6mm 0 2mm; color: #14395c; page-break-after: avoid; }
h4 { font-size: 10.6pt; margin: 4.5mm 0 1.5mm; color: #14395c; page-break-after: avoid; }
p { margin: 0 0 2.6mm; }
ul, ol { margin: 0 0 2.8mm; padding-left: 6.5mm; }
li { margin-bottom: 1.1mm; }
li > ul, li > ol { margin-top: 1.1mm; }
strong { color: #10243a; }
a { color: #10508a; text-decoration: none; word-break: break-all; }
code { font-family: Consolas, "Courier New", monospace; font-size: 9pt; background: #f2f5f8; padding: 0.4mm 1mm; border-radius: 2px; }
pre { background: #f5f7fa; border: 1px solid #dde4ec; border-radius: 3px; padding: 3mm; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 8.8pt; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0 4mm; font-size: 9pt; }
th, td { border: 1px solid #c3ceda; padding: 1.7mm 2mm; text-align: left; vertical-align: top; overflow-wrap: break-word; }
td:first-child, th:first-child { min-width: 20mm; }
th { background: #e8eef5; color: #0f2b46; font-weight: 600; }
tr:nth-child(even) td { background: #fafbfd; }
blockquote { margin: 3mm 0; padding: 2.5mm 4mm; background: #fdf6e3; border-left: 3.5px solid #d8a13a; color: #4a3c14; page-break-inside: avoid; }
blockquote p:last-child { margin-bottom: 0; }
hr { border: none; border-top: 1px solid #d5dde6; margin: 6mm 0; }
h1, h2, h3, h4 { page-break-inside: avoid; }
tr, blockquote, pre { page-break-inside: avoid; }
img { max-width: 100%; }
.doc-meta { font-size: 9pt; color: #55606d; margin-bottom: 6mm; }
.sources { font-size: 8.4pt; }
.sources li, .sources p { margin-bottom: 0.8mm; }
"""


def slug(p: Path) -> str:
    return re.sub(r"[^a-z0-9]+", "-", p.stem.lower()).strip("-")


def unique_slug(md_path: Path, uses: dict[str, int]) -> str:
    """Generic names (CHANGELOG.md, README.md) collide across folders - qualify them."""
    base = slug(md_path)
    uses[base] = uses.get(base, 0) + 1
    if uses[base] > 1 or md_path.stem.lower() in {"changelog", "readme", "index", "notes"}:
        base = f"{slug(md_path.parent)}-{base}"
    return base


def convert(md_path: Path, out_dir: Path, name: str | None = None) -> Path:
    raw = md_path.read_text(encoding="utf-8")
    body = markdown.markdown(
        raw,
        extensions=["tables", "fenced_code", "sane_lists", "attr_list", "toc", "md_in_html"],
        extension_configs={"toc": {"permalink": False}},
    )
    # split off a trailing Sources section so it can be rendered smaller
    body = re.sub(r"(<h2[^>]*>\s*Sources\s*</h2>)", r'<div class="sources">\1', body, count=1)
    if '<div class="sources">' in body:
        body += "</div>"

    # first H1 becomes the document title (used in the PDF filename/header)
    title_match = re.search(r"<h1[^>]*>(.*?)</h1>", body, flags=re.S)
    title = html.unescape(re.sub(r"<[^>]+>", "", title_match.group(1))).strip() if title_match else md_path.stem

    doc = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>{html.escape(title)}</title>
<style>{CSS}</style></head>
<body>
{body}
</body></html>
"""
    out = out_dir / f"{name or slug(md_path)}.html"
    out.write_text(doc, encoding="utf-8", newline="\n")
    return out


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    out_dir = Path(sys.argv[1]).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    uses: dict[str, int] = {}
    for arg in sys.argv[2:]:
        md_path = Path(arg).resolve()
        if not md_path.exists():
            print(f"MISSING: {md_path}")
            continue
        html_path = convert(md_path, out_dir, unique_slug(md_path, uses))
        written.append((md_path, html_path))
        print(f"OK  {md_path.name}  ->  {html_path.name}")

    index = ["<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
             f"<title>Veritas-Medica report set</title><style>{CSS}</style></head><body>"
             "<h1>Veritas-Medica — report set</h1>"
             "<p class=\"doc-meta\">Generated from the markdown sources in this repository. "
             "Each document is also available as an individual PDF.</p><ul>"]
    for md_path, html_path in written:
        index.append(f'<li><a href="{html_path.name}">{html.escape(md_path.name)}</a></li>')
    index.append("</ul></body></html>")
    (out_dir / "index.html").write_text("\n".join(index), encoding="utf-8", newline="\n")
    print(f"index.html written with {len(written)} document(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
