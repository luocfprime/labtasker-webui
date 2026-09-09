from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TaskStatus = Literal["pending", "running", "succeeded", "failed", "cancelled"]
TaskOrderField = Literal[
    "id",
    "name",
    "status",
    "priority",
    "attempt",
    "max_attempts",
    "last_route",
    "created_at",
    "updated_at",
    "started_at",
    "finished_at",
]


class ConnectRequest(BaseModel):
    server_url: str = ""
    mode: Literal["http", "local"] = "http"
    directory: str = "."
    token: str | None = None


class SelectRequest(BaseModel):
    status: TaskStatus | None = None
    name: str | None = None
    name_fuzzy: str | None = None
    filter: str | None = None


class BatchRequest(BaseModel):
    task_ids: list[str] = Field(min_length=1, max_length=1000)


class QueueResponse(BaseModel):
    name: str


class LastErrorResponse(BaseModel):
    type: str
    message: str
    traceback: str | None
    occurred_at: datetime
    attempt: int
    run_id: str


class TaskResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    queue: str
    status: TaskStatus
    name: str | None
    args: dict[str, Any]
    metadata: dict[str, Any]
    priority: int
    attempt: int
    max_attempts: int
    routes: list[str]
    result: dict[str, Any]
    last_error: LastErrorResponse | None
    last_route: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class TaskPageResponse(BaseModel):
    items: list[TaskResponse]
    next_cursor: str | None


class CountResponse(BaseModel):
    count: int = Field(ge=0)
