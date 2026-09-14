# -*- coding: utf-8 -*-
"""A local HanziCraft-style Chinese character reference.

Standard library only. Start it with:

    python server.py            # then open http://localhost:8777

Everything is served from data/hanzicraft.db, which build/build.py assembles
from open datasets. No network access is used at run time.
"""

import json
import os
import re
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse, parse_qs

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "build"))
from radicaldata import RADICAL_MAP, RADICALS  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "data", "hanzicraft.db")
WEB = os.path.join(ROOT, "web")
PORT = int(os.environ.get("PORT", "8777"))

MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml", ".ico": "image/x-icon"}

REL_NAME = {
    1: "Exact match, including tone.",
    2: "Same pinyin, different tone.",
    3: "It rhymes.",
    4: "Same initial sound.",
}

_local = threading.local()


def conn():
    if getattr(_local, "db", None) is None:
        _local.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.db.row_factory = sqlite3.Row
    return _local.db


def gloss_of(c):
    return RADICAL_MAP.get(c, (0, ""))[1]


def split_defs(s):
    return [d for d in s.split("/") if d]


# --------------------------------------------------------------------------
# queries
# --------------------------------------------------------------------------

def char_payload(ch):
    db = conn()
    row = db.execute("SELECT * FROM chars WHERE ch=?", (ch,)).fetchone()
    if not row:
        return None
    out = dict(row)
    out["breakdown"] = json.loads(row["breakdown"])
    out["components"] = json.loads(row["components"])
    out["graphical"] = json.loads(row["graphical"])
    out["gloss"] = gloss_of(ch)
    out["kradical_gloss"] = gloss_of(row["kradical"] or "")

    out["readings"] = [
        {"pinyin": r["pinyin"], "toned": r["toned"], "defs": split_defs(r["defs"])}
        for r in db.execute(
            "SELECT pinyin, toned, defs FROM readings WHERE ch=? ORDER BY idx", (ch,))
    ]

    # neighbours in the frequency list
    if row["rank"]:
        prev = db.execute(
            "SELECT ch, rank FROM chars WHERE rank<? ORDER BY rank DESC LIMIT 1",
            (row["rank"],)).fetchone()
        nxt = db.execute(
            "SELECT ch, rank FROM chars WHERE rank>? ORDER BY rank ASC LIMIT 1",
            (row["rank"],)).fetchone()
        out["prev"] = dict(prev) if prev else None
        out["next"] = dict(nxt) if nxt else None
    else:
        out["prev"] = out["next"] = None

    # component glosses, in breakdown order
    out["component_info"] = [
        {"c": c, "gloss": gloss_of(c), "is_char": bool(
            db.execute("SELECT 1 FROM chars WHERE ch=?", (c,)).fetchone())}
        for c in out["components"]
    ]

    # phonetic clues: components of this character that hint at its sound
    clues = []
    seen = set()
    for r in db.execute(
            "SELECT comp, rel FROM phonetic WHERE ch=? ORDER BY rel", (ch,)):
        comp = r["comp"]
        if comp in seen:
            continue
        seen.add(comp)
        creads = db.execute(
            "SELECT toned FROM readings WHERE ch=? ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 3", (comp,)
        ).fetchall()
        members = [dict(m) for m in db.execute(
            """SELECT p.ch, p.rel, c.rank,
                      (SELECT toned FROM readings WHERE ch=p.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS toned
                 FROM phonetic p JOIN chars c ON c.ch = p.ch
                WHERE p.comp=? AND p.ch<>? AND c.rank IS NOT NULL
                ORDER BY c.rank LIMIT 60""", (comp, ch))]
        clues.append({
            "comp": comp,
            "comp_toned": [x["toned"] for x in creads],
            "rel": r["rel"],
            "rel_name": REL_NAME[r["rel"]],
            "members": members,
        })
    out["phonetic"] = clues

    # characters that use this character as a component
    out["appears_in"] = [dict(r) for r in db.execute(
        """SELECT c.ch, c.rank,
                  (SELECT toned FROM readings WHERE ch=c.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS toned
             FROM comp JOIN chars c ON c.ch = comp.ch
            WHERE comp.comp=?
            ORDER BY (c.rank IS NULL), c.rank LIMIT 300""", (ch,))]

    # example words, grouped into common / uncommon / rare
    words = {0: [], 1: [], 2: []}
    for r in db.execute(
            """SELECT w.id, w.simp, w.trad, w.toned, w.defs, w.tier
                 FROM word_chars wc JOIN words w ON w.id = wc.wid
                WHERE wc.ch=? ORDER BY wc.tier, wc.freq DESC""", (ch,)):
        words[r["tier"]].append({
            "simp": r["simp"], "trad": r["trad"], "toned": r["toned"],
            "defs": split_defs(r["defs"])[:4],
        })
    out["words"] = {"common": words[0], "uncommon": words[1], "rare": words[2]}

    lv = db.execute(
        "SELECT MIN(level) AS l FROM hsk WHERE word=?", (ch,)).fetchone()
    out["hsk"] = lv["l"] if lv else None
    return out


def search(q, limit=40):
    db = conn()
    q = q.strip()
    if not q:
        return {"chars": [], "words": []}
    chars, words = [], []
    han = [c for c in q if 0x3400 <= ord(c) <= 0x9FFF]

    if han:
        for c in dict.fromkeys(han):
            r = db.execute(
                """SELECT ch, rank,
                          (SELECT toned FROM readings WHERE ch=chars.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS toned,
                          (SELECT defs  FROM readings WHERE ch=chars.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS defs
                     FROM chars WHERE ch=?""", (c,)).fetchone()
            if r:
                d = dict(r)
                d["defs"] = split_defs(d["defs"] or "")[:3]
                chars.append(d)
        if len(q) > 1:
            for r in db.execute(
                    "SELECT simp, trad, toned, defs FROM words WHERE simp=? OR trad=? LIMIT 5",
                    (q, q)):
                d = dict(r)
                d["defs"] = split_defs(d["defs"])[:4]
                words.append(d)
        return {"chars": chars, "words": words}

    # pinyin (with or without a tone digit) or an English gloss
    pin = q.lower().replace(" ", "")
    like = "%" + q.lower() + "%"
    rows = db.execute(
        """SELECT r.ch, c.rank, r.toned, r.defs
             FROM readings r JOIN chars c ON c.ch = r.ch
            WHERE LOWER(REPLACE(r.pinyin,' ','')) = ?
               OR LOWER(REPLACE(REPLACE(r.pinyin,' ',''),'5','')) = ?
               OR (LENGTH(?)>2 AND LOWER(r.defs) LIKE ?)
            ORDER BY (c.rank IS NULL), c.rank LIMIT ?""",
        (pin, pin, q, like, limit)).fetchall()
    if not rows:
        rows = db.execute(
            """SELECT r.ch, c.rank, r.toned, r.defs
                 FROM readings r JOIN chars c ON c.ch = r.ch
                WHERE LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                      r.pinyin,'1',''),'2',''),'3',''),'4',''),'5','') = ?
                ORDER BY (c.rank IS NULL), c.rank LIMIT ?""", (pin, limit)).fetchall()
    for r in rows:
        d = dict(r)
        d["defs"] = split_defs(d["defs"])[:3]
        chars.append(d)

    for r in db.execute(
            """SELECT simp, trad, toned, defs FROM words
                WHERE LOWER(REPLACE(pinyin,' ','')) = ?
                   OR (LENGTH(?)>2 AND LOWER(defs) LIKE ?)
                ORDER BY freq DESC LIMIT ?""", (pin, q, like, limit)):
        d = dict(r)
        d["defs"] = split_defs(d["defs"])[:4]
        words.append(d)
    return {"chars": chars, "words": words}


def list_frequency(page, per=200):
    db = conn()
    off = (page - 1) * per
    rows = [dict(r) for r in db.execute(
        """SELECT ch, rank, pct, cumpct,
                  (SELECT toned FROM readings WHERE ch=chars.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS toned,
                  (SELECT defs  FROM readings WHERE ch=chars.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS defs
             FROM chars WHERE rank IS NOT NULL ORDER BY rank LIMIT ? OFFSET ?""",
        (per, off))]
    for r in rows:
        r["defs"] = split_defs(r["defs"] or "")[:3]
    total = db.execute(
        "SELECT COUNT(*) n FROM chars WHERE rank IS NOT NULL").fetchone()["n"]
    return {"rows": rows, "page": page, "per": per, "total": total}


def list_radicals():
    db = conn()
    out = []
    for num, canon, variants, name in RADICALS:
        forms = [canon] + variants
        n = db.execute(
            "SELECT COUNT(DISTINCT ch) n FROM comp WHERE comp IN (%s)"
            % ",".join("?" * len(forms)), forms).fetchone()["n"]
        r = db.execute(
            "SELECT toned FROM readings WHERE ch=? ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1",
            (canon,)).fetchone()
        out.append({"num": num, "canon": canon, "variants": variants,
                    "name": name, "n_chars": n, "toned": r["toned"] if r else ""})
    return {"rows": out}


def list_phonetic_sets(degree, page, per=60):
    """Components whose sound carries over to several characters."""
    db = conn()
    off = (page - 1) * per
    rows = db.execute(
        """SELECT comp, COUNT(*) n FROM phonetic WHERE rel<=?
            GROUP BY comp HAVING n>=3
            ORDER BY n DESC, comp LIMIT ? OFFSET ?""",
        (degree, per, off)).fetchall()
    total = db.execute(
        """SELECT COUNT(*) n FROM (SELECT comp FROM phonetic WHERE rel<=?
             GROUP BY comp HAVING COUNT(*)>=3)""", (degree,)).fetchone()["n"]
    out = []
    for r in rows:
        comp = r["comp"]
        members = [dict(m) for m in db.execute(
            """SELECT p.ch, c.rank,
                      (SELECT toned FROM readings WHERE ch=p.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS toned,
                      (SELECT pinyin FROM readings WHERE ch=p.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS pinyin
                 FROM phonetic p JOIN chars c ON c.ch=p.ch
                WHERE p.comp=? AND p.rel<=? AND c.rank IS NOT NULL
                ORDER BY c.rank LIMIT 30""", (comp, degree))]
        if not members:
            continue
        # a component may have several readings; show the one this set is about
        bare = lambda s: re.sub(r"[0-5\s]", "", (s or "").lower())
        want = [bare(m["pinyin"]) for m in members]
        best, score = "", (-1, -1)
        for cr in db.execute(
                "SELECT pinyin, toned FROM readings WHERE ch=? ORDER BY idx", (comp,)):
            # most matching members wins; on a tie prefer the non-surname reading
            s = (want.count(bare(cr["pinyin"])), 0 if cr["pinyin"][:1].isupper() else 1)
            if s > score:
                best, score = cr["toned"], s
        out.append({"comp": comp, "toned": best, "n": r["n"], "members": members})
    return {"rows": out, "page": page, "per": per, "total": total, "degree": degree}


def list_productive_components(page, per=100):
    db = conn()
    off = (page - 1) * per
    # skip bare stroke fragments: keep radicals and anything with a reading
    keep = """(radnum > 0
               OR EXISTS(SELECT 1 FROM readings WHERE readings.ch = components.comp))"""
    rows = [dict(r) for r in db.execute(
        """SELECT comp, gloss, radnum, n_chars, n_ranked, score,
                  ROW_NUMBER() OVER (ORDER BY score DESC) AS prank
             FROM components WHERE %s
            ORDER BY score DESC LIMIT ? OFFSET ?""" % keep, (per, off))]
    for r in rows:
        cr = db.execute("SELECT toned FROM readings WHERE ch=? ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1",
                        (r["comp"],)).fetchone()
        r["toned"] = cr["toned"] if cr else ""
    total = db.execute(
        "SELECT COUNT(*) n FROM components WHERE %s" % keep).fetchone()["n"]
    return {"rows": rows, "page": page, "per": per, "total": total}


def list_productive_characters(page, per=100):
    """Characters that are themselves used inside the most other characters."""
    db = conn()
    off = (page - 1) * per
    rows = [dict(r) for r in db.execute(
        """SELECT c.ch, c.rank, c.n_contains,
                  (SELECT toned FROM readings WHERE ch=c.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS toned,
                  (SELECT defs  FROM readings WHERE ch=c.ch ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1) AS defs
             FROM chars c WHERE c.n_contains > 1 AND c.rank IS NOT NULL
            ORDER BY c.n_contains DESC, c.rank LIMIT ? OFFSET ?""", (per, off))]
    for r in rows:
        r["defs"] = split_defs(r["defs"] or "")[:3]
    total = db.execute(
        "SELECT COUNT(*) n FROM chars WHERE n_contains>1 AND rank IS NOT NULL"
    ).fetchone()["n"]
    return {"rows": rows, "page": page, "per": per, "total": total}


def list_hsk(level):
    db = conn()
    rows = [dict(r) for r in db.execute(
        """SELECT h.word, w.toned, w.defs, w.freq
             FROM hsk h LEFT JOIN words w ON w.simp = h.word
            WHERE h.level=? GROUP BY h.word ORDER BY (w.freq IS NULL), w.freq DESC""",
        (level,))]
    out = []
    for r in rows:
        if not r["toned"]:
            cr = db.execute(
                "SELECT toned, defs FROM readings WHERE ch=? ORDER BY (SUBSTR(pinyin,1,1) BETWEEN 'A' AND 'Z'), idx LIMIT 1",
                (r["word"],)).fetchone()
            if cr:
                r["toned"], r["defs"] = cr["toned"], cr["defs"]
        r["defs"] = split_defs(r["defs"] or "")[:3]
        out.append(r)
    return {"rows": out, "level": level}


def coverage(chars):
    db = conn()
    chars = [c for c in dict.fromkeys(chars) if c.strip()]
    if not chars:
        return {"pct": 0.0, "n": 0, "n_ranked": 0}
    total = 0.0
    ranked = 0
    for i in range(0, len(chars), 400):
        chunk = chars[i:i + 400]
        for r in db.execute(
                "SELECT pct FROM chars WHERE ch IN (%s)" % ",".join("?" * len(chunk)),
                chunk):
            total += r["pct"] or 0.0
            ranked += 1
    return {"pct": round(total, 3), "n": len(chars), "n_ranked": ranked}


def stats():
    db = conn()
    m = {r["k"]: r["v"] for r in db.execute("SELECT k, v FROM meta")}
    return m


# --------------------------------------------------------------------------
# http
# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "hanzicraft-local"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    # -- helpers ---------------------------------------------------------
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        try:
            with open(path, "rb") as fh:
                body = fh.read()
        except OSError:
            return self.send_json({"error": "not found"}, 404)
        self.send_response(200)
        self.send_header("Content-Type",
                         MIME.get(os.path.splitext(path)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # -- routes ----------------------------------------------------------
    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/coverage":
            n = int(self.headers.get("Content-Length", 0))
            try:
                data = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self.send_json({"error": "bad json"}, 400)
            return self.send_json(coverage(data.get("chars", [])))
        self.send_json({"error": "not found"}, 404)

    def do_GET(self):
        u = urlparse(self.path)
        p = unquote(u.path)
        q = parse_qs(u.query)

        def arg(name, default=1):
            try:
                return int(q.get(name, [default])[0])
            except ValueError:
                return default

        try:
            if p.startswith("/api/"):
                return self.api(p, q, arg)
        except sqlite3.Error as e:
            return self.send_json({"error": str(e)}, 500)

        # static files, with a single-page-app fallback
        if p == "/" or not os.path.splitext(p)[1]:
            return self.send_file(os.path.join(WEB, "index.html"))
        safe = os.path.normpath(p.lstrip("/")).replace("\\", "/")
        if safe.startswith(".."):
            return self.send_json({"error": "bad path"}, 400)
        full = os.path.join(WEB, safe)
        if os.path.isfile(full):
            return self.send_file(full)
        return self.send_file(os.path.join(WEB, "index.html"))

    def api(self, p, q, arg):
        if p.startswith("/api/char/"):
            ch = p[len("/api/char/"):]
            data = char_payload(ch)
            return self.send_json(data or {"error": "unknown character", "ch": ch},
                                  200 if data else 404)
        if p == "/api/search":
            return self.send_json(search(q.get("q", [""])[0]))
        if p == "/api/stats":
            return self.send_json(stats())
        if p == "/api/list/frequency":
            return self.send_json(list_frequency(arg("page")))
        if p == "/api/list/radicals":
            return self.send_json(list_radicals())
        if p == "/api/list/phonetic-sets":
            return self.send_json(list_phonetic_sets(arg("degree"), arg("page")))
        if p == "/api/list/productive-components":
            return self.send_json(list_productive_components(arg("page")))
        if p == "/api/list/productive-characters":
            return self.send_json(list_productive_characters(arg("page")))
        m = re.match(r"^/api/list/hsk/(\d)$", p)
        if m:
            return self.send_json(list_hsk(int(m.group(1))))
        return self.send_json({"error": "not found"}, 404)


def main():
    if not os.path.exists(DB_PATH):
        sys.exit("data/hanzicraft.db is missing - run: python build/build.py")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("HanziCraft (local) -> http://localhost:%d" % PORT)
    print("Ctrl-C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
