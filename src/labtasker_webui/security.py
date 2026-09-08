from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit

from .config import normalize_origin


class DestinationBlocked(ValueError):
    pass


def validate_server_url(value: str, allowed_origins: tuple[str, ...], strict: bool) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise DestinationBlocked("Server URL must start with http:// or https://.")
    if parsed.username or parsed.password:
        raise DestinationBlocked("Embedded URL credentials are not allowed.")
    try:
        origin = normalize_origin(value)
    except ValueError as exc:
        raise DestinationBlocked(str(exc)) from exc
    if strict and origin not in allowed_origins:
        raise DestinationBlocked("This Server origin is not in the WebUI upstream allowlist.")
    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def resolve_addresses(
    hostname: str, port: int
) -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        addresses = {
            ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(hostname, port)
        }
        if not addresses:
            raise DestinationBlocked(f"The Server host resolved to no addresses: {hostname}")
        return addresses
    except socket.gaierror as exc:
        raise DestinationBlocked(f"The Server host could not be resolved: {hostname}") from exc


def validate_resolved_destination(url: str, allowed_origins: tuple[str, ...], strict: bool) -> None:
    parsed = urlsplit(url)
    if strict and normalize_origin(url) not in allowed_origins:
        raise DestinationBlocked(
            "The resolved Server origin is not in the WebUI upstream allowlist."
        )
    # Resolution is performed on every request so DNS changes cannot silently bypass validation.
    resolve_addresses(
        parsed.hostname or "", parsed.port or (443 if parsed.scheme == "https" else 80)
    )
