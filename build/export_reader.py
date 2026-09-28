# -*- coding: utf-8 -*-
"""Write the data site/textstory.js needs to gloss any text.

site/data/readings.js - every character's readings, from the site's own data
----------------------------------------------------------------------------
Every reading of every character, most-used first, with short meanings: the
same `rd` lists the character pages use, without the other 95% of each page.
About 1 MB instead of the 20 MB of site/data/c/. Derived from site/data/c/*.js,
so it needs no database. It also carries the hand-written meanings from
build/stories/: lexicon.txt (common words whose meaning never changes: 妈妈
"mum", 累 "tired") and chars.txt (what a character means inside a word:
面@面包 "flour"), which the reader prefers to CC-CEDICT's wording.

    HZ.readings  = {char: [[pinyin, [meaning, ...]], ...]}   readings in order of use
    HZ.t2s       = {traditional: simplified}                 only where they differ
    HZ.lexicon   = {word: [pinyin, meaning]}                 from lexicon.txt
    HZ.charGloss = {key: [pinyin, meaning]}                  from chars.txt; key is
                   "面@面包" (in that word), "字 zì" (with that reading) or "字"

site/data/readerwords.js - words, from data/raw/cedict.txt + jieba_dict.txt
---------------------------------------------------------------------------
words.js keeps one reading per word, and often the rarer one: 告诉 gào sù "to
press charges", 东西 dōng xī "east and west". Here a word keeps all its
CC-CEDICT readings, everyday ones first, with jieba's frequency (which also
covers a character used as a word on its own) and part-of-speech tag.

    HZ.rwords      = {word: [frequency, tag, [[pinyin, meanings], ...]]}
                     single characters carry [frequency, tag] only
    HZ.rwordsT2S   = {traditional word: simplified word}   only where they differ
    HZ.rwordsTotal = the sum of every jieba frequency, to turn counts into odds

A word's readings are ordered: ordinary before proper nouns (dà xué before
Dà xué "the Great Learning"), then a reading with a neutral tone before its
fully-toned twin, since that is the everyday word (告诉 gào su "to tell",
东西 dōng xi "thing", 地方 dì fang "place"), then CC-CEDICT's own order.

Skipped with a message when data/raw/ lacks the two files.

    python build/export_static.py && python build/export_reader.py
"""

import glob
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import CEDICT_RE, pinyin_toned  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHUNKS = os.path.join(ROOT, "site", "data", "c")
STORIES = os.path.join(ROOT, "build", "stories")
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "site", "data", "readings.js")
OUT_WORDS = os.path.join(ROOT, "site", "data", "readerwords.js")

MAX_MEANINGS = 8
MAX_LEN = 60

# Meanings that only point somewhere else. The same test build_stories.py uses.
XREF = re.compile(r"^((old|unofficial|archaic|Japanese)\s+)*(variant of|see |used in|"
                  r"abbr\. for|CL:|Taiwan pr\.|surname |also written)", re.I)


def clean(meaning):
    m = meaning.replace("(bound form) ", "")
    m = re.sub(r"\s*\(?CL:[^)]*\)?", "", m)            # classifier notes
    m = re.sub(r"\S*\|\S*\[[^\]]*\]|\[[^\]]*\]", "", m)   # cross-reference readings
    m = re.sub(r"\s{2,}", " ", m).strip(" ;,")
    if not m or XREF.match(m):
        return ""
    return m if len(m) <= MAX_LEN else m[:MAX_LEN - 1].rstrip() + "…"


def js(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def load_table(name):
    """word | pinyin | meaning lines, read the way build_stories.py reads them"""
    out = {}
    for line in io.open(os.path.join(STORIES, name), encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) == 3 and all(parts):
            out[parts[0]] = [parts[1], parts[2]]
    return out


def load_chunk(path):
    text = io.open(path, encoding="utf-8").read()
    return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))


def export_readings():
    readings, t2s = {}, {}
    for path in sorted(glob.glob(os.path.join(CHUNKS, "*.js"))):
        for ch, e in load_chunk(path).items():
            rows = []
            for _num, toned, meanings in e.get("rd") or []:
                kept = []
                for m in meanings:
                    m = clean(m)
                    if m and m not in kept:
                        kept.append(m)
                rows.append([toned, kept[:MAX_MEANINGS]])
            readings[ch] = rows
            simp = e.get("s")
            if simp and simp != ch and len(simp) == 1:
                t2s[ch] = simp

    lexicon, char_gloss = load_table("lexicon.txt"), load_table("chars.txt")
    body = "HZ.readings=%s;\nHZ.t2s=%s;\nHZ.lexicon=%s;\nHZ.charGloss=%s;\n" % (
        js(readings), js(t2s), js(lexicon), js(char_gloss))
    io.open(OUT, "w", encoding="utf-8").write(body)
    print("Wrote %s: %d characters, %d traditional forms, %d lexicon words, %d character "
          "meanings, %.0f KB" % (os.path.relpath(OUT, ROOT), len(readings), len(t2s),
                                 len(lexicon), len(char_gloss), os.path.getsize(OUT) / 1024))


is_han = lambda c: "㐀" <= c <= "鿿" or "\U00020000" <= c <= "\U0002ffff"


def export_words():
    cedict, jieba = os.path.join(RAW, "cedict.txt"), os.path.join(RAW, "jieba_dict.txt")
    if not (os.path.exists(cedict) and os.path.exists(jieba)):
        print("Skipped %s: data/raw/ needs cedict.txt and jieba_dict.txt"
              % os.path.relpath(OUT_WORDS, ROOT))
        return

    freq, tag, total = {}, {}, 0
    for line in io.open(jieba, encoding="utf-8"):
        p = line.split()
        if len(p) >= 2 and p[1].isdigit():
            freq[p[0]] = int(p[1])
            total += int(p[1])
            if len(p) >= 3:
                tag[p[0]] = p[2]

    # word -> {numbered pinyin: [meaning, ...]}, in CC-CEDICT's order
    entries, t2s = {}, {}
    for line in io.open(cedict, encoding="utf-8"):
        if line.startswith("#"):
            continue
        m = CEDICT_RE.match(line.rstrip("\n"))
        if not m:
            continue
        trad, simp, pin, defs = m.groups()
        if len(simp) < 2 or not all(is_han(c) for c in simp):
            continue
        # a word nobody uses is only noise for splitting text; keep it when it is short
        if freq.get(simp, 0) == 0 and len(simp) > 3:
            continue
        readings = entries.setdefault(simp, {})
        kept = readings.setdefault(pin, [])
        for d in defs.split("/"):
            d = clean(d)
            if d and d not in kept:
                kept.append(d)
        if trad != simp:
            t2s.setdefault(trad, simp)

    def order(item):
        pin, _defs = item
        proper = pin[:1].isupper()
        sylls = pin.split()
        # 告诉 gao4 su5 before gao4 su4: same letters, one syllable in the neutral tone
        neutral_twin = any(s.endswith("5") for s in sylls)
        return (proper, not neutral_twin)

    words = {}
    for w, readings in entries.items():
        rows = []
        for pin, defs in sorted(readings.items(), key=order):   # sorted() is stable
            if defs:
                rows.append([pinyin_toned(pin), "; ".join(defs[:MAX_MEANINGS])])
        if rows:
            words[w] = [freq.get(w, 0), tag.get(w, ""), rows]
    for w, f in freq.items():
        if len(w) == 1 and is_han(w):
            words[w] = [f, tag.get(w, "")]

    body = "HZ.rwords=%s;\nHZ.rwordsT2S=%s;\nHZ.rwordsTotal=%d;\n" % (js(words), js(t2s), total)
    io.open(OUT_WORDS, "w", encoding="utf-8").write(body)
    print("Wrote %s: %d words, %d single characters, %d traditional forms, %.0f KB" % (
        os.path.relpath(OUT_WORDS, ROOT), sum(1 for w in words if len(w) > 1),
        sum(1 for w in words if len(w) == 1), len(t2s), os.path.getsize(OUT_WORDS) / 1024))


if __name__ == "__main__":
    export_readings()
    export_words()
