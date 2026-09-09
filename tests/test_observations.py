from fastapi.testclient import TestClient

from labtasker_webui.app import create_app
from labtasker_webui.config import Settings
from labtasker_webui.upstream import Upstream


def client():
    return TestClient(create_app(Settings(server_url="http://127.0.0.1:8000")))


def test_grouped_counts_reject_old_scalar_response(monkeypatch):
    async def request(*args, **kwargs):
        return {"count": 7}

    monkeypatch.setattr(Upstream, "request", request)
    response = client().get("/api/webui/queues/default/task-groups")
    assert response.status_code == 501
    assert response.json()["error"]["code"] == "observations_unsupported"


def test_route_groups_forward_cursor_and_active_scope(monkeypatch):
    calls = []

    async def request(self, conn, method, path, **kwargs):
        calls.append((path, kwargs["params"]))
        return {
            "group_by": ["routes", "status"],
            "count": 5,
            "items": [{"key": {"routes": "eval", "status": "pending"}, "count": 5}],
            "next_cursor": "next",
        }

    monkeypatch.setattr(Upstream, "request", request)
    response = client().get("/api/webui/queues/default/task-groups?cursor=page2")
    assert response.status_code == 200
    assert response.json()["next_cursor"] == "next"
    assert calls[0][1]["filter"] == 'status in ["pending", "running"]'
    assert calls[0][1]["cursor"] == "page2"
    client().get("/api/webui/queues/default/task-groups?include_inactive=true")
    assert "filter" not in calls[-1][1]


def test_worker_page_validation_and_filter_forwarding(monkeypatch):
    calls = []

    async def request(self, conn, method, path, **kwargs):
        calls.append(kwargs["params"])
        return {"items": [], "next_cursor": None}

    monkeypatch.setattr(Upstream, "request", request)
    response = client().get("/api/webui/queues/default/workers?filter=status%20%3D%3D%20%22idle%22")
    assert response.status_code == 200
    assert calls[0]["filter"] == 'status == "idle"'
