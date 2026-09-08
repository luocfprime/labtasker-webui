from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


def is_loopback_host(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def normalize_origin(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Server origins must be absolute HTTP(S) URLs.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Server origins cannot contain credentials, query, or fragment.")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    default = (parsed.scheme == "https" and port == 443) or (parsed.scheme == "http" and port == 80)
    return f"{parsed.scheme}://{parsed.hostname.lower()}{'' if default else f':{port}'}"


@dataclass(frozen=True, slots=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8080
    server_url: str | None = None
    server_token: str | None = None
    allowed_server_origins: tuple[str, ...] = ()

    profile_path: Path | None = None
    local_directory: Path | None = None

    def __post_init__(self) -> None:
        if self.local_directory is not None:
            if self.server_url or self.server_token:
                raise ValueError("--local cannot be combined with a Server URL or token.")
            if not is_loopback_host(self.host):
                raise ValueError("Local attachment is available only on a loopback bind.")
            directory = self.local_directory.resolve()
            if not directory.is_dir():
                raise ValueError("The local project directory does not exist.")
            object.__setattr__(self, "local_directory", directory)
        if not 1 <= self.port <= 65535:
            raise ValueError("port must be between 1 and 65535.")
        if self.profile_path and not is_loopback_host(self.host):
            raise ValueError("Project profiles are available only on a loopback bind.")
        origins = tuple(normalize_origin(item) for item in self.allowed_server_origins)
        object.__setattr__(self, "allowed_server_origins", origins)
        if not is_loopback_host(self.host) and not origins:
            raise ValueError("A non-loopback bind requires --allowed-server-origin.")
        if self.server_token and not self.server_url:
            raise ValueError("LABTASKER_WEBUI_SERVER_TOKEN requires --server-url.")
        if self.server_url:
            origin = normalize_origin(self.server_url)
            if not is_loopback_host(self.host) and origin not in origins:
                raise ValueError("The configured Server URL must match the upstream allowlist.")
