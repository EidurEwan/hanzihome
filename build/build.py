# -*- coding: utf-8 -*-
"""Build hanzicraft.db from the raw open-data sources in data/raw.

Sources
  cjk-decomp.txt        character decomposition          (Gavin Grover, public domain)
  cedict.txt            CC-CEDICT dictionary             (CC BY-SA 4.0)
  junda_char_freq.txt   Jun Da character frequency list  (GB18030 encoded)
  jieba_dict.txt        word frequency counts            (MIT)
  hsk_complete.json     HSK 2.0 + 3.0 vocabulary lists
  mmah_dictionary.txt   stroke counts, radicals, customary readings (Make Me a Hanzi)

Run:  python build/build.py
"""

import io
import json
import os
import re
import sqlite3
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from radicaldata import RADICAL_MAP, RADICALS  # noqa: E402
from readingorder import WordEvidence, order_readings  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
DB_PATH = os.path.join(ROOT, "data", "hanzicraft.db")


def log(*a):
    print(*a, flush=True)


# --------------------------------------------------------------------------
# pinyin: CC-CEDICT numbered syllables -> tone marks
# --------------------------------------------------------------------------

_TONES = {
    "a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò",
    "u": "ūúǔù", "ü": "ǖǘǚǜ", "n": "ńňǹ", "m": "ḿ",
}
_INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g",
             "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w"]
_SYL_RE = re.compile(r"^([a-zA-ZüÜ]+)([1-5])?$")


def syllable_toned(syl):
    """'hao3' -> 'hǎo';  'nu:3' -> 'nǚ';  'Jiang1' -> 'Jiāng'."""
    syl = syl.replace("u:", "ü").replace("U:", "Ü").replace("v", "ü")
    m = _SYL_RE.match(syl)
    if not m:
        return syl
    body, tone = m.group(1), m.group(2)
    if not tone or tone == "5":
        return body
    t = int(tone) - 1
    low = body.lower()
    # standard placement: a > o > e, else the last vowel of the cluster
    target = None
    for v in ("a", "o", "e"):
        if v in low:
            target = low.index(v)
            break
    if target is None:
        for i in range(len(low) - 1, -1, -1):
            if low[i] in "iuü":
                target = i
                break
    if target is None:
        for i in range(len(low) - 1, -1, -1):
            if low[i] in _TONES:
                target = i
                break
    if target is None:
        return body
    ch = low[target]
    marks = _TONES.get(ch)
    if not marks or t >= len(marks):
        return body
    rep = marks[t]
    if body[target].isupper():
        rep = rep.upper()
    return body[:target] + rep + body[target + 1:]


def pinyin_toned(p):
    """Convert a whole CC-CEDICT reading, e.g. 'ni3 hao3' -> 'nǐ hǎo'."""
    return " ".join(syllable_toned(s) for s in p.split())


def split_syllable(syl):
    """'hao3' -> ('h', 'ao', 3). Tone 0 means neutral/unknown."""
    syl = syl.replace("u:", "v").replace("U:", "v").lower()
    m = _SYL_RE.match(syl)
    if not m:
        return None
    body, tone = m.group(1), m.group(2)
    tone = int(tone) if tone else 0
    for ini in _INITIALS:
        if body.startswith(ini):
            return (ini, body[len(ini):], tone)
    return ("", body, tone)


# --------------------------------------------------------------------------
# decomposition
# --------------------------------------------------------------------------

STROKES = set(chr(c) for c in range(0x31C0, 0x31E4))
_LINE_RE = re.compile(r"^([^:]+):([a-z0-9/]*)\(([^)]*)\)$")


def glyph_priority(c):
    """Lower is a better form to show the reader.

    cjk-decomp records equivalent shapes with `me` entries but in either
    direction (一:me(㇐) yet ⻈:me(讠)), so pick the more familiar glyph:
    an everyday CJK ideograph beats a radical-block or stroke-block form,
    which in turn beat the rare extension planes.
    """
    if len(c) != 1:
        return 9
    cp = ord(c)
    if 0x4E00 <= cp <= 0x9FFF:      # CJK Unified Ideographs
        return 0
    if 0x3400 <= cp <= 0x4DBF:      # Extension A
        return 2
    if 0x2E80 <= cp <= 0x2FDF:      # Radicals / Kangxi Radicals
        return 3
    if 0x31C0 <= cp <= 0x31EF:      # CJK Strokes
        return 4
    return 5                        # Extension B and beyond


class Decomposer(object):
    def __init__(self, path):
        self.d = {}          # char -> (base_type, [args])
        self.equiv = {}      # bound/stroke form -> the familiar glyph for it
        pairs = []
        with io.open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                m = _LINE_RE.match(line)
                if not m:
                    continue
                ch, typ, args = m.group(1), m.group(2), m.group(3)
                args = [a for a in args.split(",") if a]
                base = typ.split("/")[0]
                self.d[ch] = (base, args)
                # `me` links two shapes that are the same thing drawn differently
                if base == "me" and len(args) == 1:
                    pairs.append((ch, args[0]))
        for a, b in pairs:
            keep, drop = sorted((a, b), key=glyph_priority)
            if glyph_priority(keep) < glyph_priority(drop):
                self.equiv.setdefault(drop, keep)
        # collapse any chains so norm() is idempotent
        for k in list(self.equiv):
            seen = {k}
            v = self.equiv[k]
            while v in self.equiv and v not in seen:
                seen.add(v)
                v = self.equiv[v]
            self.equiv[k] = v
        self._graph_cache = {}
        self._tree_cache = {}

    # -- helpers ----------------------------------------------------------
    def norm(self, c):
        return self.equiv.get(c, c)

    def entry(self, c):
        return self.d.get(c)

    @staticmethod
    def repeat_count(base):
        m = re.match(r"^r(\d)", base)
        if m:
            return int(m.group(1))
        if base in ("refh", "refv", "rot"):
            return 1          # a reflection/rotation of one shape
        return 2              # ra, rd, rrefl, rrefr, rrotu, rst, ...

    def is_leaf(self, c):
        """True when a component should not be broken down any further."""
        e = self.entry(c)
        if not e:
            return True
        base, args = e
        if not args:
            return True                       # c() -- an atomic stroke
        if base.startswith("m") and len(args) == 1:
            return True                       # a modified form of another shape
        return False

    def is_pseudo(self, c):
        """Numeric ids stand for shapes that have no Unicode codepoint."""
        return c.isdigit()

    # -- graphical: expand all the way down to strokes --------------------
    def graphical(self, c, _depth=0):
        c = self.norm(c)
        if c in self._graph_cache:
            return list(self._graph_cache[c])
        if _depth > 24:
            return [c]
        if self.is_leaf(c):
            return [c]
        base, args = self.entry(c)
        if base.startswith("r") and len(args) == 1:
            out = self.graphical(args[0], _depth + 1) * self.repeat_count(base)
        else:
            out = []
            for a in args:
                out.extend(self.graphical(a, _depth + 1))
        if _depth == 0:
            self._graph_cache[c] = list(out)
        return out

    @property
    def stroke_like(self):
        """Strokes, plus the everyday glyphs that stand in for them (一 丨 丿 丶 …)."""
        if not hasattr(self, "_stroke_like"):
            s = set(STROKES)
            for k in STROKES:
                s.add(self.norm(k))
            self._stroke_like = s
        return self._stroke_like

    def has_stroke_part(self, c):
        """True when a direct child is a bare stroke.

        Such a shape is already at the bottom of what is worth naming: 勺 is
        勹 + 丶 and 白 is 丿 + 日, but both read as single components, which is
        where HanziCraft stops too.
        """
        e = self.entry(c)
        if not e or not e[1]:
            return False
        return any(self.norm(a) in self.stroke_like for a in e[1])

    # -- breakdown: stop at radicals / stroke-level shapes -----------------
    def tree(self, c, _depth=0):
        """Nested [component, [children...]] down to radical level."""
        c = self.norm(c)
        if _depth > 12 or self.is_leaf(c):
            return [c, []]
        if _depth > 0 and (c in RADICAL_MAP or self.has_stroke_part(c)):
            return [c, []]
        base, args = self.entry(c)
        if base.startswith("r") and len(args) == 1:
            kids = [self.tree(args[0], _depth + 1)] * self.repeat_count(base)
        else:
            kids = [self.tree(a, _depth + 1) for a in args]
        return [c, kids]

    def leaves(self, node):
        c, kids = node
        if not kids:
            return [c]
        out = []
        for k in kids:
            out.extend(self.leaves(k))
        return out

    def nodes(self, node, _top=True):
        """Every component in the breakdown tree, excluding the character."""
        c, kids = node
        out = [] if _top else [c]
        for k in kids:
            out.extend(self.nodes(k, False))
        return out


def clean(seq, dec):
    """Drop pseudo-components that have no printable glyph."""
    return [x for x in seq if not dec.is_pseudo(x)]


def clean_tree(node, dec):
    c, kids = node
    kids = [clean_tree(k, dec) for k in kids if not dec.is_pseudo(k[0])]
    return [c, kids]


# --------------------------------------------------------------------------
# source parsers
# --------------------------------------------------------------------------

CEDICT_RE = re.compile(r"^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+/(.*)/\s*$")


def load_cedict():
    entries = []
    with io.open(os.path.join(RAW, "cedict.txt"), encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("#") or not line.strip():
                continue
            m = CEDICT_RE.match(line.rstrip("\n"))
            if not m:
                continue
            trad, simp, pin, defs = m.groups()
            entries.append((trad, simp, pin, defs))
    log("  cedict entries: %d" % len(entries))
    return entries


def load_junda():
    rows = []
    path = os.path.join(RAW, "junda_char_freq.txt")
    with io.open(path, encoding="gb18030", errors="replace") as fh:
        for line in fh:
            if line.startswith("/*") or not line.strip():
                continue
            p = line.rstrip("\n").split("\t")
            if len(p) < 5:
                continue
            try:
                rows.append((int(p[0]), p[1], int(p[2]), float(p[3]), p[4]))
            except ValueError:
                continue
    log("  junda rows: %d" % len(rows))
    return rows


def load_jieba():
    """-> ({word: frequency}, {word: part-of-speech tag})"""
    freq, pos = {}, {}
    with io.open(os.path.join(RAW, "jieba_dict.txt"), encoding="utf-8") as fh:
        for line in fh:
            p = line.split()
            if len(p) >= 2:
                try:
                    freq[p[0]] = int(p[1])
                except ValueError:
                    continue
                if len(p) >= 3:
                    pos[p[0]] = p[2]
    log("  jieba words: %d" % len(freq))
    return freq, pos


def load_mmah():
    """-> {char: (stroke_count, kangxi_radical, [toned readings])} from Make Me a Hanzi."""
    out = {}
    path = os.path.join(RAW, "mmah_dictionary.txt")
    with io.open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            ch = d.get("character")
            if ch:
                # one entry in `matches` per stroke
                out[ch] = (len(d.get("matches") or []) or None, d.get("radical"),
                           d.get("pinyin") or [])
    log("  stroke data: %d" % len(out))
    return out


def load_hsk():
    """-> {simplified word: [levels]} covering HSK 2.0 and 3.0."""
    path = os.path.join(RAW, "hsk_complete.json")
    out = defaultdict(set)
    with io.open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    for item in data:
        w = item.get("simplified")
        if not w:
            continue
        lv = item.get("level")
        levels = lv if isinstance(lv, list) else [lv]
        for L in levels:
            if not L:
                continue
            m = re.search(r"(\d)", str(L))
            if m and ("new" not in str(L).lower()):
                out[w].add(int(m.group(1)))
    log("  hsk words: %d" % len(out))
    return {k: sorted(v) for k, v in out.items()}


# --------------------------------------------------------------------------
# main build
# --------------------------------------------------------------------------

def main():
    log("Loading sources...")
    dec = Decomposer(os.path.join(RAW, "cjk-decomp.txt"))
    log("  decomposition entries: %d (equiv %d)" % (len(dec.d), len(dec.equiv)))
    cedict = load_cedict()
    junda = load_junda()
    jieba, jieba_pos = load_jieba()
    hsk = load_hsk()
    mmah = load_mmah()

    # ---- character readings from CC-CEDICT ------------------------------
    char_entries = defaultdict(list)  # char -> single-character CC-CEDICT lines
    simp_of = {}                      # trad -> simp
    trad_of = {}                      # simp -> trad
    words = []                        # multi-character entries
    for trad, simp, pin, defs in cedict:
        if len(simp) == 1 and len(trad) == 1:
            for ch in {simp, trad}:
                char_entries[ch].append((trad, simp, pin, defs))
            simp_of[trad] = simp
            trad_of.setdefault(simp, trad)
        elif len(simp) > 1:
            words.append((trad, simp, pin, defs))
        if len(simp) == len(trad):
            for a, b in zip(trad, simp):
                simp_of.setdefault(a, b)
                trad_of.setdefault(b, a)

    # one entry per pronunciation, most-used pronunciation and sense first
    log("Ordering readings by usage...")
    evidence = WordEvidence(cedict, jieba)
    readings = {}                     # char -> [(pinyin_num, toned, defs)]
    for ch, entries in char_entries.items():
        readings[ch] = order_readings(
            ch, entries, evidence, jieba, jieba_pos,
            (mmah.get(ch) or (None, None, []))[2], pinyin_toned)
    log("  %d characters, %d pronunciations (from %d entries)" % (
        len(readings), sum(len(v) for v in readings.values()),
        sum(len(v) for v in char_entries.values())))

    # ---- the working character set --------------------------------------
    rank, count, cumpct = {}, {}, {}
    for r, ch, cnt, cum, _pin in junda:
        rank[ch] = r
        count[ch] = cnt
        cumpct[ch] = cum
    total_count = float(sum(count.values()))
    charset = set(rank) | set(readings)
    charset = set(c for c in charset if len(c) == 1 and ord(c) > 0x2E00)
    log("Characters in working set: %d (ranked %d)" % (len(charset), len(rank)))

    # ---- decomposition per character ------------------------------------
    log("Decomposing...")
    breakdown, components, graphical, comp_edges = {}, {}, {}, []
    contains = defaultdict(set)       # component -> set of characters
    for ch in charset:
        tree = clean_tree(dec.tree(ch), dec)
        breakdown[ch] = tree
        comps = clean(dec.leaves(tree), dec)
        components[ch] = [c for c in comps if c != ch]
        graphical[ch] = clean(dec.graphical(ch), dec)
        for node in set(clean(dec.nodes(tree), dec)):
            if node != ch:
                contains[node].add(ch)
                comp_edges.append((ch, node))
    log("  distinct components: %d" % len(contains))

    # ---- words ----------------------------------------------------------
    log("Selecting words...")
    # CC-CEDICT lists one entry per sense, so fold them into a single word
    by_simp = {}
    for trad, simp, pin, defs in words:
        f = jieba.get(simp, 0)
        if f == 0:
            continue                  # keep only corpus-attested words
        cur = by_simp.get(simp)
        if cur is None:
            by_simp[simp] = [simp, trad, pin, pinyin_toned(pin), defs, f]
            continue
        if defs not in cur[4]:
            cur[4] += "/" + defs
        # CC-CEDICT capitalises proper nouns; prefer the everyday reading
        if cur[2][:1].isupper() and not pin[:1].isupper():
            cur[2], cur[3] = pin, pinyin_toned(pin)
    word_rows = list(by_simp.values())
    word_rows.sort(key=lambda r: -r[5])
    # tier by corpus rank within the attested set: common / uncommon / rare
    for i, row in enumerate(word_rows):
        row.append(0 if i < 2500 else (1 if i < 15000 else 2))
    log("  words kept: %d" % len(word_rows))

    # ---- phonetic relations ---------------------------------------------
    # 1 exact, 2 same syllable different tone, 3 rhyme, 4 alliteration
    log("Computing phonetic sets...")

    def sylls(ch):
        out = []
        for pin, _t, _d in readings.get(ch, []):
            if " " in pin:
                continue
            s = split_syllable(pin)
            if s:
                out.append(s)
        return out

    def relation(a, b):
        """Best relation between character reading a and component reading b."""
        best = 0
        for ia, fa, ta in a:
            for ib, fb, tb in b:
                if ia == ib and fa == fb:
                    r = 1 if (ta == tb and ta) else 2
                elif fa == fb and fa:
                    r = 3
                elif ia == ib and ia:
                    r = 4
                else:
                    continue
                if best == 0 or r < best:
                    best = r
        return best

    phon_rows = []
    for comp, chars in contains.items():
        cs = sylls(comp)
        if not cs:
            continue
        for ch in chars:
            rel = relation(sylls(ch), cs)
            if rel and rel <= 3:
                phon_rows.append((comp, ch, rel))
    log("  phonetic relations: %d" % len(phon_rows))

    # ---- productive components ------------------------------------------
    # score = sum of 1/frequency_rank over the characters containing it
    log("Scoring components...")
    comp_rows = []
    for comp, chars in contains.items():
        ranked = [c for c in chars if c in rank]
        if len(chars) < 2:
            continue
        score = sum(1.0 / rank[c] for c in ranked)
        radnum, gloss = RADICAL_MAP.get(comp, (0, ""))
        comp_rows.append([comp, gloss, radnum, len(chars), len(ranked), score])
    comp_rows.sort(key=lambda r: -r[5])

    # ---- write the database ---------------------------------------------
    log("Writing %s" % DB_PATH)
    if os.path.exists(DB_PATH):
        try:
            os.remove(DB_PATH)
        except OSError:
            sys.exit("Cannot replace data/hanzicraft.db - stop server.py first, "
                     "then run this again.")
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
    PRAGMA journal_mode=OFF;
    CREATE TABLE chars(
        ch TEXT PRIMARY KEY, rank INTEGER, cnt INTEGER, pct REAL, cumpct REAL,
        trad TEXT, simp TEXT, strokes INTEGER, radical TEXT, radnum INTEGER,
        kradical TEXT,
        n_words INTEGER, n_contains INTEGER, word_score REAL,
        breakdown TEXT, components TEXT, graphical TEXT);
    CREATE TABLE readings(ch TEXT, idx INTEGER, pinyin TEXT, toned TEXT, defs TEXT);
    CREATE TABLE words(id INTEGER PRIMARY KEY, simp TEXT, trad TEXT,
        pinyin TEXT, toned TEXT, defs TEXT, freq INTEGER, tier INTEGER);
    CREATE TABLE word_chars(ch TEXT, wid INTEGER, tier INTEGER, freq INTEGER);
    CREATE TABLE comp(ch TEXT, comp TEXT);
    CREATE TABLE phonetic(comp TEXT, ch TEXT, rel INTEGER);
    CREATE TABLE components(comp TEXT PRIMARY KEY, gloss TEXT, radnum INTEGER,
        n_chars INTEGER, n_ranked INTEGER, score REAL, prank INTEGER);
    CREATE TABLE hsk(word TEXT, level INTEGER);
    CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);
    """)

    # characters
    rows = []
    for ch in charset:
        r = rank.get(ch)
        cnt = count.get(ch, 0)
        pct = (cnt / total_count * 100.0) if cnt else 0.0
        radnum, gloss = RADICAL_MAP.get(ch, (0, ""))
        rows.append((
            ch, r, cnt, pct, cumpct.get(ch),
            trad_of.get(ch, ch), simp_of.get(ch, ch),
            mmah.get(ch, (None, None, None))[0], gloss, radnum,
            mmah.get(ch, (None, None, None))[1],
            0, len(contains.get(ch, ())), 0,
            json.dumps(breakdown[ch], ensure_ascii=False),
            json.dumps(components[ch], ensure_ascii=False),
            json.dumps(graphical[ch], ensure_ascii=False),
        ))
    db.executemany("INSERT INTO chars VALUES(%s)" % ",".join("?" * 17), rows)

    db.executemany("INSERT INTO readings VALUES(?,?,?,?,?)", [
        (ch, i, p, t, d)
        for ch in charset
        for i, (p, t, d) in enumerate(readings.get(ch, []))
    ])

    db.executemany(
        "INSERT INTO words(simp,trad,pinyin,toned,defs,freq,tier) VALUES(?,?,?,?,?,?,?)",
        [tuple(r) for r in word_rows])

    wc = []
    for wid, row in enumerate(word_rows, start=1):
        simp, trad = row[0], row[1]
        for ch in set(simp) | set(trad):
            if ch in charset:
                wc.append((ch, wid, row[6], row[5]))
    db.executemany("INSERT INTO word_chars VALUES(?,?,?,?)", wc)

    db.executemany("INSERT INTO comp VALUES(?,?)", comp_edges)
    db.executemany("INSERT INTO phonetic VALUES(?,?,?)", phon_rows)
    db.executemany(
        "INSERT INTO components VALUES(?,?,?,?,?,?,?)",
        [tuple(r) + (i + 1,) for i, r in enumerate(comp_rows)])
    db.executemany("INSERT INTO hsk VALUES(?,?)",
                   [(w, L) for w, ls in hsk.items() for L in ls])

    log("Indexing...")
    db.executescript("""
    UPDATE chars SET n_words = (
        SELECT COUNT(*) FROM word_chars WHERE word_chars.ch = chars.ch);
    UPDATE chars SET word_score = COALESCE((
        SELECT SUM(1.0/wid) FROM word_chars WHERE word_chars.ch = chars.ch), 0);
    CREATE INDEX i_rank ON chars(rank);
    CREATE INDEX i_read ON readings(ch);
    CREATE INDEX i_wc   ON word_chars(ch, tier, freq DESC);
    CREATE INDEX i_wid  ON words(id);
    CREATE INDEX i_wsimp ON words(simp);
    CREATE INDEX i_comp ON comp(comp);
    CREATE INDEX i_comp2 ON comp(ch);
    CREATE INDEX i_phon ON phonetic(comp, rel);
    CREATE INDEX i_phon2 ON phonetic(ch);
    CREATE INDEX i_hsk ON hsk(level);
    CREATE INDEX i_hskw ON hsk(word);
    CREATE INDEX i_prank ON components(prank);
    """)
    db.executemany("INSERT INTO meta VALUES(?,?)", [
        ("total_count", str(int(total_count))),
        ("n_chars", str(len(charset))),
        ("n_ranked", str(len(rank))),
        ("n_words", str(len(word_rows))),
    ])
    db.commit()

    # ---- sanity report --------------------------------------------------
    log("\nSanity check")
    for ch in "好请河江":
        row = db.execute(
            "SELECT rank, n_words, n_contains, components, graphical "
            "FROM chars WHERE ch=?", (ch,)).fetchone()
        tiers = db.execute(
            "SELECT tier, COUNT(*) FROM word_chars WHERE ch=? GROUP BY tier",
            (ch,)).fetchall()
        log("  %s rank=%s words=%s contains=%s tiers=%s" %
            (ch, row[0], row[1], row[2], dict(tiers)))
        log("     components: %s" % " ".join(json.loads(row[3])))
        log("     graphical : %s" % " ".join(json.loads(row[4])))
    db.close()
    log("\nDone -> %s (%.1f MB)" % (DB_PATH, os.path.getsize(DB_PATH) / 1e6))


if __name__ == "__main__":
    main()
