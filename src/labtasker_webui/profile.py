"""Project-local WebUI profile; credentials never enter profile API responses."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

UI_KEYS = {
    "labtasker:workspace:v1",
    "labtasker:queueLayouts:v1",
    "labtasker:views:v1",
    "labtasker:column-widths",
    "labtasker:columns:v3",
    "labtasker:customColumns:v1",
    "labtasker:columnOrder:v1",
    "labtasker:drawerWidth",
    "labtasker:lastQueue",
    "labtasker:filterPresets:v1",
    "labtasker:filters:v1",
}


class Profile:
    def __init__(self, path: Path | None) -> None:
        self.path = path
        self.token_path = path.with_name("webui-token") if path else None
        self.data: dict[str, Any] = {"version": 1, "connection": None, "ui": {}}
        if path and path.exists():
            if path.is_symlink():
                raise ValueError("WebUI profile must not be a symbolic link.")
            data = json.loads(path.read_text())
            if not isinstance(data, dict) or data.get("version") != 1:
                raise ValueError("Unsupported WebUI profile format.")
            self.data.update(data)
            os.chmod(path, 0o600)
            connection = self.data.get("connection")
            if isinstance(connection, dict):
                if "token" in connection:
                    # Migrate the earlier combined profile without exposing the token.
                    self.set_connection(connection["server_url"], connection.get("token"))
                elif self.token_path and self.token_path.exists():
                    if self.token_path.is_symlink():
                        raise ValueError("WebUI token must not be a symbolic link.")
                    os.chmod(self.token_path, 0o600)
                    connection["token"] = self.token_path.read_text().strip() or None

    @staticmethod
    def _write(path: Path, text: str) -> None:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".webui-profile-", dir=path.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def save(self) -> None:
        if not self.path:
            return
        data = dict(self.data)
        if isinstance(data.get("connection"), dict):
            data["connection"] = {"server_url": data["connection"]["server_url"]}
        self._write(self.path, json.dumps(data, ensure_ascii=False, indent=2))

    def set_connection(self, url: str | None, token: str | None = None) -> None:
        if self.token_path:
            if url and token:
                self._write(self.token_path, token)
            else:
                self.token_path.unlink(missing_ok=True)
        self.data["connection"] = {"server_url": url, "token": token} if url else None
        self.save()

    def update_ui(self, values: dict[str, str]) -> None:
        if any(key not in UI_KEYS or len(value) > 100_000 for key, value in values.items()):
            raise ValueError("Unsupported or oversized UI setting.")
        previous = self.data["ui"]
        self.data["ui"] = {**previous, **values}
        try:
            self.save()
        except OSError:
            self.data["ui"] = previous
            raise
