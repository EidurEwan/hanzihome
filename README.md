# HanziHome

A personal, offline rebuild of [hanzicraft.com](https://hanzicraft.com) — the character
dictionary *and* the logged-in dashboard: decomposition, phonetic clues, frequency data,
example words, and progress tracking over the characters you have learned.

Nothing was copied from the original site. Every fact is derived at build time from open
datasets, so this is a reimplementation of the idea with its own data pipeline.

## Running it

**Live:** <https://eidurewan.github.io/hanzihome/> — deployed from `site/` by
`.github/workflows/pages.yml` on every push to `main`.

**Just open [`site/index.html`](site/index.html) in a browser.** No server, no install,
no build step, no network. Data files load through `<script>` tags rather than `fetch()`,
which is what lets it work from a plain `file://` URL.

Everything you mark is kept in that browser's `localStorage`. Settings → Export JSON gives
you a copy to back up or move to another machine, or turn on sync (below).

## Syncing between devices

Optional. [`sync/Code.gs`](sync/Code.gs) is a Google Apps Script web app that keeps one copy of
your progress (statuses, known components, lists, notes, history, study schedule, goal) in a
Google Sheet you own. Every browser connected to it stays in step.

1. Create a Google Sheet, then **Extensions → Apps Script**. Paste in `sync/Code.gs` and save.
2. **Deploy → New deployment → Web app**. Execute as *Me*, access *Anyone*. Copy the `/exec` URL.
3. In HanziHome, **Settings → Sync with Google Sheets**: paste the URL. Repeat in each browser.

The script is marked `@OnlyCurrentDoc`, so it can only open the Sheet it is attached to.
"Anyone" means browsers can reach it without a Google sign-in. There is no password, so anyone
who has the `/exec` URL can read and replace your synced progress: keep the URL private. After
changing the script, use **Manage deployments → Edit → New version** so the URL stays the same.

To check a deployment, open the `/exec` URL in a **private window** (the site is not signed in to
Google, so that is what it sees). A working one shows `"version":3` and `"sheet":"ok"`. A
sign-in page means *Execute as* is not *Me* or access is not *Anyone*. A `"problem"` names what
stops the script opening its Sheet.

How it behaves:

* Changes are sent about 2.5 seconds after you make them. The site also syncs when it opens,
  when you return to the tab, and every 5 minutes while it is open. Changes made offline wait
  and go out on the next sync.
* The script keeps a version number and refuses a save based on an out-of-date copy. The
  browser then merges and tries again, so two devices can't silently overwrite each other.
* The merge compares both copies with the last synced one. Edits to different items on different
  devices all survive, and deleting something on one device (a status, a note, a list entry)
  stays deleted. If both devices changed *the same* item, the device that syncs second wins.
* On a browser's first connection its data is combined with the Sheet's. Characters and lists
  from both are kept, and the Sheet's goal setting wins over the new browser's.
* **Reset everything** empties the synced copy too. **Disconnect** stops syncing but leaves
  your data in the browser and in the Sheet.

To try sync without a Google account, `node sync/mock-server.js` runs the same `Code.gs` against
an in-memory sheet on `http://localhost:8787/exec`.

## What's in it

**Dashboard** — a week-streak card, counts of what you are learning versus what you have
learned, and the most common characters as a tile grid you can filter by
All / Not known / Learning / Learned. A right-hand rail follows you across every page with:

* **Character progress** — searched, components known, learning, learned.
* **Reading coverage** — a donut showing what share of ordinary running text your learned
  characters account for, using real corpus frequencies.
* **Study next** — suggestions picked because *you already know both parts* of a character,
  or because it buys the most reading coverage.

**Character pages** — breakdown tree, glossed components, full stroke expansion, every
CC-CEDICT reading, phonetic-component clues, "appears in", example words split into
common / uncommon / rare, frequency facts, stroke count, radical, and a private note field.
Components are clickable: mark one as known and it lights up green everywhere it occurs.

**Study** — flashcards over the characters you are learning, with Leitner-style spacing
(0 → 1 → 2 → 4 → 8 → 16 → 32 days). Getting one right three times promotes it to Learned.

**Reader** — 24 original graded stories, four per HSK level, each at least 250 characters
long, written with grammar kept to what that level teaches (HSK 1 sticks to 是 / 有 / 在 and
simple 了; 把, 被 and complements arrive at HSK 3; HSK 6 uses the written register). Hovering
a word shows the reading and meaning it has *in that sentence* — 还 is "to give back" in one
line and "also" in the next — plus what each of its characters contributes, with buttons to
mark them. You can also paste your own text.

**Lists** — HSK 1–6 (characters *and* vocabulary), the 214 Kangxi radicals, phonetic sets,
productive components, productive characters, the full frequency list, plus your own
custom lists, notes and search history.

**Search** — a character, pinyin (`hao3` or `hao`), or an English word, with type-ahead.

## How the data is put together

| Source | Used for | Licence |
| --- | --- | --- |
| [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | readings, meanings, words, simplified/traditional pairs | CC BY-SA 4.0 |
| [cjk-decomp](https://github.com/amake/cjk-decomp) | character decomposition | public domain |
| Jun Da, *Modern Chinese Character Frequency List* | frequency ranks and reading coverage | academic use |
| [jieba](https://github.com/fxsjy/jieba) dictionary | word frequency, common/uncommon/rare tiers | MIT |
| [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) | stroke counts, radicals | LGPL / Arphic |
| [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) | HSK levels | MIT |

```
build/build.py          data/raw/*  ->  data/hanzicraft.db   (SQLite, ~28 MB)
build/export_static.py  the database ->  site/data/*.js       (~29 MB)
build/radicaldata.py    the 214 Kangxi radicals and their glosses
build/readingorder.py   orders each character's readings and meanings most-used first
build/build_stories.py  build/stories/*.txt -> site/data/stories.js (the graded reader)
site/                   index.html, app.js, style.css — the app itself
sync/Code.gs            optional Google Apps Script that syncs progress through a Sheet
sync/mock-server.js     runs Code.gs locally for testing, no Google account needed
server.py               optional: serves the same database over HTTP instead
```

Rebuild with `python build/build.py && python build/export_static.py` (stop `server.py`
first if it is running — it holds the database file open).

Character detail is split into 64 buckets by codepoint, so opening a character pulls in
about 300 KB rather than the whole corpus. The word index (6.7 MB) only loads when you
search for something that is not a single character.

### Decomposition

`cjk-decomp` stores each character as `char:type(parts…)`. Three passes give the three views:

* **Graphical** expands to atomic strokes. A shape that is only a *modified* form of
  another (`月` → `⺆`, `一` → `㇐`) is a leaf, shown with its familiar glyph rather than the
  stroke-block codepoint.
* **Breakdown** stops when a part is a Kangxi radical, is atomic, or *has a bare stroke
  among its own parts* — that last rule is why 勺 and 白 stay whole instead of splitting
  into 勹 + 丶 and 丿 + 日.
* **Components** are the leaves of the breakdown tree, glossed from the radical table.

Checked against the original for 的, 好, 请, 河, 江, 雪 and 想.

### Pronunciation and meaning order

CC-CEDICT files readings alphabetically, one line per traditional form, so 行 used to open
with háng and 和 listed hé three times. [`build/readingorder.py`](build/readingorder.py)
merges lines that share a pronunciation and orders them by use:

* **Pronunciations** are ranked by how much text uses them. Every corpus word containing
  the character adds its jieba frequency to the syllable the character has in that word
  (进行 → xíng, 银行 → háng); names like 柏林 count for less. The character's frequency as a
  word on its own goes to its particle reading when jieba tags it as one (的 de, 得 de),
  to the surname when tagged as a name (沈 Shěn), and otherwise to Make Me a Hanzi's
  customary reading, unless words show that reading is barely used (只 zhǐ, not zhī).
* **Meanings** within a pronunciation come from the most-used traditional form first
  (里 "inside" from 裡 before "li, a unit of length" from 里), then register-tagged senses
  like *(literary)*, then surnames, then cross-references ("variant of…", "used in…").
  A cross-reference that points back at the character itself is dropped.

The corpus is news-heavy and a few characters are close calls: 长 lists zhǎng (增长, 市长)
before cháng, and 为 lists wèi before wéi.

### Graded stories

Stories live in `build/stories/hsk1.txt` … `hsk6.txt` as words separated by spaces, each
followed by a hand-written glossary: `word | pinyin | meaning in this story`. A word with two
senses in one story is tagged in the text (`还@huan`) and glossed under both keys. Words that
never change meaning (我, 学校) sit in `lexicon.txt`; context-dependent ones (了, 还, 要, 会 …)
are refused there. `chars.txt` says what a character means inside a word (面 in 面包 is
"flour", not "face").

`python build/build_stories.py --report report.txt` checks every story has at least 250
characters and a meaning for every word, that pinyin has one syllable per character, lists
vocabulary above the story's HSK level (HSK 2.0 and 3.0 lists), flags words missing from
CC-CEDICT as likely typos, and reports character meanings that fell back to the dictionary.

### Phonetic relationships

Each reading is split into initial and final, then each component is compared with the
character containing it: (1) same syllable and tone, (2) same syllable different tone,
(3) same final — it rhymes, (4) same initial. Character pages show 1–3; the phonetic-set
lists cover 1–2.

### Productive lists

*Components* score `1 / character-frequency-rank` summed over the characters they appear
in. *Characters* score `1 / word-frequency-rank` summed over the multi-character words
they form — which is why the two lists rank very differently.

## Known differences from the original

* **Word counts are lower.** Only words attested in a corpus are kept, which drops
  CC-CEDICT's most obscure entries (的: 44 words here against their 151). The
  common/uncommon/rare cutoffs are corpus-rank thresholds tuned to land near their
  proportions, not their exact numbers.
* **青 is not broken up.** They expand it to 龶 + 月; here it stops, because it is a Kangxi
  radical and, more usefully, the phonetic component of 请. It is the only character
  checked that still decomposes differently.
* **HSK character lists are derived**, not official: each level lists the characters first
  introduced by that level's vocabulary, so HSK 1 has 178 rather than the official 300.
* **More characters** — 15,450 indexed against their ~6,800, so "component in N characters"
  runs slightly higher.
* **No limits and no account.** The original caps tracked characters and full history on
  the free tier; there is nothing to upgrade here. The trade-off is that progress lives in
  one browser rather than syncing across devices — use Settings → Export JSON to move it.

## Typography and colour

Matched to their dashboard. Their stylesheet's own comment names **Nunito** as the
dashboard UI font, so English text uses Nunito — bundled in `site/fonts/` (SIL Open Font
License, 4 weights, 152 KB) so nothing is fetched from the network.

The palette is lifted from their stylesheet: `#b83746` accent with `#8c2a35` as the dark
variant (which is also the sidebar), over a Tailwind-style grey scale — `#111827` ink,
`#6b7280` and `#9ca3af` for secondary text, `#e5e7eb` borders. Active sidebar rows use the
brighter `#b83746` against the darker sidebar, as on theirs.

Chinese uses a sans CJK stack (`Noto Sans SC`, `PingFang SC`, `Microsoft YaHei`), because
they serve a Noto Sans subset — their hanzi render sans, not serif.

Light theme only. Character tiles are capped at 15 per row, matching their grid, and the
content column is centred rather than pinned to the sidebar.

## Screen sizes

The list card is always a whole number of tiles wide plus its gutters, so it snaps down a
card at a time as the window narrows instead of overflowing.

| Window | Layout | Cards per row |
| --- | --- | --- |
| 1480 px and up | list + rail side by side | up to 15 |
| 1181–1479 px | list + narrower rail | as many as fit |
| 901–1180 px | one column, rail cards above the list | up to 12 |
| 601–900 px | nav becomes a slide-in drawer | up to 10 |
| 600 px and under | phone spacing, rail cards stacked | as many as fit (6 on a 375 px phone) |

Tables scroll sideways inside their card. On touch screens a tap opens a card's status menu
and a second tap opens the character.
