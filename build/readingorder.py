# -*- coding: utf-8 -*-
"""Order a character's pronunciations and meanings most-common first.

CC-CEDICT keeps one line per (traditional form, reading) and files them in
roughly alphabetical order, so a character page used to open with whichever
reading sorts first (行 háng before xíng, 和 "old variant of 和" before "and")
and could list the same pronunciation three times.

Pronunciations
    Each reading is scored by how much running text uses it:
      * every corpus-attested word containing the character contributes its
        jieba frequency to the syllable the character takes in that word
        (split evenly when a word has more than one pronunciation; names
        like 柏林 count at PROPER_WEIGHT), and
      * the character's own frequency as a standalone word goes to the
        reading it most likely has on its own: the neutral-tone reading when
        jieba tags it as a particle (的 de, 了 le, 着 zhe, 得 de), otherwise the
        customary reading Make Me a Hanzi lists first - unless words show
        that reading is barely used, in which case the most-used one.
        A character jieba tags as a surname (沈, 冯) gives it to the name.
    Readings found only in proper-noun entries are weighed down, and a
    reading that is nothing but "variant of X" (沈 chén) always sorts last.

Meanings
    Entries sharing a pronunciation are merged. Senses are then ordered:
      0  ordinary senses, from the entry whose traditional form is used most
      1  register-tagged senses: (literary), (archaic), (dialect) ...
      2  surnames and place names
      3  cross-references: "variant of", "see", "used in", "CL:" notes
    and a cross-reference that points back at the character itself
    ("variant of 著|着" on the 着 page) is dropped.
"""

import re
from collections import defaultdict

REGISTER = re.compile(
    r"^\((literary|classical|archaic|old|obsolete|dialect|Cantonese|Taiwan|"
    r"Buddhism|Classical Chinese|old usage|arch\.)\b", re.I)
NAME = re.compile(r"^(surname |used in (place|personal) names|place name)", re.I)
XREF = re.compile(
    r"^((old|ancient|unofficial|archaic|Japanese|erroneous|non-standard|"
    r"standard|same as|also written)\s+)*(variant|form) of\b"
    r"|^(see|see also|also written|same as|used in|abbr\. for|CL:|Taiwan pr\.)",
    re.I)
VARIANT = re.compile(
    r"^((old|ancient|unofficial|archaic|Japanese|erroneous|non-standard)\s+)*"
    r"variant of\b", re.I)
SELF_REF = re.compile(
    r"^((old|ancient|unofficial|archaic|Japanese|erroneous|non-standard)\s+)*"
    r"(variant of|also written|same as)\s+(\S+?)\[", re.I)


PROPER_WEIGHT = 0.3     # proper-noun words count for less than ordinary ones
CUSTOMARY_FLOOR = 0.05  # below this share of the top reading's word use, the
                        # customary reading is not trusted for standalone use


def tier(sense):
    if XREF.search(sense):
        return 3
    if NAME.search(sense):
        return 2
    if REGISTER.search(sense):
        return 1
    return 0


class WordEvidence(object):
    """Frequency-weighted syllable counts per character, from multi-character words."""

    def __init__(self, cedict, jieba):
        prons = defaultdict(set)          # simp word -> lowercased readings
        forms = defaultdict(set)          # (simp, reading) -> traditional forms
        common = set()                    # (simp, reading) seen as an ordinary word
        for trad, simp, pin, _defs in cedict:
            if len(simp) < 2 or not jieba.get(simp):
                continue
            sy = pin.lower().split()
            if len(sy) != len(simp) or len(trad) != len(simp):
                continue
            key = " ".join(sy)
            prons[simp].add(key)
            forms[(simp, key)].add(trad)
            if not pin[:1].isupper():
                common.add((simp, key))

        self.by_char = defaultdict(lambda: defaultdict(float))   # ch -> syl -> weight
        self.by_form = defaultdict(float)                        # (simp ch, trad ch, syl)
        for simp, readings in prons.items():
            for key in readings:
                # names (柏林 Berlin, 长沙) say little about everyday use
                share = jieba[simp] / float(len(readings))
                if (simp, key) not in common:
                    share *= PROPER_WEIGHT
                sy = key.split()
                trads = forms[(simp, key)]
                tshare = share / len(trads)
                for i, s in enumerate(simp):
                    self.by_char[s][sy[i]] += share
                    for trad in trads:
                        t = trad[i]
                        if t != s:
                            self.by_char[t][sy[i]] += tshare
                        self.by_form[(s, t, sy[i])] += tshare


def _base(syl):
    return syl.rstrip("012345")


def order_readings(ch, entries, evidence, jieba, jieba_pos, customary, toned):
    """entries: [(trad, simp, pinyin, defs)] single-character CC-CEDICT lines
    that mention ch. customary: Make Me a Hanzi's toned readings, most
    customary first. toned: numbered pinyin -> tone marks.
    Returns [(pinyin, toned, "sense/sense/...")], most common reading first."""
    groups = {}
    for n, (trad, simp, pin, defs) in enumerate(entries):
        key = pin.lower()
        g = groups.setdefault(key, {"key": key, "entries": [], "first": n, "pins": []})
        g["entries"].append((n, trad, simp, pin, [d for d in defs.split("/") if d]))
        g["pins"].append(pin)
    keys = list(groups)

    # ---- how often each pronunciation is used ---------------------------
    score = defaultdict(float)
    for syl, w in evidence.by_char.get(ch, {}).items():
        if syl in groups:
            score[syl] += w
        else:
            # a neutral tone inside a word (东西 dong1 xi5) still counts
            # toward the one reading with that syllable, if unambiguous
            same = [k for k in keys if _base(k) == _base(syl)]
            if len(same) == 1:
                score[same[0]] += w

    alone = jieba.get(ch, 0)
    if alone:
        target = None
        pos = (jieba_pos.get(ch) or "")
        if pos[:1] == "u" or pos in ("y", "e"):
            neutral = [k for k in keys if k.endswith("5")]
            if len(neutral) == 1:
                target = neutral[0]
        elif pos == "nr":
            # tagged as a surname on its own (沈 Shěn, 冯 Féng)
            names = [k for k in keys if any(p[:1].isupper() for p in groups[k]["pins"])]
            if len(names) == 1:
                target = names[0]
        top = max(keys, key=lambda k: score[k]) if keys else None
        if target is None and customary:
            hit = [k for k in keys if toned(k) == customary[0]]
            # Make Me a Hanzi's customary reading leans traditional (只 zhī);
            # only trust it when words show that reading is actually in use
            if hit and score[hit[0]] >= CUSTOMARY_FLOOR * score[top]:
                target = hit[0]
        if target is None:
            target = top
        if target:
            score[target] += alone

    def proper_only(g):
        return all(p[:1].isupper() for p in g["pins"])

    def custom_rank(k):
        for i, c in enumerate(customary or []):
            if toned(k) == c:
                return i
        return 99

    def variant_only(g):
        # a reading that exists only as "variant of X" belongs to X, not here
        return all(VARIANT.match(d.strip())
                   for e in g["entries"] for d in e[4] if d.strip())

    ordered = sorted(groups.values(), key=lambda g: (
        variant_only(g),
        -(score[g["key"]] * (0.25 if proper_only(g) else 1.0)),
        custom_rank(g["key"]),
        g["first"]))

    # ---- senses within each pronunciation --------------------------------
    out = []
    for g in ordered:
        syl = g["key"]

        def entry_weight(e):
            _n, trad, simp, pin, _d = e
            w = evidence.by_form.get((simp, trad, syl), 0.0)
            if trad == simp:
                w += 0.5          # the character's own entry wins a tie
            return w

        entries_sorted = sorted(g["entries"], key=lambda e: (
            e[3][:1].isupper(),           # proper-noun entries last
            -entry_weight(e),
            e[0]))

        senses, seen = [], set()
        for rank, e in enumerate(entries_sorted):
            for j, d in enumerate(e[4]):
                d = d.strip()
                if not d or d in seen:
                    continue
                seen.add(d)
                senses.append((tier(d), rank, j, d))
        senses.sort()

        kept = []
        for t, _r, _j, d in senses:
            m = SELF_REF.match(d)
            if m and ch in m.group(4):
                continue
            kept.append(d)
        if not kept:                      # nothing but self-references: keep them
            kept = [s[3] for s in senses]

        lower = [p for p in g["pins"] if not p[:1].isupper()]
        pin = lower[0] if lower else g["pins"][0]
        # the numbered form keeps its capital to flag a name; tone marks go lowercase
        out.append((pin, toned(pin.lower()), "/".join(kept)))
    return out
