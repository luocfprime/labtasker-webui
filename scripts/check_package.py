"""Build in a fresh directory and validate the exact resulting distributions."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*arguments: str) -> None:
    subprocess.run([sys.executable, *arguments], cwd=ROOT, check=True)


def main() -> None:
    run("scripts/check_versions.py")
    with tempfile.TemporaryDirectory(prefix="labtasker-webui-package-") as temporary:
        output = Path(temporary)
        subprocess.run(["uv", "build", "--sdist", "--out-dir", str(output)], cwd=ROOT, check=True)
        sources = list(output.glob("*.tar.gz"))
        if len(sources) != 1:
            raise SystemExit("Expected exactly one source distribution")
        subprocess.run(
            ["uv", "build", str(sources[0]), "--wheel", "--out-dir", str(output)],
            cwd=ROOT,
            check=True,
        )
        wheels = list(output.glob("*.whl"))
        if len(wheels) != 1 or len(sources) != 1:
            raise SystemExit("Expected exactly one wheel and one source distribution")
        run("-m", "twine", "check", "--strict", str(wheels[0]), str(sources[0]))
        run("tests/packaging_smoke.py", str(wheels[0]))
    print("Package verification passed; no distributions were published.")


if __name__ == "__main__":
    main()
