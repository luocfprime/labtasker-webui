from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn

from .app import create_app
from .config import Settings, is_loopback_host


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="labtasker-webui", description="Web interface for Labtasker v2"
    )
    parser.add_argument("--host", default=os.getenv("LABTASKER_WEBUI_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("LABTASKER_WEBUI_PORT", "8080")))
    parser.add_argument(
        "--no-profile", action="store_true", help="Disable project profile persistence"
    )
    args = parser.parse_args()
    configured_origins = os.getenv("LABTASKER_WEBUI_ALLOWED_SERVER_ORIGINS", "")
    origins = tuple(item.strip() for item in configured_origins.split(",") if item.strip())
    settings = Settings(
        host=args.host,
        port=args.port,
        allowed_server_origins=origins,
        profile_path=Path.cwd() / ".labtasker" / "webui-profile.json"
        if is_loopback_host(args.host) and not args.no_profile
        else None,
    )
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)
