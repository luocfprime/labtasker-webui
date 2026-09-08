import asyncio
import time

import pytest

from labtasker_webui.operations import OperationStore
from labtasker_webui.sessions import Connection
from labtasker_webui.upstream import UpstreamError


class FakeUpstream:
    def __init__(self, failures: set[str] | None = None, delay: float = 0) -> None:
        self.failures = failures or set()
        self.delay = delay
        self.active = 0
        self.maximum_active = 0
        self.paths: list[str] = []

    async def request(self, connection, method, path, params=None):
        self.paths.append(path)
        task_id = path.rsplit("/", 1)[-1]
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        await asyncio.sleep(self.delay)
        self.active -= 1
        if task_id in self.failures:
            raise UpstreamError(409, "task_running", "Task is running.")


async def wait_done(store: OperationStore, operation_id: str) -> None:
    for _ in range(200):
        operation = store.get(operation_id)
        if operation and operation.done:
            return
        await asyncio.sleep(0.005)
    raise AssertionError("operation did not complete")


@pytest.mark.asyncio
async def test_batch_is_bounded_and_reports_partial_failure() -> None:
    upstream = FakeUpstream({"t_7"}, delay=0.01)
    store = OperationStore(upstream, concurrency=5)  # type: ignore[arg-type]
    connection = Connection("http://server", None, 0)
    operation = store.start(connection, "queue", [f"t_{i}" for i in range(12)])
    await wait_done(store, operation.id)
    report = operation.public()
    assert upstream.maximum_active == 5
    assert report["counts"] == {
        "deleted": 11,
        "absent": 0,
        "failed": 1,
        "stopped": 0,
    }
    assert report["completed"] == report["total"] == 12


@pytest.mark.asyncio
async def test_retry_contains_only_failed_tasks() -> None:
    upstream = FakeUpstream({"t_bad"})
    store = OperationStore(upstream)  # type: ignore[arg-type]
    connection = Connection("http://server", None, 0)
    first = store.start(connection, "queue", ["t_ok", "t_bad"])
    await wait_done(store, first.id)
    assert first.connection is None
    upstream.failures.clear()
    retry = store.retry_failed(first.id, connection)
    assert retry is not None
    assert retry.task_ids == ("t_bad",)
    await wait_done(store, retry.id)
    assert retry.public()["counts"]["deleted"] == 1


@pytest.mark.asyncio
async def test_operation_is_visible_only_to_the_same_connection() -> None:
    store = OperationStore(FakeUpstream())  # type: ignore[arg-type]
    owner = Connection("https://one.test", "one-token", 0)
    operation = store.start(owner, "queue", ["t_1"])
    await wait_done(store, operation.id)
    assert store.get(operation.id, owner) is operation
    assert store.get(operation.id, Connection("https://one.test", "other-token", 0)) is None
    assert store.get(operation.id, Connection("https://two.test", "one-token", 0)) is None


@pytest.mark.asyncio
async def test_stop_marks_not_dispatched_tasks() -> None:
    upstream = FakeUpstream(delay=0.04)
    store = OperationStore(upstream, concurrency=1)  # type: ignore[arg-type]
    operation = store.start(
        Connection("http://server", None, 0),
        "queue",
        [f"t_{i}" for i in range(8)],
    )
    await asyncio.sleep(0.01)
    store.stop(operation.id)
    await wait_done(store, operation.id)
    report = operation.public()
    assert report["counts"]["deleted"] == 1
    assert report["counts"]["stopped"] == 7
    assert report["completed"] == report["total"]


@pytest.mark.asyncio
async def test_completed_operations_expire_and_store_is_bounded() -> None:
    store = OperationStore(FakeUpstream(), ttl_seconds=1, maximum=1)  # type: ignore[arg-type]
    old = store.start(Connection("http://server", None, 0), "queue", ["t_old"])
    await wait_done(store, old.id)
    old.updated_at = time.monotonic() - 2
    assert store.get(old.id) is None


@pytest.mark.asyncio
async def test_already_absent_task_is_distinguished_from_failure() -> None:
    upstream = FakeUpstream()

    async def absent(*args, **kwargs):
        raise UpstreamError(404, "task_not_found", "Task was already absent.")

    upstream.request = absent  # type: ignore[method-assign]
    store = OperationStore(upstream)  # type: ignore[arg-type]
    operation = store.start(Connection("http://server", None, 0), "queue", ["t_gone"])
    await wait_done(store, operation.id)
    assert operation.public()["counts"]["absent"] == 1


@pytest.mark.asyncio
async def test_queue_and_task_path_segments_are_encoded_once() -> None:
    upstream = FakeUpstream()
    store = OperationStore(upstream)  # type: ignore[arg-type]
    operation = store.start(
        Connection("http://server", None, 0), "queue with space", ["task/with/slash"]
    )
    await wait_done(store, operation.id)
    assert upstream.paths == ["/api/v2/queues/queue%20with%20space/tasks/task%2Fwith%2Fslash"]


@pytest.mark.asyncio
async def test_capacity_preserves_active_operations_and_reuses_completed_slots() -> None:
    upstream = FakeUpstream(delay=0.01)
    store = OperationStore(upstream, maximum=1)  # type: ignore[arg-type]
    owner = Connection("http://server", None, 0)
    first = store.start(owner, "queue", ["t_first"])
    try:
        with pytest.raises(UpstreamError) as error:
            store.start(owner, "queue", ["t_second"])
        assert error.value.status == 503
        assert store.get(first.id, owner) is first
    finally:
        await asyncio.gather(*store._tasks)
    second = store.start(owner, "queue", ["t_second"])
    await wait_done(store, second.id)
    assert store.get(first.id) is None
    assert len(store.items) == 1
