from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import time
from dataclasses import asdict, dataclass, field
from typing import Any
from urllib.parse import quote

from .sessions import Connection
from .upstream import Upstream, UpstreamError


@dataclass(frozen=True, slots=True)
class Outcome:
    task_id: str
    status: str
    code: str | None = None
    message: str | None = None


@dataclass(slots=True)
class Operation:
    id: str
    queue: str
    task_ids: tuple[str, ...]
    connection: Connection | None
    owner_digest: bytes
    created_at: float = field(default_factory=time.monotonic)
    updated_at: float = field(default_factory=time.monotonic)
    outcomes: list[Outcome] = field(default_factory=list)
    stopped: bool = False
    done: bool = False

    def public(self) -> dict[str, Any]:
        counts = {"deleted": 0, "absent": 0, "failed": 0, "stopped": 0}
        for item in self.outcomes:
            counts[item.status] = counts.get(item.status, 0) + 1
        return {
            "id": self.id,
            "queue": self.queue,
            "total": len(self.task_ids),
            "completed": len(self.outcomes),
            "stopped": self.stopped,
            "done": self.done,
            "counts": counts,
            "outcomes": [asdict(item) for item in self.outcomes],
        }


class OperationStore:
    def __init__(
        self,
        upstream: Upstream,
        *,
        concurrency: int = 5,
        ttl_seconds: int = 60 * 60,
        maximum: int = 256,
    ) -> None:
        self.upstream = upstream
        self.concurrency = concurrency
        self.ttl_seconds = ttl_seconds
        self.maximum = maximum
        self.items: dict[str, Operation] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    def start(self, connection: Connection, queue: str, task_ids: list[str]) -> Operation:
        self.cleanup()
        unique_ids = tuple(dict.fromkeys(task_ids))
        if not unique_ids or len(unique_ids) > 1000:
            raise ValueError("A batch must contain between 1 and 1,000 unique Task IDs.")
        while len(self.items) >= self.maximum:
            completed = [key for key, item in self.items.items() if item.done]
            if not completed:
                raise UpstreamError(
                    503,
                    "operation_capacity",
                    "Too many active delete operations. Wait for one to finish and try again.",
                )
            oldest = min(completed, key=lambda key: self.items[key].updated_at)
            self.items.pop(oldest, None)
        operation = Operation(
            secrets.token_urlsafe(18),
            queue,
            unique_ids,
            connection,
            self._connection_digest(connection),
        )
        self.items[operation.id] = operation
        task = asyncio.create_task(self._run(operation))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return operation

    def get(
        self,
        operation_id: str,
        connection: Connection | None = None,
    ) -> Operation | None:
        self.cleanup()
        operation = self.items.get(operation_id)
        if operation is None or (
            connection is not None
            and not hmac.compare_digest(
                operation.owner_digest,
                self._connection_digest(connection),
            )
        ):
            return None
        return operation

    def retry_failed(
        self,
        operation_id: str,
        connection: Connection | None = None,
    ) -> Operation | None:
        previous = self.get(operation_id, connection)
        if previous is None or not previous.done:
            return None
        failed = [item.task_id for item in previous.outcomes if item.status == "failed"]
        if not failed:
            return None
        retry_connection = connection or previous.connection
        if retry_connection is None:
            return None
        return self.start(retry_connection, previous.queue, failed)

    def stop(
        self,
        operation_id: str,
        connection: Connection | None = None,
    ) -> Operation | None:
        operation = self.get(operation_id, connection)
        if operation is not None and not operation.done:
            operation.stopped = True
            operation.updated_at = time.monotonic()
        return operation

    def cleanup(self) -> None:
        now = time.monotonic()
        expired = [
            key
            for key, value in self.items.items()
            if value.done and now - value.updated_at > self.ttl_seconds
        ]
        for key in expired:
            self.items.pop(key, None)

    @staticmethod
    def _connection_digest(connection: Connection) -> bytes:
        value = f"{connection.server_url}\0{connection.token or ''}".encode()
        return hashlib.sha256(value).digest()

    async def _run(self, operation: Operation) -> None:
        active_connection = operation.connection
        if active_connection is None:
            operation.done = True
            return
        pending = asyncio.Queue[str]()
        for task_id in operation.task_ids:
            pending.put_nowait(task_id)

        async def worker() -> None:
            while not operation.stopped:
                try:
                    task_id = pending.get_nowait()
                except asyncio.QueueEmpty:
                    return
                try:
                    await self.upstream.request(
                        active_connection,
                        "DELETE",
                        f"/api/v2/queues/{quote(operation.queue, safe='')}/tasks/"
                        f"{quote(task_id, safe='')}",
                    )
                    operation.outcomes.append(Outcome(task_id, "deleted"))
                except UpstreamError as exc:
                    if exc.status == 404:
                        operation.outcomes.append(Outcome(task_id, "absent", exc.code, exc.message))
                    else:
                        operation.outcomes.append(Outcome(task_id, "failed", exc.code, exc.message))
                finally:
                    operation.updated_at = time.monotonic()
                    pending.task_done()

        await asyncio.gather(*(worker() for _ in range(self.concurrency)))
        while not pending.empty():
            task_id = pending.get_nowait()
            operation.outcomes.append(
                Outcome(task_id, "stopped", "not_dispatched", "Deletion was not started.")
            )
            pending.task_done()
        operation.done = True
        operation.connection = None
        operation.updated_at = time.monotonic()
