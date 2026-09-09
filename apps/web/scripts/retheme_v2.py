# -*- coding: utf-8 -*-
"""One-shot tonal re-theme pass: dark slate utilities -> light v2 tokens.

Applies the mechanical mapping only. Design-system specifics (gradients,
agent colors, badges, shadows) are hand-finished afterward per component.
Token names resolve against tailwind.config.ts (light v2).
"""
from __future__ import annotations

import re
from pathlib import Path

SRC = Path("src")

# --- 1. compound pairs first (background + its text color flip together) ---
PAIRS: list[tuple[str, str]] = [
    # active nav pill / active rows
    ("bg-slate-800 text-white", "bg-ink text-white"),
    # nav hover (AppShell + drawers)
    ("hover:text-white hover:bg-slate-800/60", "hover:text-ink hover:bg-veil"),
    ("hover:text-white hover:bg-slate-700", "hover:text-ink hover:bg-veil"),
    # secondary buttons (mockup: white pill, border line)
    ("bg-slate-700 hover:bg-slate-600", "bg-white hover:bg-veil border border-line"),
    ("bg-slate-600 hover:bg-slate-500", "bg-ink hover:bg-ink-deep"),
    # scrims keep a dark dim — quiet over light content
    ("bg-slate-950/40", "bg-ink/40"),
    ("bg-slate-950/50", "bg-ink/50"),
    ("bg-slate-950/60", "bg-ink/60"),
    ("bg-slate-950/70", "bg-ink/70"),
    ("bg-slate-900/60", "bg-ink/30"),
    ("bg-slate-900/80", "bg-ink/40"),
    ("bg-slate-800/60", "bg-ink/10"),
    ("bg-slate-800/50", "bg-ink/10"),
    ("bg-slate-800/40", "bg-ink/5"),
]

# --- 2. generic property-aware token map (variants like hover:/focus: kept) ---
PROP = r"(?:[a-zA-Z-]+:)?"  # hover:, focus:, disabled:, group-hover:, ...
MAP: dict[str, str] = {
    "bg-slate-950": "bg-wash",
    "bg-slate-900": "bg-white",
    "bg-slate-800": "bg-veil",
    "bg-slate-700": "bg-veil",
    "bg-slate-600": "bg-ink",
    "bg-slate-500": "bg-ink-soft",
    "bg-slate-400": "bg-ink-faint",
    "bg-slate-300": "bg-line",
    "bg-slate-200": "bg-line",
    "bg-slate-100": "bg-line",
    "text-slate-950": "text-ink",
    "text-slate-900": "text-ink",
    "text-slate-800": "text-ink",
    "text-slate-700": "text-ink-deep",
    "text-slate-600": "text-ink-faint",
    "text-slate-500": "text-ink-soft",
    "text-slate-400": "text-ink-soft",
    "text-slate-300": "text-ink-deep",
    "text-slate-200": "text-ink-deep",
    "text-slate-100": "text-ink",
    "border-slate-800": "border-line",
    "border-slate-700": "border-line",
    "border-slate-600": "border-line-strong",
    "border-slate-500": "border-line-strong",
    "border-slate-400": "border-line-strong",
    "border-slate-300": "border-line",
    "placeholder-slate-500": "placeholder-ink-faint",
    "placeholder-slate-400": "placeholder-ink-faint",
    "ring-slate-950": "ring-ink/20",
    "divide-slate-800": "divide-line",
    "divide-slate-700": "divide-line",
    "from-slate-900": "from-wash",
    "from-slate-950": "from-wash",
}

files = sorted(SRC.rglob("*.tsx"))
changed = 0
for f in files:
    src = f.read_text(encoding="utf-8")
    out = src
    for old, new in PAIRS:
        out = out.replace(old, new)
    for old, new in sorted(MAP.items(), key=lambda kv: -len(kv[0])):
        out = re.sub(rf"(?<![\w/-])({PROP}){re.escape(old)}\b", rf"\g<1>{new}", out)
    if out != src:
        f.write_text(out, encoding="utf-8", newline="\n")
        changed += 1

print(f"re-themed {changed}/{len(files)} tsx files")
left = []
for f in files:
    s = f.read_text(encoding="utf-8")
    hits = re.findall(r"[\w:-]*slate-\d+[^\s\"']*", s)
    if hits:
        left.append((str(f), sorted(set(hits))[:4]))
for f, h in left:
    print("LEFT:", f, h)
print(f"files with residual slate tokens: {len(left)}")
