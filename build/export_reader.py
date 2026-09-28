# -*- coding: utf-8 -*-
"""Write site/data/readings.js: what site/textstory.js needs about every character.

The reader turns any text into words with a reading and a meaning. For that it
needs every reading of every character, most-used first, with short meanings -
the same `rd` lists the character pages use, but without the other 95% of
each character's page (breakdown, phonetic sets, example words). That is
about 1 MB instead of the 20 MB of site/data/c/.

It is derived from site/data/c/*.js rather than from the database, so it
runs after export_static.py and needs nothing else:

    python build/export_static.py && python build/export_reader.py

It also carries the hand-written meanings from build/stories/: lexicon.txt
(common words whose meaning never changes: 妈妈 "mum", 累 "tired") and
chars.txt (what a character means inside a word: 面@面包 "flour"). They are
written for learners, so the reader prefers them to CC-CEDICT's wording.

Output:
    HZ.readings  = {char: [[pinyin, [meaning, ...]], ...]}   readings in order of use
    HZ.t2s       = {traditional: simplified}                 only where they differ
    HZ.lexicon   = {word: [pinyin, meaning]}                 from lexicon.txt
    HZ.charGloss = {key: [pinyin, meaning]}                  from chars.txt; key is
                   "面@面包" (in that word), "字 zì" (with that reading) or "字"
"""

import glob
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHUNKS = os.path.join(ROOT, "site", "data", "c")
STORIES = os.path.join(ROOT, "build", "stories")
OUT = os.path.join(ROOT, "site", "data", "readings.js")

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


def main():
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
    js = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    body = "HZ.readings=%s;\nHZ.t2s=%s;\nHZ.lexicon=%s;\nHZ.charGloss=%s;\n" % (
        js(readings), js(t2s), js(lexicon), js(char_gloss))
    io.open(OUT, "w", encoding="utf-8").write(body)
    print("Wrote %s: %d characters, %d traditional forms, %d lexicon words, %d character "
          "meanings, %.0f KB" % (os.path.relpath(OUT, ROOT), len(readings), len(t2s),
                                 len(lexicon), len(char_gloss), os.path.getsize(OUT) / 1024))


if __name__ == "__main__":
    main()
