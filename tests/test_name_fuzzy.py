from fastapi.testclient import TestClient

from labtasker_webui.app import create_app
from labtasker_webui.config import Settings
from labtasker_webui.upstream import Upstream


def test_fuzzy_selectors_are_forwarded_for_lists_counts_and_snapshot_pages(monkeypatch):
    calls = []

    async def request(self, connection, method, path, *, params=None, **kwargs):
        calls.append((path, params))
        if path.endswith("/count"):
            return {"count": 0}
        return {"items": [], "next_cursor": "next" if len(calls) == 3 else None}

    monkeypatch.setattr(Upstream, "request", request)
    with TestClient(create_app(Settings(server_url="http://127.0.0.1:8000"))) as client:
        selectors = {
            "name_fuzzy": " EV tr ",
            "name": "train_eval",
            "status": "pending",
            "filter": "priority > 0",
        }
        base = "/api/webui/queues/default"
        assert client.get(base + "/tasks", params=selectors).status_code == 200
        assert client.get(base + "/tasks/count", params=selectors).json() == {"count": 0}
        response = client.post(base + "/delete-snapshot", json=selectors)
        assert response.status_code == 200
        assert response.json()["selector"]["name_fuzzy"] == " EV tr "
        assert len(calls) == 4
        for _, params in calls:
            for key, value in selectors.items():
                assert params[key] == value
        assert calls[-1][1]["cursor"] == "next"
        before = len(calls)
        response = client.post(base + "/delete-snapshot", json={"name_fuzzy": " \t "})
        assert response.status_code == 422
        assert len(calls) == before
