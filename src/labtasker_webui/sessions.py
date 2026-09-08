from __future__ import annotations

import secrets
import time
from dataclasses import dataclass


@dataclass(slots=True)
class Connection:
    server_url: str
    token: str | None
    touched_at: float
    socket_path: str | None = None


class SessionStore:
    def __init__(self, ttl_seconds: int = 12 * 60 * 60, maximum: int = 2048) -> None:
        self.ttl_seconds = ttl_seconds
        self.maximum = maximum
        self._items: dict[str, Connection] = {}

    def create(self, server_url: str, token: str | None, socket_path: str | None = None) -> str:
        self.cleanup()
        if len(self._items) >= self.maximum:
            oldest = min(self._items, key=lambda key: self._items[key].touched_at)
            self._items.pop(oldest, None)
        session_id = secrets.token_urlsafe(32)
        self._items[session_id] = Connection(server_url, token, time.monotonic(), socket_path)
        return session_id

    def get(self, session_id: str | None) -> Connection | None:
        if not session_id:
            return None
        item = self._items.get(session_id)
        if not item or time.monotonic() - item.touched_at > self.ttl_seconds:
            self._items.pop(session_id, None)
            return None
        item.touched_at = time.monotonic()
        return item

    def delete(self, session_id: str | None) -> None:
        if session_id:
            self._items.pop(session_id, None)

    def cleanup(self) -> None:
        now = time.monotonic()
        expired = [
            key for key, value in self._items.items() if now - value.touched_at > self.ttl_seconds
        ]
        for key in expired:
            self._items.pop(key, None)
