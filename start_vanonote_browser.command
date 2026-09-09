#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
mkdir -p "$DIR/logs" "$DIR/data" "$DIR/attachments" "$DIR/audio" "$DIR/exports" "$DIR/backups"

pkill -f "$DIR/vanonote.py" >/dev/null 2>&1 || true
PIDS="$(lsof -tiTCP:8766 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$PIDS" ]; then kill $PIDS >/dev/null 2>&1 || true; fi
sleep 1

PY="$DIR/.venv/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3)"
if [ -z "${PY:-}" ]; then echo "Python 3 is required."; exit 1; fi

export VANONOTE_SILENT=1
nohup "$PY" "$DIR/vanonote.py" > "$DIR/logs/vanonote.log" 2> "$DIR/logs/vanonote.err.log" < /dev/null &
disown
sleep 2
if curl -fsS http://localhost:8766/api/ping >/dev/null 2>&1; then
  echo "VanoNote started — http://localhost:8766"
  open "http://localhost:8766"
else
  echo "Startup error. See $DIR/logs/vanonote.err.log"
  cat "$DIR/logs/vanonote.err.log" 2>/dev/null || true
fi
