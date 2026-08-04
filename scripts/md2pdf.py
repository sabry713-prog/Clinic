# -*- coding: utf-8 -*-
"""Render a Markdown document to PDF via ReportLab Platypus.

Scoped to the Markdown subset this repo's docs actually use: ATX headings,
pipe tables, fenced code, bullet/numbered lists, blockquotes, horizontal rules,
and inline bold / italic / code / links.

Glyph note: ReportLab's built-in Type1 fonts lack arrows, box-drawing and
emoji, which would render as black boxes. Those are transliterated to ASCII
rather than dropped, so meaning survives (see _SAFE).

Usage: python md2pdf.py <input.md> <output.pdf> ["Doc Title"]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, HRFlowable, ListFlowable, ListItem, PageTemplate,
    Paragraph, Preformatted, Spacer, Table, TableStyle,
)

NAVY = colors.HexColor("#0B1F3A")
ACCENT = colors.HexColor("#2E86DE")
GREY = colors.HexColor("#5A6778")
LIGHT = colors.HexColor("#F4F7FB")
BORDER = colors.HexColor("#DDE4EC")
CODE_BG = colors.HexColor("#F2F4F7")

_SAFE = {
    "\u2192": "->", "\u2190": "<-", "\u2194": "<->", "\u21d2": "=>",
    "\u2014": " -- ", "\u2013": "-", "\u2026": "...",
    "\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'",
    "\u2264": "<=", "\u2265": ">=", "\u00d7": "x", "\u2022": "-",
    "\u2705": "[OK]", "\u274c": "[NO]", "\u26a0": "[!]", "\ufe0f": "",
    "\U0001f7e2": "[GREEN]", "\U0001f7e1": "[YELLOW]", "\U0001f534": "[RED]",
    "\U0001f535": "[BLUE]", "\u26aa": "[--]", "\u2713": "v", "\u2717": "x",
}


def safe(text: str) -> str:
    for bad, good in _SAFE.items():
        text = text.replace(bad, good)
    return "".join(ch if ord(ch) < 0x250 else "?" for ch in text)


def inline(text: str) -> str:
    """Markdown inline -> ReportLab markup (XML-escaped first)."""
    text = safe(text)
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<font color="#2E86DE">\1</font>', text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)", r"<i>\1</i>", text)
    text = re.sub(r"`([^`]+)`", r'<font face="Courier" size="8.5" color="#B4341C">\1</font>', text)
    return text


_ss = getSampleStyleSheet()
S = {
    "h1": ParagraphStyle("h1", parent=_ss["Heading1"], fontName="Helvetica-Bold",
                         fontSize=19, leading=23, textColor=NAVY,
                         spaceBefore=16, spaceAfter=8),
    "h2": ParagraphStyle("h2", parent=_ss["Heading2"], fontName="Helvetica-Bold",
                         fontSize=14.5, leading=18, textColor=NAVY,
                         spaceBefore=14, spaceAfter=6),
    "h3": ParagraphStyle("h3", parent=_ss["Heading3"], fontName="Helvetica-Bold",
                         fontSize=11.5, leading=15, textColor=ACCENT,
                         spaceBefore=11, spaceAfter=4),
    "h4": ParagraphStyle("h4", parent=_ss["Heading4"], fontName="Helvetica-Bold",
                         fontSize=10, leading=13, textColor=GREY,
                         spaceBefore=9, spaceAfter=3),
    "body": ParagraphStyle("body", parent=_ss["BodyText"], fontName="Helvetica",
                           fontSize=9.5, leading=14, textColor=colors.HexColor("#222A33"),
                           spaceAfter=6),
    "li": ParagraphStyle("li", parent=_ss["BodyText"], fontName="Helvetica",
                         fontSize=9.5, leading=13.5,
                         textColor=colors.HexColor("#222A33"), spaceAfter=2),
    "quote": ParagraphStyle("quote", parent=_ss["BodyText"], fontName="Helvetica-Oblique",
                            fontSize=9, leading=13, textColor=GREY,
                            leftIndent=10, borderPadding=4, spaceAfter=6),
    "cell": ParagraphStyle("cell", parent=_ss["BodyText"], fontName="Helvetica",
                           fontSize=8.2, leading=11, spaceAfter=0),
    "cellh": ParagraphStyle("cellh", parent=_ss["BodyText"], fontName="Helvetica-Bold",
                            fontSize=8.2, leading=11, textColor=colors.white, spaceAfter=0),
    "code": ParagraphStyle("code", parent=_ss["Code"], fontName="Courier",
                           fontSize=8, leading=10.5, textColor=colors.HexColor("#1B3A57")),
}

DOC_TITLE = "Veritas-Medica"


def _split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def build_story(md: str) -> list:
    story: list = []
    lines = md.split("\n")
    i = 0
    pending_list: list[str] = []
    list_ordered = False

    def flush_list() -> None:
        nonlocal pending_list
        if not pending_list:
            return
        story.append(ListFlowable(
            [ListItem(Paragraph(t, S["li"]), leftIndent=12) for t in pending_list],
            bulletType="1" if list_ordered else "bullet",
            bulletFontSize=8, leftIndent=14, spaceAfter=6,
        ))
        pending_list = []

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()

        # fenced code
        if line.startswith("```"):
            flush_list()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(safe(lines[i]))
                i += 1
            i += 1
            body = "\n".join(buf) or " "
            t = Table([[Preformatted(body, S["code"])]], colWidths=[165 * mm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.extend([t, Spacer(1, 7)])
            continue

        # table
        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:\-|]+\|?$", lines[i + 1].strip()):
            flush_list()
            header = _split_row(line)
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(_split_row(lines[i]))
                i += 1
            ncols = len(header)
            data = [[Paragraph(inline(c), S["cellh"]) for c in header]]
            for r in rows:
                r = (r + [""] * ncols)[:ncols]
                data.append([Paragraph(inline(c), S["cell"]) for c in r])
            # first column a little wider; rest share the remainder
            total = 165 * mm
            first = min(52 * mm, total * 0.34) if ncols > 1 else total
            rest = (total - first) / max(ncols - 1, 1) if ncols > 1 else 0
            widths = [first] + [rest] * (ncols - 1) if ncols > 1 else [total]
            t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]))
            story.extend([t, Spacer(1, 9)])
            continue

        # horizontal rule
        if re.match(r"^\s*---+\s*$", line):
            flush_list()
            story.extend([Spacer(1, 3),
                          HRFlowable(width="100%", thickness=0.6, color=BORDER),
                          Spacer(1, 7)])
            i += 1
            continue

        # headings
        m = re.match(r"^(#{1,4})\s+(.*)$", line)
        if m:
            flush_list()
            lvl = len(m.group(1))
            story.append(Paragraph(inline(m.group(2)), S[f"h{lvl}"]))
            i += 1
            continue

        # blockquote
        if line.startswith(">"):
            flush_list()
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i].lstrip(">").strip())
                i += 1
            t = Table([[Paragraph(inline(" ".join(buf)), S["quote"])]], colWidths=[165 * mm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                ("LINEBEFORE", (0, 0), (0, -1), 2.2, ACCENT),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            story.extend([t, Spacer(1, 7)])
            continue

        # list items
        mb = re.match(r"^\s*[-*]\s+(.*)$", line)
        mo = re.match(r"^\s*\d+\.\s+(.*)$", line)
        if mb or mo:
            ordered = bool(mo)
            if pending_list and ordered != list_ordered:
                flush_list()
            list_ordered = ordered
            pending_list.append(inline((mo or mb).group(1)))
            i += 1
            continue

        # blank
        if not line.strip():
            flush_list()
            i += 1
            continue

        # paragraph (join soft-wrapped lines)
        flush_list()
        buf = [line.strip()]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(
            r"^(#{1,4}\s|\||>|```|\s*[-*]\s|\s*\d+\.\s|\s*---+\s*$)", lines[i]
        ):
            buf.append(lines[i].strip())
            i += 1
        story.append(Paragraph(inline(" ".join(buf)), S["body"]))

    flush_list()
    return story


def _decor(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, h - 13 * mm, w, 13 * mm, stroke=0, fill=1)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawString(18 * mm, h - 8.6 * mm, DOC_TITLE)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawRightString(w - 18 * mm, h - 8.6 * mm, "Confidential")
    canvas.setFillColor(GREY)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawCentredString(w / 2, 10 * mm, str(canvas.getPageNumber()))
    canvas.restoreState()


def main() -> None:
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    global DOC_TITLE
    if len(sys.argv) > 3:
        # Through safe() as well -- the running header is drawn with a base
        # font, so an em-dash from the shell would render as a black box.
        DOC_TITLE = safe(sys.argv[3]).strip()

    md = src.read_text(encoding="utf-8")
    doc = BaseDocTemplate(
        str(out), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=20 * mm, bottomMargin=16 * mm,
        title=DOC_TITLE, author="Veritas-Medica",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin,
                  doc.width, doc.height, id="body")
    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=_decor)])
    doc.build(build_story(md))
    print(f"Wrote {out} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
