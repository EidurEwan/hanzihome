/* background.js — the extension's dictionary, and its copy of your progress.
 *
 * It holds the reader's engine and data (site/textstory.js with index, readings
 * and readerwords: copied into hz/ by build.js), so a page's content script
 * (content.js) needs none of the ~11 MB itself: it sends the page's text and gets
 * back the words, with what each needs to be coloured, and a word's glossary
 * entry when it is looked up.
 *
 * Progress belongs to the HanziHome site, as in the desktop app. bridge.js, on a
 * HanziHome tab, hands this a copy of the site's store (only what colouring and
 * the popup need: statuses, word statuses, lesson stages), kept in
 * chrome.storage.local as `store`. Marking a character, marking a word or adding
 * it to the lessons from the popup changes that copy at once (so the page
 * recolours) and is queued (`queue`) until a HanziHome tab is open, whose page
 * makes the change itself, as its own buttons would, and syncs it as usual.
 *
 * In Chrome this is a service worker and loads the data with importScripts; in
 * Firefox an event page that has the same files listed before it in the manifest. */

'use strict';

if (typeof importScripts === 'function' && typeof TextStory === 'undefined') {
  importScripts('hz-init.js', 'hz/index.js', 'hz/readings.js', 'hz/readerwords.js',
    'hz/textstory.js', 'hz/learn.js');
}

const api = typeof browser !== 'undefined' ? browser : chrome;
const SITE = 'https://eidurewan.github.io/hanzihome/';
const DEFAULTS = { on: true, show: { learned: true, learning: true, new: true }, key: 'ctrl', paused: [] };

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const simp = c => (HZ.t2s || {})[c] || c;
const known = c => !!(HZ.index[c] || HZ.index[simp(c)]);
/* the key a word is kept under in the store, as the site's learnKey() makes it */
const learnKey = w => (HZ.rwordsT2S || {})[w] || [...w].map(simp).join('');

/* ------------------------------------------------------------ the words */

/* a block of a page's text -> its Chinese words, [start, end, key, chars]: offsets in
   UTF-16 units (as the DOM counts), the word's key in the store, and its characters
   the site knows, simplified (what the colour is worked out from: words.js stateOf) */
function wordsOf(text) {
  const t = text.replace(/[\r\n\u2028\u2029]/g, ' ');
  const toks = TextStory.segment(t, HZ)[0] || [];
  const out = [];
  let pos = 0;
  for (const tok of toks) {
    const s = typeof tok === 'string' ? tok : tok.s;
    if (t.startsWith(s, pos)) { /* where it should be */ } else {
      const at = t.indexOf(s, pos);
      if (at < 0) break;
      pos = at;
    }
    if (typeof tok === 'string') {
      const cs = [...tok].filter(c => isHan(c) && known(c)).map(simp).join('');
      if (cs) out.push([pos, pos + s.length, learnKey(tok), cs]);
    }
    pos += s.length;
  }
  return out;
}

/* the glossary entry of the word at [start, end) of a block, as the reader would give
   it in that context (textToStory on the text around it), and what the popup needs
   to draw its rows */
function glossAt(text, start, end) {
  const word = text.slice(start, end);
  const a = Math.max(0, start - 160), b = Math.min(text.length, end + 160);
  const t = text.slice(a, b).replace(/[\r\n\u2028\u2029]/g, ' ');
  let entry = null;
  try {
    const st = TextStory.textToStory(t, HZ);
    let pos = a;
    for (const row of st.seg) {
      for (const k of row) {
        if (typeof k === 'string') {
          const e = st.g[k];
          if (pos === start && e[0] === word) entry = e;
          pos += e[0].length;
        } else if (k && typeof k.s === 'string') pos += k.s.length;
      }
    }
  } catch (e) { /* glossed alone below */ }
  if (!entry) {
    const alone = TextStory.textToStory(word, HZ);
    entry = alone.g[Object.keys(alone.g)[0]];
  }
  if (!entry) return null;
  const chars = {};
  for (const c of [...entry[0]].filter(isHan)) chars[c] = { s: simp(c), known: known(c) };
  return { entry, chars, key: learnKey(entry[0]) };
}

/* ------------------------------------------------------- the store copy */

const get = keys => api.storage.local.get(keys);
const set = o => api.storage.local.set(o);

/* the site's store (bridge.js sends what it needs) -> the copy kept here */
function compact(d) {
  const items = {};
  for (const [k, stage] of Object.entries(d.items || {})) items[k] = stage ? Learn.stageName(stage) : 'In lessons';
  return { status: d.status || {}, wstatus: d.wstatus || {}, items };
}

/* make a queued change in the copy, as the site will make it */
function applyTo(store, op) {
  if (op.t === 'mark') { if (op.s) store.status[op.c] = op.s; else delete store.status[op.c]; }
  else if (op.t === 'wmark') { if (op.s) store.wstatus[op.w] = op.s; else delete store.wstatus[op.w]; }
  else if (op.t === 'learn') { const k = learnKey(op.w); if (!store.items[k]) store.items[k] = 'In lessons'; }
}

let chain = Promise.resolve();
/* one change to the stored state at a time: fn(state) changes it, gets saved */
function update(fn) {
  const run = chain.then(async () => {
    const st = await get(['store', 'queue', 'bridges']);
    st.store = st.store || { status: {}, wstatus: {}, items: {} };
    st.queue = st.queue || [];
    st.bridges = st.bridges || [];
    const out = await fn(st);
    await set({ store: st.store, queue: st.queue, bridges: st.bridges });
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

/* a change from the popup: into the copy now, and to the site when it's open */
async function enqueue(op) {
  op.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const store = await update(st => { st.queue.push(op); applyTo(st.store, op); return st.store; });
  nudge();
  return store;
}

/* tell the HanziHome tabs there is something to do (the first to claim it does it) */
async function nudge() {
  const { bridges = [] } = await get('bridges');
  for (const id of bridges) {
    api.tabs.sendMessage(id, { t: 'flush' }).catch(() =>
      update(st => { st.bridges = st.bridges.filter(x => x !== id); }));
  }
}

async function settings() {
  const { settings: s } = await get('settings');
  return Object.assign({}, DEFAULTS, s || {}, { show: Object.assign({}, DEFAULTS.show, (s || {}).show) });
}

async function site() {
  const { site: s } = await get('site');
  return s || SITE;
}

async function openSite(hash) {
  return api.tabs.create({ url: (await site()) + (hash || '') });
}

/* send text to the site's reader: kept until a HanziHome page takes it */
async function readInSite(text, title) {
  if (!text || !text.trim()) return;
  await set({ read: { text: text.slice(0, 200000), title: String(title || '').slice(0, 80) } });
  await openSite('#/reader');
}

/* ------------------------------------------------------------ messages */

const handlers = {
  words: m => m.blocks.map(wordsOf),
  gloss: m => glossAt(m.text, m.start, m.end),
  mark: m => enqueue({ t: 'mark', c: simp(m.c), s: m.s || null }),
  wmark: m => enqueue({ t: 'wmark', w: m.w, s: m.s || null }),
  learn: m => enqueue({ t: 'learn', w: m.w, p: m.p, d: m.d, sentence: m.sentence }),
  open: m => openSite('#/character/' + encodeURIComponent(simp(m.c))),
  openSite: () => openSite(''),
  read: m => readInSite(m.text, m.title),

  // from bridge.js, on a HanziHome tab
  store: (m, sender) => update(st => {
    st.store = compact(m.data);
    for (const op of st.queue) applyTo(st.store, op);
    if (sender.tab && !st.bridges.includes(sender.tab.id)) st.bridges.push(sender.tab.id);
  }).then(() => m.site && set({ site: m.site, storeAt: Date.now() })),
  claim: async () => {
    const now = Date.now();
    const ops = await update(st => {
      const free = st.queue.filter(op => !op.sent || now - op.sent > 15000);
      for (const op of free) op.sent = now;
      return free.map(({ sent, ...op }) => op);
    });
    const { read } = await get('read');
    if (read) await api.storage.local.remove('read');
    return { ops, read: read || null };
  },
  applied: m => update(st => { st.queue = st.queue.filter(op => !m.ids.includes(op.id)); }),
};

api.runtime.onMessage.addListener((m, sender, reply) => {
  const h = m && handlers[m.t];
  if (!h) return false;
  Promise.resolve().then(() => h(m, sender))
    .then(r => reply({ ok: true, r }), e => reply({ ok: false, error: String(e && e.message || e) }));
  return true;
});

api.tabs.onRemoved.addListener(id => update(st => { st.bridges = st.bridges.filter(x => x !== id); }));

/* ---------------------------------------------------------- the menus */

api.runtime.onInstalled.addListener(async () => {
  if (!(await get('settings')).settings) await set({ settings: DEFAULTS });
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({ id: 'read-sel', title: 'Read “%s” in HanziHome', contexts: ['selection'] });
    api.contextMenus.create({ id: 'read-page', title: 'Read this page in HanziHome', contexts: ['page'] });
  });
});

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'read-sel') return readInSite(info.selectionText, tab && tab.title);
  if (info.menuItemId === 'read-page' && tab) {
    try {
      const r = await api.tabs.sendMessage(tab.id, { t: 'pageText' }, { frameId: 0 });
      if (r) readInSite(r.text, r.title);
    } catch (e) { /* no content script on this page (a browser page) */ }
  }
});

// for the tests and the toolbar popup
self.HZX = { wordsOf, glossAt, settings };
