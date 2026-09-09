#!/usr/bin/env python3
"""Native desktop launcher for VanoNote on macOS."""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PORT = 8766
URL = f"http://127.0.0.1:{PORT}"
LOG_DIR = BASE_DIR / "logs"
DATA_DIR = BASE_DIR / "data"


def server_alive() -> bool:
    try:
        with urllib.request.urlopen(f"{URL}/api/ping", timeout=0.5) as response:
            return response.status == 200
    except Exception:
        return False


def wait_for_server(timeout: float = 12.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if server_alive():
            return True
        time.sleep(0.15)
    return False


def start_server() -> subprocess.Popen | None:
    if server_alive():
        return None

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["VANONOTE_SILENT"] = "1"

    stdout = open(LOG_DIR / "vanonote.log", "a", encoding="utf-8")
    stderr = open(LOG_DIR / "vanonote.err.log", "a", encoding="utf-8")
    process = subprocess.Popen(
        [sys.executable, str(BASE_DIR / "vanonote.py")],
        cwd=str(BASE_DIR),
        env=env,
        stdout=stdout,
        stderr=stderr,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    process._vanonote_logs = (stdout, stderr)  # type: ignore[attr-defined]
    return process


def stop_server(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=3)
    except Exception:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except Exception:
            pass
    finally:
        for stream in getattr(process, "_vanonote_logs", ()):
            try:
                stream.close()
            except Exception:
                pass


def main() -> int:
    if sys.platform != "darwin":
        print("The native VanoNote desktop window currently targets macOS.")
        print(f"Use the browser version at {URL} on other platforms.")
        return 2

    try:
        import webview
    except ImportError:
        print("pywebview is not installed.")
        print("Run ./install_dependencies.command once, then try again.")
        return 2

    server_process = start_server()
    if not wait_for_server():
        stop_server(server_process)
        print("VanoNote server did not start. Check logs/vanonote.err.log.")
        return 1

    storage = DATA_DIR / "webview"
    storage.mkdir(parents=True, exist_ok=True)

    try:
        webview.create_window(
            "VanoNote",
            URL,
            width=1440,
            height=920,
            min_size=(1000, 700),
            resizable=True,
            background_color="#f8f4eb",
            text_select=True,
            zoomable=False,
        )
        webview.start(
            debug=False,
            private_mode=False,
            storage_path=str(storage),
        )
    finally:
        stop_server(server_process)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
