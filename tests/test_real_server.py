import os

import pytest

from labtasker_webui.sessions import Connection
from labtasker_webui.upstream import Upstream

SERVER_URL = os.environ.get("LABTASKER_REAL_SERVER_URL")


@pytest.mark.integration
@pytest.mark.skipif(not SERVER_URL, reason="LABTASKER_REAL_SERVER_URL is not configured")
@pytest.mark.asyncio
async def test_real_labtasker_v2_read_smoke() -> None:
    """Opt-in contract smoke test; it never mutates Tasks."""
    assert SERVER_URL is not None
    token = os.environ.get("LABTASKER_REAL_SERVER_TOKEN")
    connection = Connection(SERVER_URL, token, 0)
    upstream = Upstream(allowed_origins=(), strict=False)

    health = await upstream.verify(connection)
    queues = await upstream.request(connection, "GET", "/api/v2/queues")

    assert health["status"] == "ok"
    assert str(health["api_version"]) == "2"
    assert isinstance(queues, list)
