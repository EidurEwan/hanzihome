# -*- coding: utf-8 -*-
"""Export data/hanzicraft.db into plain .js files for the static site.

The static site has to work when index.html is opened straight off disk, and
browsers refuse fetch()/XHR on file:// URLs. So every data file is a script
that assigns to a global instead of a JSON document that gets fetched:
loading one is just injecting a <script> tag, which file:// allows.

Character detail is split into 64 buckets by codepoint so a lookup pulls in
~200 KB rather than the whole corpus.

Run:  python build/export_static.py
"""

import io
import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from radicaldata import RADICALS, RADICAL_MAP  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(ROOT, "data", "hanzicraft.db")
OUT = os.path.join(ROOT, "site", "data")
BUCKETS = 64


def log(*a):
    print(*a, flush=True)


def bucket_of(ch):
    return "%02x" % (ord(ch[0]) % BUCKETS)


def dump(name, expr, obj):
    """Write `expr = <json>;` to site/data/<name>."""
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    with io.open(path, "w", encoding="utf-8") as fh:
        fh.write("%s=%s;\n" % (expr, body))
    return os.path.getsize(path)


def split_defs(s):
    return [d for d in (s or "").split("/") if d]


def short_gloss(defs, limit=52):
    """A one-line meaning for search results and list rows."""
    t = "; ".join(d.replace("(bound form) ", "") for d in defs[:2])
    return t if len(t) <= limit else t[:limit - 1].rstrip() + "…"


def main():
    if not os.path.exists(DB_PATH):
        sys.exit("data/hanzicraft.db is missing - run: python build/build.py")
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    os.makedirs(OUT, exist_ok=True)
    total = 0

    # ---- readings, keyed by character ----------------------------------
    log("Reading tables...")
    readings = {}
    for r in db.execute(
            "SELECT ch, pinyin, toned, defs FROM readings ORDER BY ch, idx"):
        readings.setdefault(r["ch"], []).append(
            [r["pinyin"], r["toned"], split_defs(r["defs"])])

    def best_reading(ch):
        """The most-used pronunciation; build.py already sorted them."""
        rs = readings.get(ch) or []
        return rs[0] if rs else None

    # ---- words per character -------------------------------------------
    words = {}
    for r in db.execute("SELECT id, simp, trad, toned, tier FROM words"):
        words[r["id"]] = (r["simp"], r["trad"], r["toned"], r["tier"])
    per_char_words = {}
    for r in db.execute(
            "SELECT ch, wid, tier FROM word_chars ORDER BY ch, tier, freq DESC"):
        w = words.get(r["wid"])
        if w:
            per_char_words.setdefault(r["ch"], []).append(
                [w[0], w[1] if w[1] != w[0] else "", w[2], w[3]])

    # ---- phonetic clues -------------------------------------------------
    phon_members = {}
    for r in db.execute(
            """SELECT p.comp, p.ch, p.rel, c.rank FROM phonetic p
                 JOIN chars c ON c.ch = p.ch
                WHERE c.rank IS NOT NULL ORDER BY p.comp, c.rank"""):
        phon_members.setdefault(r["comp"], []).append(
            [r["ch"], r["rank"], r["rel"]])
    clues_for = {}
    for r in db.execute("SELECT comp, ch, rel FROM phonetic ORDER BY ch, rel"):
        clues_for.setdefault(r["ch"], []).append((r["comp"], r["rel"]))

    # ---- component -> characters it builds ------------------------------
    appears_in = {}
    for r in db.execute(
            """SELECT cp.comp, cp.ch, c.rank FROM comp cp
                 JOIN chars c ON c.ch = cp.ch
                ORDER BY cp.comp, (c.rank IS NULL), c.rank"""):
        appears_in.setdefault(r["comp"], []).append([r["ch"], r["rank"]])

    hsk_level = {}
    for r in db.execute("SELECT word, MIN(level) l FROM hsk GROUP BY word"):
        hsk_level[r["word"]] = r["l"]

    # ---- index + per-character payloads ---------------------------------
    log("Building character payloads...")
    index = {}
    chunks = {}
    for row in db.execute("SELECT * FROM chars"):
        ch = row["ch"]
        rs = readings.get(ch) or []
        br = best_reading(ch)
        toned = br[1] if br else ""
        gloss = short_gloss(br[2]) if br else ""
        index[ch] = [row["rank"], round(row["pct"] or 0, 4), toned, gloss]

        clues = []
        seen = set()
        for comp, rel in clues_for.get(ch, []):
            if comp in seen:
                continue
            seen.add(comp)
            cbr = best_reading(comp)
            members = [m for m in phon_members.get(comp, []) if m[0] != ch][:60]
            clues.append({
                "c": comp,
                "t": cbr[1] if cbr else "",
                "r": rel,
                "m": [[m[0], (best_reading(m[0]) or ["", ""])[1], m[1]]
                      for m in members],
            })

        payload = {
            "c": ch,
            "r": row["rank"],
            "p": round(row["pct"] or 0, 4),
            "t": row["trad"],
            "s": row["simp"],
            "st": row["strokes"],
            "kr": row["kradical"],
            "rd": [[r[0], r[1], r[2]] for r in rs],
            "bd": json.loads(row["breakdown"]),
            "cm": json.loads(row["components"]),
            "gr": json.loads(row["graphical"]),
            "ph": clues,
            "ai": [[a[0], (best_reading(a[0]) or ["", ""])[1], a[1]]
                   for a in appears_in.get(ch, [])[:300]],
            "w": per_char_words.get(ch, []),
            "h": hsk_level.get(ch),
        }
        chunks.setdefault(bucket_of(ch), {})[ch] = payload

    total += dump("index.js", "HZ.index", index)
    log("  index.js: %d characters" % len(index))

    # components per character, loaded up front: the dashboard needs them to
    # work out which characters you could already decode ("you know both parts")
    comps = {ch: json.loads(row) for ch, row in db.execute(
        "SELECT ch, components FROM chars WHERE components <> '[]'")}
    total += dump("comps.js", "HZ.comps", comps)
    log("  comps.js: %d characters" % len(comps))

    for b, obj in sorted(chunks.items()):
        total += dump("c/%s.js" % b, "HZ.chunk['%s']" % b, obj)
    sizes = [os.path.getsize(os.path.join(OUT, "c", f))
             for f in os.listdir(os.path.join(OUT, "c"))]
    log("  %d character buckets, %.0f KB avg, %.0f KB largest"
        % (len(sizes), sum(sizes) / len(sizes) / 1024, max(sizes) / 1024))

    # ---- radicals -------------------------------------------------------
    rad_rows = []
    for num, canon, variants, name in RADICALS:
        forms = [canon] + variants
        n = db.execute(
            "SELECT COUNT(DISTINCT ch) n FROM comp WHERE comp IN (%s)"
            % ",".join("?" * len(forms)), forms).fetchone()["n"]
        br = best_reading(canon)
        rad_rows.append([num, canon, variants, name, n, br[1] if br else ""])
    total += dump("radicals.js", "HZ.radicals", rad_rows)
    total += dump("radicalmap.js", "HZ.radicalMap",
                  {k: v[1] for k, v in RADICAL_MAP.items()})

    # ---- productive components & characters ------------------------------
    keep = """(radnum > 0
               OR EXISTS(SELECT 1 FROM readings WHERE readings.ch = components.comp))"""
    comp_rows = []
    for i, r in enumerate(db.execute(
            "SELECT comp, gloss, n_chars, score FROM components WHERE %s "
            "ORDER BY score DESC" % keep), start=1):
        br = best_reading(r["comp"])
        comp_rows.append([i, r["comp"], r["gloss"], br[1] if br else "",
                          r["n_chars"], round(r["score"], 5)])
    total += dump("components.js", "HZ.productiveComponents", comp_rows)

    pc_rows = []
    for i, r in enumerate(db.execute(
            """SELECT ch, rank, n_words, word_score FROM chars
                WHERE rank IS NOT NULL AND n_words > 0
                ORDER BY word_score DESC LIMIT 3000"""), start=1):
        br = best_reading(r["ch"])
        pc_rows.append([i, r["ch"], r["rank"], br[1] if br else "",
                        short_gloss(br[2]) if br else "", r["n_words"],
                        round(r["word_score"], 5)])
    total += dump("prodchars.js", "HZ.productiveCharacters", pc_rows)

    # ---- phonetic sets ---------------------------------------------------
    for degree in (1, 2):
        rows = db.execute(
            """SELECT comp, COUNT(*) n FROM phonetic WHERE rel<=?
                GROUP BY comp HAVING n>=3 ORDER BY n DESC, comp""",
            (degree,)).fetchall()
        out = []
        for r in rows:
            comp = r["comp"]
            members = [m for m in phon_members.get(comp, []) if m[2] <= degree][:30]
            if not members:
                continue
            # show the component reading this set is actually about
            want = [(best_reading(m[0]) or ["", ""])[0].rstrip("012345").lower()
                    for m in members]
            best, score = "", (-1, -1)
            for rd in readings.get(comp, []):
                s = (want.count(rd[0].rstrip("012345").lower()),
                     0 if rd[0][:1].isupper() else 1)
                if s > score:
                    best, score = rd[1], s
            out.append([comp, best, r["n"],
                        [[m[0], (best_reading(m[0]) or ["", ""])[1], m[1]]
                         for m in members]])
        total += dump("phon%d.js" % degree, "HZ.phoneticSets[%d]" % degree, out)
        log("  phonetic sets degree %d: %d" % (degree, len(out)))

    # ---- HSK -------------------------------------------------------------
    hsk = {}
    for r in db.execute(
            """SELECT h.level, h.word, w.toned, w.defs, w.freq
                 FROM hsk h LEFT JOIN words w ON w.simp = h.word
                GROUP BY h.level, h.word
                ORDER BY h.level, (w.freq IS NULL), w.freq DESC"""):
        toned, defs = r["toned"], split_defs(r["defs"])
        if not toned:
            br = best_reading(r["word"])
            if br:
                toned, defs = br[1], br[2]
        hsk.setdefault(str(r["level"]), []).append(
            [r["word"], toned or "", short_gloss(defs, 70)])
    total += dump("hsk.js", "HZ.hsk", hsk)

    # characters each HSK level introduces (new at that level), by frequency
    hsk_chars, seen_ch = {}, set()
    for lv in range(1, 7):
        fresh = []
        for w, _t, _d in hsk.get(str(lv), []):
            for c in w:
                if c in index and c not in seen_ch:
                    seen_ch.add(c)
                    fresh.append(c)
        fresh.sort(key=lambda c: index[c][0] or 99999)
        hsk_chars[str(lv)] = fresh
    total += dump("hskchars.js", "HZ.hskChars", hsk_chars)
    log("  hsk characters: %s" % {k: len(v) for k, v in hsk_chars.items()})

    # ---- word search index ----------------------------------------------
    wrows = []
    for r in db.execute(
            "SELECT simp, trad, pinyin, toned, defs FROM words ORDER BY freq DESC"):
        wrows.append([r["simp"], r["trad"] if r["trad"] != r["simp"] else "",
                      r["toned"], short_gloss(split_defs(r["defs"]), 70),
                      r["pinyin"].replace(" ", "").lower()])
    total += dump("words.js", "HZ.words", wrows)
    log("  words.js: %d words" % len(wrows))

    meta = {k: v for k, v in db.execute("SELECT k, v FROM meta")}
    meta["buckets"] = BUCKETS
    total += dump("meta.js", "HZ.meta", meta)

    db.close()
    log("\nExported %.1f MB to site/data" % (total / 1e6))


if __name__ == "__main__":
    main()
