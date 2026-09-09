#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Applications/VanoNote.app"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
PY="$DIR/.venv/bin/python3"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "VanoNote.app installation is available on macOS only."
  exit 1
fi

if [ ! -x "$PY" ]; then
  echo "Installing VanoNote dependencies first…"
  "$DIR/install_dependencies.command"
fi

if ! "$PY" -c 'import webview' >/dev/null 2>&1; then
  echo "pywebview is missing. Reinstalling dependencies…"
  "$DIR/install_dependencies.command"
fi

mkdir -p "$HOME/Applications"
rm -rf "$APP_DIR"
mkdir -p "$MACOS" "$RESOURCES"

printf -v QDIR '%q' "$DIR"
cat > "$MACOS/VanoNote" <<EOF
#!/bin/bash
SOURCE_DIR=$QDIR
PY="\$SOURCE_DIR/.venv/bin/python3"
if [ ! -x "\$PY" ]; then
  osascript -e 'display alert "VanoNote" message "Python environment not found. Run install_dependencies.command in the VanoNote folder." as critical'
  exit 1
fi
exec "\$PY" "\$SOURCE_DIR/desktop.py"
EOF
chmod +x "$MACOS/VanoNote"

cat > "$CONTENTS/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>VanoNote</string>
  <key>CFBundleDisplayName</key>
  <string>VanoNote</string>
  <key>CFBundleIdentifier</key>
  <string>com.vanovamaths.vanonote</string>
  <key>CFBundleExecutable</key>
  <string>VanoNote</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.1.0</string>
  <key>CFBundleVersion</key>
  <string>1.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>VanoNote uses the microphone only when you choose to record audio or use transcription.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>VanoNote uses speech recognition only when you enable live transcription.</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
EOF

cp "$DIR/assets/icon.svg" "$RESOURCES/VanoNote.svg" 2>/dev/null || true

touch "$APP_DIR"
echo ""
echo "VanoNote.app installed successfully:"
echo "$APP_DIR"
echo ""
echo "You can now open VanoNote from Finder, Spotlight, or pin it to the Dock."
echo "The application still stores its notes in the original VanoNote folder."
open "$APP_DIR"
