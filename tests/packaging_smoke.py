"""Build-artifact smoke test: install a wheel and run it without Node.js on PATH."""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import venv
from contextlib import ExitStack
from pathlib import Path


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def read(url: str, timeout: float = 15) -> bytes:
    deadline = time.monotonic() + timeout
    while True:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                return response.read()
        except OSError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.1)


def stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: packaging_smoke.py path/to/labtasker_webui.whl")
    wheel = Path(sys.argv[1]).resolve()
    fixture_port = free_port()
    webui_port = free_port()
    while webui_port == fixture_port:
        webui_port = free_port()
    with (
        tempfile.TemporaryDirectory(prefix="labtasker-webui-wheel-") as temporary,
        ExitStack() as processes,
    ):
        environment = Path(temporary) / "venv"
        venv.EnvBuilder(with_pip=False).create(environment)
        python = environment / "bin" / "python"
        command = environment / "bin" / "labtasker-webui"
        subprocess.run(
            ["uv", "pip", "install", "--python", str(python), str(wheel)],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        fixture = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "fixture_server:app",
                "--app-dir",
                "tests",
                "--host",
                "127.0.0.1",
                "--port",
                str(fixture_port),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )
        processes.callback(stop_process, fixture)
        read(f"http://127.0.0.1:{fixture_port}/health")
        env = {**os.environ, "PATH": str(environment / "bin")}
        assert shutil.which("node", path=env["PATH"]) is None
        webui = subprocess.Popen(
            [
                str(command),
                "--no-profile",
                "--host",
                "127.0.0.1",
                "--port",
                str(webui_port),
            ],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )
        processes.callback(stop_process, webui)
        status = json.loads(read(f"http://127.0.0.1:{webui_port}/api/webui/status"))
        assert status["connected"] is False
        import http.cookiejar
        import urllib.request

        urllib.request.install_opener(
            urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
            )
        )
        with urllib.request.urlopen(
            urllib.request.Request(
                f"http://127.0.0.1:{webui_port}/api/webui/connect",
                data=json.dumps({"server_url": f"http://127.0.0.1:{fixture_port}"}).encode(),
                headers={"Content-Type": "application/json"},
            )
        ) as response:
            assert response.status == 200
        assert status["connection_error"] is None
        root = f"http://127.0.0.1:{webui_port}"
        html = read(f"{root}/")
        assert b'<div id="root">' in html
        assets = re.findall(rb'(?:src|href)="(/[^" ]+)"', html)
        assert any(asset.endswith(b".js") for asset in assets)
        assert any(asset.endswith(b".css") for asset in assets)
        for asset in assets:
            content = read(f"{root}{asset.decode()}")
            assert content and b'<div id="root">' not in content, asset
        queues = json.loads(read(f"http://127.0.0.1:{webui_port}/api/webui/queues"))
        assert queues[0]["name"] == "robotwin"


if __name__ == "__main__":
    main()
