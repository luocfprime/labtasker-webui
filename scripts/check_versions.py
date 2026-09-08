"""Check release versions without importing the application or using the network."""

from __future__ import annotations

import argparse
import ast
import json
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def check(root: Path, tag: str | None = None) -> str:
    version = tomllib.loads((root / "pyproject.toml").read_text())["project"]["version"]
    frontend = json.loads((root / "frontend/package.json").read_text())
    lock = json.loads((root / "frontend/package-lock.json").read_text())
    module = ast.parse((root / "src/labtasker_webui/__init__.py").read_text())
    runtime = next(
        ast.literal_eval(node.value)
        for node in module.body
        if isinstance(node, ast.Assign)
        and any(
            isinstance(target, ast.Name) and target.id == "__version__" for target in node.targets
        )
    )
    versions = {
        "Python runtime": runtime,
        "frontend package": frontend["version"],
        "npm lockfile": lock["version"],
        "npm root package": lock["packages"][""]["version"],
    }
    for name, value in versions.items():
        if value != version:
            raise ValueError(f"{name} version {value!r} does not match pyproject.toml {version!r}")
    if tag is not None and tag != f"v{version}":
        raise ValueError(f"Release tag must be v{version}")
    return str(version)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="Release tag to validate, e.g. v0.1.0")
    args = parser.parse_args()
    try:
        print(f"Versions consistent: {check(ROOT, args.tag)}")
    except (ValueError, KeyError, StopIteration) as error:
        raise SystemExit(str(error) or "Missing package version") from error


if __name__ == "__main__":
    main()
