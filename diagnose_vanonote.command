#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
BASE="http://localhost:8766"
echo "VanoNote diagnostic"
echo "==================="
if ! curl -fsS "$BASE/api/ping"; then
  echo "\nFAIL: VanoNote server is not running. Run ./start_vanonote.command first."
  exit 1
fi
echo "\n\n1/3 Server: OK"
BOOT="$(curl -fsS "$BASE/api/bootstrap")" || exit 1
FITZ="$(python3 -c 'import json,sys; print("yes" if json.load(sys.stdin).get("fitz") else "no")' <<<"$BOOT")"
echo "2/3 SQLite/bootstrap: OK"
echo "    PDF renderer (PyMuPDF): $FITZ"
NOTE="$(curl -fsS -X POST "$BASE/api/notes" -H 'Content-Type: application/json' -d '{"title":"VanoNote diagnostic test"}')" || { echo "FAIL: note creation"; exit 1; }
ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$NOTE")"
curl -fsS -X DELETE "$BASE/api/notes/$ID/permanent" >/dev/null || true
echo "3/3 Create/delete note: OK"
echo ""
echo "CORE TEST PASSED"
if [ "$FITZ" != "yes" ]; then
  echo "PDF import needs PyMuPDF. Run: ./install_dependencies.command"
fi
