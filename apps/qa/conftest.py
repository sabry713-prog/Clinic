"""Put the workspace's shared packages on sys.path for the test run.

The uv editable installs (.pth files pointing at each package's src/) have
proved unreliable here: they intermittently stop being applied, at which point
blocklist / classifier / retrieval / phi_guard all vanish and the suite fails
with confusing ModuleNotFoundErrors. Resolving them explicitly makes the tests
independent of that.

Runtime is a separate concern — the service still needs a correctly synced
virtualenv; synthesize() now fails closed if the blocklist is missing rather
than answering with the gate disabled.
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
QA_ROOT = Path(__file__).resolve().parent

for path in (
    QA_ROOT,
    QA_ROOT / "src",
    *(p / "src" for p in (REPO_ROOT / "packages").iterdir() if (p / "src").is_dir()),
):
    entry = str(path)
    if entry not in sys.path:
        sys.path.insert(0, entry)
