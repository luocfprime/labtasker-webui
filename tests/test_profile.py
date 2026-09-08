import json
import stat

import pytest
from fastapi.testclient import TestClient

from labtasker_webui.app import create_app
from labtasker_webui.config import Settings
from labtasker_webui.profile import Profile
from labtasker_webui.upstream import Upstream


def test_profile_restores_connection_and_ui_without_exposing_token(tmp_path, monkeypatch):
    async def verify(self, conn):
        assert conn.token == "private-token"
        return {"status": "ok", "api_version": "2"}

    monkeypatch.setattr(Upstream, "verify", verify)
    path = tmp_path / ".labtasker" / "webui-profile.json"
    settings = Settings(profile_path=path)
    with TestClient(create_app(settings)) as client:
        assert (
            client.post(
                "/api/webui/connect",
                json={
                    "server_url": "http://127.0.0.1:8000",
                    "token": "private-token",
                },
            ).status_code
            == 200
        )
        assert (
            client.patch(
                "/api/webui/profile",
                json={
                    "labtasker:customColumns:v1": '["args.foo"]',
                },
            ).status_code
            == 200
        )
        assert client.patch("/api/webui/profile", json={"token": "bad"}).status_code == 422
        assert (
            client.patch(
                "/api/webui/profile",
                headers={"origin": "https://evil.test"},
                json={"labtasker:lastQueue": "evil"},
            ).status_code
            == 403
        )
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    token_path = path.with_name("webui-token")
    assert token_path.read_text() == "private-token"
    assert stat.S_IMODE(token_path.stat().st_mode) == 0o600
    assert "private-token" not in path.read_text()
    with TestClient(create_app(settings)) as client:
        status = client.get("/api/webui/status")
        assert status.json()["connected"] is True
        assert status.json()["locked"] is False
        profile = client.get("/api/webui/profile")
        assert profile.json()["ui"]["labtasker:customColumns:v1"] == '["args.foo"]'
        assert "private-token" not in profile.text + status.text
        assert client.delete("/api/webui/connect").status_code == 204
    assert not token_path.exists()
    assert json.loads(path.read_text())["connection"] is None
    assert Profile(path).data["ui"]["labtasker:customColumns:v1"] == '["args.foo"]'


def test_no_profile_on_shared_bind(tmp_path):
    with pytest.raises(ValueError, match="loopback"):
        Settings(host="0.0.0.0", profile_path=tmp_path / "profile.json")


def test_profile_disabled_does_not_write():
    with TestClient(create_app()) as client:
        assert client.get("/api/webui/profile").json() == {"enabled": False, "ui": {}}
        assert client.patch("/api/webui/profile", json={}).status_code == 409


def test_migrates_combined_profile(tmp_path):
    path = tmp_path / "webui-profile.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "connection": {"server_url": "http://localhost:8000", "token": "old-secret"},
                "ui": {},
            }
        )
    )
    assert Profile(path).data["connection"]["token"] == "old-secret"
    assert "old-secret" not in path.read_text()
    assert path.with_name("webui-token").read_text() == "old-secret"
