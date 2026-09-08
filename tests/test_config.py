import pytest

from labtasker_webui.config import Settings, normalize_origin
from labtasker_webui.security import DestinationBlocked, validate_server_url


def test_origin_normalization() -> None:
    assert normalize_origin("https://Example.COM/path") == "https://example.com"
    assert normalize_origin("http://example.com:8080") == "http://example.com:8080"


def test_non_loopback_requires_allowlist() -> None:
    with pytest.raises(ValueError, match="requires"):
        Settings(host="0.0.0.0")


def test_locked_url_must_match_allowlist() -> None:
    with pytest.raises(ValueError, match="match"):
        Settings(
            host="0.0.0.0",
            server_url="https://tasks.example",
            allowed_server_origins=("https://other.example",),
        )


def test_embedded_credentials_are_rejected() -> None:
    with pytest.raises(DestinationBlocked, match="credentials"):
        validate_server_url("https://secret@example.com", (), False)


@pytest.mark.parametrize(
    "value",
    ["ftp://example.com", "https://example.com?token=secret", "https://example.com/#fragment"],
)
def test_unsupported_or_ambiguous_server_urls_are_rejected(value: str) -> None:
    with pytest.raises(DestinationBlocked):
        validate_server_url(value, (), False)
