"""Attach-only adapter for Labtasker's project-local transport."""

from __future__ import annotations

import importlib
import os
from pathlib import Path

from .sessions import Connection


def local_connection(directory: Path) -> Connection:
    if os.name != "posix":
        raise ValueError("Local connections require POSIX Unix sockets.")
    # Import only the pure path resolver. Never construct a Client or call ensure/start.
    try:
        local = importlib.import_module("labtasker.local")
    except ImportError as exc:
        raise ValueError("Local attachment requires labtasker-webui[local].") from exc
    local.require_local_capabilities()
    paths = local.local_paths(directory)
    return Connection(f"local:{paths.directory}", None, 0, str(paths.socket))
