import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from labtasker_webui.app import create_app
from labtasker_webui.compatibility import observe_server_version, version_headers
from labtasker_webui.config import Settings


@pytest.mark.parametrize(
    "raw,expected,older",
    [
        ("2.1.0", "2.1.0", "true"),
        ("2.10.0", "2.10.0", "false"),
        ("3.0.0", "3.0.0", "false"),
        ("2.10.0rc1", "2.10.0rc1", "true"),
        (None, "", "false"),
        ("invalid", "", "false"),
        ("1" * 129, "", "false"),
    ],
)
@pytest.mark.parametrize("status", [200, 422])
def test_business_response_forwards_versions_without_extra_request(
    raw, expected, older, status, monkeypatch
):
    monkeypatch.setattr("labtasker.__version__", "2.10.0")
    monkeypatch.setattr("labtasker_webui.upstream.validate_resolved_destination", lambda *a: None)
    requests = []

    async def handler(request):
        requests.append(request)
        return httpx.Response(
            status,
            json=[]
            if status == 200
            else {"error": {"code": "invalid_filter", "message": "Bad filter", "details": {}}},
            headers={} if raw is None else {"Labtasker-Server-Version": raw},
        )

    original = httpx.AsyncClient

    def factory(**kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return original(**kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    client = TestClient(create_app(Settings(server_url="http://127.0.0.1:8000")))
    result = client.get("/api/webui/queues")
    assert result.status_code == status
    assert result.headers["Labtasker-Server-Version"] == expected
    assert result.headers["Labtasker-Client-Version"] == "2.10.0"
    assert result.headers["Labtasker-Server-Upgrade-Recommended"] == older
    assert len(requests) == 1
    assert requests[0].url.path == "/api/v2/queues"
    assert version_headers.get() is None
    # An unrelated BFF response cannot accidentally inherit the prior request's version.
    assert "Labtasker-Client-Version" not in client.get("/api/webui/profile").headers


@pytest.mark.asyncio
async def test_concurrent_observations_do_not_cross_connections():
    async def observe(value):
        headers = {}
        token = version_headers.set(headers)
        try:
            await asyncio.sleep(0)
            observe_server_version(value)
            await asyncio.sleep(0)
            return headers["Labtasker-Server-Version"]
        finally:
            version_headers.reset(token)

    assert await asyncio.gather(observe("1.0.0"), observe("9.0.0")) == ["1.0.0", "9.0.0"]
