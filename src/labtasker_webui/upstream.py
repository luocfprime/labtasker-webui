from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

import httpx

from .compatibility import observe_server_version
from .security import DestinationBlocked, validate_resolved_destination, validate_server_url
from .sessions import Connection

MAX_RESPONSE_BYTES = 16 * 1024 * 1024


class UpstreamError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.details = details if details is not None else {}
        super().__init__(message)


class Upstream:
    def __init__(self, allowed_origins: tuple[str, ...], strict: bool) -> None:
        self.allowed_origins = allowed_origins
        self.strict = strict

    async def request(
        self,
        connection: Connection,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> Any:
        is_local = connection.socket_path is not None
        base = (
            "http://localhost"
            if is_local
            else validate_server_url(connection.server_url, self.allowed_origins, self.strict)
        )
        url = urljoin(base.rstrip("/") + "/", path.lstrip("/"))
        headers = {"Accept": "application/json"}
        if connection.token and not is_local:
            headers["Authorization"] = f"Bearer {connection.token}"
        for _ in range(6):
            if not is_local:
                validate_resolved_destination(url, self.allowed_origins, self.strict)
            try:
                async with httpx.AsyncClient(
                    timeout=15,
                    follow_redirects=False,
                    transport=httpx.AsyncHTTPTransport(uds=connection.socket_path)
                    if is_local
                    else None,
                    trust_env=not is_local,
                ) as client:
                    response = await client.request(method, url, params=params, headers=headers)
            except (httpx.RequestError, DestinationBlocked) as exc:
                if is_local:
                    raise UpstreamError(
                        502,
                        "local_unavailable",
                        "Cannot connect to the existing local instance for "
                        f"{connection.server_url.removeprefix('local:')}. "
                        "Make sure it is running, then retry. WebUI never starts it.",
                    ) from exc
                raise UpstreamError(502, "upstream_unavailable", str(exc)) from exc
            if response.is_redirect:
                if is_local:
                    raise UpstreamError(
                        502, "local_redirect", "Local instances must not redirect requests."
                    )
                target = response.headers.get("location")
                if not target:
                    raise UpstreamError(
                        502, "malformed_upstream", "Upstream returned an empty redirect."
                    )
                url = urljoin(url, target)
                validate_server_url(url, self.allowed_origins, self.strict)
                continue
            if path.startswith("/api/"):
                observe_server_version(response.headers.get("Labtasker-Server-Version"))
            if response.status_code >= 400:
                try:
                    body = response.json().get("error", {})
                except Exception:
                    body = {}
                raise UpstreamError(
                    response.status_code,
                    body.get("code", "upstream_error"),
                    body.get("message", f"Labtasker Server returned HTTP {response.status_code}."),
                    body.get("details", {}),
                )
            if len(response.content) > MAX_RESPONSE_BYTES:
                raise UpstreamError(
                    502,
                    "upstream_response_too_large",
                    "Labtasker Server returned more than 16 MiB in one response.",
                    {"limit_bytes": MAX_RESPONSE_BYTES},
                )
            if response.status_code == 204:
                return None
            try:
                return response.json()
            except ValueError as exc:
                raise UpstreamError(
                    502, "malformed_upstream", "Labtasker Server returned invalid JSON."
                ) from exc
        raise UpstreamError(502, "redirect_limit", "Labtasker Server redirected too many times.")

    async def verify(self, connection: Connection) -> dict[str, Any]:
        health = await self.request(connection, "GET", "/health")
        if (
            not isinstance(health, dict)
            or health.get("status") != "ok"
            or str(health.get("api_version")) != "2"
        ):
            raise UpstreamError(
                409, "incompatible_api", "This WebUI requires Labtasker API version 2."
            )
        schema = await self.request(connection, "GET", "/openapi.json")
        paths = schema.get("paths") if isinstance(schema, dict) else None
        required = {
            "/api/v2/queues": {"get"},
            "/api/v2/queues/{queue}/tasks": {"get"},
            "/api/v2/queues/{queue}/tasks/count": {"get"},
            "/api/v2/queues/{queue}/tasks/{task_id}": {"get", "delete"},
            "/api/v2/queues/{queue}/tasks/{task_id}/cancel": {"post"},
            "/api/v2/queues/{queue}/tasks/{task_id}/requeue": {"post"},
        }
        compatible = isinstance(paths, dict) and all(
            path in paths and methods.issubset(paths[path]) for path, methods in required.items()
        )
        if not compatible:
            raise UpstreamError(
                409,
                "incompatible_api",
                "The Server OpenAPI contract is missing endpoints required by this WebUI.",
            )
        await self.request(connection, "GET", "/api/v2/queues")
        return health
