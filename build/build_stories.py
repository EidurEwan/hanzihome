# -*- coding: utf-8 -*-
"""Build site/data/stories.js from the hand-written sources in build/stories/.

Every word in a story carries the reading and meaning it has *in that story*,
written by hand - never a dictionary's first entry, which is how 说 once came
out as "to persuade" and 家 as "used in 傢伙".

Source format (build/stories/hsk1.txt ... hsk6.txt)
---------------------------------------------------
    === s01
    level: 1
    tag: A cat at home
    zh: 我的小猫
    en: My Little Cat
    text:
    我 家 有 一 只 小 猫 。          <- words separated by spaces; a blank
                                        line starts a new paragraph
    她 还@huan 我 书 。              <- word@sense picks one of two senses
    words:
    只 | zhī | (measure word for animals)
    还@huan | huán | to give back
    chars:
    候@时候 | hou | time; season      <- this character inside this word
    候 | hòu | to wait              <- this character in any word here

build/stories/lexicon.txt holds words whose meaning does not change between
stories (我, 猫, 学校); a story's own `words:` entry always wins. Words whose
sense depends on context (了, 还, 要, 会, 得 ...) are refused in the lexicon.
build/stories/chars.txt holds the same kind of per-character meanings for every
story. Characters with no entry anywhere fall back to the dictionary, and
--report lists those so they can be checked.

Checks: at least MIN_CHARS characters of text, every word glossed, one pinyin
syllable per character, and vocabulary above the story's HSK level listed.

Run:  python build/build_stories.py [--report path]
"""

import io
import json
import os
import re
import sqlite3
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "build", "stories")
DB_PATH = os.path.join(ROOT, "data", "hanzicraft.db")
HSK_PATH = os.path.join(ROOT, "data", "raw", "hsk_complete.json")
OUT = os.path.join(ROOT, "site", "data", "stories.js")

MIN_CHARS = 250
LEVEL_NAMES = {1: "Beginner", 2: "Elementary", 3: "Intermediate",
               4: "Upper Intermediate", 5: "Advanced", 6: "Proficient"}

# never glossed once for all stories: the meaning is decided by the sentence
STORY_ONLY = set("了 着 过 得 地 的 还 要 会 就 才 都 又 对 给 让 把 被 为 跟 打 开 上 下 "
                 "出 起 来 去 到 走 看 想 好 长 只 行 发 觉 教 空 数 种 重 调 便 干 倒 差 "
                 "场 当 应 相 转 背 分 正 点 头 面 家 在 和 没 一下 多 少 张 本 天 里 中 "
                 "而 以 于 之 其 亦 便 却 待 冲 声 满 带 收 管 老 一 那 什么 再 吧 大 叫 小 "
                 "几 前 住 出来 下来 回 过去 放 字 快 楼 离 还是 小心 车 高 用 连 块 班 送 "
                 "口 整 通知 准备 坐 一直 听 完 怎么 刻 可 同 成 活 夜 处 曲 春".split())

is_han = lambda c: "㐀" <= c <= "鿿" or "\U00020000" <= c <= "\U0002ffff"


def strip_tones(s):
    s = unicodedata.normalize("NFD", s.replace("ü", "v"))
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


class SourceError(Exception):
    pass


# --------------------------------------------------------------------------
# parsing
# --------------------------------------------------------------------------

def parse_gloss_line(line, where):
    parts = [p.strip() for p in line.split("|")]
    if len(parts) != 3 or not all(parts):
        raise SourceError("%s: expected 'word | pinyin | meaning': %r" % (where, line))
    return parts


def parse_story_file(path):
    stories, cur, section = [], None, None
    for n, raw in enumerate(io.open(path, encoding="utf-8"), start=1):
        line = raw.rstrip("\n")
        where = "%s:%d" % (os.path.basename(path), n)
        if line.startswith("#"):
            continue
        if line.startswith("=== "):
            cur = {"id": line[4:].strip(), "paras": [[]], "words": {}, "chars": {},
                   "where": where}
            stories.append(cur)
            section = "head"
            continue
        if cur is None:
            if line.strip():
                raise SourceError("%s: text before the first '=== id'" % where)
            continue
        if line.strip() in ("text:", "words:", "chars:"):
            section = line.strip()[:-1]
            continue
        if section == "head":
            if not line.strip():
                continue
            k, _, v = line.partition(":")
            cur[k.strip()] = v.strip()
        elif section == "text":
            if not line.strip():
                if cur["paras"][-1]:
                    cur["paras"].append([])
                continue
            cur["paras"][-1].extend(line.split())
        elif section in ("words", "chars"):
            if not line.strip():
                continue
            key, pin, gloss = parse_gloss_line(line, where)
            if key in cur[section]:
                raise SourceError("%s: '%s' is glossed twice in %s - give the second "
                                  "sense its own key (%s@…)" % (where, key, cur["id"], key))
            cur[section][key] = (pin, gloss)
    for st in stories:
        if not st["paras"][-1]:
            st["paras"].pop()
    return stories


def parse_table(path):
    out = {}
    if not os.path.exists(path):
        return out
    for n, raw in enumerate(io.open(path, encoding="utf-8"), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, pin, gloss = parse_gloss_line(line, "%s:%d" % (os.path.basename(path), n))
        out[key] = (pin, gloss)
    return out


# --------------------------------------------------------------------------
# dictionary fallback for characters nobody glossed
# --------------------------------------------------------------------------

XREF = re.compile(r"^((old|unofficial|archaic|Japanese)\s+)*(variant of|see |used in|"
                  r"abbr\. for|CL:|Taiwan pr\.|surname |also written)", re.I)


def load_cedict_words():
    """Every headword in CC-CEDICT, to catch mistyped words in the sources."""
    words = set()
    path = os.path.join(ROOT, "data", "raw", "cedict.txt")
    for line in io.open(path, encoding="utf-8"):
        if not line.startswith("#"):
            parts = line.split(" ", 2)
            if len(parts) > 2:
                words.add(parts[0])
                words.add(parts[1])
    return words


def load_dictionary():
    db = sqlite3.connect(DB_PATH)
    readings = {}
    for ch, toned, defs in db.execute(
            "SELECT ch, toned, defs FROM readings ORDER BY ch, idx"):
        readings.setdefault(ch, []).append((toned, defs))
    return readings


def dictionary_gloss(readings, ch, syl):
    rs = readings.get(ch) or []
    if not rs:
        return ""
    pick = ([r for r in rs if r[0] == syl]
            or [r for r in rs if strip_tones(r[0]) == strip_tones(syl)] or rs)[0]
    for d in pick[1].split("/"):
        d = d.replace("(bound form) ", "")
        d = re.sub(r"\s*\(?CL:[^)]*\)?", "", d)           # classifier notes
        d = re.sub(r"\S*\|\S*\[[^\]]*\]|\[[^\]]*\]", "", d)  # cross-reference readings
        d = d.strip(" ;,")
        if d and not XREF.match(d):
            while len(d) > 40 and "; " in d:                 # drop whole senses, not letters
                d = d[:d.rindex("; ")]
            return d if len(d) <= 40 else d[:39].rstrip() + "…"
    return ""


# --------------------------------------------------------------------------
# HSK vocabulary: a word counts at the lower of its HSK 2.0 and HSK 3.0 levels
# --------------------------------------------------------------------------

def load_hsk_levels():
    level = {}
    for item in json.load(io.open(HSK_PATH, encoding="utf-8")):
        for tag in item.get("level") or []:
            if tag.startswith("old-") or tag.startswith("new-"):
                w, L = item["simplified"], int(tag.split("-")[1])
                level[w] = min(L, level.get(w, 9))
    return level


def within_level(word, cap, hsk, names):
    """A word passes if it is on the list at or below cap, or splits into
    words that are (小猫 = 小 + 猫). Digits and names always pass."""
    if word in names or all(c in "零一二三四五六七八九十百千万两" for c in word):
        return True
    if hsk.get(word, 9) <= cap:
        return True
    n = len(word)
    ok = [True] + [False] * n
    for i in range(n):
        if ok[i]:
            for j in range(i + 1, n + 1):
                if hsk.get(word[i:j], 9) <= cap:
                    ok[j] = True
    return ok[n] and n > 1


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def build(report_path=None):
    lexicon = parse_table(os.path.join(SRC, "lexicon.txt"))
    shared_chars = parse_table(os.path.join(SRC, "chars.txt"))
    bad = sorted(k for k in lexicon if k.split("@")[0] in STORY_ONLY)
    if bad:
        raise SourceError("lexicon.txt: context-dependent words must be glossed in "
                          "each story instead: %s" % " ".join(bad))

    stories = []
    for name in sorted(os.listdir(SRC)):
        if re.match(r"hsk\d\.txt$", name):
            stories.extend(parse_story_file(os.path.join(SRC, name)))

    readings = load_dictionary()
    cedict_words = load_cedict_words()
    hsk = load_hsk_levels()
    errors, report, out = [], [], []

    for st in stories:
        sid = st["id"]
        for k in ("level", "tag", "zh", "en"):
            if not st.get(k):
                errors.append("%s: missing '%s:'" % (sid, k))
        level = int(st.get("level") or 0)
        names = {k.split("@")[0] for k, v in st["words"].items() if "(name)" in v[1]}

        glossary, seg, vocab, char_senses = {}, [], [], {}
        above, auto, unknown = [], [], []
        han_count = 0
        for para in st["paras"]:
            row = []
            for tok in para:
                word = tok.split("@")[0]
                if not any(is_han(c) for c in word):
                    if row and isinstance(row[-1], dict):
                        row[-1]["s"] += tok      # keep runs of punctuation together
                    else:
                        row.append({"s": tok})
                    continue
                han_count += sum(1 for c in word if is_han(c))
                if tok not in glossary:
                    entry = st["words"].get(tok) or (lexicon.get(tok) if word not in STORY_ONLY else None)
                    if entry is None:
                        errors.append("%s: no meaning for '%s'" % (sid, tok))
                        entry = ("?", "?")
                    pin, gloss = entry
                    sylls = pin.split()
                    hans = [c for c in word if is_han(c)]
                    # erhua: 这儿 is written zhèr, one syllable for two characters
                    if (len(hans) == len(sylls) + 1 and hans[-1] == "儿"
                            and sylls and sylls[-1].endswith("r")):
                        sylls = sylls[:-1] + [sylls[-1][:-1], "r"]
                    if len(sylls) != len(hans):
                        errors.append("%s: '%s' has %d characters but pinyin '%s'"
                                      % (sid, tok, len(hans), pin))
                        sylls = (sylls + [""] * len(hans))[:len(hans)]
                    parts = []
                    for c, syl in zip(hans, sylls):
                        if len(hans) == 1:
                            cp, cg = syl, gloss
                        else:
                            hit = (st["chars"].get("%s@%s" % (c, word))
                                   or shared_chars.get("%s@%s" % (c, word)))
                            if hit is None:
                                cands = [st["chars"].get(c), shared_chars.get("%s %s" % (c, syl)),
                                         shared_chars.get(c)]
                                hit = next((h for h in cands if h and
                                            strip_tones(h[0]) == strip_tones(syl)), None)
                            if hit:
                                cp, cg = syl, hit[1]
                            else:
                                cp, cg = syl, dictionary_gloss(readings, c, syl)
                                auto.append("%s %s (in %s): %s" % (c, syl, word, cg))
                        parts.append([cp, cg])
                        # a character used as a word on its own carries a hand-written
                        # meaning; those win over meanings borrowed from longer words
                        slot = char_senses.setdefault(c, {"alone": [], "inside": []})
                        bucket = slot["alone" if len(hans) == 1 else "inside"]
                        if [cp, cg] not in bucket:
                            bucket.append([cp, cg])
                    glossary[tok] = [word, pin, gloss, parts]
                    if len(hans) > 1 and not any(v[0] == word for v in vocab):
                        vocab.append([word, pin, gloss])
                    if level and not within_level(word, level, hsk, names):
                        above.append(word)
                    if len(hans) > 1 and word not in cedict_words and word not in names:
                        unknown.append(word)
                row.append(tok)
            seg.append(row)

        unused = [k for k in st["words"] if k not in glossary]
        if unused:
            errors.append("%s: glossed but never used: %s" % (sid, " ".join(unused)))
        if han_count < MIN_CHARS:
            errors.append("%s: only %d characters (minimum %d)" % (sid, han_count, MIN_CHARS))

        chars = []
        for c, slot in char_senses.items():
            senses = slot["alone"] or slot["inside"]
            pins = []
            for p, _g in senses:
                if p not in pins:
                    pins.append(p)
            glosses = []
            for _p, g in senses:
                for part in g.split("; "):
                    if part and part not in glosses:
                        glosses.append(part)
            chars.append([c, " / ".join(pins), "; ".join(glosses)])

        out.append({"id": sid, "l": level, "tag": st.get("tag", ""), "zh": st.get("zh", ""),
                    "en": st.get("en", ""), "n": han_count,
                    "g": glossary, "seg": seg, "v": vocab, "c": chars})
        report.append("== %s  HSK %s  %s  %d chars, %d words, %d characters"
                      % (sid, level, st.get("zh"), han_count, len(glossary), len(chars)))
        if unknown:
            report.append("   not in CC-CEDICT (check spelling): %s" % " ".join(unknown))
        if above:
            report.append("   above HSK %d: %s" % (level, " ".join(sorted(set(above)))))
        for a in auto:
            report.append("   dictionary: " + a)

    if report_path:
        io.open(report_path, "w", encoding="utf-8").write("\n".join(report) + "\n")
    if errors:
        raise SourceError("\n".join(errors))

    body = "HZ.stories=%s;\nHZ.levelNames=%s;\n" % (
        json.dumps(out, ensure_ascii=False, separators=(",", ":")),
        json.dumps({str(k): v for k, v in LEVEL_NAMES.items()}, ensure_ascii=False,
                   separators=(",", ":")))
    io.open(OUT, "w", encoding="utf-8").write(body)
    return out, report


if __name__ == "__main__":
    rp = sys.argv[sys.argv.index("--report") + 1] if "--report" in sys.argv else None
    try:
        stories, report = build(rp)
    except SourceError as e:
        sys.exit("Story sources have problems:\n" + str(e))
    print("\n".join(line for line in report if not line.startswith("   dictionary")))
    print("\nWrote %s: %d stories, %.0f KB" % (
        os.path.relpath(OUT, ROOT), len(stories), os.path.getsize(OUT) / 1024))
