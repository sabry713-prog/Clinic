"""Resolve the orchestrator module and workspace packages for the test run.

The uv editable installs (.pth files) have proved unreliable in this
environment, so paths are added explicitly rather than depending on them.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]

for path in (HERE, *((d / "src") for d in (REPO_ROOT / "packages").iterdir() if (d / "src").is_dir())):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
