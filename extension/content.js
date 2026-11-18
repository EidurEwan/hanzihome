/* content.js — HanziHome on every page: the desktop app's screen reader, in the browser.
 *
 * The desktop app reads the screen (or asks the program in front for its text) and
 * draws over it. A page already is text, so this takes it from the page itself:
 *
 *  - Colour. The page's text is taken a block at a time (a paragraph, a list item, a
 *    cell: an element and the inline elements inside it), split into words by the
 *    reader's engine in background.js, and each word gets a coloured underline: green
 *    learned, blue learning, red new (the reader's wordState() rules). The underlines
 *    are CSS Custom Highlights, so the page's own elements are never touched. New and
 *    changed text is read again as it appears (a MutationObserver).
 *
 *  - Look-up. Hold the look-up key (Ctrl unless changed; on its own, so Ctrl+C never
 *    opens anything) and point at a word: the reader's word popup appears under it,
 *    glossed in the context of its sentence, with the buttons to mark its characters,
 *    mark the word, add it to your lessons (with its sentence as the example) and open
 *    a character's page. Let go and it stays while the pointer is on the word or the
 *    popup; a safe triangle from the word to the popup keeps it while the pointer
 *    crosses the words between them, as in the desktop app (desktop/src/hover.js).
 *
 * Progress is the HanziHome site's (see background.js): the statuses arrive in
 * chrome.storage, and a change made here recolours every open page at once. */

(() => {
  'use strict';
  if (window.__hanzihomeReader) return;
  window.__hanzihomeReader = true;
  if (!document.documentElement || !(window.CSS && CSS.highlights && window.Highlight)) return;

  const api = typeof browser !== 'undefined' ? browser : chrome;

  const HAN = /[㐀-鿿\ud840-\udbbf]/;
  const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
  // elements that only style a run of text: their text belongs to the block around them
  const INLINE = new Set(('A ABBR B BDI BDO BIG CITE CODE DATA DEL DFN EM FONT I INS KBD LABEL MARK Q RUBY RB S ' +
    'SAMP SMALL SPAN STRIKE STRONG SUB SUP TIME TT U VAR WBR NOBR').split(' '));
  // nothing to read in these (RT: the pinyin over ruby text)
  const SKIP = new Set('SCRIPT STYLE NOSCRIPT TEMPLATE TEXTAREA INPUT SELECT OPTION RT RP SVG MATH IFRAME HANZIHOME-POPUP'.split(' '));
  const KEYS = { ctrl: 'Control', alt: 'Alt', shift: 'Shift' };
  const MAX_BLOCK = 30000;   // characters of one block read at once
  const HOLD = 150;          // ms the key is held alone before looking
  const POLL = 60;           // ms between pointer checks
  const LEAVE = 400;         // ms off the word and the popup before it closes
  const AIM = 600;           // ms the safe triangle lasts after the pointer leaves the word
  const SLACK = 6;           // px the triangle's base reaches past the popup's sides

  let settings = { on: true, show: { learned: true, learning: true, new: true }, key: 'ctrl', paused: [] };
  let store = { status: {}, wstatus: {}, items: {} };
  // turned off for this site: neither colours nor look-ups; colours off: look-ups still work
  const here = () => !(settings.paused || []).includes(location.hostname);
  const active = () => settings.on && here();

  const send = m => new Promise(res => {
    try {
      api.runtime.sendMessage(m, r => {
        void (api.runtime.lastError);
        res(r && r.ok ? r.r : null);
      });
    } catch (e) { res(null); }   // the extension was reloaded: this page's script is orphaned
  });

  /* ------------------------------------------------------------ blocks */

  // element -> {el, nodes, starts, text, words, ranges}
  const blocks = new Map();
  const nodeBlock = new WeakMap();
  const cache = new Map();   // block text -> its words, from the background

  function blockOf(el) {
    while (el && INLINE.has(el.tagName) && el.parentElement) el = el.parentElement;
    return el;
  }

  /* the text of a subtree, grouped into blocks (those with some Chinese) */
  function collect(root) {
    const found = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeType === 1
        ? (SKIP.has(n.tagName) || n.isContentEditable && n.contentEditable === 'true' && n !== root
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)
        : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = blockOf(n.parentElement);
      if (!el) continue;
      let b = found.get(el);
      if (!b) found.set(el, b = { el, nodes: [], han: false });
      b.nodes.push(n);
      if (!b.han && HAN.test(n.data)) b.han = true;
    }
    const out = [];
    for (const b of found.values()) {
      if (!b.han) continue;
      const starts = [];
      let text = '';
      for (const n of b.nodes) { starts.push(text.length); text += n.data; }
      if (text.length > MAX_BLOCK) text = text.slice(0, MAX_BLOCK);
      out.push({ el: b.el, nodes: b.nodes, starts, text, words: null, ranges: null });
    }
    return out;
  }

  /* read a subtree (again): forget the blocks in it, collect them, get their words */
  async function read(root) {
    for (const el of blocks.keys()) if (el === root || root.contains(el) || !el.isConnected) forget(el);
    const found = collect(root);
    for (const b of found) {
      blocks.set(b.el, b);
      for (const n of b.nodes) nodeBlock.set(n, b);
    }
    const todo = [...new Set(found.map(b => b.text).filter(t => !cache.has(t)))];
    for (let i = 0; i < todo.length; i += 150) {
      const part = todo.slice(i, i + 150);
      const r = await send({ t: 'words', blocks: part });
      if (!r) return;
      if (cache.size > 20000) cache.clear();
      part.forEach((t, j) => cache.set(t, r[j]));
      paintSoon();
    }
    paintSoon();
  }

  function forget(el) {
    const b = blocks.get(el);
    if (!b) return;
    blocks.delete(el);
  }

  /* a block's offset -> [text node, offset in it] */
  function locate(b, off) {
    let lo = 0, hi = b.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (b.starts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    // an offset at a node's very end is the start of the next one
    while (lo < b.nodes.length - 1 && off - b.starts[lo] >= b.nodes[lo].data.length) lo++;
    return [b.nodes[lo], off - b.starts[lo]];
  }

  function rangeOf(b, w) {
    try {
      const r = document.createRange();
      const [sn, so] = locate(b, w[0]);
      const [en, eo] = locate(b, w[1] - 1);
      r.setStart(sn, so);
      r.setEnd(en, eo + (en.data.codePointAt(eo) > 0xffff ? 2 : 1));
      return r;
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------ colour */

  /* a word's colour, as the reader's wordState(): learned, learning, new (or null) */
  function stateOf(w) {
    const cs = [...w[3]];
    if (!cs.length) return null;
    if (cs.length > 1) { const own = store.wstatus[w[2]]; if (own) return own; }
    if (cs.every(c => store.status[c] === 'learned')) return 'learned';
    if (cs.some(c => store.status[c])) return 'learning';
    return 'new';
  }

  let painting = 0;
  function paintSoon() {
    if (!painting) painting = requestAnimationFrame(() => { painting = 0; paint(); });
  }

  function paint() {
    if (!active()) {
      for (const k of ['learned', 'learning', 'new']) CSS.highlights.delete('hz-' + k);
      return;
    }
    const sets = { learned: [], learning: [], new: [] };
    for (const b of blocks.values()) {
      if (!b.words) b.words = cache.get(b.text) || null;
      if (!b.words) continue;
      if (!b.ranges) b.ranges = b.words.map(w => rangeOf(b, w));
      b.words.forEach((w, i) => {
        const s = stateOf(w);
        if (s && settings.show[s] && b.ranges[i]) sets[s].push(b.ranges[i]);
      });
    }
    for (const [k, ranges] of Object.entries(sets)) {
      if (ranges.length) CSS.highlights.set('hz-' + k, new Highlight(...ranges));
      else CSS.highlights.delete('hz-' + k);
    }
  }

  /* ------------------------------------------------------- page changes */

  const dirty = new Set();
  let dirtyTimer = 0;
  const observer = new MutationObserver(ms => {
    for (const m of ms) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!t || (host && (t === host || host.contains(t)))) continue;
      dirty.add(t);
    }
    if (dirty.size && !dirtyTimer) dirtyTimer = setTimeout(readDirty, 300);
  });

  function readDirty() {
    dirtyTimer = 0;
    let roots = [...dirty].filter(el => el.isConnected).map(blockOf);
    dirty.clear();
    roots = [...new Set(roots)];
    roots = roots.filter(r => !roots.some(o => o !== r && o.contains(r)));
    for (const r of roots) read(r);
    for (const el of blocks.keys()) if (!el.isConnected) forget(el);
    paintSoon();
  }

  /* ------------------------------------------------------------ look-up */

  let host = null, shadow = null, pop = null;
  let look = null;           // {b, w, rects, gloss}
  let pointer = { x: -1, y: -1 };
  let down = false, alone = false, since = 0, timer = 0, busy = false, away = 0, apex = null;

  const inRect = (r, p, pad = 0) => p.x >= r.left - pad && p.x < r.right + pad && p.y >= r.top - pad && p.y < r.bottom + pad;
  const onWord = (p, pad) => look && look.rects.some(r => inRect(r, p, pad));
  function inTriangle(p, a, b, c) {
    const side = (u, v) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
    const d1 = side(a, b), d2 = side(b, c), d3 = side(c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }
  const visible = () => !!(host && host.isConnected && host.style.display !== 'none');

  addEventListener('mousemove', e => { pointer = { x: e.clientX, y: e.clientY }; }, { capture: true, passive: true });
  addEventListener('keydown', e => {
    if (e.key !== KEYS[settings.key]) {
      if (down) alone = false;               // a shortcut, not a look-up
      if (e.key === 'Escape') hide();
      return;
    }
    if (e.repeat || down || !here()) return;
    down = true; alone = true; since = Date.now();
    loop();
  }, true);
  addEventListener('keyup', e => { if (e.key === KEYS[settings.key]) down = false; }, true);
  addEventListener('blur', () => { down = false; });
  addEventListener('scroll', () => { if (visible() && !down) hide(); }, { capture: true, passive: true });

  function loop() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { await step(); } catch (e) { /* keep going */ }
      if (down || visible()) loop();
    }, POLL);
  }

  async function step() {
    const pt = pointer;
    if (visible() && inRect(host.getBoundingClientRect(), pt)) { away = 0; apex = null; return; }
    if (visible() && heading(pt)) { away = 0; return; }
    if (down && alone && Date.now() - since >= HOLD) {
      if (look && onWord(pt, 2)) { apex = { x: pt.x, y: pt.y, t: Date.now() }; return; }
      await lookAt(pt);
      return;
    }
    // let go: stay while the pointer is on the word or the popup
    if (visible()) {
      if (onWord(pt, 8)) { away = 0; apex = { x: pt.x, y: pt.y, t: Date.now() }; return; }
      away += POLL;
      if (away >= LEAVE) hide();
    }
  }

  /* is the pointer on its way from the word to the popup? */
  function heading(pt) {
    const a = apex;
    if (!a || Date.now() - a.t > AIM) return false;
    const b = host.getBoundingClientRect();
    const y = b.top >= a.y ? b.top : b.bottom;
    return inTriangle(pt, a, { x: b.left - SLACK, y }, { x: b.right + SLACK, y });
  }

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p ? [p.offsetNode, p.offset] : null;
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      return r ? [r.startContainer, r.startOffset] : null;
    }
    return null;
  }

  /* the word under a point: {b, w, range, rects}, or null */
  function wordAt(pt) {
    const hit = caretAt(pt.x, pt.y);
    if (!hit || !hit[0] || hit[0].nodeType !== 3) return null;
    const b = nodeBlock.get(hit[0]);
    if (!b || blocks.get(b.el) !== b || !b.words) return null;
    const i = b.starts[b.nodes.indexOf(hit[0])] + hit[1];
    // the caret falls on the nearer edge of a character: the word before it or after
    for (const k of b.words.keys()) {
      const w = b.words[k];
      if (w[1] < i || w[0] > i) continue;
      const range = (b.ranges && b.ranges[k]) || rangeOf(b, w);
      if (!range) continue;
      const rects = [...range.getClientRects()];
      if (rects.some(r => inRect(r, pt, 1))) return { b, w, range, rects };
    }
    return null;
  }

  async function lookAt(pt) {
    if (busy) return;
    busy = true;
    try {
      const hit = wordAt(pt);
      if (!hit) { hide(); return; }
      if (look && look.b === hit.b && look.w === hit.w) return;
      const gloss = await send({ t: 'gloss', text: hit.b.text, start: hit.w[0], end: hit.w[1] });
      if (!gloss) return;
      look = Object.assign(hit, { gloss });
      CSS.highlights.set('hz-look', new Highlight(hit.range));
      render();
    } finally { busy = false; }
  }

  function hide() {
    look = null; apex = null;
    CSS.highlights.delete('hz-look');
    if (host) host.style.display = 'none';
  }

  /* the sentence of the block that holds the word, for the lesson's example */
  function sentenceOf(b, w) {
    let a = w[0], z = w[1];
    while (a > 0 && !/[。！？!?；…\n]/.test(b.text[a - 1])) a--;
    while (z < b.text.length && !/[。！？!?；…\n]/.test(b.text[z])) z++;
    if (z < b.text.length) z++;
    return b.text.slice(a, z).trim().slice(0, 160);
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function popup() {
    if (host && host.isConnected) return;
    host = document.createElement('hanzihome-popup');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; left: 0; top: 0; display: none;';
    shadow = host.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      shadow.adoptedStyleSheets = [sheet];
    } catch (e) {
      const st = document.createElement('style');
      st.textContent = STYLE;
      shadow.append(st);
    }
    pop = document.createElement('div');
    pop.id = 'word-pop';
    shadow.append(pop);
    // the page never hears about clicks in the popup
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'dblclick'])
      host.addEventListener(t, e => e.stopPropagation());
    pop.addEventListener('click', onClick);
    document.documentElement.append(host);
  }

  /* the reader's word popup (site/app.js showWordPop, as desktop/src/popup draws it) */
  function render() {
    if (!look) return;
    popup();
    const { entry, chars, key } = look.gloss;
    const [w, p, d, parts, extra] = entry;
    const alt = (extra && extra.alt) || [];
    const han = [...w].filter(isHan);
    const multi = han.length > 1;
    const status = c => store.status[chars[c].s] || store.status[c] || '';
    const row = (c, i) => {
      const st = status(c);
      const [cp, cg] = parts[i] || ['', ''];
      const btn = (v, label, cls) =>
        `<button type="button" data-c="${esc(c)}" data-s="${v}"${st === v ? ' class="on ' + cls + '"' : ''}>${label}</button>`;
      const meaning = multi ? `<span class="wp-cm"><b>${esc(cp)}</b> ${esc(cg)}</span>` : '';
      return `<div class="wp-char${multi ? ' multi' : ''}">
        <a class="wp-c han" data-open="${esc(c)}" title="Open in HanziHome">${esc(c)}</a>
        <span class="wp-cbody">${meaning}${chars[c].known
          ? `<span class="seg3">${btn('', 'Not known', 'none')}${btn('learning', 'Learning', 'learning')}${btn('learned', 'Learned', 'learned')}</span>`
          : ''}</span></div>`;
    };
    const stage = store.items[key];
    const wstate = store.wstatus[key] || '';
    pop.innerHTML = `
      <div class="wp-head"><span class="han">${esc(w)}</span><b>${esc(p)}</b><span class="wp-d">${esc(d)}</span></div>
      ${alt.map(([ap, ad]) => `<p class="wp-alt">or: <b>${esc(ap)}</b> ${esc(ad)}</p>`).join('')}
      <p class="wp-learn">${stage ? `<span>✓ ${esc(stage)}</span>` : '<button type="button" data-learn>＋ Add to lessons</button>'}</p>
      ${multi ? `<div class="wp-word"><span class="wp-wl">The word</span><span class="seg3">${
        [['', 'Not known', 'none'], ['learning', 'Learning', 'learning'], ['learned', 'Learned', 'learned']].map(([v, label, cls]) =>
          `<button type="button" data-ws="${v}"${wstate === v ? ` class="on ${cls}"` : ''}>${label}</button>`).join('')}</span></div>` : ''}
      ${han.map((c, i) => han.indexOf(c) === i ? row(c, i) : '').join('')}`;
    place();
  }

  /* under the word, as in the reader; above it when there is no room below */
  function place() {
    host.style.display = 'block';
    const r = look.rects[0] || look.range.getBoundingClientRect();
    const W = document.documentElement.clientWidth || innerWidth, H = innerHeight;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const x = Math.max(4, Math.min(r.left, W - w - 4));
    let y = r.bottom + 8;
    if (y + h > H - 4) y = Math.max(4, r.top - h - 8);
    host.style.left = Math.round(x) + 'px';
    host.style.top = Math.round(y) + 'px';
    if (!down) loop();
  }

  function onClick(e) {
    if (!look) return;
    const { entry, key } = look.gloss;
    const ws = e.target.closest('button[data-ws]');
    if (ws) return send({ t: 'wmark', w: key, s: ws.dataset.ws || null });
    const b = e.target.closest('button[data-s]');
    if (b) return send({ t: 'mark', c: b.dataset.c, s: b.dataset.s || null });
    if (e.target.closest('button[data-learn]'))
      return send({ t: 'learn', w: entry[0], p: entry[1], d: entry[2], sentence: sentenceOf(look.b, look.w) });
    const a = e.target.closest('[data-open]');
    if (a) { send({ t: 'open', c: a.dataset.open }); hide(); }
  }

  /* -------------------------------------------------------- the toolbar */

  /* the page's text for the site's reader: the selection, or the part of the page with
     the most Chinese in it (as the site's Read in HanziHome bookmarklet chooses) */
  function pageText() {
    const s = String(getSelection()).trim();
    let best = document.body, n = 0;
    if (!s) {
      for (const e of document.querySelectorAll('article,main,[role=main],#content,.content,.article,.post')) {
        const k = (e.innerText.match(/[一-鿿]/g) || []).length;
        if (k > n) { n = k; best = e; }
      }
    }
    return { text: (s || (best ? best.innerText : '')).slice(0, 200000), title: document.title };
  }

  api.runtime.onMessage.addListener((m, sender, reply) => {
    if (m && m.t === 'pageText' && window === window.top) { reply(pageText()); return false; }
    if (m && m.t === 'stats' && window === window.top) {
      const c = { learned: 0, learning: 0, new: 0 };
      const seen = new Set();
      for (const b of blocks.values()) for (const w of b.words || []) {
        if (seen.has(w[2])) continue;
        seen.add(w[2]);
        const s = stateOf(w);
        if (s) c[s]++;
      }
      reply(c);
      return false;
    }
    return false;
  });

  /* ---------------------------------------------------------- settings */

  api.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings) {
      settings = Object.assign(settings, ch.settings.newValue || {});
      if (!here()) hide();
      else start();
    }
    if (ch.store && ch.store.newValue) {
      store = ch.store.newValue;
      if (look) render();
    }
    if (ch.settings || ch.store) paintSoon();
  });

  let started = false;
  function start() {
    if (started) return;
    started = true;
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.body) read(document.body);
  }

  api.storage.local.get(['settings', 'store'], r => {
    if (r.settings) settings = Object.assign(settings, r.settings);
    if (r.store) store = r.store;
    if (here()) start();
  });

  /* ------------------------------------------------------------- style */

  // the site's word popup (site/style.css: #word-pop, .wp-*, .seg3), light and dark
  const STYLE = `
    :host { all: initial; }
    #word-pop {
      --panel: #ffffff; --panel-2: #ebe8e1; --ink: #222222; --ink-2: #6b6b6b; --ink-3: #73716d;
      --line: #e6e2d9; --line-2: #dcd8cf; --accent: #8a6c00; --blue: #3a78e6; --green: #2da779;
      --han: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Source Han Sans SC", sans-serif;
      box-sizing: border-box; width: max-content; min-width: 230px; max-width: min(360px, calc(100vw - 16px));
      max-height: calc(100vh - 16px); overflow: auto;
      background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 16px;
      box-shadow: 0 1px 0 rgba(0,0,0,.06), 0 18px 40px -16px rgba(0,0,0,.3), 0 6px 20px rgba(17,24,39,.16);
      padding: 10px 12px; font: 400 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      text-align: left; letter-spacing: normal;
    }
    @media (prefers-color-scheme: dark) {
      #word-pop { --panel: #2c2c2c; --panel-2: #181818; --ink: #ffffff; --ink-2: #adadad; --ink-3: #8a8a8a;
        --line: #3a3a3a; --line-2: #4a4a4a; --accent: #fde24d; --blue: #6aa2ff; --green: #42f4b0; }
    }
    * { box-sizing: border-box; }
    p { margin: 0; }
    .han { font-family: var(--han); }
    .wp-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 9px; margin-bottom: 8px; }
    .wp-head .han { font-size: 21px; font-weight: 700; }
    .wp-head b { color: var(--accent); font-size: 13.5px; }
    .wp-head .wp-d { color: var(--ink-2); font-size: 13px; }
    .wp-alt { margin: -4px 0 8px; font-size: 12.5px; color: var(--ink-3); }
    .wp-alt b { color: var(--ink-2); font-weight: 700; }
    .wp-learn { margin: 0 0 6px; }
    .wp-learn button { border: 1px solid var(--line-2); background: var(--panel); color: var(--ink); border-radius: 999px;
      padding: 3px 10px; font: 600 12.5px/1.4 inherit; font-family: inherit; cursor: pointer; }
    .wp-learn button:hover { background: var(--panel-2); }
    .wp-learn span { font-size: 12.5px; font-weight: 700; color: var(--accent); }
    .wp-word { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0;
      border-bottom: 1px solid var(--line); margin-bottom: 4px; }
    .wp-wl { font-size: 11.5px; font-weight: 700; color: var(--ink-2); }
    .wp-char { display: flex; align-items: center; gap: 10px; padding: 3px 0; }
    .wp-char.multi { align-items: flex-start; padding: 6px 0; border-top: 1px solid var(--line); }
    .wp-word + .wp-char.multi { border-top: 0; }
    .wp-c { font-size: 19px; width: 24px; text-align: center; color: var(--ink); cursor: pointer; text-decoration: none; }
    .wp-c:hover { color: var(--accent); }
    .wp-char.multi .wp-c { font-size: 21px; line-height: 1.2; margin-top: 1px; }
    .wp-cbody { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .wp-cm { font-size: 12.5px; color: var(--ink-2); line-height: 1.35; }
    .wp-cm b { color: var(--accent); font-weight: 700; margin-right: 3px; }
    .seg3 { display: flex; gap: 4px; }
    .seg3 button { border: 1px solid transparent; background: none; border-radius: 999px; padding: 3px 9px;
      font: 600 11.5px/1.4 inherit; font-family: inherit; color: var(--ink-2); cursor: pointer; white-space: nowrap; }
    .seg3 button:hover { background: var(--panel-2); }
    .seg3 button.on.none { background: var(--panel-2); color: var(--ink); }
    .seg3 button.on.learning { background: var(--blue); border-color: var(--blue); color: #fff; }
    .seg3 button.on.learned { background: var(--green); border-color: var(--green); color: #fff; }
  `;
})();
