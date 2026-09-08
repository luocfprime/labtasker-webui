import time

from labtasker_webui.sessions import SessionStore


def test_session_round_trip_and_delete() -> None:
    store = SessionStore()
    session_id = store.create("http://127.0.0.1:8000", "secret")
    assert store.get(session_id).token == "secret"  # type: ignore[union-attr]
    store.delete(session_id)
    assert store.get(session_id) is None


def test_session_store_is_bounded() -> None:
    store = SessionStore(maximum=1)
    first = store.create("http://one", None)
    second = store.create("http://two", None)
    assert store.get(first) is None
    assert store.get(second) is not None


def test_expired_session_is_removed() -> None:
    store = SessionStore(ttl_seconds=1)
    session_id = store.create("http://one", "secret")
    store._items[session_id].touched_at = time.monotonic() - 2
    assert store.get(session_id) is None
