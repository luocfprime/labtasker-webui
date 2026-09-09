"""Request-scoped version observations, forwarded without an upstream preflight."""

from contextvars import ContextVar

import labtasker
from packaging.version import InvalidVersion, Version

version_headers: ContextVar[dict[str, str] | None] = ContextVar("version_headers", default=None)


def observe_server_version(raw: str | None) -> None:
    headers = version_headers.get()
    if headers is None:
        return
    headers.clear()
    headers["Labtasker-Client-Version"] = labtasker.__version__
    headers["Labtasker-Server-Version"] = ""
    headers["Labtasker-Server-Upgrade-Recommended"] = "false"
    if raw is None or len(raw) > 128:
        return
    try:
        server = Version(raw)
        client = Version(labtasker.__version__)
    except InvalidVersion:
        return
    headers["Labtasker-Server-Version"] = str(server)
    headers["Labtasker-Server-Upgrade-Recommended"] = str(server < client).lower()
