# -*- coding: utf-8 -*-
"""Give every word its everyday reading in the site's word lists.

The database keeps one reading per word, and for a word CC-CEDICT lists twice it
is often the rarer one: search showed 告诉 as gào sù "to press charges" and 东西
as dōng xī "east and west". build/everyday_readings.txt lists, checked by hand,
the words whose everyday reading is another (告诉 gào su "to tell"), and
site/data/readerwords.js (build/export_reader.py), which keeps all of a word's
readings, gives that reading's meanings. This rewrites, from them:

    site/data/words.js    search: the reading, and the meanings of that reading first
    site/data/hsk.js      the HSK vocabulary lists: the same
    site/data/c/*.js      each character's example words: the reading

A word whose reading already matches is left as it is, so running this again
changes nothing. Run it after export_reader.py:

    python build/export_static.py && python build/export_reader.py && python build/word_readings.py
"""

import glob
import io
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")

TONES = {"̄": 1, "́": 2, "̌": 3, "̀": 4}


def load(name):
    """site/data/<name> as (the `HZ.x=` prefix, the parsed value)."""
    with io.open(os.path.join(DATA, name), encoding="utf-8") as fh:
        text = fh.read()
    prefix, body = text.split("=", 1)
    value, end = json.JSONDecoder().raw_decode(body)   # (readerwords.js has more after it)
    return prefix, value


def save(name, prefix, obj):
    body = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    with io.open(os.path.join(DATA, name), "w", encoding="utf-8") as fh:
        fh.write("%s=%s;\n" % (prefix, body))


def numbered(toned):
    """'gào su' -> 'gao4su5', 'lǜ sè' -> 'lu:4se4', the way words.js writes it."""
    out = []
    for syl in toned.split():
        tone, letters = 5, []
        for ch in unicodedata.normalize("NFD", syl.lower()):
            if ch in TONES:
                tone = TONES[ch]
            elif ch == "̈":
                letters.append(":")
            else:
                letters.append(ch)
        out.append("".join(letters) + str(tone))
    return "".join(out)


def first_meanings_first(gloss, meanings):
    """gloss's '; '-separated parts, those of the everyday reading moved to the front."""
    parts = [p for p in gloss.split("; ") if p]
    want = [m.rstrip("…") for m in meanings.split("; ")]
    lead = [p for p in parts if any(p == w or (m.endswith("…") and p.startswith(w))
                                    for m, w in zip(meanings.split("; "), want))]
    rest = [p for p in parts if p not in lead]
    return "; ".join(lead + rest) if lead else meanings + ("; " + gloss if gloss else "")


def main():
    _, words = load("readerwords.js")    # {word: [freq, tag, [[pinyin, meanings], ...]]}
    want = {}
    with io.open(os.path.join(ROOT, "build", "everyday_readings.txt"), encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                word, pinyin = line.split(" ", 1)
                want[word] = pinyin

    def everyday(word):
        """[pinyin, meanings] of the word's everyday reading, when it is listed"""
        if word not in want:
            return None
        e = words.get(word)
        for reading in (e[2] if e and len(e) > 2 else []):
            if reading[0] == want[word]:
                return reading
        raise SystemExit("%s: readerwords.js has no reading %s" % (word, want[word]))

    changed = {}

    prefix, rows = load("words.js")       # [simp, trad, toned, gloss, numbered]
    n = 0
    for row in rows:
        best = everyday(row[0])
        if best and best[0] != row[2]:
            changed[row[0]] = (row[2], best[0])
            row[2] = best[0]
            row[3] = first_meanings_first(row[3], best[1])
            row[4] = numbered(best[0])
            n += 1
    save("words.js", prefix, rows)
    print("words.js: %d words given their everyday reading" % n)

    prefix, hsk = load("hsk.js")          # {level: [[word, toned, gloss], ...]}
    n = 0
    for level in hsk.values():
        for row in level:
            best = everyday(row[0])
            if best and best[0] != row[1]:
                row[1] = best[0]
                row[2] = first_meanings_first(row[2], best[1])
                n += 1
    save("hsk.js", prefix, hsk)
    print("hsk.js: %d words" % n)

    n = 0
    for path in sorted(glob.glob(os.path.join(DATA, "c", "*.js"))):
        name = os.path.join("c", os.path.basename(path))
        prefix, chunk = load(name)
        touched = False
        for entry in chunk.values():
            for w in entry.get("w") or []:      # [simp, trad, toned, tier]
                best = everyday(w[0])
                if best and best[0] != w[2]:
                    w[2] = best[0]
                    touched = True
                    n += 1
        if touched:
            save(name, prefix, chunk)
    print("c/*.js: %d example words" % n)

    for w in ("告诉", "东西", "地方"):
        if w in changed:
            print("  %s: %s -> %s" % (w, changed[w][0], changed[w][1]))


if __name__ == "__main__":
    main()
