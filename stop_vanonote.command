#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
pkill -f "$DIR/vanonote.py" >/dev/null 2>&1 || true
echo "VanoNote stopped."
sleep 2
