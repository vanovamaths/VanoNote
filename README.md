# VanoNote

VanoNote is a local-first handwritten notebook and classroom whiteboard for macOS. It is designed for stylus-based teaching, PDF annotation, structured notes, audio capture, and live classroom use.

> **Latest published local build:** `2026.09.09-stable1` — Retina/HiDPI canvas rendering, 2.2× PDF rendering, Mac trackpad gestures, XP-Pen smoothing/pressure, and a native `VanoNote.app` installer with the VanoNote icon.

VanoNote can run as a **native macOS window** using Cocoa/WebKit through pywebview. Chrome or Safari is not required for normal desktop use.

## Features

- Native macOS application window with no browser address bar or tabs
- Pressure-sensitive handwriting with XP-Pen and other Pointer Events-compatible tablets
- Configurable handwriting smoothing, automatic stroke correction, and pressure curves
- Native-feeling Mac trackpad scrolling and pinch-to-zoom
- Pen, calligraphy, highlighter, eraser, lasso, text, lines, shapes, arrows, and laser pointer
- Blank, ruled, grid, dotted, Cornell, and blackboard paper
- Multi-page notes with PDF and image import/annotation
- Audio recording and live transcription where supported by macOS WebKit
- Classroom presentation mode and shareable student links on a trusted local network
- Folders, favorites, search, Trash, version history, duplication, and backups
- Local summaries, flashcards, quizzes, and LaTeX snippets
- Autumn, Night, and Quantum themes
- Local SQLite storage: your notes remain on the machine running VanoNote

## Requirements

- macOS 11 or newer
- Python 3.10 or newer
- Optional: XP-Pen macOS driver for pressure, eraser, tilt, and tablet button support
- Optional: LibreOffice for converting supported office documents to PDF

The native desktop window uses **pywebview 6.2.1**, backed by WKWebView on macOS. PDF rendering uses **PyMuPDF**, which is distributed under the GNU Affero General Public License (AGPL) or a commercial license.

## Install as a macOS app

Clone or download this repository, then run:

```bash
cd VanoNote
chmod +x *.command
./install_dependencies.command
./install_vanonote_retina_app.command
```

The installer creates:

```text
~/Applications/VanoNote.app
```

After that, open **VanoNote** from Finder, Spotlight, or pin it to the Dock. The application starts its local Python backend automatically and displays the interface inside its own native macOS window.

Your notes stay in the original VanoNote source folder. Installing `VanoNote.app` does not copy, replace, or delete the SQLite database.

If you move the source folder later, run `./install_macos_app.command` again so the application bundle points to the new location.

## Launch without installing the app bundle

From the VanoNote folder:

```bash
./start_vanonote.command
```

On macOS this opens the same native desktop window.

For debugging, the original browser mode remains available:

```bash
./start_vanonote_browser.command
```

Browser mode opens:

```text
http://localhost:8766
```

## How desktop mode works

`desktop.py` starts `vanonote.py` silently in a separate local process, waits for the API to become ready, and creates a resizable pywebview window pointed at `http://127.0.0.1:8766`. On macOS, pywebview uses the system WKWebView renderer.

When the desktop window started the backend itself, closing the window also stops that backend process. If a VanoNote server was already running, the launcher reuses it instead.

## Data and privacy

VanoNote is local-first. Runtime data is created beside the application source:

```text
data/          SQLite notes database and desktop WebKit state
attachments/   imported PDFs, documents, and images
audio/         recordings
exports/       exported notes
backups/       local backups
logs/          local server logs
```

These folders are excluded from Git by default. Do not commit personal notes, recordings, PDFs, backups, or database files.

### Network warning

VanoNote's classroom sharing is intended for a **trusted local network**. Do not expose port `8766` directly to the public internet. If remote access is required, place VanoNote behind an authenticated VPN or reverse proxy that you control.

## XP-Pen setup

Recommended tablet-button mappings:

| Key | Action |
| --- | --- |
| `P` | Pen |
| `C` | Calligraphy |
| `H` | Highlighter |
| `E` | Eraser |
| `L` | Laser |
| `V` | Lasso |
| `T` | Text |
| `Z` | Undo |
| `Shift+Z` | Redo |
| `[` / `]` | Brush size |
| `F` | Presentation mode |
| `←` / `→` | Previous / next page in presentation mode |

For handwriting, the default profile uses medium smoothing, automatic stroke correction, a linear pressure curve, and trackpad pinch zoom.

## Project structure

```text
VanoNote/
├── assets/
│   ├── app.css
│   ├── app.js
│   └── icon.svg
├── desktop.py
├── index.html
├── manifest.json
├── vanonote.py
├── requirements.txt
├── install_dependencies.command
├── install_macos_app.command
├── install_vanonote_retina_app.command
├── start_vanonote.command
├── start_vanonote_browser.command
├── restart_vanonote.command
├── stop_vanonote.command
└── diagnose_vanonote.command
```

## Visual showcase

A static presentation page lives in `docs/index.html`. Screenshots can be added under `docs/screenshots/` and embedded in both the showcase and this README.


## Development

The backend uses Python's standard-library HTTP server and SQLite. The frontend is plain HTML, CSS, and JavaScript with Pointer Events for stylus input. The desktop shell is deliberately thin so the same VanoNote UI and API remain usable in both desktop and browser modes.

Run the diagnostic after starting the backend:

```bash
./diagnose_vanonote.command
```

A healthy installation ends with:

```text
CORE TEST PASSED
```

## License

VanoNote is released under **GNU AGPL-3.0-or-later**. See `LICENSE`.

VanoNote is an independent project. Product and company names mentioned in documentation are trademarks of their respective owners.
