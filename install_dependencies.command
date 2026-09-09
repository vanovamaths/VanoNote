#!/bin/bash
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
echo "Creating a LOCAL Python environment in $DIR/.venv"
python3 -m venv "$DIR/.venv"
"$DIR/.venv/bin/python3" -m pip install --upgrade pip
"$DIR/.venv/bin/python3" -m pip install -r "$DIR/requirements.txt"
echo ""
echo "Done. PyMuPDF lets VanoNote turn PDF pages into annotatable backgrounds."
echo "The dependency is installed only in $DIR/.venv"
sleep 6
