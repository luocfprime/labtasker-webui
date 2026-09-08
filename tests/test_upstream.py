import httpx
import pytest

from labtasker_webui.security import DestinationBlocked
from labtasker_webui.sessions import Connection
from labtasker_webui.upstream import Upstream, UpstreamError


class FakeClient:
    def __init__(self, responses: list[httpx.Response]) -> None:
        self.responses = responses
        self.requests: list[tuple[str, str, dict[str, str]]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def request(self, method, url, params=None, headers=None):
        self.requests.append((method, url, headers or {}))
        return self.responses.pop(0)


def response(status: int, *, json=None, headers=None, text=None) -> httpx.Response:
    request = httpx.Request("GET", "https://allowed.test/api")
    if json is not None:
        return httpx.Response(status, json=json, headers=headers, request=request)
    return httpx.Response(status, text=text or "", headers=headers, request=request)


@pytest.mark.asyncio
async def test_authorization_header_is_forwarded(monkeypatch) -> None:
    client = FakeClient([response(200, json={"ok": True})])
    monkeypatch.setattr("labtasker_webui.upstream.validate_resolved_destination", lambda *a: None)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)
    result = await Upstream((), False).request(
        Connection("https://allowed.test", "secret", 0), "GET", "/api/v2/queues"
    )
    assert result == {"ok": True}
    assert client.requests[0][2]["Authorization"] == "Bearer secret"


@pytest.mark.asyncio
async def test_redirect_target_must_remain_on_allowlist(monkeypatch) -> None:
    client = FakeClient([response(302, headers={"location": "https://evil.test/api"})])
    monkeypatch.setattr("labtasker_webui.upstream.validate_resolved_destination", lambda *a: None)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)
    with pytest.raises(DestinationBlocked, match="allowlist"):
        await Upstream(("https://allowed.test",), True).request(
            Connection("https://allowed.test", None, 0), "GET", "/api/v2/queues"
        )


@pytest.mark.asyncio
async def test_server_error_envelope_is_preserved(monkeypatch) -> None:
    client = FakeClient(
        [
            response(
                409,
                json={
                    "error": {"code": "task_running", "message": "Task is running.", "details": {}}
                },
            )
        ]
    )
    monkeypatch.setattr("labtasker_webui.upstream.validate_resolved_destination", lambda *a: None)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)
    with pytest.raises(UpstreamError) as caught:
        await Upstream((), False).request(
            Connection("https://allowed.test", "secret", 0), "DELETE", "/task"
        )
    assert caught.value.code == "task_running"
    assert "secret" not in str(caught.value)


@pytest.mark.asyncio
async def test_invalid_json_is_reported_as_malformed(monkeypatch) -> None:
    client = FakeClient([response(200, text="not json")])
    monkeypatch.setattr("labtasker_webui.upstream.validate_resolved_destination", lambda *a: None)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)
    with pytest.raises(UpstreamError, match="invalid JSON") as caught:
        await Upstream((), False).request(Connection("https://allowed.test", None, 0), "GET", "/")
    assert caught.value.code == "malformed_upstream"


@pytest.mark.asyncio
async def test_verify_rejects_incomplete_v2_openapi(monkeypatch) -> None:
    client = FakeClient(
        [
            response(200, json={"status": "ok", "api_version": "2"}),
            response(200, json={"paths": {"/api/v2/queues": {"get": {}}}}),
        ]
    )
    monkeypatch.setattr("labtasker_webui.upstream.validate_resolved_destination", lambda *a: None)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)
    with pytest.raises(UpstreamError, match="missing endpoints") as caught:
        await Upstream((), False).verify(Connection("https://allowed.test", None, 0))
    assert caught.value.code == "incompatible_api"


@pytest.mark.asyncio
async def test_oversized_response_has_stable_error(monkeypatch) -> None:
    client = FakeClient([response(200, text="x" * (16 * 1024 * 1024 + 1))])
    monkeypatch.setattr("labtasker_webui.upstream.validate_resolved_destination", lambda *a: None)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: client)
    with pytest.raises(UpstreamError) as caught:
        await Upstream((), False).request(
            Connection("https://allowed.test", None, 0), "GET", "/large"
        )
    assert caught.value.code == "upstream_response_too_large"


@pytest.mark.asyncio
async def test_socks_environment_proxy_can_initialize_client(monkeypatch) -> None:
    for name in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ):
        monkeypatch.setenv(name, "socks5://127.0.0.1:1080")
    monkeypatch.setenv("NO_PROXY", "")
    monkeypatch.setenv("no_proxy", "")
    monkeypatch.setattr("labtasker_webui.upstream.validate_resolved_destination", lambda *a: None)

    async def request(self, method, url, **kwargs):
        return response(200, json={"status": "ok"})

    # Keep the real constructor: missing SOCKS support fails before any request.
    monkeypatch.setattr(httpx.AsyncClient, "request", request)
    result = await Upstream((), False).request(
        Connection("https://allowed.test", None, 0), "GET", "/health"
    )
    assert result == {"status": "ok"}
