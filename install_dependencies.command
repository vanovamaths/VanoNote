#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "Creating a LOCAL Python environment in $DIR/.venv"
python3 -m venv "$DIR/.venv"
"$DIR/.venv/bin/python3" -m pip install --upgrade pip
"$DIR/.venv/bin/python3" -m pip install -r "$DIR/requirements.txt"

echo ""
echo "VanoNote dependencies are installed in $DIR/.venv"
echo "PyMuPDF enables PDF annotation backgrounds."
if [ "$(uname -s)" = "Darwin" ]; then
  echo "pywebview + Cocoa/WebKit support enables the native macOS VanoNote window."
  echo "Run ./install_macos_app.command once to create ~/Applications/VanoNote.app"
fi
