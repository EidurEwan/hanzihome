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

**On a phone, or offline:** opened from the live address, the site keeps every file it has
used ([`site/sw.js`](site/sw.js), a service worker), so pages you have opened open again without
a connection, and **Settings → Use offline → Keep everything** fetches the rest (about 70 MB).
Add it to the home screen from the browser's menu and it opens like an app
([`site/manifest.webmanifest`](site/manifest.webmanifest)). A new version shows as soon as the
page is loaded with a connection.

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
"Anyone" means browsers can reach it without a Google sign-in, so anyone who has the `/exec` URL
can read and replace your synced progress: keep the URL private, and lock it with a passphrase
(**Settings → Sync**, once connected). A locked script refuses every request without the
passphrase, and stops answering for a quarter of an hour after 10 wrong ones. Each device asks
for it once and keeps it beside the URL; the script keeps only a salted hash, in its script
properties. Forgotten it? In the Apps Script editor, **Project Settings → Script properties**,
delete `lockHash`. After changing the script, use **Manage deployments → Edit → New version**
so the URL stays the same.

To check a deployment, open the `/exec` URL in a **private window** (the site is not signed in to
Google, so that is what it sees). A working one shows `"version":6` and `"sheet":"ok"`. A
sign-in page means *Execute as* is not *Me* or access is not *Anyone*. A `"problem"` names what
stops the script opening its Sheet.

How it behaves:

* Changes are sent about 5 seconds after you stop making them, in one request. The site also
  checks when it opens, when you return to the tab, and every 5 minutes while it is open: a
  request for the version number only, with the whole copy fetched just when it has changed.
  Changes made offline wait and go out on the next sync.
* Reads and saves take turns in the script, and the Sheet keeps the saved copy's length, so a
  copy is never read half-way through a save. The site also never takes a copy that doesn't
  arrive whole for an empty one: it keeps what it has and tries again a few seconds later.
  (Before version 4 of the script, a sync that caught another device's save half-way could
  empty the store until the next sync.) The Settings page says when a deployment runs an older
  script; update it as in step 2 above, with **Manage deployments → Edit → New version**.
* No sync may remove most of a device's data unasked. If the synced copy holds far less than a
  device (under half), that device pauses syncing and asks which copy to keep: its own (with
  anything new from the synced copy) or the synced one. The script (version 5) refuses such an
  upload from any device, so an emptied device can't empty the others; only **Reset
  everything** gets through, on purpose.
* The script keeps earlier copies in a second sheet, "HanziHome backups": the last 30, one at
  most every half hour, and always before a big drop or a restore. **Earlier copies…** in
  Settings lists them and puts one back on every device. **Import a file…** loads an export.
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

**Character pages** — stroke order (played stroke by stroke, the radical's strokes in red,
with practice tracing over it or writing it from memory, checked stroke by stroke), breakdown
tree, glossed components, full stroke expansion, every CC-CEDICT reading, phonetic-component clues, "appears in", example words split into
common / uncommon / rare, frequency facts, stroke count, radical, and a private note field.
Components are clickable: mark one as known and it lights up green everywhere it occurs.

**Study** — lessons and reviews in the style of [HanziHero](https://hanzihero.com). **Add to
lessons** (on a character's page, or in the reader's word popup, here or on the desktop) puts a
character or word in a queue, with the sentence you found it in. A lesson, five at a time, goes
through its parts (a character's components and sound component, a word's characters), a
mnemonic you write yourself on a scaffold of those parts, its meanings and pronunciation, and
examples, then asks you to type its pinyin (tone numbers: `ren4shi`), then its meaning.

Reviews are scheduled by [FSRS](https://github.com/open-spaced-repetition) (version 5, its
default weights), checked against the reference implementation in `test/learn.js`. Each item
has a difficulty (1–10) and a stability (days until the chance of recalling it falls to 90%),
and so a retrievability, the chance of recalling it now; it comes back when that falls to the
retention you want (90% unless set otherwise in Settings). The rating each review gives FSRS
isn't asked for: it comes from the answers. A wrong answer (or the answer shown) is *again*, a
slip of tone or a long think (over 15 seconds before typing starts) *hard*, right *good*, right
and typing within 3 seconds on both questions *easy*; the lesson's quiz gives the first rating.
A lapse is relearned in the session, which FSRS counts as a same-day review. The stages keep
HanziHero's names as bands of stability (Novice under 4 days, Apprentice from a week,
Journeyman from a month, Expert from 4 months, Master from 2 years), and the item info panel
shows each item's numbers. A review asks both questions, the
meaning only once the pronunciation is right (in pairs or shuffled); anything missed comes
back again before the session ends. A neutral tone may be
typed with any tone or none, meanings allow a typo and ignore "to" and brackets, and **My
answer was right** keeps your wording as a synonym. Under the answer is HanziHero's toolbar,
with its keys: item info once answered (I: parts, pronunciation, meaning and your synonyms (+
to add one), your mnemonic and notes to edit, usage; a section that would give away the item's
other question starts closed), play the pronunciation (P), quiz settings (Q), reveal the answer
(Ctrl+Enter, counted as missed), open the item in a new tab (O; a second window in the desktop
app), wrap up (W: finish the items already started, leave the rest for next time) and undo
(Ctrl+Z: the answer doesn't count and the question comes again later). Two more questions can be
turned on in Settings: **Listening** asks an item's meaning from its sound alone, before you see
it, and counts like the others; **Writing** asks you to draw a character, stroke by stroke, from
its pinyin and meaning (after three misses on a stroke its outline shows, and needing it makes
the review hard, never forgotten). Tabs and windows open on
the site follow each other's changes. The summary after a session shows the share right first
time, what was reviewed, right and missed and how long it took, a tile per item with the stage
it moved to (and from), the rating the app gave it, its stability and difficulty, and what you
answered when you missed it, which characters became
learned, mastered or slipped back to learning, and when the next reviews come. **Practice the
missed** runs them again without changing their schedule, as does **Recent mistakes** on the
Study page (misses from the last three days). A character counts as learning from its first lesson and as
learned from Journeyman (a month). Every character marked Learned is in the reviews too,
from Journeyman I: ones marked before this have their first reviews spread over a month, most
common first (20 a day at most), and one marked later comes up a month after. The
**calibration test** (Study → Calibration test) sorts them by how well you really know them: a
review session over the ones not yet checked, rated from your answers like any other and taken
as if each came right when due, so FSRS puts each where it fits (from a stability of a month:
wrong goes to Novice, a slip stays at Journeyman, right goes up to Journeyman II, right at once
to Expert). The ones you didn't know can go back to the lessons. The Study page
shows what you can start now (and why not, when nothing), the week ahead, the lesson queue
(☆ to prioritize, 🔒 for what waits to unlock) and how many items are at each stage.

HanziHero's settings are in **Settings → Lessons and reviews**, saved as you change them and
synced: the desired retention for FSRS (80–97%; changing it moves every review); lesson batch size; daily lesson limit (Casual 5 to Jump start 40, or none) and how many
of those may be words; a soft daily review limit; when a character unlocks (right away, or once
its components are learned or familiar) and when a word does (once its characters are learned
or familiar; adding a word can put its unknown characters at the front of the queue);
question order, lesson order, the priority queue and review order (random, by type, oldest,
newest, easiest, lowest stage); the progress counters; pinyin answer validation (an answer
that isn't pinyin shakes instead of counting as wrong); targeted sentence reviews (a word shown
in the sentence you found it in, or one from the stories); the voice, its speed and muting it
and the sound effects (reading aloud uses the device's Chinese voice); and vacation mode, which
pauses everything and moves reviews on by the time away. HanziHero's daily dictionary limit and
word skipping have no counterpart here: every item is one you added, and nothing is skipped.

The rules are in [`site/learn.js`](site/learn.js), checked by `node test/learn.js`; characters
that were being learned with the old flashcards start at Novice I.

**Reader** — 24 original graded stories, four per HSK level, each at least 250 characters
long, written with grammar kept to what that level teaches (HSK 1 sticks to 是 / 有 / 在 and
simple 了; 把, 被 and complements arrive at HSK 3; HSK 6 uses the written register). Hovering
a word shows the reading and meaning it has *in that sentence* — 还 is "to give back" in one
line and "also" in the next — plus what each of its characters contributes, with buttons to
mark them and to add the word to your lessons. Text you paste in opens in the same reader, glossed automatically (see "Reading
any text" below); when context can't settle a meaning, the popup names the other one too.

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
| [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) (Make Me a Hanzi's graphics) | stroke order, writing practice | Arphic Public License |
| [Hanzi Writer](https://github.com/chanind/hanzi-writer) (`site/vendor/`) | drawing strokes and checking written ones | MIT |

```
build/build.py          data/raw/*  ->  data/hanzicraft.db   (SQLite, ~28 MB)
build/export_static.py  the database ->  site/data/*.js       (~29 MB)
build/radicaldata.py    the 214 Kangxi radicals and their glosses
build/readingorder.py   orders each character's readings and meanings most-used first
build/build_stories.py  build/stories/*.txt -> site/data/stories.js (the graded reader)
build/export_reader.py  site/data/c/*.js + build/stories/{lexicon,chars}.txt -> site/data/readings.js
                        data/raw/{cedict,jieba_dict}.txt -> site/data/readerwords.js
build/word_readings.py  everyday readings (build/everyday_readings.txt) into words.js, hsk.js, c/*.js
build/export_strokes.js hanzi-writer-data -> site/data/s/*.js (strokes, by the same 64 buckets)
site/                   index.html, app.js, style.css — the app itself
site/textstory.js       turns any text into what the story reader draws (see "Reading any text")
test/accuracy.js        scores textstory.js against the hand-glossed stories
sync/Code.gs            optional Google Apps Script that syncs progress through a Sheet
sync/mock-server.js     runs Code.gs locally for testing, no Google account needed
server.py               optional: serves the same database over HTTP instead
```

Rebuild with `python build/build.py && python build/export_static.py && python
build/export_reader.py && python build/word_readings.py` (stop `server.py` first if it is
running — it holds the database file open).

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

### Reading any text

[`site/textstory.js`](site/textstory.js) does automatically what the story glossaries do by
hand, so any text can get the full reader. It splits the text into words the way jieba does
(every way of cutting a run of characters into dictionary words is scored by jieba's word
frequencies, and the most probable wins), regroups them the way the stories do (一 个, 每 天,
不 是; 二十八 as one number), and gives each word its reading and meaning. A word of two or more
characters brings its own pinyin, which settles polyphones (银行 háng, 进行 xíng), with place and
direction endings unstressed as the stories write them (家里 jiā li, 回来 huí lai). A character
standing alone goes through context rules (了 after a verb or at the end of a clause, 还 hái or
huán, 得 de or děi, 只 after a number, 的 after a person), then `lexicon.txt`, then CC-CEDICT,
where jieba's part-of-speech tag picks the kind of sense (累 is an adjective: lèi "tired", not
lěi "to accumulate"). Everything runs offline.

Its word data is `site/data/readerwords.js` (~9 MB, loaded only by the reader), written by
`build/export_reader.py` from `data/raw/cedict.txt` and `data/raw/jieba_dict.txt`. Unlike
`words.js` it keeps every reading of a word, everyday ones first: 告诉 gào su "to tell" before
gào sù "to press charges", 东西 dōng xi "thing" before dōng xī "east and west".

`node test/accuracy.js` puts each story's text back together without the spaces, runs it
through the engine and compares the result with the hand-made glossary. The last story of each
level is held out while rules are written. On 2026-09-28:

| | dev (18 stories) | held out (6) |
| --- | --- | --- |
| words split as by hand | 93.5% | 93.9% |
| words cut through the middle | 0.2% | 0.0% |
| pinyin per character | 99.4% | 99.2% |
| meaning shares a content word with the hand gloss | 87.2% | 85.8% |
| … for words not in `lexicon.txt` | 78.0% | 75.9% |
| … for context-dependent characters (了, 还, 得 …) | 83.0% | 79.9% |

`--errors` lists the mistakes, `--show 上` prints every sentence a word appears in, and
`--tune` searches the segmentation parameters. Most remaining meaning "errors" are wording
(mama vs mum, frequently vs often).

`words.js` keeps one reading per word, which for some words was the rarer one (告诉 gào sù "to
press charges"). [`build/word_readings.py`](build/word_readings.py) gives the words listed in
`build/everyday_readings.txt`, checked by hand, their everyday reading and its meanings first,
in search, the HSK lists and the character pages' example words: 告诉 gào su "to tell", 东西
dōng xi "thing", 便宜 pián yi "cheap". The list is by hand because "a neutral tone first" is
right for those and wrong for others (女人 nǚ rén, 土地 tǔ dì).

### Phonetic relationships

Each reading is split into initial and final, then each component is compared with the
character containing it: (1) same syllable and tone, (2) same syllable different tone,
(3) same final — it rhymes, (4) same initial. Character pages show 1–3; the phonetic-set
lists cover 1–2.

### Productive lists

*Components* score `1 / character-frequency-rank` summed over the characters they appear
in. *Characters* score `1 / word-frequency-rank` summed over the multi-character words
they form — which is why the two lists rank very differently.

## Desktop app

[`desktop/`](desktop/) is HanziHome for Windows, reading Chinese anywhere on screen with the
OCR built into Windows. It runs the whole site in a window, with the same progress and sync,
and from the tray it:

* puts a coloured bar under every Chinese word on screen: green learned, blue learning,
  red new;
* shows the reader's word popup for the word under the pointer while you hold Ctrl, with
  the buttons to mark its characters and to add the word to your lessons (with the line
  it was on as the example);
* opens whatever is on screen in the reader ("On screen now"), or the text you copied
  ("Read copied text").

Where a program hands over its text (browsers, Word, Notepad, Electron apps: anything with
UI Automation's text pattern), the app takes it from the program instead of reading the
screen: the exact characters and where they are, with each paragraph as the program has it.
The screen is read (OCR) only for the rest: other windows, pictures, video, games. On a page
in Chrome, looking a word up takes about 10 ms; checking an unchanged screen, about 40 ms. A
switch in Settings → Desktop app turns this off. `npx electron test/text.js` (in `desktop/`)
compares both ways with where the characters really are.

Everything is offline apart from sync. `cd desktop && npm install && npm start` runs it from
here; `npm run dist` builds the installer. Ready-built installers are on the repo's
[Releases](https://github.com/EidurEwan/hanzihome/releases) page, built on Windows by
`.github/workflows/desktop-installer.yml` for each pushed `v*` tag (it must match `version` in
`desktop/package.json`), and every run of the "Desktop tests" workflow (on a push that changes
`desktop/`) keeps one under its Artifacts. The installed
app updates itself from Releases: it downloads a new version in the background and installs it
when you quit (or at once, from the tray). How it works, what was measured and what each
part is for: [`desktop/PLAN.md`](desktop/PLAN.md).

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
  the free tier; there is nothing to upgrade here. Progress lives in the browser, and moves
  between devices through your own Google Sheet (see "Syncing between devices") or an
  exported JSON file instead of an account.

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
