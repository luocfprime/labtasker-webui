from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Annotated, Any, cast
from urllib.parse import quote

from fastapi import Cookie, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import TypeAdapter, ValidationError

from .compatibility import version_headers
from .config import Settings, is_loopback_host
from .local import local_connection
from .operations import OperationStore
from .profile import Profile
from .schemas import (
    BatchRequest,
    ConnectRequest,
    CountResponse,
    GroupPageResponse,
    PriorityUpdateRequest,
    QueueResponse,
    SelectRequest,
    TaskOrderField,
    TaskPageResponse,
    TaskResponse,
    TaskStatus,
    WorkerPageResponse,
)
from .security import DestinationBlocked, validate_server_url
from .sessions import Connection, SessionStore
from .upstream import Upstream, UpstreamError

COOKIE = "labtasker_webui_session"
STATUSES = ("pending", "running", "succeeded", "failed", "cancelled")
QUEUES_ADAPTER = TypeAdapter(list[QueueResponse])


def validated(value: Any, model: Any) -> Any:
    try:
        if isinstance(model, TypeAdapter):
            parsed = model.validate_python(value)
            return model.dump_python(parsed, mode="json")
        parsed = model.model_validate(value)
        return parsed.model_dump(mode="json")
    except ValidationError as exc:
        raise UpstreamError(
            502,
            "malformed_upstream",
            "Labtasker Server returned a response that does not match API v2.",
            {"errors": exc.errors(include_input=False)},
        ) from exc


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    local = (
        local_connection(settings.local_directory) if settings.local_directory is not None else None
    )
    locked = settings.server_url is not None or local is not None
    profile = Profile(settings.profile_path)
    sessions = SessionStore()
    upstream = Upstream(settings.allowed_server_origins, strict=not is_loopback_host(settings.host))
    operations = OperationStore(upstream)
    app = FastAPI(title="Labtasker WebUI", version="0.1.0", docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def enforce_same_origin(request: Request, call_next: Any) -> Response:
        origin = request.headers.get("origin")
        if origin and request.method not in {"GET", "HEAD", "OPTIONS"}:
            try:
                origin_value = validate_server_url(origin, (), strict=False)
                webui_value = validate_server_url(str(request.base_url), (), strict=False)
            except DestinationBlocked:
                origin_value = ""
                webui_value = "different"
            if origin_value != webui_value:
                return JSONResponse(
                    status_code=403,
                    content={
                        "error": {
                            "code": "cross_origin_request_blocked",
                            "message": "The WebUI rejected a cross-origin write request.",
                            "details": {},
                        }
                    },
                )
        # A mutable request-local observation also captures upstream calls made in
        # child tasks, without sharing versions across sessions or credentials.
        observed: dict[str, str] = {}
        context_token = version_headers.set(observed)
        try:
            response = cast(Response, await call_next(request))
            response.headers.update(observed)
            return response
        finally:
            version_headers.reset(context_token)

    @app.exception_handler(UpstreamError)
    async def upstream_error(_: Request, exc: UpstreamError) -> JSONResponse:
        return JSONResponse(
            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
            status_code=exc.status,
        )

    @app.exception_handler(DestinationBlocked)
    async def blocked(_: Request, exc: DestinationBlocked) -> JSONResponse:
        return JSONResponse(
            content={"error": {"code": "destination_blocked", "message": str(exc), "details": {}}},
            status_code=400,
        )

    @app.exception_handler(HTTPException)
    async def webui_http_error(_: Request, exc: HTTPException) -> JSONResponse:
        details: Any
        if isinstance(exc.detail, dict):
            code = str(exc.detail.get("code", "webui_error"))
            message = str(exc.detail.get("message", "The WebUI request failed."))
            details = exc.detail.get("details", {})
        else:
            code = "webui_error"
            message = str(exc.detail)
            details = {}
        return JSONResponse(
            content={"error": {"code": code, "message": message, "details": details}},
            status_code=exc.status_code,
        )

    @app.exception_handler(RequestValidationError)
    async def webui_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            content={
                "error": {
                    "code": "invalid_request",
                    "message": "The WebUI request is invalid.",
                    "details": {"errors": exc.errors()},
                }
            },
            status_code=422,
        )

    def attach_local(directory: str) -> Connection:
        if not is_loopback_host(settings.host):
            raise UpstreamError(
                403, "local_forbidden", "Local connections require a loopback WebUI bind."
            )
        path = Path(directory).expanduser().resolve()
        if not path.is_dir():
            raise UpstreamError(
                422, "local_directory_missing", "The local project directory does not exist."
            )
        try:
            return local_connection(path)
        except (ValueError, ImportError) as exc:
            raise UpstreamError(422, "local_unavailable", str(exc)) from exc

    def connection(session_id: str | None) -> Connection:
        if local is not None:
            return local
        if settings.server_url:
            return Connection(settings.server_url, settings.server_token, 0)
        item = sessions.get(session_id)
        if not item and profile.path and profile.data.get("connection"):
            saved = profile.data["connection"]
            item = (
                attach_local(saved["server_url"][6:])
                if saved["server_url"].startswith("local:")
                else Connection(saved["server_url"], saved.get("token"), 0)
            )
        if not item:
            raise HTTPException(
                401, {"code": "connection_required", "message": "Connect to a Labtasker Server."}
            )
        return item

    @app.get("/api/webui/status")
    async def status(
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
    ) -> dict[str, Any]:
        item = None
        connection_error = None
        try:
            if (
                locked
                or sessions.get(session_id)
                or (profile.path and profile.data.get("connection"))
            ):
                item = connection(session_id)
            if item and (locked or item.socket_path or not sessions.get(session_id)):
                await upstream.verify(item)
        except UpstreamError as exc:
            connection_error = {"code": exc.code, "message": exc.message}
        return {
            "connected": item is not None and connection_error is None,
            "locked": locked,
            "mode": "local" if item and item.socket_path else "http",
            "server_url": item.server_url if item else None,
            "connection_error": connection_error,
        }

    @app.post("/api/webui/connect")
    async def connect(
        payload: ConnectRequest, request: Request, response: Response
    ) -> dict[str, Any]:
        if locked:
            raise HTTPException(409, "Connection is locked by deployment configuration.")
        if payload.mode == "local":
            if payload.token:
                raise HTTPException(422, "Local connections do not use a token.")
            candidate = attach_local(payload.directory)
        else:
            url = validate_server_url(
                payload.server_url,
                settings.allowed_server_origins,
                strict=not is_loopback_host(settings.host),
            )
            candidate = Connection(url, payload.token or None, 0)
        health = await upstream.verify(candidate)
        if profile.path:
            profile.set_connection(candidate.server_url, candidate.token)
        session_id = sessions.create(candidate.server_url, candidate.token, candidate.socket_path)
        response.set_cookie(
            COOKIE,
            session_id,
            httponly=True,
            samesite="strict",
            secure=request.url.scheme == "https",
            max_age=12 * 60 * 60,
        )
        return {
            "connected": True,
            "server_url": candidate.server_url,
            "api_version": health.get("api_version"),
        }

    @app.delete("/api/webui/connect", status_code=204)
    async def disconnect(
        response: Response, session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None
    ) -> None:
        if locked:
            raise HTTPException(409, "Connection is locked by deployment configuration.")
        sessions.delete(session_id)
        if profile.path:
            profile.set_connection(None)
        response.delete_cookie(COOKIE)

    @app.get("/api/webui/profile")
    async def get_profile() -> dict[str, Any]:
        return {
            "enabled": profile.path is not None,
            "ui": profile.data["ui"] if profile.path else {},
        }

    @app.patch("/api/webui/profile")
    async def update_profile(values: dict[str, str]) -> dict[str, bool]:
        if not profile.path:
            raise HTTPException(409, "Project profile is disabled.")
        try:
            profile.update_ui(values)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {"saved": True}

    @app.get("/api/webui/queues")
    async def queues(
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
    ) -> list[dict[str, Any]]:
        conn = connection(session_id)
        queue_list = validated(
            await upstream.request(conn, "GET", "/api/v2/queues"),
            QUEUES_ADAPTER,
        )
        semaphore = asyncio.Semaphore(6)

        async def limited_request(path: str, params: dict[str, Any]) -> Any:
            async with semaphore:
                return await upstream.request(conn, "GET", path, params=params)

        async def summarize(item: dict[str, str]) -> dict[str, Any]:
            name = item["name"]
            path = f"/api/v2/queues/{quote(name, safe='')}/tasks"
            values = await asyncio.gather(
                *(limited_request(path + "/count", {"status": value}) for value in STATUSES),
                limited_request(
                    path,
                    {"limit": 1, "order_by": "updated_at", "descending": "true"},
                ),
            )
            counts = {
                state: validated(values[index], CountResponse)["count"]
                for index, state in enumerate(STATUSES)
            }
            recent_page = validated(values[-1], TaskPageResponse)
            recent_items = recent_page["items"]
            return {
                "name": name,
                "counts": counts,
                "recent": recent_items[0] if recent_items else None,
            }

        return await asyncio.gather(*(summarize(item) for item in queue_list))

    async def observation_request(conn: Connection, path: str, params: dict[str, Any]) -> Any:
        try:
            return await upstream.request(conn, "GET", path, params=params)
        except UpstreamError as exc:
            if exc.status == 404 and exc.code != "queue_not_found":
                raise UpstreamError(
                    501,
                    "observations_unsupported",
                    "This Server does not support Worker observations or route counts.",
                ) from exc
            raise

    async def grouped_counts(
        queue: str,
        session_id: str | None,
        resource: str,
        dimensions: list[str],
        cursor: str | None,
        include_inactive: bool = True,
    ) -> Any:
        params: dict[str, Any] = {"group_by": ",".join(dimensions), "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        if not include_inactive:
            params["filter"] = 'status in ["pending", "running"]'
        value = await observation_request(
            connection(session_id),
            f"/api/v2/queues/{quote(queue, safe='')}/{resource}/count",
            params,
        )
        if isinstance(value, dict) and set(value) == {"count"}:
            raise UpstreamError(
                501,
                "observations_unsupported",
                "This Server does not support grouped counts. Existing Task browsing is available.",
            )
        page = validated(value, GroupPageResponse)
        if page["group_by"] != dimensions or any(
            set(item["key"]) != set(dimensions) for item in page["items"]
        ):
            raise UpstreamError(502, "malformed_upstream", "Invalid grouped count dimensions.")
        return page

    @app.get("/api/webui/queues/{queue}/task-groups")
    async def task_groups(
        queue: str,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
        cursor: str | None = None,
        include_inactive: bool = False,
    ) -> Any:
        return await grouped_counts(
            queue,
            session_id,
            "tasks",
            ["routes", "status"],
            cursor,
            include_inactive,
        )

    @app.get("/api/webui/queues/{queue}/worker-groups")
    async def worker_groups(
        queue: str,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
        cursor: str | None = None,
    ) -> Any:
        return await grouped_counts(queue, session_id, "workers", ["route", "status"], cursor)

    @app.get("/api/webui/queues/{queue}/workers")
    async def list_workers(
        queue: str,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
        cursor: str | None = None,
        filter_expression: Annotated[str | None, Query(alias="filter")] = None,
    ) -> Any:
        params: dict[str, Any] = {"limit": 100}
        if cursor:
            params["cursor"] = cursor
        if filter_expression:
            params["filter"] = filter_expression
        return validated(
            await observation_request(
                connection(session_id),
                f"/api/v2/queues/{quote(queue, safe='')}/workers",
                params,
            ),
            WorkerPageResponse,
        )

    @app.get("/api/webui/queues/{queue}/tasks")
    async def list_tasks(
        queue: str,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
        status: TaskStatus | None = None,
        name: str | None = None,
        name_fuzzy: str | None = None,
        filter_expression: Annotated[str | None, Query(alias="filter")] = None,
        order_by: TaskOrderField = "created_at",
        descending: bool = True,
        cursor: str | None = None,
    ) -> Any:
        params = {"limit": 100, "order_by": order_by, "descending": str(descending).lower()}
        params.update(
            {
                k: v
                for k, v in {
                    "status": status,
                    "name": name,
                    "name_fuzzy": name_fuzzy,
                    "filter": filter_expression,
                    "cursor": cursor,
                }.items()
                if v
            }
        )
        return validated(
            await upstream.request(
                connection(session_id),
                "GET",
                f"/api/v2/queues/{quote(queue, safe='')}/tasks",
                params=params,
            ),
            TaskPageResponse,
        )

    @app.get("/api/webui/queues/{queue}/tasks/count")
    async def count_tasks(
        queue: str,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
        status: TaskStatus | None = None,
        name: str | None = None,
        name_fuzzy: str | None = None,
        filter_expression: Annotated[str | None, Query(alias="filter")] = None,
    ) -> Any:
        params = {
            k: v
            for k, v in {
                "status": status,
                "name": name,
                "name_fuzzy": name_fuzzy,
                "filter": filter_expression,
            }.items()
            if v
        }
        return validated(
            await upstream.request(
                connection(session_id),
                "GET",
                f"/api/v2/queues/{quote(queue, safe='')}/tasks/count",
                params=params,
            ),
            CountResponse,
        )

    @app.get("/api/webui/queues/{queue}/tasks/{task_id}")
    async def get_task(
        queue: str, task_id: str, session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None
    ) -> Any:
        return validated(
            await upstream.request(
                connection(session_id),
                "GET",
                f"/api/v2/queues/{quote(queue, safe='')}/tasks/{quote(task_id, safe='')}",
            ),
            TaskResponse,
        )

    @app.patch("/api/webui/queues/{queue}/tasks/{task_id}/priority")
    async def update_task_priority(
        queue: str,
        task_id: str,
        update: PriorityUpdateRequest,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
    ) -> Any:
        return validated(
            await upstream.request(
                connection(session_id),
                "PATCH",
                f"/api/v2/queues/{quote(queue, safe='')}/tasks/{quote(task_id, safe='')}",
                json={"priority": update.priority},
            ),
            TaskResponse,
        )

    @app.post("/api/webui/queues/{queue}/tasks/{task_id}/{action}")
    async def lifecycle(
        queue: str,
        task_id: str,
        action: str,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
    ) -> Any:
        if action not in {"cancel", "requeue"}:
            raise HTTPException(404)
        return validated(
            await upstream.request(
                connection(session_id),
                "POST",
                f"/api/v2/queues/{quote(queue, safe='')}/tasks/{quote(task_id, safe='')}/{action}",
            ),
            TaskResponse,
        )

    @app.post("/api/webui/queues/{queue}/delete-snapshot")
    async def delete_snapshot(
        queue: str,
        selector: SelectRequest,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
    ) -> dict[str, Any]:
        if not any(
            [
                selector.status,
                selector.name,
                selector.name_fuzzy and selector.name_fuzzy.strip(),
                selector.filter and selector.filter.strip(),
            ]
        ):
            raise HTTPException(
                422,
                {
                    "code": "selector_required",
                    "message": "At least one non-empty selector is required.",
                },
            )
        conn = connection(session_id)
        params = {
            k: v
            for k, v in {
                "status": selector.status,
                "name": selector.name,
                "name_fuzzy": selector.name_fuzzy,
                "filter": selector.filter,
            }.items()
            if v
        }
        ids: list[str] = []
        cursor: str | None = None
        while True:
            page_params = {**params, "limit": 1000}
            if cursor:
                page_params["cursor"] = cursor
            page = validated(
                await upstream.request(
                    conn,
                    "GET",
                    f"/api/v2/queues/{quote(queue, safe='')}/tasks",
                    params=page_params,
                ),
                TaskPageResponse,
            )
            ids.extend(item["id"] for item in page["items"])
            if len(ids) > 1000:
                raise HTTPException(
                    422,
                    {
                        "code": "batch_too_large",
                        "message": "More than 1,000 Tasks match. Refine the filter.",
                        "details": {"limit": 1000},
                    },
                )
            cursor = page.get("next_cursor")
            if not cursor:
                break
        return {
            "queue": queue,
            "task_ids": ids,
            "count": len(ids),
            "selector": selector.model_dump(),
        }

    @app.post("/api/webui/queues/{queue}/delete-operations", status_code=202)
    async def start_delete(
        queue: str,
        payload: BatchRequest,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
    ) -> dict[str, Any]:
        return operations.start(connection(session_id), queue, payload.task_ids).public()

    @app.get("/api/webui/delete-operations/{operation_id}")
    async def operation(
        operation_id: str,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
    ) -> dict[str, Any]:
        item = operations.get(operation_id, connection(session_id))
        if not item:
            raise HTTPException(
                404,
                {
                    "code": "operation_history_lost",
                    "message": (
                        "Operation history was not found; it may have been lost after restart. "
                        "Re-run the current filter to inspect actual Server state."
                    ),
                },
            )
        return item.public()

    @app.post("/api/webui/delete-operations/{operation_id}/stop")
    async def stop_operation(
        operation_id: str,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
    ) -> dict[str, Any]:
        item = operations.stop(operation_id, connection(session_id))
        if not item:
            raise HTTPException(404)
        return item.public()

    @app.post("/api/webui/delete-operations/{operation_id}/retry", status_code=202)
    async def retry_operation(
        operation_id: str,
        session_id: Annotated[str | None, Cookie(alias=COOKIE)] = None,
    ) -> dict[str, Any]:
        item = operations.retry_failed(operation_id, connection(session_id))
        if not item:
            raise HTTPException(
                409,
                "Only a completed operation with failures can be retried.",
            )
        return item.public()

    static_dir = Path(__file__).with_name("static")
    if not static_dir.exists():
        static_dir = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if static_dir.exists():
        app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def frontend(path: str) -> FileResponse:
            candidate = (static_dir / path).resolve()
            if path and candidate.is_file() and static_dir.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(static_dir / "index.html")

    return app
