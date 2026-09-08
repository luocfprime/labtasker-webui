import asyncio

from fastapi.testclient import TestClient

from labtasker_webui.app import create_app
from labtasker_webui.config import Settings
from labtasker_webui.upstream import Upstream, UpstreamError


def test_status_requires_connection() -> None:
    client = TestClient(create_app(Settings()))
    assert client.get("/api/webui/status").json() == {
        "connected": False,
        "locked": False,
        "server_url": None,
        "connection_error": None,
        "mode": "http",
    }


def test_locked_status_never_returns_token(monkeypatch) -> None:
    async def verify(self, connection):
        return {"status": "ok", "api_version": "2"}

    monkeypatch.setattr(Upstream, "verify", verify)
    client = TestClient(
        create_app(Settings(server_url="http://127.0.0.1:8000", server_token="secret"))
    )
    body = client.get("/api/webui/status").json()
    assert body == {
        "connected": True,
        "locked": True,
        "server_url": "http://127.0.0.1:8000",
        "connection_error": None,
        "mode": "http",
    }
    assert "secret" not in client.get("/api/webui/status").text


def test_frontend_fallback_is_packaged() -> None:
    client = TestClient(create_app(Settings()))
    response = client.get("/")
    assert response.status_code == 200
    assert "Labtasker" in response.text


def test_upstream_errors_keep_stable_envelope(monkeypatch) -> None:
    async def fail(*args, **kwargs):
        raise UpstreamError(422, "invalid_filter", "The filter is invalid.", {"offset": 3})

    monkeypatch.setattr(Upstream, "request", fail)
    client = TestClient(create_app(Settings(server_url="http://127.0.0.1:8000")))
    response = client.get("/api/webui/queues")
    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "invalid_filter",
            "message": "The filter is invalid.",
            "details": {"offset": 3},
        }
    }


def test_webui_errors_use_stable_envelope() -> None:
    client = TestClient(create_app(Settings()))
    response = client.get("/api/webui/queues")
    assert response.status_code == 401
    assert response.json()["error"] == {
        "code": "connection_required",
        "message": "Connect to a Labtasker Server.",
        "details": {},
    }


def test_invalid_order_field_uses_validation_envelope() -> None:
    client = TestClient(create_app(Settings(server_url="http://127.0.0.1:8000")))
    response = client.get("/api/webui/queues/default/tasks?order_by=unknown")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_malformed_upstream_response_is_rejected(monkeypatch) -> None:
    async def malformed(*args, **kwargs):
        return [{"unexpected": True}]

    monkeypatch.setattr(Upstream, "request", malformed)
    client = TestClient(create_app(Settings(server_url="http://127.0.0.1:8000")))
    response = client.get("/api/webui/queues")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "malformed_upstream"


def test_queue_summary_request_concurrency_is_bounded(monkeypatch) -> None:
    active = 0
    maximum = 0

    async def fake(self, connection, method, path, params=None):
        nonlocal active, maximum
        if path == "/api/v2/queues":
            return [{"name": f"q{i}"} for i in range(12)]
        active += 1
        maximum = max(maximum, active)
        await asyncio.sleep(0.002)
        active -= 1
        if path.endswith("/count"):
            return {"count": 0}
        return {"items": [], "next_cursor": None}

    monkeypatch.setattr(Upstream, "request", fake)
    client = TestClient(create_app(Settings(server_url="http://127.0.0.1:8000")))
    response = client.get("/api/webui/queues")
    assert response.status_code == 200
    assert len(response.json()) == 12
    assert maximum == 6


def test_interactive_connection_uses_opaque_http_only_cookie(monkeypatch) -> None:
    async def verify(self, connection):
        return {"status": "ok", "api_version": "2"}

    monkeypatch.setattr(Upstream, "verify", verify)
    client = TestClient(create_app(Settings()))
    response = client.post(
        "/api/webui/connect",
        json={"server_url": "http://127.0.0.1:8000", "token": "secret"},
    )
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "secret" not in cookie
    status = client.get("/api/webui/status").json()
    assert status == {
        "connected": True,
        "locked": False,
        "server_url": "http://127.0.0.1:8000",
        "connection_error": None,
        "mode": "http",
    }


def test_locked_status_reports_safe_connection_failure(monkeypatch) -> None:
    async def reject(self, connection):
        raise UpstreamError(409, "incompatible_api", "API version 2 is required.")

    monkeypatch.setattr(Upstream, "verify", reject)
    client = TestClient(
        create_app(Settings(server_url="http://127.0.0.1:8000", server_token="secret"))
    )
    response = client.get("/api/webui/status")
    assert response.status_code == 200
    assert response.json()["connection_error"] == {
        "code": "incompatible_api",
        "message": "API version 2 is required.",
    }
    assert "secret" not in response.text


def test_https_connection_cookie_is_secure(monkeypatch) -> None:
    async def verify(self, connection):
        return {"status": "ok", "api_version": "2"}

    monkeypatch.setattr(Upstream, "verify", verify)
    client = TestClient(create_app(Settings()), base_url="https://webui.test")
    response = client.post(
        "/api/webui/connect",
        json={"server_url": "https://tasks.test", "token": None},
    )
    assert "Secure" in response.headers["set-cookie"]


def test_cross_origin_write_is_rejected_before_connection(monkeypatch) -> None:
    async def verify(self, connection):
        raise AssertionError("upstream verification must not run")

    monkeypatch.setattr(Upstream, "verify", verify)
    client = TestClient(create_app(Settings()))
    response = client.post(
        "/api/webui/connect",
        headers={"Origin": "https://attacker.example"},
        json={"server_url": "http://127.0.0.1:8000", "token": None},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "cross_origin_request_blocked"


def test_same_origin_write_is_allowed(monkeypatch) -> None:
    async def verify(self, connection):
        return {"status": "ok", "api_version": "2"}

    monkeypatch.setattr(Upstream, "verify", verify)
    client = TestClient(create_app(Settings()), base_url="https://webui.test")
    response = client.post(
        "/api/webui/connect",
        headers={"Origin": "https://webui.test"},
        json={"server_url": "http://127.0.0.1:8000", "token": None},
    )
    assert response.status_code == 200


def test_non_loopback_interactive_connection_obeys_allowlist(monkeypatch) -> None:
    async def verify(self, connection):
        raise AssertionError("blocked destinations must not be contacted")

    monkeypatch.setattr(Upstream, "verify", verify)
    client = TestClient(
        create_app(
            Settings(
                host="0.0.0.0",
                allowed_server_origins=("https://allowed.example",),
            )
        )
    )
    response = client.post(
        "/api/webui/connect",
        json={"server_url": "https://blocked.example", "token": None},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "destination_blocked"
