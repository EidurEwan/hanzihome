# -*- coding: utf-8 -*-
"""Re-rank the characters in site/data/ by frequency, in place.

The full rebuild (build.py, export_static.py, then the hand-curated steps after them)
would also redo everything else; this changes only what follows from frequency:

  index.js        rank and share of text
  c/*.js          r, p; phonetic-clue members (ph) and "appears in" (ai), in rank order
  charfreq.js     share of text per character, most common first
  meta.js         total_count, n_ranked
  phon1.js phon2.js  phonetic-set members, in rank order
  components.js   productive components, scored again (sum of 1/rank)
  prodchars.js    the rank column, and which characters qualify (ranked ones only)
  hskchars.js     each level's characters, in rank order

Then run  node build/export_charorder.js  and  node build/export_lookalikes.js.

  python build/refreq.py            ranks from wordfreq (build.char_freq)
  python build/refreq.py --check    ranks as they are now: must leave every file unchanged
"""

import glob
import io
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "site", "data")


def load(name):
    with io.open(os.path.join(DATA, name), encoding="utf-8") as fh:
        s = fh.read()
    head = s.split("\n", 1)[0] + "\n" if s.startswith("/*") else ""
    body = s[len(head):]
    expr, js = body.split("=", 1)
    return head, expr, json.loads(js.rstrip().rstrip(";"))


def save(name, head, expr, obj):
    with io.open(os.path.join(DATA, name), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("%s%s=%s;\n" % (head, expr, json.dumps(obj, ensure_ascii=False, separators=(",", ":"))))


def nodes(tree):
    """every node of a breakdown [char, [[part, [...]], ...]] below its root"""
    out = []
    def walk(kids):
        for part, sub in kids:
            out.append(part)
            walk(sub)
    walk(tree[1] if tree else [])
    return out


def main():
    check = "--check" in sys.argv
    _, ixe, index = load("index.js")
    chunks = {}
    for path in sorted(glob.glob(os.path.join(DATA, "c", "*.js"))):
        name = "c/" + os.path.basename(path)
        chunks[name] = load(name)
    char = {}
    for _h, _e, obj in chunks.values():
        char.update(obj)

    # ---- the ranks and shares --------------------------------------------
    if check:
        rank = {c: v[0] for c, v in index.items() if v[0]}
        pct = {c: v[1] for c, v in index.items()}
        _, _, meta = load("meta.js")
        total = meta["total_count"]
    else:
        import build
        simp_of = {c: v["s"] for c, v in char.items() if v.get("s")}
        meanings = {c: [d for rd in v["rd"] for d in rd[2]] for c, v in char.items()}
        rows = [r for r in build.char_freq(simp_of, meanings) if r[1] in index]
        total_n = float(sum(r[2] for r in rows))
        rank = {ch: i for i, (_r, ch, _n, _c, _p) in enumerate(rows, 1)}
        pct = {ch: round(n / total_n * 100.0, 4) for _r, ch, n, _c, _p in rows}
        total = str(int(total_n))
    R = lambda c: rank.get(c)
    by_rank = lambda c: (rank.get(c) is None, rank.get(c) or 0)

    # ---- index -------------------------------------------------------------
    for c, v in index.items():
        v[0], v[1] = R(c), pct.get(c, 0)
    save("index.js", "", ixe, index)

    # ---- phonetic relations and "appears in", from the characters themselves
    rel = {}                                  # (comp, char) -> relation
    for c, v in char.items():
        seen = set()
        for clue in v["ph"]:
            if clue["c"] not in seen:
                seen.add(clue["c"])
                rel[(clue["c"], c)] = clue["r"]
    members = defaultdict(list)               # comp -> ranked chars it is a clue in
    for (comp, c), r in rel.items():
        if R(c):
            members[comp].append(c)
    for comp in members:
        members[comp].sort(key=lambda c: (R(c), c))
    contains = defaultdict(set)               # comp -> chars with it anywhere in the breakdown
    for c, v in char.items():
        for n in set(nodes(v["bd"])):
            if n != c:
                contains[n].add(c)
    toned = lambda c: (index.get(c) or [None, 0, ""])[2]

    for name, (head, expr, obj) in chunks.items():
        for c, v in obj.items():
            v["r"], v["p"] = R(c), pct.get(c, 0)
            for clue in v["ph"]:
                old = {m[0]: m[1] for m in clue["m"]}
                clue["m"] = [[m, old.get(m, toned(m)) if m in old else toned(m), R(m)]
                             for m in members.get(clue["c"], []) if m != c][:60]
            old = {a[0]: a[1] for a in v["ai"]}
            v["ai"] = [[a, old[a] if a in old else toned(a), R(a)]
                       for a in sorted(contains.get(c, ()), key=lambda a: (by_rank(a), a))][:300]
        save(name, head, expr, obj)

    # ---- charfreq, meta ------------------------------------------------------
    cf = sorted((c for c in index if R(c) and pct.get(c, 0) > 0), key=R)
    save("charfreq.js", "", "HZ.charfreq", {c: pct[c] for c in cf})
    _, me, meta = load("meta.js")
    meta["total_count"], meta["n_ranked"] = total, str(len(rank))
    save("meta.js", "", me, meta)

    # ---- phonetic sets ---------------------------------------------------------
    for degree in (1, 2):
        name = "phon%d.js" % degree
        head, expr, sets = load(name)
        for s in sets:
            old = {m[0]: m[1] for m in s[3]}
            ms = [c for c in members.get(s[0], []) if rel[(s[0], c)] <= degree][:30]
            s[3] = [[c, old[c] if c in old else toned(c), R(c)] for c in ms]
        save(name, head, expr, sets)

    # ---- productive components -------------------------------------------------
    head, expr, comps = load("components.js")
    for row in comps:
        row[5] = round(sum((1.0 / R(c) for c in contains.get(row[1], ()) if R(c)), 0.0), 5)
    comps.sort(key=lambda row: -row[5])
    for i, row in enumerate(comps, 1):
        row[0] = i
    save("components.js", head, expr, comps)

    # ---- productive characters: ranked ones, by word score (which doesn't change)
    head, expr, pcs = load("prodchars.js")
    pcs = [row for row in pcs if R(row[1])]
    for i, row in enumerate(pcs, 1):
        row[0], row[2] = i, R(row[1])
    save("prodchars.js", head, expr, pcs)

    # ---- HSK characters ----------------------------------------------------------
    head, expr, hsk = load("hskchars.js")
    for lv in hsk:
        hsk[lv].sort(key=lambda c: R(c) or 99999)
    save("hskchars.js", head, expr, hsk)

    print("ranked %d of %d characters" % (len(rank), len(index)))


if __name__ == "__main__":
    main()
