/* overlays.js — the colour overlay: a bar under every Chinese word on screen.
 *
 * One see-through window per display (overlay/index.html), always on top,
 * click-through, never focused, and kept out of screen captures with content
 * protection, so the OCR never reads our own bars (desktop/test/protect.js
 * checks this). A loop asks the OCR helper for each display every
 * settings.interval ms; the helper compares with its last capture and only
 * reads again what changed, so an unchanged screen costs ~40 ms a round. Changed
 * text is repaired (ocrfix), split into words (words.js) and sent to that
 * display's window, which draws the bars. Marking a character or changing a
 * setting recolours from the words already read, without reading again.
 *
 * The helper works in physical pixels; windows in Electron's scaled units (DIP).
 * screen.screenToDipRect converts, and helper monitors are matched to Electron
 * displays by their physical origin.
 *
 * For tests, opts.picture = {path, w, h} reads a picture instead of the screen
 * into one window of the picture's size (desktop/test/overlay.js).
 */

'use strict';

const path = require('path');
const { BrowserWindow, screen, powerMonitor } = require('electron');
const { repair } = require('./ocrfix');
const { wordsOf, stateOf } = require('./words');

const DISPLAY_EVENTS = ['display-added', 'display-removed', 'display-metrics-changed'];

class Overlays {
  /* opts: ocr() -> OcrHelper; HZ() -> the site's data; status() -> {char: 'learned'|…};
     settings() -> {show: {learned, learning, new}, interval}; exclude() -> a DIP rect
     to leave bare (HanziHome's own window) or null; log(msg); picture, offscreen (tests) */
  constructor(opts) {
    this.o = opts;
    this.panes = [];
    this.running = false;
    this.timer = null;
    this.onDisplays = () => { if (this.running) this.rebuild().catch(e => this.log('rebuild: ' + e.message)); };
  }

  log(msg) { if (this.o.log) this.o.log(msg); }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.rebuild();
    if (!this.o.picture) for (const ev of DISPLAY_EVENTS) screen.on(ev, this.onDisplays);
    this.tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    for (const ev of DISPLAY_EVENTS) screen.removeListener(ev, this.onDisplays);
    this.close();
  }

  close() {
    for (const p of this.panes) if (!p.win.isDestroyed()) p.win.destroy();
    this.panes = [];
  }

  async rebuild() {
    this.close();
    if (this.o.picture) {
      const { path: file, w, h } = this.o.picture;
      this.panes.push(this.pane({ x: 0, y: 0, width: w, height: h }, { picture: file }, r => r));
      return;
    }
    const ocr = this.o.ocr();
    const { monitors } = await ocr.request('monitors');
    await ocr.request('forget');                        // new windows: read everything afresh
    for (const d of screen.getAllDisplays()) {
      const phys = screen.dipToScreenRect(null, d.bounds);
      const m = monitors.find(k => Math.abs(k.x - phys.x) <= 2 && Math.abs(k.y - phys.y) <= 2);
      if (!m) { this.log(`no OCR monitor matches display ${d.id}`); continue; }
      this.panes.push(this.pane(d.bounds, { monitor: m.index }, r => {
        const dip = screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h });
        return { x: dip.x, y: dip.y, w: dip.width, h: dip.height };
      }));
    }
  }

  /* one display's window; toGlobal maps a helper rect to global DIP */
  pane(bounds, request, toGlobal) {
    const win = new BrowserWindow({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      transparent: true, frame: false, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, type: 'toolbar', hasShadow: false, show: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: path.join(__dirname, 'overlay', 'preload.js'),
        contextIsolation: true, sandbox: true, offscreen: !!this.o.offscreen,
      },
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    const pane = { win, bounds, request, toGlobal, words: [] };
    win.webContents.on('did-finish-load', () => this.paint(pane));
    win.loadFile(path.join(__dirname, 'overlay', 'index.html'));
    if (!this.o.offscreen) win.once('ready-to-show', () => win.showInactive());
    return pane;
  }

  async tick() {
    if (!this.running) return;
    try {
      // a locked screen shows nothing worth reading
      const locked = !this.o.picture && powerMonitor.getSystemIdleState(60) === 'locked';
      if (!locked) {
        for (const p of this.panes.slice()) {
          const r = await this.o.ocr().request('screen', Object.assign({ incremental: true }, p.request));
          if (!r.changed || !this.running) continue;
          const HZ = this.o.HZ();
          p.words = [];
          for (const line of repair(r.lines, HZ).lines) {
            for (const w of wordsOf(line, HZ)) p.words.push(Object.assign(w, p.toGlobal(w)));
          }
          const bars = this.paint(p);
          this.log(`read ${JSON.stringify(p.request)}: ${r.lines.length} lines, ${p.words.length} words, ` +
            `${bars.length} bars, ${r.ms.total} ms`);
        }
      }
    } catch (e) {
      this.log('overlay: ' + e.message);
    }
    if (this.running) this.timer = setTimeout(() => this.tick(), this.o.settings().interval);
  }

  /* send one window the bars for its words, as its settings and statuses say */
  paint(p) {
    if (p.win.isDestroyed()) return [];
    const { show } = this.o.settings();
    const status = this.o.status(), HZ = this.o.HZ(), ex = this.o.exclude();
    const bars = [];
    for (const w of p.words) {
      const s = stateOf(w.text, status, HZ);
      if (!s || !show[s]) continue;
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      if (ex && cx >= ex.x && cx < ex.x + ex.width && cy >= ex.y && cy < ex.y + ex.height) continue;
      bars.push({ x: w.x - p.bounds.x, y: w.y - p.bounds.y, w: w.w, h: w.h, s });
    }
    p.win.webContents.send('bars', bars);
    return bars;
  }

  repaint() { for (const p of this.panes) this.paint(p); }
}

module.exports = { Overlays };
