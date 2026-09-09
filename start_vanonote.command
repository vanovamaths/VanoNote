#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

PY="$DIR/.venv/bin/python3"
if [ ! -x "$PY" ]; then
  echo "VanoNote dependencies are not installed yet."
  echo "Running install_dependencies.command…"
  "$DIR/install_dependencies.command"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  if ! "$PY" -c 'import webview' >/dev/null 2>&1; then
    "$DIR/install_dependencies.command"
  fi
  exec "$PY" "$DIR/desktop.py"
fi

echo "Native desktop mode currently targets macOS. Starting browser mode instead."
exec "$DIR/start_vanonote_browser.command"
