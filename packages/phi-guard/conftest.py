"""Make the package importable when the editable install is unavailable.

uv/hatchling editable installs write a .pth pointing at src/, which has proved
unreliable in this environment (the path silently drops off sys.path and every
shared package becomes un-importable). Adding src/ here means the suite runs
from a clean checkout with no install step.
"""
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
