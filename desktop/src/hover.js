/* hover.js — hold a key, point at a Chinese word anywhere, get its popup.
 *
 * uiohook-napi hears keys anywhere in Windows (Electron's globalShortcut only
 * fires on presses, not holds). Only the chosen key is followed; of any other key
 * nothing is kept but the fact that one was pressed during the hold, so Ctrl+C
 * never opens a popup. After the key has been held alone for HOLD ms, the pointer
 * is followed and the word under it gets the reader's word popup (popup/).
 *
 * The word comes from the overlay's last read when the overlay is on; otherwise
 * (or where it has read nothing) from a strip of screen read around the pointer.
 * It is glossed by textToStory in the context of its OCR line.
 *
 * The popup is never focused (it takes clicks without taking focus from the app
 * underneath) and is kept out of screen captures. When the key is let go it
 * stays while the pointer is on the word or on the popup, so its buttons can be
 * used, and closes LEAVE ms after the pointer leaves both, or on Escape.
 */

'use strict';

const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');
const TextStory = require('../../site/textstory.js');
const Learn = require('../../site/learn.js');
const { wordsFromLines } = require('./words');

const KEYS = { ctrl: ['Ctrl', 'CtrlRight'], alt: ['Alt', 'AltRight'], shift: ['Shift', 'ShiftRight'] };
const HOLD = 150;       // ms the key is held alone before looking
const POLL = 60;        // ms between pointer checks
const LEAVE = 400;      // ms off the word and the popup before it closes
const STRIP = 70;       // DIP above and below the pointer read when there is no overlay
const STRIP_FRESH = 1500;

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const inside = (r, p, pad = 0) => p.x >= r.x - pad && p.x < r.x + (r.w || r.width) + pad
  && p.y >= r.y - pad && p.y < r.y + (r.h || r.height) + pad;

class Hover {
  /* opts: key() -> 'ctrl'|'alt'|'shift'|'off'; overlays() -> Overlays or null; ocr(); HZ();
     status() -> {char: state}; mark(char, state) -> Promise of the new statuses;
     items() -> the lesson items {key: item}; learn(word, pinyin, gloss, sentence) ->
     Promise of the item, once added to the lessons; open(char); paused() -> Promise: is the program in front on the pause list;
     direct() -> take text straight from the program under the pointer when it
     offers it; skip: HanziHome's process ids;
     log(msg); pointer() -> the pointer in global DIP (tests; default: the
     real one); offscreen (tests) */
  constructor(opts) {
    this.o = opts;
    this.down = false;       // the key is held
    this.alone = false;      // ...and nothing else was pressed meanwhile
    this.word = null;
    this.win = null;
    this.timer = null;
    this.busy = false;
    this.strip = null;
    this.stories = new WeakMap();
    this.listening = false;

    ipcMain.on('popup-size', (e, w, h) => { if (this.from(e)) this.place(w, h); });
    ipcMain.on('popup-mark', async (e, c, s) => {
      if (!this.from(e) || !this.word) return;
      try { this.show(this.word, await this.o.mark(this.simp(c), s)); }
      catch (err) { this.log('mark: ' + err.message); }
    });
    ipcMain.on('popup-learn', async e => {
      if (!this.from(e) || !this.word) return;
      const word = this.word, [w, p, d] = this.gloss(word);
      try { this.show(word, null, await this.o.learn(w, p, d, sentenceOf(word))); }
      catch (err) { this.log('learn: ' + err.message); }
    });
    ipcMain.on('popup-open', (e, c) => {
      if (!this.from(e)) return;
      this.hide();
      this.o.open(c);
    });
  }

  log(m) { if (this.o.log) this.o.log(m); }
  from(e) { return this.win && !this.win.isDestroyed() && e.sender === this.win.webContents; }
  simp(c) { return (this.o.HZ().t2s || {})[c] || c; }
  /* the key a lesson item is kept under, as the site's learnKey() makes it */
  learnKey(w) { return (this.o.HZ().rwordsT2S || {})[w] || [...w].map(c => this.simp(c)).join(''); }

  // ------------------------------------------------------------- the key

  start() {
    if (this.listening) return;
    const { uIOhook, UiohookKey } = require('uiohook-napi');
    this.hook = uIOhook;
    this.codes = () => (KEYS[this.o.key()] || []).map(k => UiohookKey[k]);
    this.escape = UiohookKey.Escape;
    if (!this.handlers) {
      this.handlers = true;
      uIOhook.on('keydown', e => this.keydown(e.keycode));
      uIOhook.on('keyup', e => this.keyup(e.keycode));
    }
    uIOhook.start();
    this.listening = true;
  }

  stop() {
    if (this.listening) this.hook.stop();
    this.listening = false;
    this.down = false;
    this.hide();
  }

  keydown(code) {
    if (!this.codes().includes(code)) {
      if (this.down) this.alone = false;             // a shortcut, not a look-up
      if (code === this.escape) this.hide();
      return;
    }
    if (this.down) return;                          // the key repeating
    this.down = true;
    this.alone = true;
    this.since = Date.now();
    this.loop();
  }

  keyup(code) {
    if (this.codes().includes(code)) this.down = false;
  }

  // --------------------------------------------------------- the pointer

  loop() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.step().catch(e => this.log('hover: ' + e.message))
        .finally(() => { if (this.down || this.visible()) this.loop(); });
    }, POLL);
  }

  async step() {
    const pt = this.o.pointer ? this.o.pointer() : screen.getCursorScreenPoint();
    if (this.visible() && inside(this.win.getBounds(), pt)) { this.away = 0; return; }
    if (this.down && this.alone && Date.now() - this.since >= HOLD) {
      if (this.word && inside(this.word, pt, 2)) return;
      await this.lookAt(pt);
      return;
    }
    // let go: stay while the pointer is on the word or the popup
    if (this.visible()) {
      if (this.word && inside(this.word, pt, 8)) { this.away = 0; return; }
      this.away = (this.away || 0) + POLL;
      if (this.away >= LEAVE) this.hide();
    }
  }

  /* show the popup for the word at a point (global DIP), or close it if none */
  async lookAt(pt) {
    if (this.busy) return;
    this.busy = true;
    try {
      // a program on the pause list gets no popups either
      if (this.o.paused && await this.o.paused()) { this.hide(); return; }
      const w = await this.find(pt);
      if (w) await this.show(w); else this.hide();
    } finally {
      this.busy = false;
    }
  }

  async find(pt) {
    // the program under the pointer may hand over its text: the exact line, at once
    if (this.o.direct && this.o.direct()) {
      const hit = await this.direct(pt);
      if (hit) return hit;
    }
    const ov = this.o.overlays();
    const hit = ov && ov.running ? ov.wordAt(pt) : null;
    if (hit) return hit;
    // no overlay, or it has read nothing here: read the strip around the pointer
    const s = this.strip;
    if (!(s && Date.now() - s.t < STRIP_FRESH && pt.y >= s.top && pt.y < s.bottom)) {
      const d = screen.getDisplayNearestPoint(pt);
      const top = Math.max(d.bounds.y, pt.y - STRIP), bottom = Math.min(d.bounds.y + d.bounds.height, pt.y + STRIP);
      const phys = screen.dipToScreenRect(null, { x: d.bounds.x, y: top, width: d.bounds.width, height: bottom - top });
      const r = await this.o.ocr().request('screen',
        { x: phys.x, y: phys.y, w: phys.width, h: phys.height, incremental: false });
      const toGlobal = w => {
        const dip = screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.w, height: w.h });
        return { x: dip.x, y: dip.y, w: dip.width, h: dip.height };
      };
      this.strip = { t: Date.now(), top, bottom, words: wordsFromLines(r.lines, this.o.HZ(), toGlobal) };
    }
    return this.strip.words.find(w => inside(w, pt, 1)) || null;
  }

  /* the word at a point from the line the program there offers (desktop/ocr/
     TextReader.cs), or null: it offers none, or there is no word just there */
  async direct(pt) {
    const p = screen.dipToScreenPoint(pt);
    let r;
    try { r = await this.o.ocr().request('text-at', { x: p.x, y: p.y, skip: this.o.skip || [] }); }
    catch (e) { return null; }
    if (!r.lines.length) return null;
    const toGlobal = w => {
      const dip = screen.screenToDipRect(null, { x: w.x, y: w.y, width: w.w, height: w.h });
      return { x: dip.x, y: dip.y, w: dip.width, h: dip.height };
    };
    return wordsFromLines(r.lines, this.o.HZ(), toGlobal).find(w => inside(w, pt, 1)) || null;
  }

  // ----------------------------------------------------------- the popup

  /* the word's glossary entry, as the reader would have it in the word's line */
  gloss(word) {
    const HZ = this.o.HZ();
    let st = this.stories.get(word.line);
    if (!st) {
      st = TextStory.textToStory(word.line.text, HZ);
      this.stories.set(word.line, st);
    }
    const keys = [].concat(...st.seg).filter(k => typeof k === 'string');
    const e = st.g[keys[word.index]];
    if (e && e[0] === word.text) return e;
    const alone = TextStory.textToStory(word.text, HZ);
    return alone.g[Object.keys(alone.g)[0]];
  }

  popup() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: 380, height: 200, useContentSize: true, show: false,
      frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true,
      alwaysOnTop: true, type: 'toolbar', backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, 'popup', 'preload.js'),
        contextIsolation: true, sandbox: true, offscreen: !!this.o.offscreen,
      },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setContentProtection(true);
    this.ready = this.win.loadFile(path.join(__dirname, 'popup', 'index.html'));
    return this.win;
  }

  /* status: the statuses to show, when they have just changed (after a mark);
     item: the word's lesson item, when it has just been added */
  async show(word, status, item) {
    const win = this.popup();
    await this.ready;
    this.word = word;
    this.away = 0;
    const HZ = this.o.HZ(), all = status || this.o.status();
    const entry = this.gloss(word);
    const st = {}, known = {};
    for (const c of [...entry[0]].filter(isHan)) {
      st[c] = all[this.simp(c)] || all[c] || null;
      known[c] = !!(HZ.index[c] || HZ.index[this.simp(c)]);
    }
    const it = item || ((this.o.items && this.o.items()) || {})[this.learnKey(entry[0])];
    const learn = !this.o.learn ? null
      : it ? { stage: it.stage ? Learn.stageName(it.stage) : 'In lessons' } : { add: true };
    win.webContents.send('popup-show', { entry, status: st, known, learn });
  }

  /* the page has drawn and measured itself: fit the window, next to the word */
  place(w, h) {
    if (!this.word || !this.win) return;
    const wd = this.word;
    const area = screen.getDisplayNearestPoint({ x: wd.x, y: wd.y }).workArea;
    let x = Math.max(area.x + 4, Math.min(wd.x, area.x + area.width - w - 4));
    let y = wd.y + wd.h + 8;                         // below the word, as in the reader
    if (y + h > area.y + area.height) y = Math.max(area.y + 4, wd.y - h - 8);
    this.win.setContentBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
    if (!this.win.isVisible() && !this.o.offscreen) this.win.showInactive();
    this.win.moveTop();
    if (!this.down) this.loop();                   // key let go: watch the pointer leave
  }

  visible() { return !!(this.win && !this.win.isDestroyed() && this.win.isVisible()); }

  hide() {
    this.word = null;
    if (this.visible()) this.win.hide();
  }
}

/* the sentence of the word's line that holds the word, for the lesson's example */
function sentenceOf(word) {
  const text = (word.line && word.line.text) || word.text;
  const parts = text.split(/(?<=[。！？!?；…])/);
  return (parts.find(x => x.includes(word.text)) || text).trim().slice(0, 160);
}

module.exports = { Hover, sentenceOf };
