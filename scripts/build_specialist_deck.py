# -*- coding: utf-8 -*-
"""Build SPECIALIST_DECK.pptx — modern dark-theme 16:9 deck via python-pptx.

VALUE-FIRST EDITION: written for a first-time audience. Leads with the
problem and the value delivered; technical machinery stays out of the
copy. Design: premium dark (near-black navy), one bright blue accent,
card-based layouts, proof-panel cards. Every factual claim traces to the
repo docs (source map at the top of SPECIALIST_DECK.md).

Usage: uv run --with python-pptx python scripts/build_specialist_deck.py
"""
from __future__ import annotations

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

# ---------------------------------------------------------------- palette
BG = RGBColor(0x0B, 0x12, 0x20)        # near-black navy
BG_SOFT = RGBColor(0x0E, 0x18, 0x2B)   # decorative panel
CARD = RGBColor(0x14, 0x1F, 0x35)      # card fill
CARD_LINE = RGBColor(0x26, 0x3A, 0x5C)  # card border
ACCENT = RGBColor(0x3E, 0x8B, 0xFF)    # bright blue
ACCENT_SOFT = RGBColor(0x8F, 0xC1, 0xFF)
GREEN = RGBColor(0x3F, 0xD6, 0x8F)
AMBER = RGBColor(0xF5, 0xB8, 0x4C)
TEXT = RGBColor(0xF4, 0xF7, 0xFC)
SUB = RGBColor(0xA9, 0xB6, 0xCC)
MUTED = RGBColor(0x6B, 0x7A, 0x93)
TERM_BG = RGBColor(0x0A, 0x0F, 0x1A)
TERM_LINE = RGBColor(0x1D, 0x2B, 0x45)

HEAD = "Segoe UI"
BODY = "Segoe UI"
MONO = "Consolas"

SW, SH = Inches(13.333), Inches(7.5)
MX = Inches(0.9)  # side margin

prs = Presentation()
prs.slide_width = SW
prs.slide_height = SH
BLANK = prs.slide_layouts[6]


# ---------------------------------------------------------------- helpers
def slide_new() -> object:
    return prs.slides.add_slide(BLANK)


def no_shadow(shape: object) -> None:
    try:
        shape.shadow.inherit = False
    except Exception:  # noqa: BLE001 — some shapes have no shadow node
        pass


def rect(slide, x, y, w, h, fill, line=None, round_=True, radius=0.06, dash=None):
    shp = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if round_ else MSO_SHAPE.RECTANGLE, x, y, w, h
    )
    if round_:
        try:
            shp.adjustments[0] = radius
        except Exception:  # noqa: BLE001
            pass
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line
        shp.line.width = Pt(1)
        if dash is not None:
            # python-pptx 1.0.2 has no dash-style enum — set prstDash in XML.
            from pptx.oxml.ns import qn

            ln = shp.line._get_or_add_ln()
            ln.append(ln.makeelement(qn("a:prstDash"), {"val": "dash"}))
    no_shadow(shp)
    return shp


def oval(slide, x, y, w, h, line, width_pt=1.5, fill=None):
    shp = slide.shapes.add_shape(MSO_SHAPE.OVAL, x, y, w, h)
    if fill is None:
        shp.fill.background()
    else:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
    shp.line.color.rgb = line
    shp.line.width = Pt(width_pt)
    no_shadow(shp)
    return shp


def text(
    slide, x, y, w, h, runs, size=14, color=TEXT, bold=False, font=BODY,
    align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, leading=1.0, space_after=0,
):
    """runs: str, or list of paragraphs; a paragraph is str or list of
    (text, {overrides}) run tuples."""
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    paras = runs if isinstance(runs, list) else [runs]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = leading
        if space_after:
            p.space_after = Pt(space_after)
        chunks = para if isinstance(para, list) else [(para, {})]
        for t, ov in chunks:
            r = p.add_run()
            r.text = t
            r.font.name = ov.get("font", font)
            r.font.size = Pt(ov.get("size", size))
            r.font.bold = ov.get("bold", bold)
            r.font.color.rgb = ov.get("color", color)
    return box


def chrome(slide, kicker: str, title_runs=None, page: int | None = None) -> None:
    """Standard slide furniture: bg, decorative ring, kicker, title, footer."""
    rect(slide, 0, 0, SW, SH, BG, round_=False)
    # subtle decorative ring, top-right
    oval(slide, Inches(10.6), Inches(-1.6), Inches(4.6), Inches(4.6), RGBColor(0x16, 0x24, 0x3D), 1.25)
    oval(slide, Inches(11.35), Inches(-0.85), Inches(3.1), Inches(3.1), RGBColor(0x13, 0x1F, 0x36), 1.0)
    if kicker:
        rect(slide, MX, Inches(0.62), Inches(0.32), Inches(0.045), ACCENT, round_=False)
        text(
            slide, MX + Inches(0.46), Inches(0.47), Inches(11), Inches(0.32),
            kicker.upper(), size=11, color=ACCENT_SOFT, bold=True,
        )
    if title_runs:
        text(slide, MX, Inches(0.86), Inches(11.5), Inches(0.95), title_runs, size=30, bold=True)
    # footer
    text(slide, MX, Inches(7.08), Inches(4), Inches(0.3), "VERITAS-MEDICA", size=9, color=MUTED, bold=True)
    if page is not None:
        text(slide, Inches(12.0), Inches(7.08), Inches(0.45), Inches(0.3), f"{page:02d}", size=9, color=MUTED, align=PP_ALIGN.RIGHT, font=MONO)


def card(slide, x, y, w, h, line=CARD_LINE):
    return rect(slide, x, y, w, h, CARD, line=line)


def arrow_right(slide, x, y, w=Inches(0.34), h=Inches(0.3), color=ACCENT):
    shp = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, x, y, w, h)
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    no_shadow(shp)
    return shp


def chip(slide, x, y, w, label, fill=CARD, line=CARD_LINE, color=SUB, size=11.5):
    h = Inches(0.42)
    rect(slide, x, y, w, h, fill, line=line, radius=0.5)
    text(slide, x, y, w, h, label, size=size, color=color, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE)
    return w


def terminal(slide, x, y, w, h, lines, size=12.5, lang_color=GREEN):
    """Dark proof-panel card. lines: list of paragraphs (str or runs)."""
    rect(slide, x, y, w, h, TERM_BG, line=TERM_LINE, radius=0.05)
    # window dots
    for i, c in enumerate((RGBColor(0xFF, 0x5F, 0x57), RGBColor(0xFE, 0xBC, 0x2E), RGBColor(0x28, 0xC8, 0x40))):
        d = slide.shapes.add_shape(MSO_SHAPE.OVAL, x + Inches(0.22 + i * 0.24), y + Inches(0.16), Inches(0.11), Inches(0.11))
        d.fill.solid()
        d.fill.fore_color.rgb = c
        d.line.fill.background()
        no_shadow(d)
    text(slide, x + Inches(0.28), y + Inches(0.42), w - Inches(0.56), h - Inches(0.6), lines, size=size, color=lang_color, font=MONO, leading=1.25)


IN = Inches  # shorthand

# ================================================================ slide 1 — title
s = slide_new()
rect(s, 0, 0, SW, SH, BG, round_=False)
oval(s, IN(9.2), IN(-2.2), IN(6.4), IN(6.4), RGBColor(0x16, 0x24, 0x3D), 1.5)
oval(s, IN(10.4), IN(-1.0), IN(4.0), IN(4.0), RGBColor(0x13, 0x1F, 0x36), 1.0)
rect(s, 0, IN(7.34), SW, IN(0.06), ACCENT, round_=False)

text(s, MX, IN(0.72), IN(6), IN(0.4), "VERITAS-MEDICA", size=13, color=ACCENT_SOFT, bold=True)

text(
    s, MX, IN(2.06), IN(11.4), IN(2.6),
    [
        [("Clinical AI", {})],
        [("you can ", {}), ("trust", {"color": ACCENT}), (".", {})],
    ],
    size=54, bold=True, leading=1.04,
)
rect(s, MX, IN(4.42), IN(0.9), IN(0.05), ACCENT, round_=False)
text(
    s, MX, IN(4.72), IN(9.6), IN(0.9),
    [
        [("Documentation and claim protection", {"color": SUB})],
        [("for Saudi hospitals.", {"color": SUB})],
    ],
    size=19, leading=1.15,
)
# brand device: value chain
chain_y = IN(6.28)
cx = MX
for label, col in (("Your records", SUB), ("Verified facts", ACCENT), ("Your clinicians", SUB)):
    w = IN(1.7 if label != "Your clinicians" else 1.85)
    chip(s, cx, chain_y, w, label, fill=BG_SOFT, line=RGBColor(0x1E, 0x2E, 0x4A), color=col, size=10.5)
    cx += w
    if label != "Your clinicians":
        text(s, cx + IN(0.04), chain_y, IN(0.3), IN(0.42), "→", size=14, color=MUTED, anchor=MSO_ANCHOR.MIDDLE)
        cx += IN(0.38)

# ================================================================ slide 2 — problem
s = slide_new()
chrome(s, "The problem", "Medicine's hardest problems aren't medical.", page=2)
cards = [
    ("01", "3+ hours lost every day", "Clinicians spend more time documenting than treating.", "US/EU figure — not Saudi-validated"),
    ("02", "1 in 7 claims rejected", "Errors surface after submission — the revenue is gone.", "US/EU figure — not Saudi-validated"),
    ("03", "AI you can't verify", "Generative tools can sound confident and still be wrong."),
]
cw, gap, y = IN(3.72), IN(0.24), IN(2.1)
x = MX
for item in cards:
    num, head, sub = item[0], item[1], item[2]
    card(s, x, y, cw, IN(3.4))
    text(s, x + IN(0.34), y + IN(0.34), IN(1.6), IN(0.7), num, size=30, color=ACCENT, bold=True, font=MONO)
    text(s, x + IN(0.34), y + IN(1.24), cw - IN(0.68), IN(0.85), head, size=19, bold=True, leading=1.05)
    text(s, x + IN(0.34), y + IN(2.14), cw - IN(0.68), IN(1.0), sub, size=13.5, color=SUB, leading=1.2)
    if len(item) > 3:
        chip(s, x + IN(0.34), y + IN(2.86), IN(2.1), item[3], fill=BG_SOFT, line=CARD_LINE, color=MUTED, size=9.5)
    x += cw + gap

# ================================================================ slide 3 — the promise
s = slide_new()
chrome(s, "Our promise", page=3)
text(s, IN(2.0), IN(1.55), IN(9.4), IN(0.8), "“", size=72, color=RGBColor(0x1D, 0x2B, 0x45), bold=True, font="Georgia")
text(
    s, MX + IN(0.4), IN(2.35), IN(11.2), IN(2.2),
    [
        [("AI grounded in ", {}), ("your patient's record", {"color": ACCENT}), (".", {})],
    ],
    size=44, bold=True, leading=1.1,
)
text(
    s, MX + IN(0.4), IN(3.85), IN(11.2), IN(1.0),
    [[("Rule findings are deterministic and inspectable; ", {"color": SUB}),
      ("the clinician confirms before anything enters the record.", {"color": TEXT, "bold": True})]],
    size=22, leading=1.2,
)
rect(s, MX + IN(0.4), IN(5.2), IN(0.9), IN(0.05), ACCENT, round_=False)
text(
    s, MX + IN(0.4), IN(5.5), IN(10.4), IN(0.8),
    "The architecture separates fact retrieval from language formatting — enforced by our tests.",
    size=14, color=MUTED, leading=1.3,
)

# ================================================================ slide 4 — proof
s = slide_new()
chrome(s, "Seeing is believing", page=4)
text(
    s, MX, IN(1.7), IN(11.5), IN(1.0),
    [[("Don't take our word for it. ", {}), ("Check us.", {"color": ACCENT})]],
    size=32, bold=True, leading=1.08,
)
terminal(
    s, MX, IN(2.85), IN(11.53), IN(1.55),
    [
        [("  ✓ ", {"color": GREEN}), ("Diagnosis on file:   ", {"color": SUB}), ("Hypertension (I10)", {"color": TEXT})],
        [("  ✓ ", {"color": GREEN}), ("Service covered:     ", {"color": SUB}), ("Consultation 11700-00-10", {"color": TEXT})],
        [("  ✓ ", {"color": GREEN}), ("Necessity rule:      ", {"color": SUB}), ("Matched", {"color": GREEN})],
        [("  ▸ ", {"color": ACCENT_SOFT}), ("VERDICT: ", {"color": ACCENT_SOFT}), ("READY — submit with confidence", {"color": GREEN, "bold": True})],
    ],
    size=13.5,
)
terminal(
    s, MX, IN(4.6), IN(11.53), IN(1.5),
    [
        [("  ✓ ", {"color": GREEN}), ("Patient record:      ", {"color": SUB}), ("kidney function 28% — this week", {"color": TEXT})],
        [("  ✓ ", {"color": GREEN}), ("Active medication:   ", {"color": SUB}), ("Metformin 1000mg", {"color": TEXT})],
        [("  ✓ ", {"color": GREEN}), ("Safety rule:         ", {"color": SUB}), ("renal threshold crossed", {"color": TEXT})],
        [("  ▸ ", {"color": ACCENT_SOFT}), ("ALERT: ", {"color": ACCENT_SOFT}), ("dose review recommended", {"color": AMBER})],
    ],
    size=13.5,
)
labels = ["Notes", "Drug alerts", "Orders", "Claims"]
cx = MX
text(s, MX, IN(6.24), IN(3.2), IN(0.35), "Proof follows every answer", size=12, color=MUTED)
for lbl in labels:
    w = IN(1.85 if len(lbl) < 15 else 2.15)
    chip(s, cx, IN(6.62), w, lbl, fill=BG_SOFT, line=CARD_LINE, color=SUB, size=10.5)
    cx += w + IN(0.16)

# ================================================================ slide 5 — value: time
s = slide_new()
chrome(s, "More medicine, less keyboard", page=5)
text(s, MX, IN(1.95), IN(11.5), IN(1.2), [[("The note ", {}), ("writes itself", {"color": ACCENT}), (".", {})]], size=36, bold=True)
feats = [
    ("Arabic & English", "Real consultation language — both, in one visit."),
    ("The doctor stays in charge", "Nothing is applied without review and signature."),
    ("Hours back, every day", "Target: −65% documentation time, measured in your pilot."),
]
x = MX
for head_t, sub_t in feats:
    card(s, x, IN(3.5), IN(3.72), IN(2.3))
    rect(s, x + IN(0.3), IN(3.82), IN(0.5), IN(0.05), ACCENT, round_=False)
    text(s, x + IN(0.3), IN(4.05), IN(3.1), IN(0.85), head_t, size=15.5, bold=True, leading=1.1)
    text(s, x + IN(0.3), IN(5.0), IN(3.1), IN(0.8), sub_t, size=12.5, color=SUB, leading=1.2)
    x += IN(3.72) + IN(0.24)

# ================================================================ slide 6 — value: revenue
s = slide_new()
chrome(s, "Protect the claim", page=6)
text(s, MX, IN(1.9), IN(11.5), IN(0.8), [[("Find the error ", {}), ("before the payer does", {"color": ACCENT}), (".", {})]], size=32, bold=True)
text(s, MX, IN(3.0), IN(11.5), IN(0.5), "تحقق قبل الإرسال", size=17, color=ACCENT_SOFT, align=PP_ALIGN.RIGHT)
items = [
    ("Check before you send", "Every claim is verified — verdict before submission.", None),
    ("Fix it on the spot", "The right code is suggested while the doctor is still there.", None),
    ("Revenue that stays", "Fewer rejections — found by you, not by the payer.", "target: −85% rejections"),
]
x = MX
for head_t, sub_t, tag in items:
    card(s, x, IN(3.75), IN(3.72), IN(2.3))
    text(s, x + IN(0.3), IN(4.05), IN(3.15), IN(0.75), head_t, size=16.5, bold=True, leading=1.05)
    text(s, x + IN(0.3), IN(4.85), IN(3.15), IN(0.95), sub_t, size=12.5, color=SUB, leading=1.2)
    if tag:
        chip(s, x + IN(0.3), IN(5.55), IN(2.6), tag, fill=BG_SOFT, line=CARD_LINE, color=MUTED, size=9.5)
    x += IN(3.72) + IN(0.24)

# ================================================================ slide 7 — value: safety
s = slide_new()
chrome(s, "Safety by design", page=7)
rows = [
    ("The record decides what's true", "Rule findings come from deterministic graph queries; never from the model."),
    ("Doctors sign everything", "No note, order, or code is ever applied automatically."),
    ("Rule evidence is one click away", "Every deterministic finding shows the query and source facts."),
    ("Reviewed outputs are versioned", "Drafts, codes and links carry reviewer identity and timestamps."),
]
y = IN(2.0)
for head_t, sub_t in rows:
    card(s, MX, y, IN(11.53), IN(1.0))
    d = oval(s, MX + IN(0.3), y + IN(0.32), IN(0.36), IN(0.36), GREEN, 1.4, fill=RGBColor(0x0F, 0x2A, 0x1F))
    text(s, MX + IN(0.3), y + IN(0.32), IN(0.36), IN(0.36), "✓", size=14, color=GREEN, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE, bold=True)
    text(s, MX + IN(0.95), y + IN(0.16), IN(4.6), IN(0.4), head_t, size=16, bold=True)
    text(s, MX + IN(5.75), y + IN(0.2), IN(5.5), IN(0.6), sub_t, size=13, color=SUB)
    y += IN(1.14)
text(s, MX, IN(6.62), IN(11.5), IN(0.34), "Generated text always requires clinician review; findings reflect loaded data and rules.", size=12, color=MUTED)

# ================================================================ slide 8 — value: kingdom
s = slide_new()
chrome(s, "Built for the Kingdom", page=8)
bullets = [
    ("Arabic first", "Full RTL interface, Hijri dates, Arabic patient messages."),
    ("NPHIES-native", "Built for the national claims platform from day one."),
    ("Your data stays home", "In-Kingdom by design — inside your hospital, even."),
    ("Your AI, your walls", "The language engine can run on your own servers."),
]
y = IN(2.05)
for head_t, sub_t in bullets:
    rect(s, MX, y + IN(0.12), IN(0.14), IN(0.14), ACCENT, radius=0.5)
    text(s, MX + IN(0.4), y, IN(4.6), IN(0.4), head_t, size=16.5, bold=True)
    text(s, MX + IN(0.4), y + IN(0.4), IN(4.7), IN(0.4), sub_t, size=12.5, color=SUB)
    y += IN(1.08)
terminal(
    s, IN(6.6), IN(2.0), IN(5.8), IN(2.6),
    [
        [("# WHERE PATIENT DATA LIVES", {"color": MUTED})],
        [("Location   ", {"color": SUB}), ("inside your hospital", {"color": TEXT})],
        [("Leaves     ", {"color": SUB}), ("not in this configuration", {"color": GREEN})],
        [("AI engine  ", {"color": SUB}), ("your servers — optional", {"color": TEXT})],
    ],
    size=13,
)
text(s, IN(6.6), IN(4.85), IN(5.8), IN(1.2), "No foreign clouds. No exceptions. Self-hosting keeps every byte inside your walls.", size=12, color=MUTED, leading=1.3)

# ================================================================ slide 9 — a day changed
s = slide_new()
chrome(s, "A day changed", "One visit. Everything done.", page=9)
day = [
    ("DURING THE VISIT", "The note writes itself", "The doctor just talks — in Arabic or English."),
    ("AT THE ORDER", "The claim gets checked", "Issues surface instantly, fixed on the spot."),
    ("BY EVENING", "Everything is signed", "Notes done. Claims ready. No backlog."),
]
x = MX
for i, (tag_t, head_t, sub_t) in enumerate(day):
    card(s, x, IN(3.3), IN(3.72), IN(2.2))
    chip(s, x + IN(0.3), IN(3.6), IN(1.95), tag_t, fill=BG_SOFT, line=CARD_LINE, color=ACCENT_SOFT, size=9.5)
    text(s, x + IN(0.3), IN(4.25), IN(3.1), IN(0.5), head_t, size=16, bold=True)
    text(s, x + IN(0.3), IN(4.85), IN(3.1), IN(0.8), sub_t, size=12.5, color=SUB, leading=1.2)
    if i < 2:
        arrow_right(s, x + IN(3.73), IN(4.29), w=IN(0.20), h=IN(0.20))
    x += IN(3.72) + IN(0.24)
text(s, MX, IN(5.95), IN(11.5), IN(0.5), "The documentation, the order, and the claim — finished in the same minute.", size=14, color=MUTED)

# ================================================================ slide 10 — why us
s = slide_new()
chrome(s, "Why us", "Others write notes. We guard the encounter.", page=10)
rows = [
    ("Notes written during the visit", True, True),
    ("Claims protected before submission", False, True),
    ("Proof behind every statement", False, True),
    ("Runs inside your hospital", False, True),
]
tx, ty, tw = MX, IN(2.0), IN(11.53)
col2, col3 = tx + IN(6.4), tx + IN(9.0)
rect(s, tx, ty, tw, IN(0.55), BG_SOFT, line=CARD_LINE, radius=0.10)
text(s, tx + IN(0.3), ty + IN(0.12), IN(5.5), IN(0.35), "CAPABILITY", size=11, color=MUTED, bold=True)
text(s, col2, ty + IN(0.12), IN(2.4), IN(0.35), "AMBIENT VENDORS *", size=11, color=MUTED, bold=True)
text(s, col3, ty + IN(0.12), IN(2.4), IN(0.35), "VERITAS-MEDICA", size=11, color=ACCENT_SOFT, bold=True)
y = ty + IN(0.62)
for label, them, us in rows:
    rect(s, tx, y, tw, IN(0.72), CARD if rows.index((label, them, us)) % 2 == 0 else BG_SOFT, line=CARD_LINE, radius=0.08)
    text(s, tx + IN(0.3), y + IN(0.18), IN(5.9), IN(0.4), label, size=14.5, color=TEXT)
    mark = "✓" if them else "—"
    text(s, col2, y + IN(0.16), IN(2.4), IN(0.4), mark, size=16, color=GREEN if them else MUTED, bold=True)
    text(s, col3, y + IN(0.16), IN(2.4), IN(0.4), "✓", size=16, color=ACCENT, bold=True)
    y += IN(0.8)
text(s, MX, IN(6.0), IN(11.5), IN(0.6), "* typically — characterization, not a claim about any specific product", size=10.5, color=MUTED)
text(s, MX, IN(6.4), IN(11.5), IN(0.6), [[("Notes are where it starts. ", {"color": SUB}), ("Trust and revenue are the difference.", {"color": TEXT, "bold": True})]], size=17)

# ================================================================ slide 11 — honesty
s = slide_new()
chrome(s, "Our honesty commitment", page=11)
col_w = IN(5.6)
card(s, MX, IN(1.95), col_w, IN(3.3), line=RGBColor(0x2A, 0x5C, 0x45))
text(s, MX + IN(0.35), IN(2.2), IN(4), IN(0.4), "WHAT YOU SAW IS REAL", size=13, color=GREEN, bold=True)
text(
    s, MX + IN(0.35), IN(2.7), col_w - IN(0.7), IN(2.4),
    [
        "Every answer — and its proof",
        "Notes, alerts and dashboards",
        "Tamper-proof audit trail",
        "Arabic + English, end to end",
    ],
    size=14.5, color=TEXT, leading=1.5,
)
x2 = MX + col_w + IN(0.33)
card(s, x2, IN(1.95), col_w, IN(3.3), line=RGBColor(0x6A, 0x53, 0x2A))
text(s, x2 + IN(0.35), IN(2.2), IN(4), IN(0.4), "WHAT IS SIMULATED", size=13, color=AMBER, bold=True)
text(
    s, x2 + IN(0.35), IN(2.7), col_w - IN(0.7), IN(2.4),
    [
        "Patient data — synthetic",
        "Payer connection — simulated",
        "No real claim has been sent",
    ],
    size=14.5, color=TEXT, leading=1.5,
)
rect(s, MX, IN(5.6), IN(11.53), IN(0.95), RGBColor(0x10, 0x1B, 0x2F), line=ACCENT, radius=0.12)
text(
    s, MX, IN(5.6), IN(11.53), IN(0.95),
    [[("A real product, shown on synthetic data.", {})]],
    size=19, bold=True, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
)

# ================================================================ slide 12 — pilot
s = slide_new()
chrome(s, "The 30-day proof", page=12)
text(s, MX, IN(1.9), IN(11.5), IN(0.8), [[("Prove it ", {}), ("in your hospital", {"color": ACCENT}), (".", {})]], size=32, bold=True)
weeks = [
    ("WEEK 1", "Connect", "Read-only. Zero disruption."),
    ("WEEK 2", "Shadow", "Runs alongside your workflow."),
    ("WEEK 3", "Live", "Opt-in doctors, real encounters."),
    ("WEEK 4", "Measure", "Time + rejections vs your baseline."),
]
cw4, gap4 = IN(2.70), IN(0.24)
x = MX
for tag_t, head_t, sub_t in weeks:
    card(s, x, IN(3.1), cw4, IN(2.0))
    chip(s, x + IN(0.26), IN(3.38), IN(1.15), tag_t, fill=BG_SOFT, line=CARD_LINE, color=ACCENT_SOFT, size=9.5)
    text(s, x + IN(0.26), IN(3.98), cw4 - IN(0.52), IN(0.45), head_t, size=16, bold=True)
    text(s, x + IN(0.26), IN(4.45), cw4 - IN(0.52), IN(0.6), sub_t, size=11.5, color=SUB, leading=1.2)
    x += cw4 + gap4
text(
    s, MX, IN(5.7), IN(11.5), IN(0.7),
    [[("One department. Two champions. ", {"color": TEXT}), ("Thirty days to proof.", {"color": ACCENT})]],
    size=21, bold=True,
)

# ================================================================ slide 13 — the ask
s = slide_new()
chrome(s, "What we ask of you", page=13)
asks = [
    ("Meet the product", "A working session, live on synthetic data."),
    ("Pick a department", "Internal medicine or cardiology to start."),
    ("Name two champions", "Clinicians who shape the workflow with us."),
    ("Grant the pilot", "Thirty days — read-only first, measured together."),
]
positions = [(MX, IN(2.0)), (MX + IN(5.93), IN(2.0)), (MX, IN(4.35)), (MX + IN(5.93), IN(4.35))]
for (ax, ay), (head_t, sub_t) in zip(positions, asks):
    card(s, ax, ay, IN(5.6), IN(2.05))
    text(s, ax + IN(0.35), ay + IN(0.3), IN(0.9), IN(0.5), f"{asks.index((head_t, sub_t)) + 1:02d}", size=22, color=ACCENT, bold=True, font=MONO)
    text(s, ax + IN(0.35), ay + IN(0.85), IN(4.9), IN(0.55), head_t, size=16.5, bold=True, leading=1.05)
    text(s, ax + IN(0.35), ay + IN(1.42), IN(4.9), IN(0.55), sub_t, size=12.5, color=SUB, leading=1.2)

# ================================================================ slide 14 — closing
s = slide_new()
rect(s, 0, 0, SW, SH, BG, round_=False)
oval(s, IN(9.6), IN(4.6), IN(5.6), IN(5.6), RGBColor(0x16, 0x24, 0x3D), 1.5)
oval(s, IN(-1.4), IN(-1.8), IN(4.6), IN(4.6), RGBColor(0x13, 0x1F, 0x36), 1.0)
rect(s, 0, IN(7.34), SW, IN(0.06), ACCENT, round_=False)
text(s, MX, IN(2.62), IN(11.5), IN(1.6),
     [[("Medicine deserves", {})], [("AI it can ", {}), ("trust", {"color": ACCENT}), (".", {})]],
     size=44, bold=True, leading=1.1)
text(s, MX, IN(4.75), IN(6), IN(0.4), "VERITAS-MEDICA", size=13, color=ACCENT_SOFT, bold=True)
text(s, MX, IN(5.15), IN(8), IN(0.4), "Documentation and claim protection for Saudi hospitals", size=14, color=MUTED)

import os

OUT = os.environ.get("DECK_OUT", "docs/executive-demo/SPECIALIST_DECK.pptx")
prs.save(OUT)
print(f"saved {OUT} — {len(prs.slides._sldIdLst)} slides")
