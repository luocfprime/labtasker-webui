from fixture_server import tasks

from labtasker_webui.schemas import TaskPageResponse, TaskResponse


def test_preserve_task_fields_for_custom_json_paths() -> None:
    task = {**next(iter(tasks.values())), "summary": {"success_rate": 0.75}}
    task["args"] = {"foo": {"bar": 0}, "enabled": False}
    result = TaskResponse.model_validate(task).model_dump()
    assert result["summary"] == {"success_rate": 0.75}
    assert result["args"] == {"foo": {"bar": 0}, "enabled": False}
    page = TaskPageResponse.model_validate({"items": [task], "next_cursor": None}).model_dump()
    assert page["items"][0]["summary"] == result["summary"]
