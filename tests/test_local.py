import asyncio
import json
import socket
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from labtasker_webui.app import create_app
from labtasker_webui.config import Settings
from labtasker_webui.local import local_connection
from labtasker_webui.sessions import Connection
from labtasker_webui.upstream import Upstream, UpstreamError


def test_local_resolution_only_uses_path_helpers(tmp_path, monkeypatch):
    calls = []
    module = SimpleNamespace(
        require_local_capabilities=lambda: calls.append("capabilities"),
        local_paths=lambda directory: SimpleNamespace(
            directory=directory, socket=directory / "test.sock"
        ),
    )
    monkeypatch.setattr("labtasker_webui.local.importlib.import_module", lambda name: module)
    conn = local_connection(tmp_path)
    assert conn.server_url == f"local:{tmp_path}"
    assert conn.socket_path == str(tmp_path / "test.sock")
    assert conn.token is None
    assert calls == ["capabilities"]


def test_local_configuration_rejects_remote_exposure_and_http_credentials(tmp_path):
    for kwargs in (
        {"host": "0.0.0.0"},
        {"server_url": "http://localhost:8000"},
        {"server_token": "secret"},
    ):
        with pytest.raises(ValueError):
            Settings(local_directory=tmp_path, **kwargs)
    with pytest.raises(ValueError, match="does not exist"):
        Settings(local_directory=tmp_path / "absent")


def test_unavailable_local_instance_stays_locked_and_retryable(tmp_path, monkeypatch):
    conn = Connection(f"local:{tmp_path}", None, 0, str(tmp_path / "absent.sock"))
    monkeypatch.setattr("labtasker_webui.app.local_connection", lambda directory: conn)
    with TestClient(create_app(Settings(local_directory=tmp_path))) as client:
        for _ in range(2):
            data = client.get("/api/webui/status").json()
            assert data["connected"] is False
            assert data["locked"] is True
            assert data["mode"] == "local"
            assert data["connection_error"]["code"] == "local_unavailable"
        assert (
            client.post(
                "/api/webui/connect", json={"server_url": "http://localhost:8000"}
            ).status_code
            == 409
        )
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
@pytest.mark.skipif(not hasattr(socket, "AF_UNIX"), reason="Unix sockets required")
async def test_real_socket_transport_ignores_proxy_and_token(tmp_path, monkeypatch):
    # Short socket path: macOS sockaddr_un is limited to 104 bytes.
    import tempfile

    with tempfile.TemporaryDirectory(dir="/tmp", prefix="webui-") as directory:
        path = str(Path(directory) / "test.sock")
        requests = []

        async def handle(reader, writer):
            requests.append((await reader.readuntil(b"\r\n\r\n")).decode())
            body = json.dumps({"tasks": [], "next_cursor": None}).encode()
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                + str(len(body)).encode()
                + b"\r\nConnection: close\r\n\r\n"
                + body
            )
            await writer.drain()
            writer.close()
            await writer.wait_closed()

        server = await asyncio.start_unix_server(handle, path=path)
        monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:1")
        try:
            result = await Upstream((), False).request(
                Connection("local:/project", "must-not-send", 0, path),
                "GET",
                "/api/v2/queues/default/tasks",
                params={"limit": 20},
            )
            assert result["tasks"] == []
            assert "limit=20" in requests[0]
            assert "Authorization" not in requests[0]
        finally:
            server.close()
            await server.wait_closed()
        with pytest.raises(UpstreamError) as error:
            await Upstream((), False).request(
                Connection("local:/project", None, 0, path), "GET", "/health"
            )
        assert error.value.code == "local_unavailable"


def test_interactive_local_connection_is_saved_and_restored(tmp_path, monkeypatch):
    conn = Connection(f"local:{tmp_path}", None, 0, str(tmp_path / "test.sock"))
    monkeypatch.setattr("labtasker_webui.app.local_connection", lambda directory: conn)

    async def verify(self, candidate):
        assert candidate.socket_path == conn.socket_path
        assert candidate.token is None
        return {"api_version": "2"}

    monkeypatch.setattr(Upstream, "verify", verify)
    settings = Settings(profile_path=tmp_path / ".labtasker/webui-profile.json")
    with TestClient(create_app(settings)) as client:
        result = client.post(
            "/api/webui/connect", json={"mode": "local", "directory": str(tmp_path)}
        )
        assert result.status_code == 200
        assert client.get("/api/webui/status").json()["mode"] == "local"
    with TestClient(create_app(settings)) as client:
        status = client.get("/api/webui/status").json()
        assert status["connected"] and not status["locked"]
        assert status["mode"] == "local"
        assert client.delete("/api/webui/connect").status_code == 204
