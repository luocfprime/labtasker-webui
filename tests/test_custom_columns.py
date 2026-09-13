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


def test_progress_fields_are_explicit_and_optional_for_older_servers() -> None:
    task = next(iter(tasks.values()))
    result = TaskResponse.model_validate(task).model_dump(mode="json")
    assert result["progress"] is None
    assert result["progress_updated_at"] is None
    assert result["progress_attempt"] is None

    older = {key: value for key, value in task.items() if not key.startswith("progress")}
    fallback = TaskResponse.model_validate(older).model_dump(mode="json")
    assert fallback["progress"] is None
    assert fallback["progress_updated_at"] is None
    assert fallback["progress_attempt"] is None

    running = TaskResponse.model_validate(tasks["t_RUNNING12345"]).model_dump(mode="json")
    assert running["progress"] == {
        "completed": 42.9,
        "total": 100,
        "metrics": {"validation_loss": 0.82},
    }
    assert running["progress_attempt"] == 1
