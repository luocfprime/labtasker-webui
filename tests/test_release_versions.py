"""Ensure release validation rejects version drift before publishing."""

import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "release_versions", Path(__file__).resolve().parents[1] / "scripts/check_versions.py"
)
assert spec and spec.loader
versions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(versions)


def test_release_versions_and_tag(tmp_path):
    (tmp_path / "frontend").mkdir()
    (tmp_path / "src/labtasker_webui").mkdir(parents=True)
    (tmp_path / "pyproject.toml").write_text('[project]\nversion = "1.2.3"\n')
    (tmp_path / "src/labtasker_webui/__init__.py").write_text('__version__ = "1.2.3"\n')
    (tmp_path / "frontend/package.json").write_text('{"version":"1.2.3"}')
    lock = tmp_path / "frontend/package-lock.json"
    lock.write_text(json.dumps({"version": "1.2.3", "packages": {"": {"version": "1.2.3"}}}))
    assert versions.check(tmp_path, "v1.2.3") == "1.2.3"
    with pytest.raises(ValueError, match="Release tag"):
        versions.check(tmp_path, "v1.2.4")
    lock.write_text(json.dumps({"version": "1.2.4", "packages": {"": {"version": "1.2.3"}}}))
    with pytest.raises(ValueError, match="npm lockfile"):
        versions.check(tmp_path)
