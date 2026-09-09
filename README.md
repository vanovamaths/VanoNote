# VanoNote

VanoNote is a local-first handwritten notebook and classroom whiteboard for macOS. It is designed for stylus-based teaching, PDF annotation, structured notes, audio capture, and live classroom use from a web browser.

## Features

- Pressure-sensitive handwriting with XP-Pen and other Pointer Events-compatible tablets
- Configurable handwriting smoothing, automatic stroke correction, and pressure curves
- Native-feeling Mac trackpad scrolling and pinch-to-zoom
- Pen, calligraphy, highlighter, eraser, lasso, text, lines, shapes, arrows, and laser pointer
- Blank, ruled, grid, dotted, Cornell, and blackboard paper
- Multi-page notes with PDF and image import/annotation
- Audio recording and browser speech transcription
- Classroom presentation mode and shareable student links on a trusted local network
- Folders, favorites, search, Trash, version history, duplication, and backups
- Local summaries, flashcards, quizzes, and LaTeX snippets
- Autumn, Night, and Quantum themes
- Local SQLite storage: your notes remain on the machine running VanoNote

## Requirements

- macOS
- Python 3.10 or newer
- A modern Chromium- or Safari-based browser
- Optional: XP-Pen macOS driver for pressure, eraser, tilt, and tablet button support
- Optional: LibreOffice for converting supported office documents to PDF

PDF rendering uses **PyMuPDF**, which is distributed under the GNU Affero General Public License (AGPL) or a commercial license. See the PyMuPDF licensing documentation before redistributing a modified or proprietary build.

## Install

Clone or download this repository, then from the VanoNote directory run:

```bash
chmod +x *.command
./install_dependencies.command
./start_vanonote.command
```

VanoNote opens at:

```text
http://localhost:8766
```

You can also run it directly:

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python vanonote.py
```

## Data and privacy

VanoNote is local-first. Runtime data is created beside the application:

```text
data/          SQLite notes database
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
├── index.html
├── manifest.json
├── vanonote.py
├── requirements.txt
├── install_dependencies.command
├── start_vanonote.command
├── restart_vanonote.command
├── stop_vanonote.command
└── diagnose_vanonote.command
```

## Development

The backend uses Python's standard-library HTTP server and SQLite. The frontend is plain HTML, CSS, and JavaScript with Pointer Events for stylus input.

Run the diagnostic after starting the app:

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
