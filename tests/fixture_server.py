"""Small Labtasker v2-compatible fixture used only for browser/integration smoke tests."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI, Response

app = FastAPI()
now = datetime.now(UTC).isoformat()
tasks = {
    "t_ABCDEFGHIJKL": {
        "id": "t_ABCDEFGHIJKL",
        "queue": "robotwin",
        "status": "pending",
        "name": "evaluate-checkpoint",
        "args": {"checkpoint": "qwen-7b", "episodes": 100},
        "metadata": {"owner": "research"},
        "priority": 10,
        "attempt": 0,
        "max_attempts": 3,
        "routes": ["gpu-a100"],
        "result": {},
        "last_error": None,
        "last_route": None,
        "created_at": now,
        "updated_at": now,
        "started_at": None,
        "finished_at": None,
    },
    "t_MNOPQRSTUVWX": {
        "id": "t_MNOPQRSTUVWX",
        "queue": "robotwin",
        "status": "failed",
        "name": "generate-rollouts",
        "args": {"seed": 42},
        "metadata": {"suite": "robotwin"},
        "priority": 2,
        "attempt": 2,
        "max_attempts": 2,
        "routes": ["default"],
        "result": {},
        "last_error": {
            "type": "RuntimeError",
            "message": "CUDA out of memory",
            "traceback": "RuntimeError: CUDA out of memory",
            "occurred_at": now,
            "attempt": 2,
            "run_id": "r_fixture",
        },
        "last_route": "default",
        "created_at": now,
        "updated_at": now,
        "started_at": now,
        "finished_at": now,
    },
    "t_RUNNING12345": {
        "id": "t_RUNNING12345",
        "queue": "robotwin",
        "status": "running",
        "name": "train-policy",
        "args": {"checkpoint": "qwen-7b"},
        "metadata": {"owner": "research"},
        "priority": 8,
        "attempt": 1,
        "max_attempts": 3,
        "routes": ["gpu-a100"],
        "result": {},
        "last_error": None,
        "last_route": "gpu-a100",
        "created_at": (datetime.now(UTC) - timedelta(minutes=20)).isoformat(),
        "updated_at": (datetime.now(UTC) - timedelta(minutes=12, seconds=34)).isoformat(),
        "started_at": (datetime.now(UTC) - timedelta(minutes=12, seconds=34)).isoformat(),
        "finished_at": None,
    },
    "t_SUCCEEDED123": {
        "id": "t_SUCCEEDED123",
        "queue": "robotwin",
        "status": "succeeded",
        "name": "score-checkpoint",
        "args": {"suite": "robotwin"},
        "metadata": {"owner": "research"},
        "priority": 5,
        "attempt": 1,
        "max_attempts": 3,
        "routes": ["gpu-a100"],
        "result": {"score": 0.91},
        "last_error": None,
        "last_route": "gpu-a100",
        "created_at": (datetime.now(UTC) - timedelta(hours=2)).isoformat(),
        "updated_at": now,
        "started_at": (datetime.now(UTC) - timedelta(hours=1, minutes=2, seconds=3)).isoformat(),
        "finished_at": now,
    },
}
initial_tasks = deepcopy(tasks)


@app.post("/__test__/reset", status_code=204)
def reset() -> Response:
    tasks.clear()
    tasks.update(deepcopy(initial_tasks))
    return Response(status_code=204)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "api_version": "2", "database": "ok"}


@app.get("/api/v2/queues")
def queues() -> list[dict[str, str]]:
    return [{"name": "robotwin"}]


@app.get("/api/v2/queues/{queue}/tasks")
def list_tasks(
    status: str | None = None,
    name: str | None = None,
    limit: int = 100,
    filter: str | None = None,
    order_by: str = "created_at",
    descending: bool = True,
    cursor: str | None = None,
) -> dict[str, object]:
    items = list(tasks.values())
    if status:
        items = [item for item in items if item["status"] == status]
    if name:
        items = [item for item in items if item["name"] == name]
    return {"items": items[:limit], "next_cursor": None}


@app.get("/api/v2/queues/{queue}/tasks/count")
def count_tasks(
    status: str | None = None, name: str | None = None, filter: str | None = None
) -> dict[str, int]:
    return {"count": len(list_tasks(status, name)["items"])}


@app.get("/api/v2/queues/{queue}/tasks/{task_id}")
def get_task(task_id: str) -> dict[str, object]:
    return tasks[task_id]


@app.post("/api/v2/queues/{queue}/tasks/{task_id}/cancel")
def cancel(task_id: str) -> dict[str, object]:
    tasks[task_id]["status"] = "cancelled"
    return tasks[task_id]


@app.post("/api/v2/queues/{queue}/tasks/{task_id}/requeue")
def requeue(task_id: str) -> dict[str, object]:
    tasks[task_id]["status"] = "pending"
    return tasks[task_id]


@app.delete("/api/v2/queues/{queue}/tasks/{task_id}", status_code=204)
def delete(task_id: str) -> Response:
    tasks.pop(task_id, None)
    return Response(status_code=204)
