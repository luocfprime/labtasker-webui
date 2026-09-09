"""Opt-in BFF contract check against an installed Server, using only temporary data."""

import time
from importlib.metadata import version

import httpx
import pytest
from fastapi.testclient import TestClient

from labtasker_webui.app import create_app
from labtasker_webui.config import Settings


@pytest.mark.integration
def test_bff_against_upstream_source(tmp_path, monkeypatch):
    server_module = pytest.importorskip("labtasker_server.app")
    config_module = pytest.importorskip("labtasker_server.config")
    print(f"Client {version('labtasker-client')}, Server {version('labtasker-server')}")
    upstream_app = server_module.create_app(
        config_module.ServerSettings(database=tmp_path / "isolated.db", token=None)
    )
    with TestClient(upstream_app) as seed:
        assert seed.put("/api/v2/queues/compatibility").status_code in {200, 201}
        for index in range(101):
            response = seed.put(
                f"/api/v2/queues/compatibility/tasks/t_{index:012d}",
                json={
                    "name": f"eval-{index}",
                    "priority": -1,
                    "routes": ["gpu"],
                    "metadata": {"values": "not-an-array"},
                },
            )
            assert response.status_code in {200, 201}, response.text
        response = seed.put(
            "/api/v2/queues/compatibility/workers/w_000000000000",
            json={"route": "gpu", "status": "idle", "task_id": None},
        )
        assert response.status_code == 204, response.text

        # Keep the real BFF transport/parsing, replacing only the network with ASGI.
        async_client = httpx.AsyncClient

        def in_process_client(**kwargs):
            kwargs["transport"] = httpx.ASGITransport(app=upstream_app)
            return async_client(**kwargs)

        monkeypatch.setattr(httpx, "AsyncClient", in_process_client)
        with TestClient(create_app(Settings(server_url="http://127.0.0.1:8000"))) as bff:
            assert bff.get("/api/webui/status").json()["connected"] is True
            base = "/api/webui/queues/compatibility"
            assert bff.get("/api/webui/queues").status_code == 200
            expression = '"gpu" in routes and ' + " and ".join(["priority >= -1"] * 100)
            selection = {"name_fuzzy": "EV", "filter": expression}
            first = bff.get(base + "/tasks", params=selection)
            assert first.status_code == 200, first.text
            assert first.headers["Labtasker-Server-Version"]
            page = first.json()
            assert len(page["items"]) == 100
            assert page["next_cursor"]
            second = bff.get(base + "/tasks", params={**selection, "cursor": page["next_cursor"]})
            assert second.status_code == 200, second.text
            assert len(second.json()["items"]) == 1
            assert second.json()["next_cursor"] is None
            assert len({item["id"] for item in page["items"] + second.json()["items"]}) == 101
            assert bff.get(base + "/tasks/count", params=selection).json() == {"count": 101}
            snapshot = bff.post(base + "/delete-snapshot", json=selection)
            assert snapshot.status_code == 200, snapshot.text
            assert snapshot.json()["count"] == 101
            groups = bff.get(base + "/task-groups")
            assert groups.status_code == 200, groups.text
            assert groups.json()["items"] == [
                {"key": {"routes": "gpu", "status": "pending"}, "count": 101}
            ]
            workers = bff.get(base + "/workers", params={"filter": 'route == "gpu"'})
            assert workers.status_code == 200, workers.text
            assert workers.json()["items"][0]["status"] == "idle"
            groups = bff.get(base + "/worker-groups")
            assert groups.status_code == 200, groups.text
            assert groups.json()["items"][0]["count"] == 1
            non_array = bff.get(base + "/tasks/count", params={"filter": '"x" in metadata.values'})
            assert non_array.status_code == 200, non_array.text
            assert non_array.json() == {"count": 0}
            invalid = bff.get(base + "/tasks", params={"cursor": "invalid"})
            assert invalid.status_code == 422
            assert invalid.json()["error"]["code"] == "invalid_cursor"
            task = base + "/tasks/t_000000000000"
            assert bff.post(task + "/cancel").json()["status"] == "cancelled"
            assert bff.post(task + "/requeue").json()["status"] == "pending"
            deletion = bff.post(base + "/delete-operations", json={"task_ids": ["t_000000000000"]})
            assert deletion.status_code == 202, deletion.text
            deadline = time.monotonic() + 5
            while True:
                result = bff.get("/api/webui/delete-operations/" + deletion.json()["id"])
                assert result.status_code == 200, result.text
                if result.json()["done"]:
                    break
                assert time.monotonic() < deadline, result.text
            assert result.json()["counts"]["deleted"] == 1
            assert bff.get(task).status_code == 404
