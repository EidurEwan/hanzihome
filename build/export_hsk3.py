# -*- coding: utf-8 -*-
"""Rewrite the site's HSK data for HSK 3.0 (the 2021 standard), without the full database.

HSK 3.0 has six levels and an advanced band, 7-9, examined together; here the band is
level 7 (the app shows it as "HSK 7-9"). The lists come from data/raw/hsk_complete.json
(complete-hsk-vocabulary, MIT: its "new-1" ... "new-7" tags are HSK 3.0).

Writes, in site/data:
  hsk.js        HZ.hsk       {level: [[word, pinyin, meaning], ...]}, most common first
  hskchars.js   HZ.hskChars  {level: [characters new at that level]}, most common first
  c/*.js        each character's "h": its own HSK level as a word (or null)

Readings and meanings come from the site's own words.js where it has the word, so they
match the rest of the app; the list's own are used for the rest. Afterwards run
  node build/export_charorder.js
  node build/export_wordorder.js
so the learning path and the word order follow the new levels.

Run:  python build/export_hsk3.py
"""

import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "hsk_complete.json")
OUT = os.path.join(ROOT, "site", "data")
LEVELS = range(1, 8)


def log(*a):
    print(*a, flush=True)


def site_data(name):
    """The JSON value of a site/data file written as `expr=<json>;`."""
    with io.open(os.path.join(OUT, name), encoding="utf-8") as fh:
        text = fh.read()
    return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))


def dump(name, expr, obj):
    path = os.path.join(OUT, name)
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("%s=%s;\n" % (expr, body))
    return os.path.getsize(path)


def short_gloss(defs, limit=70):
    """As export_static.short_gloss: the first two meanings, on one line."""
    t = "; ".join(d.replace("(bound form) ", "") for d in defs[:2])
    return t if len(t) <= limit else t[:limit - 1].rstrip() + "…"


def main():
    if not os.path.exists(RAW):
        sys.exit("data/raw/hsk_complete.json is missing: get complete.json from "
                 "https://github.com/drkameleon/complete-hsk-vocabulary")
    with io.open(RAW, encoding="utf-8") as fh:
        data = json.load(fh)

    # the site's dictionary: words.js is in frequency order, most common first
    words = site_data("words.js")
    known = {}
    for rank, row in enumerate(words):
        if row[0] not in known:
            known[row[0]] = (rank, row[2], row[3])
    index = site_data("index.js")

    # each word at its lowest HSK 3.0 level
    level_of, entry_of = {}, {}
    for item in data:
        w = item.get("simplified")
        if not w:
            continue
        for tag in item.get("level") or []:
            m = re.match(r"new-(\d)$", str(tag))
            if m:
                L = int(m.group(1))
                if L < level_of.get(w, 99):
                    level_of[w] = L
                    entry_of[w] = item

    hsk = {str(L): [] for L in LEVELS}
    for w, L in level_of.items():
        if w in known:
            rank, toned, gloss = known[w]
            gloss = gloss if len(gloss) <= 70 else gloss[:69].rstrip() + "…"
        else:
            item = entry_of[w]
            form = (item.get("forms") or [{}])[0]
            toned = (form.get("transcriptions") or {}).get("pinyin", "")
            gloss = short_gloss(form.get("meanings") or [])
            rank = 10 ** 6 + (item.get("frequency") or 10 ** 6)
        hsk[str(L)].append((rank, [w, toned, gloss]))
    for L in hsk:
        hsk[L] = [row for _, row in sorted(hsk[L], key=lambda x: x[0])]
    size = dump("hsk.js", "HZ.hsk", hsk)
    log("hsk.js: %s words (%d bytes)" % ({k: len(v) for k, v in hsk.items()}, size))

    # the characters each level brings in, as export_static does it
    hsk_chars, seen = {}, set()
    for L in LEVELS:
        fresh = []
        for w, _t, _d in hsk[str(L)]:
            for c in w:
                if c in index and c not in seen:
                    seen.add(c)
                    fresh.append(c)
        fresh.sort(key=lambda c: index[c][0] or 99999)
        hsk_chars[str(L)] = fresh
    dump("hskchars.js", "HZ.hskChars", hsk_chars)
    log("hskchars.js: %s characters" % {k: len(v) for k, v in hsk_chars.items()})

    # each character's own level, in its payload
    changed = 0
    cdir = os.path.join(OUT, "c")
    for name in sorted(os.listdir(cdir)):
        path = os.path.join(cdir, name)
        with io.open(path, encoding="utf-8") as fh:
            text = fh.read()
        head = text[:text.index("=") + 1]
        chunk = json.loads(text[len(head):].rstrip().rstrip(";"))
        for ch, payload in chunk.items():
            h = level_of.get(ch)
            if payload.get("h") != h:
                payload["h"] = h
                changed += 1
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(head + json.dumps(chunk, ensure_ascii=False, separators=(",", ":")) + ";\n")
    log("character payloads: %d HSK levels changed" % changed)


if __name__ == "__main__":
    main()
