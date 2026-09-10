#!/usr/bin/env python3
"""
VanoNote · local handwritten notebook / classroom whiteboard
All application data lives next to this file under ~/Desktop/VanoNote/.
Launch: python3 vanonote.py  -> http://localhost:8766
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.parse
import webbrowser
import zipfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
ATTACH_DIR = BASE_DIR / "attachments"
AUDIO_DIR = BASE_DIR / "audio"
EXPORT_DIR = BASE_DIR / "exports"
BACKUP_DIR = BASE_DIR / "backups"
ASSETS_DIR = BASE_DIR / "assets"
DB_PATH = DATA_DIR / "vanonote.db"
PORT = 8766
APP_VERSION = "2026.09.09-stable1"
MAX_BODY = 100 * 1024 * 1024

for p in (DATA_DIR, ATTACH_DIR, AUDIO_DIR, EXPORT_DIR, BACKUP_DIR, ASSETS_DIR):
    p.mkdir(parents=True, exist_ok=True)

try:
    import fitz  # PyMuPDF, installed into VanoNote/.venv by install_dependencies.command
    HAVE_FITZ = True
except Exception:
    HAVE_FITZ = False

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#355e4a',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'notebook',
  paper TEXT DEFAULT 'blank',
  favorite INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  locked INTEGER DEFAULT 0,
  content_json TEXT NOT NULL,
  plain_text TEXT DEFAULT '',
  transcript TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT DEFAULT '',
  revision INTEGER DEFAULT 1,
  share_token TEXT DEFAULT '',
  share_mode TEXT DEFAULT 'none'
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  kind TEXT DEFAULT 'file',
  name TEXT NOT NULL,
  mime TEXT DEFAULT 'application/octet-stream',
  rel_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  plain_text TEXT DEFAULT '',
  transcript TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flashcards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  due_at TEXT DEFAULT '',
  interval_days INTEGER DEFAULT 0,
  ease REAL DEFAULT 2.5,
  reps INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);
CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);
CREATE INDEX IF NOT EXISTS idx_versions_note ON versions(note_id, created_at DESC);
"""


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def default_content(paper="blank"):
    return {
        "version": 1,
        "activePage": 0,
        "paper": paper,
        "pages": [{
            "id": secrets.token_hex(4), "name": "Page 1", "paper": paper,
            "width": 1200, "height": 1600, "strokes": [], "objects": [],
            "background": None
        }],
        "settings": {"penOnly": True, "snap": False, "smoothing": "Medium", "autoCorrection": True, "pressureCurve": "Linear", "pinchZoom": True}
    }


def init_db():
    conn = db()
    conn.executescript(SCHEMA)
    note_cols = {r["name"] for r in conn.execute("PRAGMA table_info(notes)")}
    note_add = {
        "folder_id": "INTEGER", "kind": "TEXT DEFAULT 'notebook'", "paper": "TEXT DEFAULT 'blank'",
        "favorite": "INTEGER DEFAULT 0", "archived": "INTEGER DEFAULT 0", "locked": "INTEGER DEFAULT 0",
        "content_json": "TEXT DEFAULT '{}'", "plain_text": "TEXT DEFAULT ''", "transcript": "TEXT DEFAULT ''",
        "tags": "TEXT DEFAULT ''", "created_at": "TEXT DEFAULT ''", "updated_at": "TEXT DEFAULT ''",
        "deleted_at": "TEXT DEFAULT ''", "revision": "INTEGER DEFAULT 1", "share_token": "TEXT DEFAULT ''",
        "share_mode": "TEXT DEFAULT 'none'",
    }
    for col, spec in note_add.items():
        if col not in note_cols:
            conn.execute(f"ALTER TABLE notes ADD COLUMN {col} {spec}")
    t = now_iso()
    conn.execute("UPDATE notes SET content_json=? WHERE content_json IS NULL OR content_json=''", (json.dumps(default_content()),))
    conn.execute("UPDATE notes SET created_at=? WHERE created_at IS NULL OR created_at=''", (t,))
    conn.execute("UPDATE notes SET updated_at=created_at WHERE updated_at IS NULL OR updated_at='' ")
    conn.commit()
    count = conn.execute("SELECT COUNT(*) c FROM folders").fetchone()["c"]
    if not count:
        t = now_iso()
        for i, (name, color) in enumerate([
            ("Courses", "#1f4e37"), ("Research", "#7a5c2e"),
            ("Meetings", "#355e4a"), ("Personal", "#8a5528")
        ]):
            conn.execute("INSERT INTO folders(name,color,sort_order,created_at,updated_at) VALUES(?,?,?,?,?)",
                         (name, color, i, t, t))
        conn.commit()
    conn.close()


def rowdict(r):
    return dict(r) if r else None


def note_meta(row):
    d = dict(row)
    d.pop("content_json", None)
    return d


def list_attachments(conn, note_id):
    out = []
    for r in conn.execute("SELECT * FROM attachments WHERE note_id=? ORDER BY id", (note_id,)):
        d = dict(r)
        d["url"] = f"/file/{d['id']}"
        out.append(d)
    return out


def get_note(conn, note_id):
    r = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    if not r:
        return None
    d = dict(r)
    try:
        d["content"] = json.loads(d.pop("content_json"))
    except Exception:
        d["content"] = default_content(d.get("paper") or "blank")
        d.pop("content_json", None)
    d["attachments"] = list_attachments(conn, note_id)
    return d


def create_note(payload):
    title = str(payload.get("title") or "Untitled Note").strip()[:300]
    folder_id = payload.get("folder_id") or None
    kind = payload.get("kind") or "notebook"
    paper = payload.get("paper") or "blank"
    content = payload.get("content") or default_content(paper)
    t = now_iso()
    conn = db()
    cur = conn.execute(
        "INSERT INTO notes(folder_id,title,kind,paper,content_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        (folder_id, title, kind, paper, json.dumps(content, ensure_ascii=False), t, t))
    conn.commit()
    rid = cur.lastrowid
    out = get_note(conn, rid)
    conn.close()
    return out


def snapshot_if_needed(conn, row):
    last = conn.execute("SELECT created_at FROM versions WHERE note_id=? ORDER BY id DESC LIMIT 1", (row["id"],)).fetchone()
    should = True
    if last:
        try:
            should = (datetime.now() - datetime.fromisoformat(last["created_at"])).total_seconds() >= 180
        except Exception:
            should = True
    if should:
        conn.execute("INSERT INTO versions(note_id,title,content_json,plain_text,transcript,created_at) VALUES(?,?,?,?,?,?)",
                     (row["id"], row["title"], row["content_json"], row["plain_text"], row["transcript"], now_iso()))
        conn.execute("DELETE FROM versions WHERE note_id=? AND id NOT IN (SELECT id FROM versions WHERE note_id=? ORDER BY id DESC LIMIT 100)",
                     (row["id"], row["id"]))


def update_note(note_id, payload, shared=False):
    conn = db()
    row = conn.execute("SELECT * FROM notes WHERE id=?", (note_id,)).fetchone()
    if not row:
        conn.close(); return None
    snapshot_if_needed(conn, row)
    allowed = ["folder_id", "title", "kind", "paper", "favorite", "archived", "locked", "plain_text", "transcript", "tags"]
    cols, vals = [], []
    for k in allowed:
        if k in payload:
            cols.append(f"{k}=?")
            v = payload[k]
            if k in ("favorite", "archived", "locked"):
                v = 1 if v else 0
            if k == "folder_id" and not v:
                v = None
            vals.append(v)
    if "content" in payload:
        cols.append("content_json=?")
        vals.append(json.dumps(payload["content"], ensure_ascii=False, separators=(",", ":")))
    cols += ["updated_at=?", "revision=revision+1"]
    vals.append(now_iso())
    vals.append(note_id)
    conn.execute(f"UPDATE notes SET {','.join(cols)} WHERE id=?", vals)
    conn.commit()
    out = get_note(conn, note_id)
    conn.close()
    return out


def safe_name(name):
    name = Path(name or "file").name
    name = re.sub(r"[^A-Za-z0-9._()\- àâäéèêëîïôöùûüçÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]", "_", name)
    return name[:180] or "file"


def office_to_pdf(src: Path):
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None, "LibreOffice not installed; the original file was attached but not converted to PDF."
    outdir = src.parent / (src.stem + "_converted")
    outdir.mkdir(exist_ok=True)
    try:
        p = subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(src)],
                           capture_output=True, text=True, timeout=90)
        pdf = outdir / (src.stem + ".pdf")
        if p.returncode == 0 and pdf.exists():
            return pdf, None
        return None, (p.stderr or p.stdout or "Conversion failed")[-1000:]
    except Exception as e:
        return None, str(e)


def render_pdf_pages(pdf_path: Path, attachment_id: int):
    if not HAVE_FITZ:
        return [], "PDF rendering needs PyMuPDF. Double-click install_dependencies.command once."
    outdir = ATTACH_DIR / f"pdf_{attachment_id}"
    outdir.mkdir(parents=True, exist_ok=True)
    urls = []
    try:
        doc = fitz.open(str(pdf_path))
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=fitz.Matrix(2.2, 2.2), alpha=False)
            fn = outdir / f"page_{i+1:04d}.png"
            pix.save(str(fn))
            urls.append({"url": f"/pdfpage/{attachment_id}/{i+1}", "width": pix.width, "height": pix.height})
        return urls, None
    except Exception as e:
        return [], str(e)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"


def make_backup():
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = BACKUP_DIR / f"VanoNote_backup_{stamp}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for root in [DATA_DIR, ATTACH_DIR, AUDIO_DIR]:
            for p in root.rglob("*"):
                if p.is_file():
                    z.write(p, p.relative_to(BASE_DIR))
    return out


def backup_loop():
    time.sleep(20)
    while True:
        try:
            make_backup()
            backups = sorted(BACKUP_DIR.glob("VanoNote_backup_*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
            for old in backups[20:]:
                old.unlink(missing_ok=True)
        except Exception as e:
            print("[backup]", e)
        time.sleep(6 * 3600)


class Handler(BaseHTTPRequestHandler):
    server_version = "VanoNote/1.0"

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("Request too large")
        return self.rfile.read(n)

    def read_json(self):
        raw = self.read_body()
        return json.loads(raw.decode("utf-8")) if raw else {}

    def serve_file(self, fp: Path, ctype=None, disposition=None, cache=False):
        if not fp.exists() or not fp.is_file():
            self.send_error(404); return
        data = fp.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or mimetypes.guess_type(fp.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public,max-age=86400" if cache else "no-store")
        if disposition:
            self.send_header("Content-Disposition", disposition)
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        path = u.path
        q = urllib.parse.parse_qs(u.query)
        if path in ("/", "/index.html") or path.startswith("/s/"):
            return self.serve_file(BASE_DIR / "index.html", "text/html; charset=utf-8")
        if path == "/manifest.json":
            return self.serve_file(BASE_DIR / "manifest.json", "application/manifest+json")
        if path.startswith("/assets/"):
            rel = Path(path[len("/assets/"):]).name
            cache_asset = Path(rel).suffix.lower() not in (".js", ".css")
            return self.serve_file(ASSETS_DIR / rel, cache=cache_asset)
        if path == "/api/ping":
            return self.send_json({"ok": True, "app": "VanoNote", "version": APP_VERSION, "port": PORT})
        if path == "/api/bootstrap":
            conn = db()
            folders = [dict(r) for r in conn.execute("SELECT * FROM folders ORDER BY sort_order,name")]
            notes = [note_meta(r) for r in conn.execute("SELECT * FROM notes ORDER BY updated_at DESC")]
            conn.close()
            return self.send_json({"folders": folders, "notes": notes, "fitz": HAVE_FITZ, "lan": lan_ip(), "port": PORT})
        m = re.fullmatch(r"/api/notes/(\d+)", path)
        if m:
            conn = db(); n = get_note(conn, int(m.group(1))); conn.close()
            return self.send_json(n or {"error": "not found"}, 200 if n else 404)
        m = re.fullmatch(r"/api/notes/(\d+)/versions", path)
        if m:
            conn = db(); rows = [dict(r) for r in conn.execute("SELECT id,title,created_at FROM versions WHERE note_id=? ORDER BY id DESC LIMIT 100", (int(m.group(1)),))]; conn.close()
            return self.send_json(rows)
        m = re.fullmatch(r"/api/shared/([A-Za-z0-9_\-]+)", path)
        if m:
            token = m.group(1); conn = db()
            r = conn.execute("SELECT id,share_mode FROM notes WHERE share_token=? AND deleted_at=''", (token,)).fetchone()
            if not r: conn.close(); return self.send_json({"error":"invalid share link"},404)
            n = get_note(conn, r["id"]); conn.close(); n["shared_mode"] = r["share_mode"]
            return self.send_json(n)
        m = re.fullmatch(r"/file/(\d+)", path)
        if m:
            conn = db(); r = conn.execute("SELECT * FROM attachments WHERE id=?", (int(m.group(1)),)).fetchone(); conn.close()
            if not r: return self.send_error(404)
            fp = BASE_DIR / r["rel_path"]
            return self.serve_file(fp, r["mime"], f'inline; filename="{safe_name(r["name"])}"')
        m = re.fullmatch(r"/pdfpage/(\d+)/(\d+)", path)
        if m:
            aid, page = int(m.group(1)), int(m.group(2))
            return self.serve_file(ATTACH_DIR / f"pdf_{aid}" / f"page_{page:04d}.png", "image/png", cache=True)
        m = re.fullmatch(r"/api/versions/(\d+)", path)
        if m:
            conn = db(); r = conn.execute("SELECT * FROM versions WHERE id=?", (int(m.group(1)),)).fetchone(); conn.close()
            if not r: return self.send_json({"error":"not found"},404)
            d=dict(r); d["content"]=json.loads(d.pop("content_json")); return self.send_json(d)
        if path == "/api/backups":
            arr=[{"name":p.name,"size":p.stat().st_size,"mtime":datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec='seconds')} for p in sorted(BACKUP_DIR.glob('*.zip'), reverse=True)]
            return self.send_json(arr)
        if path.startswith("/backup/"):
            name=Path(path[len('/backup/'):]).name
            return self.serve_file(BACKUP_DIR/name,"application/zip",f'attachment; filename="{name}"')
        self.send_error(404)

    def do_POST(self):
        u=urllib.parse.urlparse(self.path); path=u.path; q=urllib.parse.parse_qs(u.query)
        if path == "/api/notes":
            try:
                return self.send_json(create_note(self.read_json()), 201)
            except sqlite3.IntegrityError as ex:
                return self.send_json({"error": f"Could not create note: {ex}"}, 409)
            except Exception as ex:
                print(f"[VanoNote] create note error: {ex}")
                return self.send_json({"error": f"Could not create note: {ex}"}, 500)
        if path == "/api/folders":
            o=self.read_json(); t=now_iso(); conn=db()
            cur=conn.execute("INSERT INTO folders(parent_id,name,color,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                             (o.get('parent_id') or None, str(o.get('name') or 'Folder')[:200], o.get('color') or '#355e4a', int(o.get('sort_order') or 0), t,t)); conn.commit(); rid=cur.lastrowid; r=dict(conn.execute('SELECT * FROM folders WHERE id=?',(rid,)).fetchone()); conn.close(); return self.send_json(r,201)
        m=re.fullmatch(r"/api/notes/(\d+)/restore",path)
        if m:
            conn=db(); conn.execute("UPDATE notes SET deleted_at='',updated_at=?,revision=revision+1 WHERE id=?",(now_iso(),int(m.group(1)))); conn.commit(); n=get_note(conn,int(m.group(1))); conn.close(); return self.send_json(n)
        m=re.fullmatch(r"/api/notes/(\d+)/duplicate",path)
        if m:
            conn=db(); n=get_note(conn,int(m.group(1))); conn.close()
            if not n: return self.send_json({'error':'not found'},404)
            o=create_note({'title':n['title']+' Copy','folder_id':n['folder_id'],'kind':n['kind'],'paper':n['paper'],'content':n['content']}); return self.send_json(o,201)
        m=re.fullmatch(r"/api/notes/(\d+)/share",path)
        if m:
            o=self.read_json(); mode=o.get('mode','view')
            if mode not in ('none','view','edit'): mode='view'
            conn=db(); row=conn.execute('SELECT share_token FROM notes WHERE id=?',(int(m.group(1)),)).fetchone()
            if not row: conn.close(); return self.send_json({'error':'not found'},404)
            token=row['share_token'] or secrets.token_urlsafe(16)
            if mode=='none': token=''
            conn.execute('UPDATE notes SET share_token=?,share_mode=?,updated_at=? WHERE id=?',(token,mode,now_iso(),int(m.group(1)))); conn.commit(); conn.close()
            host=lan_ip(); url=f"http://{host}:{PORT}/s/{token}" if token else ''
            return self.send_json({'mode':mode,'token':token,'url':url})
        m=re.fullmatch(r"/api/notes/(\d+)/restore-version/(\d+)",path)
        if m:
            nid,vid=map(int,m.groups()); conn=db(); old=conn.execute('SELECT * FROM notes WHERE id=?',(nid,)).fetchone(); v=conn.execute('SELECT * FROM versions WHERE id=? AND note_id=?',(vid,nid)).fetchone()
            if not old or not v: conn.close(); return self.send_json({'error':'not found'},404)
            snapshot_if_needed(conn,old)
            conn.execute('UPDATE notes SET title=?,content_json=?,plain_text=?,transcript=?,updated_at=?,revision=revision+1 WHERE id=?',(v['title'],v['content_json'],v['plain_text'],v['transcript'],now_iso(),nid)); conn.commit(); n=get_note(conn,nid); conn.close(); return self.send_json(n)
        if path == "/api/upload":
            nid=int((q.get('note_id') or ['0'])[0]); kind=(q.get('kind') or ['file'])[0]; name=safe_name((q.get('name') or ['file'])[0]); raw=self.read_body()
            if not nid: return self.send_json({'error':'note_id required'},400)
            ext=Path(name).suffix; stem=Path(name).stem; unique=f"{int(time.time())}_{secrets.token_hex(4)}_{safe_name(stem)}{ext}"
            dest=(AUDIO_DIR if kind=='audio' else ATTACH_DIR)/unique; dest.write_bytes(raw)
            mime=self.headers.get('Content-Type') or mimetypes.guess_type(name)[0] or 'application/octet-stream'
            conn=db(); cur=conn.execute('INSERT INTO attachments(note_id,kind,name,mime,rel_path,created_at) VALUES(?,?,?,?,?,?)',(nid,kind,name,mime,str(dest.relative_to(BASE_DIR)),now_iso())); conn.commit(); aid=cur.lastrowid; conn.close()
            result={'id':aid,'name':name,'kind':kind,'mime':mime,'url':f'/file/{aid}','pages':[]}
            pdf_source=None
            if kind=='pdf' or mime=='application/pdf' or ext.lower()=='.pdf': pdf_source=dest
            elif kind in ('document','slides') or ext.lower() in ('.doc','.docx','.ppt','.pptx','.odt','.odp'):
                pdf_source,err=office_to_pdf(dest); result['conversion_error']=err
            if pdf_source:
                pages,err=render_pdf_pages(pdf_source,aid); result['pages']=pages; result['render_error']=err
            return self.send_json(result,201)
        if path == "/api/backup":
            p=make_backup(); return self.send_json({'ok':True,'name':p.name,'url':'/backup/'+p.name})
        self.send_error(404)

    def do_PUT(self):
        path=urllib.parse.urlparse(self.path).path
        m=re.fullmatch(r"/api/notes/(\d+)",path)
        if m:
            try:
                n = update_note(int(m.group(1)), self.read_json())
                return self.send_json(n or {'error':'not found'}, 200 if n else 404)
            except Exception as ex:
                print(f"[VanoNote] save note error: {ex}")
                return self.send_json({"error": f"Could not save note: {ex}"}, 500)
        m=re.fullmatch(r"/api/shared/([A-Za-z0-9_\-]+)",path)
        if m:
            token=m.group(1); conn=db(); r=conn.execute("SELECT id,share_mode FROM notes WHERE share_token=? AND deleted_at=''",(token,)).fetchone(); conn.close()
            if not r: return self.send_json({'error':'invalid share link'},404)
            if r['share_mode']!='edit': return self.send_json({'error':'read only'},403)
            n=update_note(r['id'],self.read_json(),shared=True); return self.send_json(n)
        m=re.fullmatch(r"/api/folders/(\d+)",path)
        if m:
            o=self.read_json(); fields=[]; vals=[]
            for k in ('parent_id','name','color','sort_order'):
                if k in o: fields.append(k+'=?'); vals.append(o[k] or None if k=='parent_id' else o[k])
            fields.append('updated_at=?'); vals.append(now_iso()); vals.append(int(m.group(1))); conn=db(); conn.execute('UPDATE folders SET '+','.join(fields)+' WHERE id=?',vals); conn.commit(); r=conn.execute('SELECT * FROM folders WHERE id=?',(int(m.group(1)),)).fetchone(); conn.close(); return self.send_json(dict(r) if r else {'error':'not found'},200 if r else 404)
        self.send_error(404)

    def do_DELETE(self):
        path=urllib.parse.urlparse(self.path).path
        m=re.fullmatch(r"/api/notes/(\d+)",path)
        if m:
            conn=db(); conn.execute("UPDATE notes SET deleted_at=?,updated_at=? WHERE id=?",(now_iso(),now_iso(),int(m.group(1)))); conn.commit(); conn.close(); return self.send_json({'ok':True})
        m=re.fullmatch(r"/api/notes/(\d+)/permanent",path)
        if m:
            conn=db(); conn.execute('DELETE FROM notes WHERE id=?',(int(m.group(1)),)); conn.commit(); conn.close(); return self.send_json({'ok':True})
        m=re.fullmatch(r"/api/folders/(\d+)",path)
        if m:
            conn=db(); conn.execute('UPDATE notes SET folder_id=NULL WHERE folder_id=?',(int(m.group(1)),)); conn.execute('DELETE FROM folders WHERE id=?',(int(m.group(1)),)); conn.commit(); conn.close(); return self.send_json({'ok':True})
        self.send_error(404)


def port_busy(port):
    with socket.socket() as s:
        s.settimeout(.25); return s.connect_ex(('127.0.0.1',port))==0


def main():
    init_db()
    if port_busy(PORT):
        print(f"VanoNote already appears to be running on http://localhost:{PORT}")
        if os.environ.get('VANONOTE_SILENT')!='1': webbrowser.open(f'http://localhost:{PORT}')
        return
    threading.Thread(target=backup_loop,daemon=True).start()
    httpd=ThreadingHTTPServer(('0.0.0.0',PORT),Handler)
    print(f"VanoNote: http://localhost:{PORT}")
    print(f"Classroom/LAN: http://{lan_ip()}:{PORT}")
    print(f"Data folder: {BASE_DIR}")
    if os.environ.get('VANONOTE_SILENT')!='1':
        threading.Timer(.6,lambda:webbrowser.open(f'http://localhost:{PORT}')).start()
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
    finally: httpd.server_close()

if __name__=='__main__':
    main()
