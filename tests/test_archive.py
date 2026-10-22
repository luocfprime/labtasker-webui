import pytest
from fastapi.testclient import TestClient

from labtasker_webui.app import create_app
from labtasker_webui.config import Settings
from labtasker_webui.upstream import Upstream


def test_archive_scope_is_forwarded_for_every_collection_and_snapshot_page(monkeypatch):
    calls = []

    async def request(self, connection, method, path, *, params=None, **kwargs):
        calls.append((path, params))
        if params.get("group_by"):
            return {"group_by": ["routes", "status"], "count": 0, "items": [], "next_cursor": None}
        if path.endswith("/count"):
            return {"count": 0}
        return {"items": [], "next_cursor": "next" if len(calls) == 4 else None}

    monkeypatch.setattr(Upstream, "request", request)
    with TestClient(create_app(Settings(server_url="http://127.0.0.1:8000"))) as client:
        base = "/api/webui/queues/default"
        for endpoint in ["/tasks", "/tasks/count", "/task-groups"]:
            assert client.get(base + endpoint, params={"include_archived": True}).status_code == 200
        response = client.post(
            base + "/delete-snapshot", json={"filter": "archived == True", "include_archived": True}
        )
        assert response.status_code == 200
        assert response.json()["selector"]["include_archived"] is True
        assert len(calls) == 5
        assert all(params["include_archived"] == "true" for _, params in calls)
        assert calls[-1][1]["cursor"] == "next"
        assert calls[2][1]["filter"] == 'status in ["pending", "running"]'


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"archived": None},
        {"archived": 1},
        {"archived": "true"},
        {"archived": True, "priority": 1},
    ],
)
def test_archive_write_is_narrow_and_strict(monkeypatch, body):
    async def request(*args, **kwargs):
        pytest.fail("invalid archive write reached upstream")

    monkeypatch.setattr(Upstream, "request", request)
    with TestClient(create_app(Settings(server_url="http://127.0.0.1:8000"))) as client:
        response = client.patch(
            "/api/webui/queues/default/tasks/t_ABCDEFGHIJKL/archived", json=body
        )
        assert response.status_code == 422
