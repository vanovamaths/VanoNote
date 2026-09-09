#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Applications/VanoNote.app"

pkill -f "$DIR/desktop.py" >/dev/null 2>&1 || true
pkill -f "$DIR/vanonote.py" >/dev/null 2>&1 || true
PIDS="$(lsof -tiTCP:8766 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$PIDS" ]; then kill $PIDS >/dev/null 2>&1 || true; fi
sleep 1

if [ -d "$APP" ]; then
  open "$APP"
else
  exec "$DIR/start_vanonote.command"
fi
