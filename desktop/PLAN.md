# HanziHome Desktop — plan

A Windows app that reads Chinese anywhere on screen. It sits in the tray, colours every
character on screen by what you know, and shows the reader's word popup when you point at
one. It uses HanziHome's dictionary and your HanziHome progress. Everything runs offline
apart from progress sync.

Status (2026-09-28): **steps 1–3 done.** Step 1: `site/textstory.js`, `site/data/readings.js`
and `site/data/readerwords.js` (from `build/export_reader.py`, which needs
`data/raw/cedict.txt` and `jieba_dict.txt`), and `test/accuracy.js`; the scores are in README →
"Reading any text". Step 2: pasted text on the site opens at `#/reader/text` in the story
reader. Step 3: the OCR helper `desktop/ocr/` (`node desktop/ocr/build.js`), its Node client
`desktop/src/ocr.js`, the repair `desktop/src/ocrfix.js`, and `desktop/test/ocr.js`. Step 4:
the Electron shell, `desktop/src/main.js` (run with `npm start` in `desktop/`): the site in
one window at `app://hanzihome/`, tray menu, the store bridge (`preload.js` +
`tellDesktop()` in `site/app.js`), background sync, and "Read the screen now" (OCR →
ocrfix → `layout.js` paragraphs → the site's reader). New logo: `site/logo.svg` (icons
drawn from it by `desktop/tools/make-icons.js`). Next: step 5, the colour overlay.

Running it: `cd desktop && npm install && node ocr/build.js && npm start`. The app has
its own browser storage, so it starts with no progress: connect the same Google Sheet
in Settings → Sync (or Settings → import an exported JSON).

## Decisions made

| Question | Decision |
| --- | --- |
| Where text comes from | The screen itself, read with OCR. No paste, files or URLs. |
| Screen modes | **Hover lookup** and a **colour overlay**. Snip-and-read and live regions were declined. |
| Meaning in context | **Offline only.** Dictionary plus rules; no AI. Show both senses when unsure. |
| What the app contains | **Full HanziHome** (dashboard, character pages, study, lists) plus the screen reader. |
| Progress | The same Google Sheet sync as the website (`sync/Code.gs`), so both stay in step. |
| Project location | `Downloads\hanzihome`, in a `desktop/` folder next to `site/`. |

## What it does

**Colour overlay.** A see-through, click-through window covers the screen. Each recognised
word gets a thin colour bar under it: green = every character learned, amber = some marked,
red = new. These are the reader's `wordState()` rules. Bars, not tints, so the text stays
readable. Tray toggles turn each colour on or off, as the reader's filter checkboxes do.
Marking a character recolours every place it appears straight away.

**Hover lookup.** Hold a key (default: Left Alt, configurable) and point at a word. The
reader's word popup appears: word, pinyin, meaning, then one row per character with what
it contributes and Not known / Learning / Learned buttons. Clicking a character opens its
full page in the main window.

**Main window.** The whole of `site/`, opened from the tray. It also has an "On screen now"
page: counts plus the Vocabulary and Characters tabs for the text currently recognised,
reusing `vocabList()` / `charList()`.

## How it works

```
 screen ──capture──▶ OCR helper (C#) ──text + boxes──▶ Electron main
                         ▲ only when pixels changed          │
                         │                                    ▼
             overlay hidden from capture            textToStory(lines)
             (setContentProtection)                          │
                                                             ▼
                       overlay window  ◀── words + boxes + status ──┘
                       (bars, hover popup)
```

1. **Capture and OCR: a small C# helper** (`desktop/ocr/HanziOcr.cs`) that stays running
   and talks JSON over stdin/stdout. Windows.Media.Ocr with `zh-Hans-CN`, which Windows
   installs with Chinese language support. It captures a monitor (by default the foreground
   window's), compares it with the last capture in 16-pixel strips, and OCRs again only the
   bands that changed, widened to whole lines, at ×1.5.
   * **Built with the C# compiler that ships with Windows** (.NET Framework 4.x): no SDK to
     install, and the exe runs on any Windows 10/11 with nothing added. The price is C# 5
     and awaiting WinRT calls by hand (see the file's header).
   * Measured 2026-09-28 (`desktop/test/ocr.js`): Chinese characters read correctly at ×1.5
     — 94% (YaHei 16px), 99% (YaHei 24px), 92% (13px), 99.4–99.8% (DengXian, SimSun,
     KaiTi 20–24px), 98% (dark mode), 99% (subtitles; big text reads best at ×1). A whole
     1920×1080 screen: 0.28 s at ×1, 0.56 s at ×2; an unchanged screen: ~40 ms. One
     paragraph changed on a page: 21% of it re-read, in 60 ms instead of 270.
2. **OCR repair** (`desktop/src/ocrfix.js`). Merges a character read as its two halves
   (亻尔 → 你: a narrow part plus a neighbour about one character wide, looked up in
   `desktop/data/ocrpairs.json` from the character breakdowns), turns 丿+b back into 儿,
   and swaps look-alikes (学/字, 已/己) only when the text becomes far likelier Chinese.
   Raises ×1.5 accuracy by 0.3–0.9 points and changed none of 8,379 correct characters.
   What remains is mostly dropped characters, which no repair can bring back.
3. **`textToStory(text)`** in a shared file used by the website and the desktop app.
   Output has the same shape as a `stories.js` entry (`seg`, `g`, `v`, `c`), so the reader's
   existing drawing code works unchanged.
   * **Segmentation:** jieba-style. Build every way to split the text into dictionary
     words (`readerwords.js`: CC-CEDICT words with jieba's frequencies), then take the most
     probable path.
   * **Pinyin** comes from the word entry, so the word settles polyphones (银行 háng,
     进行 xíng).
   * **Each character's contribution:** the character's own reading that matches its
     syllable in the word, and that reading's first meaning. Override with `chars.txt`
     where it exists.
   * **Context rules** for single-character words in `STORY_ONLY` (了 还 得 地 的 会 要
     着 过 …). Examples: 了 at clause end → particle, 还 + noun/pronoun + noun → huán
     "to give back", 得 after a verb → complement de. Where no rule applies, show the
     top two senses rather than guess.
   * **Traditional text:** look words up by traditional form too. Look up status with the
     simplified character.
4. **Accuracy test.** The 24 hand-glossed stories are the answer key. Strip their spaces,
   run `textToStory`, then score word boundaries, pinyin and senses against the
   hand-written glossary. `node test/accuracy.js` prints the scores. Rules are
   judged by whether they raise them.
5. **Overlay window.** Electron: transparent, frameless, always on top, one per monitor.
   Click-through via `setIgnoreMouseEvents(true, {forward: true})`, so it still gets
   mouse movement. `setContentProtection(true)` keeps it out of our own captures. DPI:
   map physical OCR pixels to the window's logical pixels (this PC reports 1280×720, so
   scaling is on). Scrolling makes boxes stale: hide bars in changed tiles until they
   are re-read.
6. **Hold-to-look key.** `uiohook-napi` for key-down/key-up anywhere in Windows (Electron's
   `globalShortcut` only sees presses). Fallback: a toggle shortcut.
7. **Progress.** One store in the main process, persisted to the app's data folder, so the
   main window and overlays share it. It runs the existing `Sync` + `merge3` code against
   the user's `/exec` URL. Fetching from Node also avoids the browser's CORS problems.
   First run: connect sync or import an exported JSON.

## Build order

1. **`textToStory` and the accuracy test.** Pure JS, no desktop parts. Checked against the
   24 stories.
2. **The website's paste reader uses it.** Pasted text on the site gets the full story
   reader. It ships on its own and tests the engine on real text.
3. **OCR helper.** C# console app: capture, change detection, OCR, JSON out; repair in
   Node. Tested on rendered pictures in several fonts, sizes and styles, and on this PC's
   screen (timings and counts only).
4. **Electron shell.** Tray, main window with `site/`, shared store, sync. The page stays
   the store's owner (it keeps running while hidden); the main process keeps a copy
   through the bridge rather than a second store, so nothing is duplicated.
5. **Colour overlay.** Bars over recognised words, per-colour toggles, recolour on mark.
6. **Hover lookup.** Hold key, word popup, mark buttons, open character page.
7. **"On screen now" page, settings** (hotkey, colours, which monitors, pause list for
   apps like games), **installer** (electron-builder, NSIS `.exe`), start with Windows.

## Known risks

* **OCR errors** on small, stylised or low-contrast text (game fonts, subtitles over video).
  Mitigated by ×1.5 scale and the repair; 13px text still loses ~8% of characters. Could
  improve: re-read small lines at ×2–3 and big ones at ×1.
* **Lag after scrolling.** Bars vanish while the region is re-read (about 0.3–1 s).
* **CPU.** Kept low by OCRing only changed tiles, and pausing when idle or in listed apps.
* **Offline senses** will sometimes be wrong for 了/还/会-type words. The accuracy test
  shows how often.
* **Exclusive-fullscreen games** may not be capturable. Borderless windowed works.
