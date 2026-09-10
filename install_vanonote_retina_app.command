#!/bin/bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Applications/VanoNote.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"
PY="$DIR/.venv/bin/python3"

fail(){ echo ""; echo "ERROR: $1"; exit 1; }
[ "$(uname -s)" = "Darwin" ] || fail "VanoNote.app installation is available on macOS only."
command -v python3 >/dev/null 2>&1 || fail "Python 3 is required."

if [ ! -x "$PY" ]; then
  "$DIR/install_dependencies.command"
fi
if ! "$PY" -c 'import webview, fitz' >/dev/null 2>&1; then
  "$DIR/install_dependencies.command"
fi

mkdir -p "$HOME/Applications"
rm -rf "$APP"
mkdir -p "$MACOS" "$RES"

printf -v QDIR '%q' "$DIR"
cat > "$MACOS/VanoNote" <<EOF
#!/bin/bash
SOURCE_DIR=$QDIR
PY="\$SOURCE_DIR/.venv/bin/python3"
[ -x "\$PY" ] || { osascript -e 'display alert "VanoNote" message "Python environment missing. Run install_dependencies.command in the VanoNote folder." as critical'; exit 1; }
cd "\$SOURCE_DIR" || exit 1
exec "\$PY" "\$SOURCE_DIR/desktop.py"
EOF
chmod +x "$MACOS/VanoNote"

cat > "$CONTENTS/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>VanoNote</string>
  <key>CFBundleExecutable</key><string>VanoNote</string>
  <key>CFBundleIdentifier</key><string>com.vanovamaths.vanonote</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>VanoNote</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.1.1</string>
  <key>CFBundleVersion</key><string>1.1.1</string>
  <key>CFBundleIconFile</key><string>VanoNote</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>VanoNote uses the microphone only when you start an audio recording.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>VanoNote uses speech recognition only when you enable transcription.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
EOF

ICON_PNG="$RES/VanoNote-1024.png"
"$PY" - "$ICON_PNG" <<'PY'
import math, struct, sys, zlib
n=1024; scale=n/256; r=58*scale
bg1=(31,78,55); bg2=(107,141,100); cream=(255,248,232,255); gold=(231,184,92,255)
poly=[(61,61),(97,61),(128,153),(159,61),(195,61),(145,200),(110,200)]
poly=[(x*scale,y*scale) for x,y in poly]
def inside_round(x,y):
    if r<=x<n-r or r<=y<n-r: return True
    cx=r if x<r else n-r-1; cy=r if y<r else n-r-1
    return (x-cx)**2+(y-cy)**2<=r*r
def inside_poly(x,y):
    c=False; j=len(poly)-1
    for i,(xi,yi) in enumerate(poly):
        xj,yj=poly[j]
        if ((yi>y)!=(yj>y)) and x < (xj-xi)*(y-yi)/(yj-yi+1e-12)+xi: c=not c
        j=i
    return c
ax,ay=169*scale,153*scale; bx,by=204*scale,188*scale; lw=8*scale
def on_gold(x,y):
    vx,vy=bx-ax,by-ay; wx,wy=x-ax,y-ay; vv=vx*vx+vy*vy
    t=max(0,min(1,(wx*vx+wy*vy)/vv)); px,py=ax+t*vx,ay+t*vy
    return (x-px)**2+(y-py)**2<=lw*lw
raw=bytearray()
for y in range(n):
    raw.append(0)
    for x in range(n):
        if not inside_round(x,y): raw += bytes((0,0,0,0)); continue
        t=(x+y)/(2*(n-1)); rgb=tuple(round(bg1[k]*(1-t)+bg2[k]*t) for k in range(3)); px=(*rgb,255)
        if inside_poly(x+.5,y+.5): px=cream
        if on_gold(x+.5,y+.5): px=gold
        raw += bytes(px)
def chunk(tag,data): return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',n,n,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(raw),9))+chunk(b'IEND',b'')
open(sys.argv[1],'wb').write(png)
PY

TMP="$(mktemp -d)"; ICONSET="$TMP/VanoNote.iconset"; mkdir -p "$ICONSET"
sips -z 16 16 "$ICON_PNG" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$ICON_PNG" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$ICON_PNG" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$ICON_PNG" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$ICON_PNG" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$ICON_PNG" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$ICON_PNG" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$ICON_PNG" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$ICON_PNG" --out "$ICONSET/icon_512x512.png" >/dev/null
cp "$ICON_PNG" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$RES/VanoNote.icns"
rm -rf "$TMP"

codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
touch "$APP"
echo "VanoNote Retina app installed: $APP"
echo "Your notes remain in: $DIR/data/vanonote.db"
open "$APP"
