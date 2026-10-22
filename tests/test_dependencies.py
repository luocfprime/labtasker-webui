import pytest
from fastapi.testclient import TestClient
from fixture_server import tasks

from labtasker_webui.app import create_app
from labtasker_webui.config import Settings
from labtasker_webui.schemas import TaskPageResponse, TaskResponse
from labtasker_webui.upstream import Upstream


def test_dependency_lists_preserve_order_and_duplicates_in_details_and_pages():
    dependencies = ["t_SUCCEEDED123", "t_ABCDEFGHIJKL", "t_SUCCEEDED123"]
    task = {**tasks["t_ABCDEFGHIJKL"], "dependencies": dependencies}
    assert TaskResponse.model_validate(task).model_dump()["dependencies"] == dependencies
    page = TaskPageResponse.model_validate({"items": [task], "next_cursor": None})
    assert page.model_dump()["items"][0]["dependencies"] == dependencies
    older = {key: value for key, value in task.items() if key != "dependencies"}
    assert TaskResponse.model_validate(older).dependencies == []


@pytest.mark.parametrize("dependencies", [None, {}, "t_ABCDEFGHIJKL", [1], [False]])
def test_malformed_upstream_dependencies_use_the_response_error_envelope(monkeypatch, dependencies):
    async def request(*args, **kwargs):
        return {**tasks["t_ABCDEFGHIJKL"], "dependencies": dependencies}

    monkeypatch.setattr(Upstream, "request", request)
    client = TestClient(create_app(Settings(server_url="http://127.0.0.1:8000")))
    response = client.get("/api/webui/queues/robotwin/tasks/t_ABCDEFGHIJKL")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "malformed_upstream"
