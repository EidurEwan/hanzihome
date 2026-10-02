/* HanziHome — static build.
 *
 * No server: data files are loaded by injecting <script> tags, and routing is
 * hash-based, so everything works when index.html is opened from disk.
 * All personal state (learned characters, lists, notes, review scheduling)
 * lives in localStorage. */

'use strict';

const app = document.getElementById('app');
const GOAL_DEFAULT = 3500;

/* ============================ utilities ============================ */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const num = n => (n == null ? '' : n.toLocaleString());
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const bucketOf = ch => ('0' + (ch.codePointAt(0) % (HZ.meta.buckets || 64)).toString(16)).slice(-2);
const glossOf = c => HZ.radicalMap[c] || '';
const today = () => new Date().toISOString().slice(0, 10);
/* no hover on this device: menus that open on hover must open on tap instead */
const isTouch = () => matchMedia('(hover: none)').matches;

/* Bump whenever the build rewrites site/data, so browsers stop serving the old copy.
   index.html carries the same number on the data scripts it loads itself. */
const DATA_VERSION = 6;

const _loading = {};
function loadScript(src) {
  if (_loading[src]) return _loading[src];
  _loading[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src + '?v=' + DATA_VERSION;
    s.onload = () => res(true);
    s.onerror = () => rej(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
  return _loading[src];
}

/* A rejected script load used to leave the page blank, because the page
   functions are async and nothing caught the rejection. Surface it instead. */
function loadFailure(detail) {
  const where = location.protocol === 'file:'
    ? 'The page is open directly from disk. Most browsers allow this, but if yours '
      + 'blocks local file access the data files cannot load.'
    : 'A data file could not be fetched.';
  app.innerHTML = '<div class="card"><h1>Could not load the data</h1>'
    + '<p class="muted">' + esc(where) + '</p>'
    + (detail ? '<p class="small muted">' + esc(detail) + '</p>' : '')
    + '<p class="small muted">Serving the folder locally always works: run'
    + ' <code>python -m http.server 8899</code> inside the <code>site</code> folder'
    + ' and open <code>http://localhost:8899</code>.</p></div>';
}
window.addEventListener('unhandledrejection', e => {
  const m = (e.reason && e.reason.message) || String(e.reason || '');
  e.preventDefault();
  if (m.indexOf('could not load') === 0) loadFailure(m);
  else {
    console.error(e.reason);
    app.innerHTML = '<div class="card"><h1>Something went wrong</h1>'
      + '<p class="muted">' + esc(m) + '</p>'
      + '<p class="small muted">Reload the page; if it keeps happening this is a bug.</p></div>';
  }
});

/* optional data: degrade rather than break the page */
const optional = p => p.catch(e => { console.warn(e); return null; });

async function charData(ch) {
  const b = bucketOf(ch);
  if (!HZ.chunk[b]) { try { await loadScript('data/c/' + b + '.js'); } catch (e) { return null; } }
  return (HZ.chunk[b] || {})[ch] || null;
}
/* how to write a character, stroke by stroke (site/data/s/, build/export_strokes.js):
   [strokes, medians, radStrokes], or null for the few characters it doesn't cover */
const strokeCount = ch => { const b = HZ.strokes[bucketOf(ch)]; return b && b[ch] ? b[ch][0].length : 0; };
async function strokeData(ch) {
  const b = bucketOf(ch);
  if (!HZ.strokes[b]) { try { await loadScript('data/s/' + b + '.js'); } catch (e) { return null; } }
  return (HZ.strokes[b] || {})[ch] || null;
}

const need = {
  writer: () => window.HanziWriter ? Promise.resolve() : loadScript('vendor/hanzi-writer.min.js'),
  comps: () => HZ.comps ? Promise.resolve() : loadScript('data/comps.js'),
  words: () => HZ.words ? Promise.resolve() : loadScript('data/words.js'),
  hsk: () => HZ.hsk ? Promise.resolve() : loadScript('data/hsk.js'),
  hskChars: () => HZ.hskChars ? Promise.resolve() : loadScript('data/hskchars.js'),
  radicals: () => HZ.radicals ? Promise.resolve() : loadScript('data/radicals.js'),
  components: () => HZ.productiveComponents ? Promise.resolve() : loadScript('data/components.js'),
  prodchars: () => HZ.productiveCharacters ? Promise.resolve() : loadScript('data/prodchars.js'),
  phon: d => HZ.phoneticSets[d] ? Promise.resolve() : loadScript('data/phon' + d + '.js'),
  stories: () => HZ.stories ? Promise.resolve() : loadScript('data/stories.js'),
  // the reader for pasted text: the engine, every character's readings, and the
  // word list with frequencies (~9 MB, so only when someone reads their own text)
  textStory: () => Promise.all([
    window.TextStory ? null : loadScript('textstory.js'),
    HZ.readings ? null : loadScript('data/readings.js'),
    HZ.rwords ? null : loadScript('data/readerwords.js'),
  ]),
};

let _byRank = null;
function byRank() {
  if (!_byRank) {
    _byRank = Object.keys(HZ.index).filter(c => HZ.index[c][0]);
    _byRank.sort((a, b) => HZ.index[a][0] - HZ.index[b][0]);
  }
  return _byRank;
}

/* ============================ store ============================ */

const Store = {
  key: 'hanzicraft.v2',
  data: null,
  load() {
    if (this.data) return this.data;
    let d = {};
    try { d = JSON.parse(localStorage.getItem(this.key) || '{}'); } catch (e) { d = {}; }
    d.status = d.status || {}; d.comps = d.comps || {}; d.lists = d.lists || [];
    d.notes = d.notes || {}; d.history = d.history || []; d.items = d.items || {};
    d.days = d.days || {}; d.goal = d.goal || GOAL_DEFAULT; d.study = d.study || {};
    // The old Study flashcards (srs) gave way to lessons and reviews: a character
    // that was marked Learning joins the reviews at Novice I, due when it was due.
    for (const c of Object.keys(d.srs || {})) {
      if (d.status[c] === 'learning' && !d.items[c]) {
        const e = HZ.index[c] || [], now = Date.now();
        const it = Learn.finishLesson(Learn.newItem('char', { pin: e[2] || '', mean: e[3] || '' }, now), now);
        it.due = Math.min(d.srs[c].due || now, now);
        d.items[c] = it;
      }
    }
    d.srs = {};
    // items reviewed before FSRS: a stability from the stage they had reached
    for (const it of Object.values(d.items)) Learn.adopt(it);
    // Characters marked Learned are in the reviews too, from Journeyman I. The ones
    // that aren't yet (from before, or from a device that didn't do this) get their
    // first reviews spread over the next month, most common first, 20 a day at most.
    const known = Object.keys(d.status).filter(c => d.status[c] === 'learned' && !d.items[c] && HZ.index[c]);
    if (known.length) {
      const now = Date.now(), rank = c => HZ.index[c][0] || 1e9;
      const span = Math.max(30, Math.ceil(known.length / 20)) * Learn.DAY;
      known.sort((a, b) => rank(a) - rank(b)).forEach((c, i) => {
        d.items[c] = Learn.known('char', charInfo(c), now, Math.round(span * i / known.length));
      });
    }
    this.data = d;
    return d;
  },
  save() {
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); }
    catch (e) { console.warn('could not save', e); }
    Sync.markDirty();
    tellDesktop();
  },
  touch() { const d = this.load(); d.days[today()] = (d.days[today()] || 0) + 1; this.save(); },

  status(ch) { return this.load().status[ch] || null; },
  setStatus(ch, s) {
    const d = this.load();
    if (s) d.status[ch] = s; else delete d.status[ch];
    // marked learned: in the reviews at Journeyman I, first review a month on
    if (s === 'learned' && HZ.index[ch]) {
      const it = d.items[ch], now = Date.now(), wait = Learn.STAGES[Learn.LEARNED_FROM][1] * Learn.DAY;
      if (!it) d.items[ch] = Learn.known('char', charInfo(ch), now, wait);
      else if (it.stage < Learn.LEARNED_FROM) {
        // said to be known: a month's stability at least, first checked in a month
        Learn.adopt(it);
        it.S = Math.max(it.S || 0, Learn.STAGES[Learn.LEARNED_FROM][1]);
        it.D = it.D || Learn.initD(3);
        it.stage = Learn.stageFor(it.S);
        it.due = now + wait;
        if (!it.learnt) it.joined = now;
      }
    }
    this.touch();
  },
  chars(s) { const d = this.load(); return Object.keys(d.status).filter(c => d.status[c] === s); },

  compKnown(c) { const d = this.load(); return !!d.comps[c] || d.status[c] === 'learned'; },
  toggleComp(c) {
    const d = this.load();
    d.comps[c] ? delete d.comps[c] : (d.comps[c] = 1);
    this.touch();
    return !!d.comps[c];
  },
  knownComps() { return Object.keys(this.load().comps); },

  note(ch, t) { const d = this.load(); t && t.trim() ? (d.notes[ch] = t.trim()) : delete d.notes[ch]; this.save(); },

  visit(ch) {
    const d = this.load();
    d.history = d.history.filter(h => h.c !== ch);
    d.history.unshift({ c: ch, t: Date.now() });
    if (d.history.length > 500) d.history.length = 500;
    this.save();
  },
  addList(name) {
    const d = this.load();
    const l = { id: 'l' + Date.now().toString(36), name, chars: [] };
    d.lists.push(l); this.save(); return l;
  },
  listToggle(id, ch) {
    const d = this.load(), l = d.lists.find(x => x.id === id);
    if (!l) return false;
    const i = l.chars.indexOf(ch);
    i < 0 ? l.chars.push(ch) : l.chars.splice(i, 1);
    this.save();
    return i < 0;
  },
  // ---- lessons and reviews: characters and words you chose to learn (site/learn.js
  //      schedules them, site/study.js draws the pages) ----
  item(k) { return this.load().items[k] || null; },
  learnAdd(k, kind, info) {
    const d = this.load(), now = Date.now();
    if (!d.items[k]) {
      d.items[k] = Learn.newItem(kind, info, now);
      if (kind === 'char') rememberParts(k);
      // a word brings along the characters in it you don't know yet, prioritized
      // (Automatically prioritize characters, in HanziHero's settings)
      if (kind === 'word' && this.cfg().autoChars) {
        const syl = String(info.pin || '').split(/\s+/), written = [...((info.ex && info.ex.w) || k)];
        [...k].filter(isHan).forEach((c, i) => {
          if (!HZ.index[c] || d.items[c] || d.status[c] === 'learned') return;
          const it = d.items[c] = Learn.newItem('char', charInfo(c, syl[i]), now);
          it.prio = true;
          if (info.ex) it.ex = { text: info.ex.text, w: written.filter(isHan)[i] || c, t: info.ex.t };
          rememberParts(c);
        });
      }
    }
    this.touch();
    return d.items[k];
  },
  learnRemove(k) { delete this.load().items[k]; this.save(); },
  prioritize(k) {
    const it = this.item(k);
    if (!it) return;
    if (it.prio) delete it.prio; else it.prio = true;
    this.save();
  },
  /* after a lesson or review: a character's stage decides its status on the rest of the site */
  learnSaved(k) {
    const d = this.load(), it = d.items[k];
    if (it && it.kind === 'char') {
      const s = Learn.statusFor(it);
      if (s) d.status[k] = s;
    }
    this.touch();
  },
  /* the settings (HanziHero's), and what there is to study now under them */
  cfg() { return Learn.settings(this.load().study); },
  setCfg(patch) { Object.assign(this.load().study, patch); this.save(); },
  plan() { const d = this.load(); return Learn.plan(d.items, d.study, Date.now(), learnEnv()); },
  lessons() { return this.plan().lessons; },
  due() { const p = this.plan(); return p.reviews.slice(0, p.reviewsLeft); },
  /* vacation mode: nothing to study; coming back moves every review on by the time away */
  vacation(on) {
    const d = this.load(), now = Date.now();
    if (on) d.study.vacation = now;
    else if (d.study.vacation) { Learn.resume(d.items, d.study.vacation, now); d.study.vacation = 0; }
    this.save();
  },
};

/* Inside the desktop app (desktop/), its preload script provides
   window.hanzihomeDesktop; the app keeps a copy of the store for its screen
   overlay. In a browser this does nothing. */
function tellDesktop() {
  if (window.hanzihomeDesktop) window.hanzihomeDesktop.saved(JSON.stringify(Store.load()));
}

/* ============================ sync ============================
   Optional: keep the store in step across browsers through a Google Apps
   Script web app the user deploys to their own account (sync/Code.gs), which
   saves one copy in a Google Sheet.

   The script keeps a revision number. A push names the revision it was based
   on and is refused if someone else pushed first; the refusal carries the
   newer copy, which is merged in and pushed again. Merging is three-way
   against the copy from the last successful sync (the "base"), so a change
   made on one device and a different change made on another both survive,
   and removing something (a status, a list entry) is not undone by a device
   that still has it. When both sides changed the same item, this device wins.

   A change is pushed straight away (one request); only a refusal brings the
   sheet's copy back to merge. With nothing to push, a sync just asks for the
   revision (a few bytes) and fetches the copy only when it has moved on.
   A copy the sheet can't give whole (another device half-way through saving
   it, with the first scripts) is never taken for an empty one: nothing here
   changes, and the sync tries again a few seconds later.

   Nor may any copy replace or merge away most of this device's data without
   asking (shrinks()): an emptied copy from an older version of the site did
   exactly that. Syncing pauses (cfg.held) until you choose which to keep. A
   deliberate Reset everything says so (cfg.reset), and the script (version 5)
   refuses the same kind of upload from any device, and keeps earlier copies.

   A passphrase (script version 6) locks the script: set from Settings, kept here
   beside the URL and sent with every request. */

const REDEPLOY = 'Paste the current sync/Code.gs into the Apps Script editor, save, then Deploy → '
  + 'Manage deployments → Edit (pencil) → Version: New version → Deploy.';
const OLD_SCRIPT = 'Your deployment is still running the old script, which asks for a sync key. ' + REDEPLOY;
const SCRIPT_VERSION = 6;           // sync/Code.gs's VERSION

/* how much a copy of the store holds: statuses, review items, known components,
   notes and list entries */
function heft(d) {
  if (!d || typeof d !== 'object') return 0;
  const n = o => (o && typeof o === 'object' ? Object.keys(o).length : 0);
  const lists = Array.isArray(d.lists) ? d.lists.reduce((t, l) => t + ((l && l.chars) || []).length, 0) : 0;
  return n(d.status) + n(d.items) + n(d.comps) + n(d.notes) + lists;
}
/* would going from one copy to the other lose most of it? */
const shrinks = (from, to) => heft(from) >= 20 && heft(to) < heft(from) / 2;

const Sync = {
  cfgKey: 'hanzihome.sync',          // {url, key, rev, dirty, lastSync}
  baseKey: 'hanzihome.sync.base',    // the store as of the last successful sync
  timer: null, busy: null, again: false, error: '', lastRun: 0, retries: 0,

  cfg() { try { return JSON.parse(localStorage.getItem(this.cfgKey) || 'null'); } catch (e) { return null; } },
  setCfg(c) {
    try { c ? localStorage.setItem(this.cfgKey, JSON.stringify(c)) : localStorage.removeItem(this.cfgKey); }
    catch (e) { /* storage full or blocked: sync just stops */ }
  },
  update(fields) { const c = this.cfg(); if (c) this.setCfg(Object.assign(c, fields)); },
  on() { const c = this.cfg(); return !!(c && c.url); },
  base() { try { return JSON.parse(localStorage.getItem(this.baseKey) || 'null'); } catch (e) { return null; } },
  setBase(d) {
    try { d ? localStorage.setItem(this.baseKey, JSON.stringify(d)) : localStorage.removeItem(this.baseKey); }
    catch (e) { /* without a base the next merge is a plain union */ }
  },

  /* a local change: push a moment later, so a burst of clicks is one request */
  markDirty() {
    if (!this.on()) return;
    this.update({ dirty: true });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), 5000);
    this.paint();
  },

  /* soft: a refusal comes back as the reply instead of an error (for 'rev', which the
     first scripts don't know) */
  async post(body, cfg, soft) {
    const c = cfg || this.cfg();
    let res;
    try {
      // text/plain keeps this a "simple" request: Apps Script can't answer a CORS preflight
      res = await fetch(c.url, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(c.key ? Object.assign({ key: c.key }, body) : body),
      });
    } catch (e) {
      // Google's own error pages carry no CORS header, so a wrong URL, an access
      // setting other than Anyone, and a script that crashes all end up here
      const err = new Error(await this.diagnose(c.url));
      err.code = 'unreachable';
      throw err;
    }
    if (!res.ok) throw new Error(`The script answered with an error (HTTP ${res.status}).`);
    let j;
    try { j = await res.json(); }
    catch (e) { throw new Error("That URL didn't answer like the HanziHome script. Use the web app URL ending in /exec."); }
    if (!j.ok && /^(locked|wrong-passphrase|slow-down)$/.test(j.error)) {
      const err = new Error({
        'locked': 'This sync is locked with a passphrase, and this device needs it.',
        'wrong-passphrase': "That passphrase doesn't match the one this sync is locked with.",
        'slow-down': `Too many wrong passphrases: the script refuses everything for ${j.minutes || 15} minutes.`,
      }[j.error]);
      err.code = 'locked';
      throw err;
    }
    if (typeof j.locked === 'boolean') this.locked = j.locked;
    if (!j.ok && !j.conflict && soft) return j;
    if (!j.ok && j.error === 'shrink') {
      const err = new Error('held');
      err.code = 'held';
      err.there = j.have;
      throw err;
    }
    if (!j.ok && (j.error === 'busy' || j.error === 'unreadable')) {
      const err = new Error('The Google Sheet was busy saving. Trying again in a moment; nothing here has changed.');
      err.code = 'retry';
      throw err;
    }
    if (!j.ok && !j.conflict) {
      throw new Error({
        // only the first version of Code.gs asked for a key
        'bad-key': OLD_SCRIPT, 'not-configured': OLD_SCRIPT,
        'script-error': `The script ran but failed: ${j.message}`,
        'busy': 'The sheet was busy. Try again in a moment.',
        'too-large': 'Your data is too large for the script to accept.',
        'short-passphrase': `A passphrase needs at least ${j.min || 6} characters.`,
      }[j.error] || `The script refused the request (${j.error || 'unknown error'}).`);
    }
    return j;
  },

  /* The POST got no readable answer. A plain GET of the same URL, made the
     same way (no Google sign-in), tells an access problem from a script that
     crashes: doGet answers even when saving would fail. */
  async diagnose(url) {
    let info;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      info = await res.json();
    } catch (e) {
      return 'Google wants a sign-in before it will answer this site. Opening the URL works in your own tab '
        + 'because you are signed in there. In Apps Script choose Deploy → Manage deployments → Edit (pencil), '
        + 'set Execute as: Me and Who has access: Anyone, then Deploy. Open the URL in a private window to '
        + 'see what the site sees.';
    }
    if (!info || info.app !== 'HanziHome sync') {
      return "That URL answers, but not as the HanziHome script. Check you copied this project's web app URL.";
    }
    if (info.problem) return `The script can't open its Sheet: ${info.problem}`;
    if ((info.version || 0) < 3) {
      return 'The script is reachable but failed while reading or saving. Deploy the current version so it can '
        + 'report the reason: ' + REDEPLOY;
    }
    return 'The script is reachable but the request failed. Try again in a moment.';
  },

  run() {
    if (!this.on()) return Promise.resolve();
    if (this.busy) { this.again = true; return this.busy; }
    clearTimeout(this.timer);
    this.lastRun = Date.now();
    this.busy = this.cycle()
      .then(() => { this.error = ''; this.errorCode = ''; this.retries = 0; this.checkScript(); })
      .catch(e => {
        if (e.code === 'held') { this.hold(e.there); return; }
        // the sheet half-way through a save: quietly try again, a few times, before saying so
        if (e.code === 'retry' && this.retries < 4) {
          this.retries++;
          this.timer = setTimeout(() => this.run(), 3000 * this.retries);
          return;
        }
        this.error = e.message; this.errorCode = e.code || '';
      })
      .finally(() => {
        this.busy = null;
        this.paint();
        if (this.again) { this.again = false; this.run(); }
      });
    this.paint();
    return this.busy;
  },

  async cycle() {
    let c = this.cfg();
    if (!c || c.held) return;                      // paused: waiting for a choice (hold)
    let remote = null;                             // the sheet's copy, when we have fetched it
    if (!c.dirty) {
      // nothing to send: has the sheet moved on? (just the revision; the first
      // scripts don't know 'rev', and then the copy is fetched)
      const head = await this.post({ action: 'rev' }, null, true);
      if (head.ok && head.rev === (c.rev || 0)) { this.update({ lastSync: Date.now() }); return; }
      remote = this.whole(await this.post({ action: 'pull' }));
      c = this.cfg();
      if (!c) return;
      if (remote.rev === (c.rev || 0) && !c.dirty) { this.update({ lastSync: Date.now() }); return; }
      if (!c.dirty) {                               // only the other side changed
        if (!c.take) this.guard(Store.load(), remote.data, remote.data);
        this.adopt(remote.data || {}, remote.rev);
        if (c.take) this.update({ take: false });
        return;
      }
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      c = this.cfg();
      if (!c) return;                              // disconnected mid-flight
      if (remote && remote.rev !== (c.rev || 0)) {
        // the sheet moved on: merge its copy with this device's changes first
        const local = Store.load();
        // after "keep this device's data": everything from both, this device's wins
        const merged = merge3(c.union ? null : this.base(), local, remote.data || {});
        if (!c.union) this.guard(local, merged, remote.data);
        if (!same(merged, local)) this.apply(merged);
        if (remote.data && same(merged, remote.data)) { this.adopt(remote.data, remote.rev); return; }
      }
      const baseRev = remote ? remote.rev : (c.rev || 0);
      const pushed = JSON.parse(JSON.stringify(Store.load()));
      const r = await this.post({ action: 'push', baseRev, data: pushed, reset: !!c.reset });
      if (r.ok) {
        // only clear the flag if nothing changed while the request was out
        this.update({ rev: r.rev, lastSync: Date.now(), dirty: !same(Store.load(), pushed), reset: false, union: false });
        this.setBase(pushed);
        if (this.cfg() && this.cfg().dirty) this.markDirty();
        return;
      }
      remote = this.whole(r);                      // someone pushed first: merge with theirs
    }
    throw new Error('Other devices kept changing the data at the same moment. Try Sync now again.');
  },

  /* this device's data would mostly go: stop, and ask */
  guard(local, next, there) {
    if (!shrinks(local, next)) return;
    const err = new Error('held');
    err.code = 'held';
    err.there = heft(there);
    throw err;
  },

  hold(there) {
    this.update({ held: { at: Date.now(), here: heft(Store.load()), there: there || 0 } });
    this.error = '';
    this.paint();
  },

  /* the choices after a pause: keep this device's data (with anything new in the
     synced copy) and upload it, or take the synced copy as it is */
  keepHere() {
    this.update({ held: null, dirty: true, union: true });
    return this.run();
  },
  takeThere() {
    this.update({ held: null, dirty: false, rev: -1, take: true });
    return this.run();
  },

  /* earlier copies the script (version 5) keeps, and putting one back */
  async backups() {
    const j = await this.post({ action: 'backups' }, null, true);
    if (!j.ok) return null;                        // an older script: it keeps none
    return j.backups || [];
  },
  async restore(rev) {
    const j = await this.post({ action: 'restore', rev });
    this.update({ held: null, dirty: false, rev: -1, take: true });   // take it as it is, even if smaller
    await this.run();
    return j;
  },

  /* The sheet's copy, only if it came whole. A sheet that has been saved to (rev
     above 0) but gives no data was caught half-way through a save: taking that
     for an empty copy is what used to make everything vanish until the next sync. */
  whole(reply) {
    const d = reply.data;
    if (reply.rev > 0 && (!d || typeof d !== 'object' || Array.isArray(d))) {
      const err = new Error('The Google Sheet was busy saving. Trying again in a moment; nothing here has changed.');
      err.code = 'retry';
      throw err;
    }
    return reply;
  },

  /* once per visit: does the deployment run the current script? (the older ones
     can be read half-way through a save, and are slower) */
  checkScript() {
    if (this.scriptChecked || !this.on()) return;
    this.scriptChecked = true;
    fetch(this.cfg().url, { redirect: 'follow' }).then(r => r.json()).then(info => {
      this.oldScript = !!(info && info.app === 'HanziHome sync' && (info.version || 0) < SCRIPT_VERSION);
      this.scriptVersion = info && info.version || 0;
      if (info && typeof info.locked === 'boolean') this.locked = info.locked;
      this.paint();
    }).catch(() => {});
  },

  adopt(data, rev) {
    if (!same(data, Store.load())) this.apply(data);
    this.setBase(data);
    this.update({ rev, dirty: false, lastSync: Date.now() });
  },

  /* write data from the sheet into the local store without queueing a push */
  apply(data) {
    try { localStorage.setItem(Store.key, JSON.stringify(data)); } catch (e) { /* keep going in memory */ }
    Store.data = null;
    Store.load();
    tellDesktop();
    const typing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (!typing) rerenderKeepingScroll();
    else markNav(currentPath());
  },

  async connect(url, key) {
    const trial = key ? { url, key } : { url };
    this.errorCode = '';
    await this.post({ action: 'pull' }, trial);   // fails loudly on a wrong URL or passphrase
    // rev 0 and dirty: the first cycle merges this browser's data with the sheet's
    this.setCfg(Object.assign({ url, rev: 0, dirty: true, lastSync: 0 }, key ? { key } : {}));
    this.scriptChecked = false;                  // a new deployment: check its script again
    this.setBase(null);
    this.error = '';
    return this.run();
  },

  /* lock the script with a passphrase, change it, or ('' ) remove it */
  async lock(newKey) {
    const j = await this.post({ action: 'lock', newKey });
    this.update({ key: newKey || undefined });
    this.locked = j.locked;
    this.paint();
  },
  /* this device's passphrase, after another device locked the sync */
  unlock(key) {
    this.update({ key });
    this.error = ''; this.errorCode = '';
    return this.run();
  },

  disconnect() {
    clearTimeout(this.timer);
    this.setCfg(null);
    this.setBase(null);
    this.error = '';
    this.paint();
  },

  /* status line in the sidebar and on the settings page */
  paint() {
    const c = this.cfg();
    const who = document.getElementById('side-who');
    const sub = document.getElementById('side-sub');
    let line = '', detail = '';
    if (!c) {
      line = 'Local profile'; detail = 'Everything is stored in this browser.';
    } else if (c.held) {
      line = 'Sync paused'; detail = 'Your data here is safe. Choose in Settings which copy to keep.';
    } else if (this.busy) {
      line = 'Syncing…'; detail = 'Google Sheets';
    } else if (this.error) {
      line = 'Sync problem'; detail = this.error;
    } else {
      line = 'Synced with Google Sheets';
      detail = c.dirty ? 'Changes waiting to sync' : c.lastSync ? 'Last synced ' + ago(c.lastSync) : 'Not synced yet';
    }
    if (who) who.textContent = line;
    if (sub) { sub.textContent = detail; sub.classList.toggle('sync-err', !!(c && (this.error || c.held))); }
    const box = document.getElementById('sync-status');
    if (box) {
      box.textContent = !c ? '' : c.held ? `Sync paused: the synced copy has far less in it (${c.held.there}) than this device (${c.held.here}), so nothing was changed here.`
        : this.busy ? 'Syncing…' : this.error ? this.error
        : `${c.dirty ? 'Changes waiting to sync' : 'Up to date'} · last synced ${c.lastSync ? ago(c.lastSync) : 'never'} · version ${c.rev || 0}`;
      box.classList.toggle('sync-err', !!(this.error || (c && c.held)));
      const choice = document.getElementById('sync-held');
      if (choice) choice.hidden = !(c && c.held);
      const help = document.getElementById('sync-help-box');
      if (help) {
        help.innerHTML = c && this.errorCode === 'unreachable' ? syncTroubleHtml(c.url)
          : c && this.oldScript ? `<p class="small sync-err">Your deployment runs an older sync script. Updating it
            makes syncing quicker and safer, and lets you lock it with a passphrase: ${esc(REDEPLOY)}</p>` : '';
      }
      this.paintLock(c);
    }
  },
};

/* the passphrase part of the sync card: drawn again only when what it shows changes,
   so typing into it is never wiped */
Sync.paintLock = function (c) {
  const box = document.getElementById('sync-lock-box');
  if (!box) return;
  const state = !c ? '' : this.errorCode === 'locked' ? 'needs' : this.locked === true ? 'locked'
    : this.locked === false && !this.oldScript ? 'open' : '';
  if (box.dataset.state === state) return;
  box.dataset.state = state;
  box.innerHTML = {
    needs: `<div class="row"><input id="sync-key" class="sync-key" type="password" autocomplete="off"
        placeholder="Passphrase"><button class="btn" id="sync-unlock">Unlock</button></div>`,
    open: `<p class="small muted">Anyone who has the URL can read and change your synced progress. Lock it with a
        passphrase, which each device asks for once:</p>
      <div class="row"><input id="sync-key" class="sync-key" type="password" autocomplete="new-password"
        placeholder="New passphrase (6+ characters)"><button class="btn quiet" id="sync-lock">Lock</button></div>`,
    locked: `<p class="small muted">Locked with a passphrase: a device needs it as well as the URL.</p>
      <details class="sync-help"><summary>Change or remove the passphrase</summary>
        <div class="row"><input id="sync-key" class="sync-key" type="password" autocomplete="new-password"
          placeholder="New passphrase"><button class="btn quiet" id="sync-lock">Change</button>
          <button class="btn quiet" id="sync-unlock-all">Remove</button></div>
        <p class="small muted">Other devices then ask for the new one. Forgotten it everywhere? In the Apps Script
          editor, Project Settings → Script properties: delete <code>lockHash</code>.</p></details>`,
  }[state] || '';
  const $ = id => document.getElementById(id);
  const say = (e) => { box.insertAdjacentHTML('beforeend', `<p class="small sync-err">${esc(e.message)}</p>`); };
  if ($('sync-unlock')) {
    const go = () => { const k = $('sync-key').value; if (k) this.unlock(k); };
    $('sync-unlock').addEventListener('click', go);
    $('sync-key').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }
  if ($('sync-lock')) $('sync-lock').addEventListener('click', () => {
    const k = $('sync-key').value;
    if (k.length < 6) return say(new Error('A passphrase needs at least 6 characters.'));
    this.lock(k).catch(say);
  });
  if ($('sync-unlock-all')) $('sync-unlock-all').addEventListener('click', () => {
    if (confirm('Remove the passphrase? Anyone with the URL can then read and change your synced progress.')) this.lock('').catch(say);
  });
};

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString();
}

/* key order differs between devices, so compare by a sorted serialization */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
const same = (a, b) => stable(a) === stable(b);

/* three-way merge of the whole store; base may be null (first sync) */
function merge3(base, local, remote) {
  const b = base || {};
  // settings such as the goal: without a base, the sheet's value wins over this device's default
  const pick = (bv, lv, rv) => (base ? (same(lv, bv) ? rv : lv) : (rv === undefined ? lv : rv));

  // maps where each entry stands alone: keep whichever side changed it
  const map = (bm = {}, lm = {}, rm = {}) => {
    const out = {};
    new Set([...Object.keys(bm), ...Object.keys(lm), ...Object.keys(rm)]).forEach(k => {
      const v = base ? (same(lm[k], bm[k]) ? rm[k] : lm[k]) : (lm[k] !== undefined ? lm[k] : rm[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  };

  // a list's characters: additions and removals on this device, applied to theirs
  const set = (bs = [], ls = [], rs = []) => {
    const removed = new Set(bs.filter(x => !ls.includes(x)));
    const out = rs.filter(x => !removed.has(x));
    ls.forEach(x => { if (!out.includes(x)) out.push(x); });
    return out;
  };

  const lists = () => {
    const byId = arr => new Map((arr || []).map(l => [l.id, l]));
    const bl = byId(b.lists), ll = byId(local.lists), rl = byId(remote.lists);
    const out = [];
    const ids = [...rl.keys(), ...[...ll.keys()].filter(id => !rl.has(id))];
    ids.forEach(id => {
      const x = bl.get(id), l = ll.get(id), r = rl.get(id);
      if (l && r) {
        out.push({ id, name: x && same(l.name, x.name) ? r.name : l.name,
                   chars: set(x ? x.chars : [], l.chars, r.chars) });
      } else if (l) {
        if (!(x && same(l, x))) out.push(l);       // unchanged here and deleted there: gone
      } else if (r) {
        if (!(x && same(r, x))) out.push(r);       // deleted here and unchanged there: gone
      }
    });
    return out;
  };

  // history: this device's list, plus anything visited elsewhere since the base
  const history = () => {
    const since = Math.max(0, ...(b.history || []).map(h => h.t || 0));
    const seen = new Map();
    [...(local.history || []), ...(remote.history || []).filter(h => (h.t || 0) > since)]
      .forEach(h => { if (!seen.has(h.c) || seen.get(h.c).t < h.t) seen.set(h.c, h); });
    return [...seen.values()].sort((x, y) => y.t - x.t).slice(0, 500);
  };

  // study days only ever count up
  const days = () => {
    const out = Object.assign({}, remote.days || {});
    Object.entries(local.days || {}).forEach(([k, v]) => { out[k] = Math.max(v, out[k] || 0); });
    return out;
  };

  const out = {};
  new Set([...Object.keys(b), ...Object.keys(local), ...Object.keys(remote)]).forEach(k => {
    // (items: each character or word learnt changes on its own; study: each setting;
    //  srs is the old flashcards)
    if (['status', 'comps', 'notes', 'srs', 'items', 'study'].includes(k)) out[k] = map(b[k], local[k], remote[k]);
    else if (k === 'lists') out[k] = lists();
    else if (k === 'history') out[k] = history();
    else if (k === 'days') out[k] = days();
    else {
      const v = pick(b[k], local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    }
  });
  return out;
}

function coverage(chars) {
  let pct = 0, n = 0;
  for (const c of chars) { const e = HZ.index[c]; if (e && e[1]) { pct += e[1]; n++; } }
  return { pct, n };
}
const topCoverage = n => coverage(byRank().slice(0, n)).pct;

function streak() {
  const days = Store.load().days;
  const now = new Date(), dow = (now.getDay() + 6) % 7;
  const monday = new Date(now); monday.setDate(now.getDate() - dow);
  const key = x => x.toISOString().slice(0, 10);
  const week = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(monday); x.setDate(monday.getDate() + i);
    week.push({ on: !!days[key(x)], today: i === dow });
  }
  const active = w => {
    const start = new Date(monday); start.setDate(monday.getDate() - 7 * w);
    for (let i = 0; i < 7; i++) {
      const x = new Date(start); x.setDate(start.getDate() + i);
      if (days[key(x)]) return true;
    }
    return false;
  };
  let weeks = 0;
  while (weeks < 260 && active(weeks)) weeks++;
  let best = 0, run = 0;
  for (let w = 0; w < 260; w++) {
    if (active(w)) { run++; best = Math.max(best, run); } else run = 0;
  }
  return { week, weeks, best };
}

/* ============================ routing ============================ */

const go = p => { location.hash = '#' + p; };

/* Changing a character's state re-renders the page it is on. Hold the scroll
   position across that: marking something 2,000 rows down the list should
   leave you looking at it, not back at the top. The page functions are async,
   so restore only once the new DOM is in place. */
/* Apply a state change as cheaply as the current page allows. */
function applyStateChange(ch) {
  if (_boardUpdate && _boardUpdate(ch)) {
    paintRail();
    markNav(currentPath());
  } else {
    rerenderKeepingScroll();
  }
}

function rerenderKeepingScroll() {
  const y = window.scrollY;
  Promise.resolve(render(true)).then(() => window.scrollTo(0, y));
}
window.addEventListener('hashchange', () => render());
const currentPath = () => {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  return h.startsWith('/') ? h : '/dashboard';
};

function markNav(path) {
  path = path.replace(/^\/(lessons|reviews|calibrate)/, '/study');
  document.querySelectorAll('.sidebar nav a').forEach(a => {
    const t = a.dataset.nav;
    a.classList.toggle('on', path === t || (t !== '/' && path.startsWith(t)));
  });
  const due = Store.due().length;
  const b = document.getElementById('due-badge');
  b.hidden = !due; b.textContent = due;
  const learned = Store.chars('learned').length;
  document.getElementById('side-who').textContent =
    learned ? learned + (learned === 1 ? ' character learned' : ' characters learned')
            : 'Local profile';
}

/* ============================ search ============================ */

function searchChars(q, limit = 30) {
  const out = [], s = q.trim().toLowerCase();
  if (!s) return out;
  const bare = s.replace(/[0-5]/g, '');
  for (const c of byRank()) {
    const e = HZ.index[c];
    const plain = (e[2] || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s/g, '');
    if (plain === bare || plain === s || (s.length > 2 && (e[3] || '').toLowerCase().includes(s))) {
      out.push(c);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function initSearch() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('q');
  const box = document.getElementById('ac');
  const paint = () => {
    const q = input.value.trim();
    const hits = [...q].filter(c => isHan(c) && HZ.index[c]);
    const all = [...new Set(hits.length ? hits : searchChars(q, 7))].slice(0, 7);
    if (!all.length) { box.hidden = true; return; }
    box.innerHTML = all.map(c => {
      const e = HZ.index[c];
      return `<a href="#/character/${encodeURIComponent(c)}"><span class="g">${esc(c)}</span>
        <b>${esc(e[2] || '')}</b><span class="m">${esc(e[3] || '')}</span></a>`;
    }).join('');
    box.hidden = false;
  };
  input.addEventListener('input', paint);
  input.addEventListener('focus', () => input.value && paint());
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 160));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim(); box.hidden = true;
    if (!q) return;
    const han = [...q].filter(isHan);
    if (han.length === 1 && HZ.index[han[0]]) go('/character/' + han[0]);
    else go('/search/' + encodeURIComponent(q));
  });
}

/* ============================ shared bits ============================ */

const charLink = (c, cls) => `<a class="${cls || ''}" href="#/character/${encodeURIComponent(c)}">${esc(c)}</a>`;

function tile(c, label) {
  const e = HZ.index[c] || [];
  const st = Store.status(c);
  return `<a class="tile ${st || ''}" href="#/character/${encodeURIComponent(c)}"
     title="${esc((e[2] || '') + '  ' + (e[3] || ''))}">
     <span class="g">${esc(c)}</span><span class="n">${label != null ? label : (e[0] || '')}</span></a>`;
}

/* The tile hover menu lives on <body>, not inside the card, so nothing about
   the card (width, overflow, stacking) can clip or constrain where it lands.
   It is positioned against the hovered tile in viewport coordinates. */
const MENU_GAP = 2, MENU_EDGE = 6, TOPBAR = 60;
let _menuEl = null, _menuHide = null;

function tileMenu() {
  if (_menuEl) return _menuEl;
  _menuEl = document.createElement('div');
  _menuEl.id = 'tile-menu';
  _menuEl.hidden = true;
  document.body.appendChild(_menuEl);
  _menuEl.addEventListener('mouseenter', () => clearTimeout(_menuHide));
  _menuEl.addEventListener('mouseleave', hideTileMenu);
  _menuEl.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    Store.setStatus(b.dataset.c, b.dataset.s || null);
    hideTileMenu();
    applyStateChange(b.dataset.c);
  });
  return _menuEl;
}

let _menuAnchor = null;

function showTileMenu(anchor, c) {
  clearTimeout(_menuHide);
  const el = tileMenu();
  // the menu is on <body>, so :hover no longer reaches the card -- hold the
  // hovered look ourselves while the pointer is over the menu
  if (_menuAnchor && _menuAnchor !== anchor) _menuAnchor.classList.remove('hot');
  _menuAnchor = anchor;
  anchor.classList.add('hot');
  const st = Store.status(c);
  // the button matching the card's state becomes the way to clear it
  const btn = (state, text) => st === state
    ? `<button type="button" class="clear" data-c="${esc(c)}" data-s="">Mark as Not Known</button>`
    : `<button type="button" data-c="${esc(c)}" data-s="${state}">${text}</button>`;
  el.innerHTML = btn('learning', 'Mark as Learning') + btn('learned', 'Mark as Learned');
  el.hidden = false;

  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = r.left + r.width / 2 - w / 2;          // centred on the card
  let top = r.top - MENU_GAP - h;                   // sitting above it
  left = Math.max(MENU_EDGE, Math.min(left, window.innerWidth - w - MENU_EDGE));
  if (top < TOPBAR) top = r.bottom + MENU_GAP;      // flip under the sticky bar
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
}

function hideTileMenu() {
  clearTimeout(_menuHide);
  _menuHide = setTimeout(() => {
    if (_menuEl) _menuEl.hidden = true;
    if (_menuAnchor) { _menuAnchor.classList.remove('hot'); _menuAnchor = null; }
  }, 120);
}
window.addEventListener('scroll', () => {
  if (_menuEl) _menuEl.hidden = true;
  if (_menuAnchor) { _menuAnchor.classList.remove('hot'); _menuAnchor = null; }
}, true);

function chip(c, rank) {
  const e = HZ.index[c] || [];
  const st = Store.status(c) === 'learned' ? 'learned' : '';
  return `<a class="chip ${st}" href="#/character/${encodeURIComponent(c)}">
    <span class="g">${esc(c)}</span><span class="p">${esc(e[2] || '')}</span>
    ${rank ? `<span class="r">#${rank}</span>` : ''}</a>`;
}

function donut(pct) {
  const r = 34, C = 2 * Math.PI * r, on = Math.min(100, pct) / 100 * C;
  return `<svg width="88" height="88" viewBox="0 0 88 88" role="img"
    aria-label="${pct.toFixed(2)} percent of running text">
    <circle cx="44" cy="44" r="${r}" fill="none" stroke="var(--line)" stroke-width="9"/>
    <circle cx="44" cy="44" r="${r}" fill="none" stroke="var(--green)" stroke-width="9"
      stroke-linecap="round" stroke-dasharray="${on} ${C}" transform="rotate(-90 44 44)"/>
    <text class="pctlab" x="44" y="43" text-anchor="middle">${pct.toFixed(2)}%</text>
    <text class="sub" x="44" y="55" text-anchor="middle">OF TEXT</text></svg>`;
}

function pager(base, page, total, per) {
  const last = Math.max(1, Math.ceil(total / per));
  if (last < 2) return '';
  return `<div class="pager">
    ${page > 1 ? `<a href="#${base}/${page - 1}">← Previous</a>` : '<span>← Previous</span>'}
    <span>Page ${page} of ${last}</span>
    ${page < last ? `<a href="#${base}/${page + 1}">Next →</a>` : '<span>Next →</span>'}</div>`;
}

/* ---- the right-hand rail, shown on every dashboard page ---- */

function railHtml() {
  const d = Store.load();
  const learned = Store.chars('learned'), learning = Store.chars('learning');
  const cov = coverage(learned);
  return `
  <section class="card">
    <h3>Character progress</h3>
    <div class="quad">
      <div><b>${num(d.history.length)}</b><span>Searched</span><a href="#/history">View history →</a></div>
      <div><b class="pu">${num(Store.knownComps().length)}</b><span>Components Learned</span><a href="#/productive-components">Browse →</a></div>
      <div><b class="bl">${learning.length}</b><span>Learning</span><a href="#/study">Study these →</a></div>
      <div><b class="g">${learned.length}</b><span>Learned</span><a href="#/lists">View list →</a></div>
    </div>
  </section>
  <section class="card">
    <h3>Reading coverage <i class="info-i" title="How much of an ordinary Chinese text is made of characters you have marked as learned">i</i></h3>
    <div class="donut">${donut(cov.pct)}
      <div><p class="small muted" style="margin-bottom:8px">The top 500 characters alone
        cover about ${topCoverage(500).toFixed(0)}% of running text. Mark characters as
        learned to watch this climb.</p>
        <a class="btn" href="#/reader">Practice your reading</a></div></div>
    <div class="bar" style="margin-top:12px"><i style="width:${Math.min(100, learned.length / d.goal * 100)}%"></i></div>
    <p class="small muted">${num(learned.length)} / ${num(d.goal)} characters learned</p>
  </section>
  <section class="card">
    <div class="rail-head">
      <h3>Study next <i class="info-i" title="Characters you have not marked yet, easiest or highest-value first">i</i></h3>
      <span class="rail-pager"><b id="sn-count"></b>
        <button id="sn-prev" aria-label="Previous suggestions">&lsaquo;</button>
        <button id="sn-next" aria-label="More suggestions">&rsaquo;</button></span>
    </div>
    <div id="study-next"></div>
  </section>`;
}

/* railLast: on one column, keep the rail under the page instead of above it */
function withRail(main, railLast) {
  return `<div class="dash${railLast ? ' rail-last' : ''}"><div>${main}</div><div class="rail">${railHtml()}</div></div>`;
}

async function paintRail() {
  const box = document.getElementById('study-next');
  if (!box) return;
  await optional(need.comps());
  const pool = suggestPool();
  const pages = Math.max(1, Math.ceil(pool.length / SUGGEST_PER_PAGE));
  if (suggestPage >= pages) suggestPage = 0;
  const picks = pool.slice(suggestPage * SUGGEST_PER_PAGE,
                           suggestPage * SUGGEST_PER_PAGE + SUGGEST_PER_PAGE);

  const count = document.getElementById('sn-count');
  const prev = document.getElementById('sn-prev');
  const next = document.getElementById('sn-next');
  if (count) count.textContent = pool.length ? (suggestPage + 1) + '/' + pages : '';
  if (prev) { prev.disabled = suggestPage === 0; prev.onclick = () => { suggestPage--; paintRail(); }; }
  if (next) { next.disabled = suggestPage >= pages - 1; next.onclick = () => { suggestPage++; paintRail(); }; }

  box.innerHTML = picks.length ? picks.map(p => `
    <div class="next-row">${tile(p.c)}
      <div class="info"><b>${esc(p.c)}</b>
        <span class="muted">${esc(HZ.index[p.c][2] || '')}</span>
        <div class="why">${esc(p.why)}</div></div>
      <button class="btn add-next" data-c="${esc(p.c)}">Add</button></div>`).join('')
    : '<p class="empty small">Nothing to suggest right now.</p>';
  box.querySelectorAll('.add-next').forEach(b => b.addEventListener('click', () => {
    Store.setStatus(b.dataset.c, 'learning');
    applyStateChange(b.dataset.c);
  }));
}

/* Characters worth learning next. Two kinds of suggestion: ones whose parts
   you already know, and ones that simply buy the most reading coverage.
   A decodable character only earns a slot while it is still common enough to
   be worth the effort - otherwise a rank-1600 character outranks a rank-8 one. */
const DECODABLE_MAX_RANK = 800;
const SUGGEST_PER_PAGE = 3;
let suggestPage = 0;

function suggestPool() {
  const decodable = [], plain = [];
  for (const c of byRank()) {                    // already in frequency order
    if (Store.status(c)) continue;
    const e = HZ.index[c];
    const parts = (HZ.comps && HZ.comps[c]) || [];
    if (parts.length >= 2 && parts.every(p => Store.compKnown(p))) {
      if (e[0] <= DECODABLE_MAX_RANK && decodable.length < 12) {
        decodable.push({ c, why: 'You know both parts ' + parts.join(' + ') });
      }
    } else if (plain.length < 24) {
      plain.push({ c, why: '+' + (e[1] || 0).toFixed(2) + '% reading coverage' });
    }
    if (decodable.length >= 12 && plain.length >= 24) break;
  }
  return [...decodable, ...plain];
}

/* ---- reusable tile grid with All / Not known / Learning / Learned ---- */

function tileBoard(id, chars, opts) {
  opts = opts || {};
  const d = Store.load();
  const counts = {
    all: chars.length,
    unknown: chars.filter(c => !d.status[c]).length,
    learning: chars.filter(c => d.status[c] === 'learning').length,
    learned: chars.filter(c => d.status[c] === 'learned').length,
  };
  return `<div class="filters" id="${id}-filters">
      <button data-f="all" class="on">All (${num(counts.all)})</button>
      <button data-f="unknown">Not Known (${num(counts.unknown)})</button>
      <button data-f="learning" class="learning">Learning (${counts.learning})</button>
      <button data-f="learned" class="learned">Learned (${counts.learned})</button>
      <button data-multi="1" class="multi">Select Multiple</button>
    </div>
    <div class="selbar" id="${id}-selbar" hidden>
      <b><span id="${id}-seln">0</span> selected</b>
      <button class="btn" data-set="learned">Mark learned</button>
      <button class="btn quiet" data-set="learning">Mark learning</button>
      <button class="btn quiet" data-set="">Clear status</button>
      <button class="btn quiet" data-cancel="1">Cancel</button>
    </div>
    <div id="${id}-body"></div>`;
}

/* Set by whichever tile board is on screen. Marking one character only needs
   that tile and the filter counts updated - rebuilding the whole grid for it
   is both slow and what threw away the scroll position. Returns false when the
   change could move the tile out of the current filter, so the caller falls
   back to a full re-render. */
let _boardUpdate = null;

function wireTileBoard(id, chars, opts) {
  opts = opts || {};
  const band = opts.band || 250;
  const label = opts.label || (c => (HZ.index[c] || [])[0] || '');
  let filter = 'all', multi = false;
  const picked = new Set();
  const bar = document.getElementById(id + '-selbar');
  const syncBar = () => {
    if (!bar) return;
    bar.hidden = !multi;
    const n = document.getElementById(id + '-seln');
    if (n) n.textContent = picked.size;
  };
  const paint = () => {
    const d = Store.load();
    const keep = c => filter === 'all' ? true
      : filter === 'unknown' ? !d.status[c] : d.status[c] === filter;
    const body = document.getElementById(id + '-body');
    if (!body) return;
    // group into bands of the underlying order so filtered views stay locatable
    let html = '', any = false;
    for (let i = 0; i < chars.length; i += band) {
      const slice = chars.slice(i, i + band).filter(keep);
      if (!slice.length) continue;
      any = true;
      html += `<p class="band">${i + 1}–${Math.min(i + band, chars.length)}</p>
        <div class="tilegrid">${slice.map(c =>
          tile(c, label(c)).replace('class="tile ', 'class="tile ' + (picked.has(c) ? 'sel ' : ''))
        ).join('')}</div>`;
    }
    body.innerHTML = any ? html : '<p class="empty">Nothing in this group yet.</p>';
    body.querySelectorAll('.tile').forEach(t => {
      const c = decodeURIComponent(t.getAttribute('href').split('/').pop());
      t.addEventListener('mouseenter', () => { if (!multi && !isTouch()) showTileMenu(t, c); });
      t.addEventListener('mouseleave', () => { if (!isTouch()) hideTileMenu(); });
      t.addEventListener('click', e => {
        if (multi || !isTouch()) return;
        if (_menuEl && !_menuEl.hidden && _menuAnchor === t) return;   // second tap: open the page
        e.preventDefault();
        showTileMenu(t, c);
      });
    });
    if (multi) body.querySelectorAll('.tile').forEach(t => {
      t.addEventListener('click', e => {
        e.preventDefault();
        const c = decodeURIComponent(t.getAttribute('href').split('/').pop());
        picked.has(c) ? picked.delete(c) : picked.add(c);
        t.classList.toggle('sel', picked.has(c));
        syncBar();
      });
    });
  };
  paint();

  const relabel = () => {
    const d = Store.load();
    const f2 = document.getElementById(id + '-filters');
    if (!f2) return;
    const n = {
      all: chars.length,
      unknown: chars.filter(c => !d.status[c]).length,
      learning: chars.filter(c => d.status[c] === 'learning').length,
      learned: chars.filter(c => d.status[c] === 'learned').length,
    };
    const put = (k, text) => {
      const b = f2.querySelector('button[data-f="' + k + '"]');
      if (b) b.textContent = text;
    };
    put('all', 'All (' + num(n.all) + ')');
    put('unknown', 'Not Known (' + num(n.unknown) + ')');
    put('learning', 'Learning (' + n.learning + ')');
    put('learned', 'Learned (' + n.learned + ')');
  };

  _boardUpdate = ch => {
    if (filter !== 'all' || multi) return false;   // tile might have to leave the list
    const body = document.getElementById(id + '-body');
    if (!body) return false;
    const st = Store.status(ch);
    body.querySelectorAll('.tile').forEach(t => {
      if (decodeURIComponent(t.getAttribute('href').split('/').pop()) !== ch) return;
      t.classList.remove('learned', 'learning');
      if (st) t.classList.add(st);
    });
    relabel();
    return true;
  };

  if (bar) bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cancel) { multi = false; picked.clear(); syncBar(); paint(); return; }
    if (b.dataset.set !== undefined) {
      picked.forEach(c => Store.setStatus(c, b.dataset.set || null));
      picked.clear();
      rerenderKeepingScroll();
    }
  });
  const f = document.getElementById(id + '-filters');
  if (f) f.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.multi) {
      multi = !multi;
      b.classList.toggle('on', multi);
      if (!multi) picked.clear();
      syncBar(); paint();
      return;
    }
    f.querySelectorAll('button[data-f]').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); filter = b.dataset.f; paint();
  });
}

/* ============================ dashboard ============================ */

async function pageDashboard() {
  app.innerHTML = '<p class="muted">Loading…</p>';
  await optional(need.comps());
  const d = Store.load();
  const learned = Store.chars('learned'), learning = Store.chars('learning');
  const st = streak();
  const tracked = byRank().slice(0, d.goal);
  const dueN = Store.due().length;

  app.innerHTML = `<h1 class="page-title">Dashboard</h1>` + withRail(`
    <section class="card streak">
      <div class="big"><b>${st.weeks}</b><u>Week<br>streak
        <em>Best ${st.best}</em></u></div>
      <div class="week">${st.week.map((w, i) =>
        `<div><i class="${w.on ? 'on' : ''} ${w.today ? 'today' : ''}"></i>${'MTWTFSS'[i]}</div>`).join('')}</div>
      <div class="small">
        <div><span class="dot b"></span><b>${learning.length}</b> started learning</div>
        <div><span class="dot g"></span><b>${learned.length}</b> marked as learned</div>
        <div class="minitiles">
          ${learned.slice(0, 8).map(c => `<a class="tile learned" title="${esc(c)}"
              href="#/character/${encodeURIComponent(c)}"><span class="g">${esc(c)}</span></a>`).join('')
            || '<span class="muted small">Nothing marked yet</span>'}
          ${learned.length > 8 ? `<span class="plusn">+${learned.length - 8}</span>` : ''}</div>
      </div>
      <div style="margin-left:auto"><a class="btn" href="#/study">
        ${dueN ? `Reviews (${dueN})` : Store.lessons().length ? `Lessons (${Store.lessons().length})` : 'Study'}</a></div>
    </section>
    <section class="card">
      <h2 class="caps">Most common characters</h2>
      <p class="muted small">Keep track of the most popular characters by updating them
         with what you currently know. Open a character to mark it.</p>
      ${tileBoard('track', tracked)}
    </section>`);
  wireTileBoard('track', tracked);
  paintRail();
}

/* ============================ character page ============================ */

/* Horizontal tree: the parent sits on the left with its parts stacked to the
   right of it, the way HanziCraft draws the breakdown. */
function renderTree(node, top) {
  const [c, kids] = node;
  const known = !top && Store.compKnown(c);
  const box = top
    ? `<span class="tbox ${Store.compKnown(c) ? 'known' : ''}">${esc(c)}</span>`
    : `<a class="tbox ${known ? 'known' : ''}" href="#/character/${encodeURIComponent(c)}"
         title="${esc(glossOf(c) || '')}">${esc(c)}</a>`;
  return `<div class="tnode">${box}${kids && kids.length
    ? `<div class="tkids">${kids.map(k => renderTree(k, false)).join('')}</div>` : ''}</div>`;
}

/* small monochrome icons for the fact list */
const ICON = {
  rank: 'M3 13h3v6H3zM9 8h3v11H9zM15 4h3v15h-3z',
  pct: 'M18 6L6 18M8 7.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM19 16.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
  swap: 'M4 8h13l-3-3M20 16H7l3 3',
  book: 'M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM8 8h7M8 12h7',
  chat: 'M4 5h16v11H9l-5 4z',
  piece: 'M5 5h6v3a2 2 0 1 0 4 0V5h4v6h-3a2 2 0 1 0 0 4h3v4H5z',
  stroke: 'M5 19L19 5M5 5l4 4',
  radical: 'M4 6h16M12 6v13M7 19h10',
  hsk: 'M12 3 21 8l-9 5-9-5zM3 12.5 12 17.5l9-5',
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;

const wordChip = w => `<a class="word" href="#/search/${encodeURIComponent(w[0])}">
  <span class="w">${esc(w[0])}</span>${w[1] ? ` <span class="t">(${esc(w[1])})</span>` : ''}
  <span class="p">${esc(w[2])}</span></a>`;

const REL = { 1: 'Exact match, including tone.', 2: 'Same pinyin, different tone.',
              3: 'It rhymes.', 4: 'Same initial sound.' };

/* a square for HanziWriter to draw in, over a 米字格 practice grid */
function writerBox(id, size = 220) {
  return `<div class="writer-wrap" style="width:${size}px;height:${size}px">
    <svg class="writer-grid" viewBox="0 0 100 100" aria-hidden="true"><rect x=".5" y=".5" width="99" height="99"/>
      <path d="M0 0L100 100M100 0L0 100M50 0V100M0 50H100"/></svg>
    <div id="${id}" class="writer"></div></div>`;
}

/* HanziWriter in the element with that id, drawing ch from site/data/s; null when
   there are no strokes for it. Colours follow the page's (light or dark). */
async function makeWriter(id, ch, size, opts) {
  const [, d] = await Promise.all([need.writer(), strokeData(ch)]);
  if (!d || !document.getElementById(id)) return null;
  const css = getComputedStyle(document.documentElement);
  const v = n => css.getPropertyValue(n).trim();
  return HanziWriter.create(id, ch, Object.assign({
    width: size, height: size, padding: 6,
    strokeColor: v('--ink'), outlineColor: v('--line-2'), radicalColor: v('--accent'),
    drawingColor: v('--blue'), highlightColor: v('--blue'),
    strokeAnimationSpeed: 1.1, delayBetweenStrokes: 220, drawingWidth: 6,
    charDataLoader: (c, done) => done({ strokes: d[0], medians: d[1], radStrokes: d[2] || [] }),
  }, opts));
}

/* a writing quiz in a writer: tracing over the outline, or from memory (the outline
   only comes back, stroke by stroke, after three misses on it). done(mistakes, strokes) */
function writeQuiz(writer, memory, say, done) {
  let strokes = 0;
  writer.hideCharacter();
  if (memory) writer.hideOutline(); else writer.showOutline();
  writer.quiz({
    showHintAfterMisses: 3, leniency: 1.1,
    onCorrectStroke: s => { strokes = s.strokeNum + 1 + s.strokesRemaining; say(`Stroke ${s.strokeNum + 1} of ${strokes}.`); },
    onMistake: s => say(s.mistakesOnStroke >= 3 ? `Stroke ${s.strokeNum + 1}: follow the hint.` : `Not quite: stroke ${s.strokeNum + 1} again.`),
    onComplete: s => { writer.showOutline(); done(s.totalMistakes, strokes); },
  });
}

async function pageCharacter(ch) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const d = await charData(ch);
  if (!d) {
    app.innerHTML = withRail(`<div class="card"><h1>${esc(ch)}</h1>
      <p class="empty">No data for this character.</p></div>`);
    paintRail();
    return;
  }
  Store.visit(ch);
  const store = Store.load();
  const first = d.rd[0];
  const status = Store.status(ch);
  const ranked = byRank();
  const i = d.r ? ranked.indexOf(ch) : -1;
  const prev = i > 0 ? ranked[i - 1] : null;
  const next = i >= 0 && i < ranked.length - 1 ? ranked[i + 1] : null;

  const facts = [];
  const fact = (ic, html) => facts.push(`<li>${icon(ic)}<span>${html}</span></li>`);
  if (d.r) {
    fact('rank', `<b>${ordinal(d.r)}</b> most frequent character`);
    fact('pct', `Adds <b>~${d.p.toFixed(2)}%</b> to your reading coverage
      <i class="info-i" title="This character's share of all characters in a large corpus of modern Chinese">i</i>`);
  } else fact('rank', 'Not in the modern frequency list');
  if (d.t === d.s) fact('swap', 'Same in <b>Simplified and Traditional</b>');
  else if (ch === d.s) fact('swap', `<b>Simplified</b> character · Traditional: ${charLink(d.t)}`);
  else fact('swap', `<b>Traditional</b> character · Simplified: ${charLink(d.s)}`);
  fact('book', `<b>${d.rd.length}</b> ${d.rd.length === 1 ? 'pronunciation' : 'pronunciations'}`);
  fact('chat', `Appears in <b>${d.w.length}</b> words`);
  fact('piece', `Component in <b>${d.ai.length}</b> character${d.ai.length === 1 ? '' : 's'}`);
  if (d.st) fact('stroke', `<b>${d.st}</b> strokes`);
  if (d.kr) fact('radical', `Radical: ${charLink(d.kr, 'han')} <span class="muted">${esc(glossOf(d.kr))}</span>`);
  if (d.h) fact('hsk', `<b>HSK ${d.h}</b> vocabulary`);

  const words = { 0: [], 1: [], 2: [] };
  d.w.forEach(w => words[w[3]].push(w));
  const group = (title, list, initial) => {
    if (!list.length) return '';
    const gid = 'g' + title;
    return `<div class="wordgroup"><h3>${title} <span class="muted">(${list.length})</span></h3>
      <div class="words" id="${gid}">${list.slice(0, initial).map(wordChip).join('')}</div>
      ${list.length > initial ? `<p style="margin-top:8px"><button class="more"
         data-g="${title}" data-from="${initial}">Show ${list.length - initial} more</button></p>` : ''}</div>`;
  };

  app.innerHTML = `<p class="crumb"><a href="#/dashboard">Dashboard</a> / <span class="han">${esc(ch)}</span></p>`
  + withRail(`
    <div class="chartab han">${esc(ch)}</div>
    <section class="card chartop">
      <div class="hero-row">
        <div class="hero-glyph ${status || ''}">${esc(ch)}</div>
        <div class="hero-actions">
          <div class="dd">
            <button class="btn status-btn ${status || 'none'}" id="statusbtn">
              Status: ${status ? status[0].toUpperCase() + status.slice(1) : 'Not started'} ▾</button>
            <div class="dd-pop" id="statuspop" hidden>
              <button data-s="">Not started</button>
              <button data-s="learning">Learning</button>
              <button data-s="learned">Learned</button>
            </div>
          </div>
          <div class="dd">
            <button class="btn addlist-btn" id="addlistbtn">＋ Add to list ▾</button>
            <div class="dd-pop" id="listpop" hidden></div>
          </div>
          ${learnButton(ch)}
        </div>
      </div>
      <p class="neighbours">${prev ? `Previous (${charLink(prev)})` : ''}
        ${next ? `Next (${charLink(next)})` : ''}</p>
      <ul class="facts">${facts.join('')}</ul>
    </section>

    <section id="stroke-sec" hidden>
      <h2 class="sec-h">Stroke order</h2>
      <div class="decomp-box pad stroke-box">
        ${writerBox('writer')}
        <div class="writer-side">
          <p class="small muted" id="writer-msg"></p>
          <div class="row">
            <button class="btn" id="w-play">▶ Play</button>
            <button class="btn quiet" id="w-trace">✎ Trace it</button>
            <button class="btn quiet" id="w-recall">✎ Write from memory</button>
          </div>
        </div>
      </div>
    </section>

    <h2 class="sec-h">Decomposition</h2>
    <p class="tip"><i class="info-i">i</i> Components you have marked as known are
       outlined in green — click one in row 2 to mark it.</p>
    <div class="decomp-box">
      <div class="decomp-row">
        <div class="decomp-label"><span class="n">1</span> Breakdown <i class="info-i" title="The character split into its parts, and those parts split again down to named components">i</i></div>
        <div class="decomp-body tree-h">${renderTree(d.bd, true)}</div>
      </div>
      <div class="decomp-row">
        <div class="decomp-label"><span class="n">2</span> Components <i class="info-i" title="The named building blocks this character is made of">i</i></div>
        <div class="decomp-body glyphs"><span class="gbox han ${Store.compKnown(ch) ? 'known' : ''}">${esc(ch)}</span><span class="arrow">→</span>
          ${d.cm.map(c => `<button class="gbox comp-btn ${Store.compKnown(c) ? 'known' : ''}" data-c="${esc(c)}">
              <span class="han">${esc(c)}</span><small>${esc(glossOf(c) || 'N/A')}</small></button>`).join('')
            || '<span class="empty">Atomic — no components.</span>'}</div>
      </div>
      <div class="decomp-row">
        <div class="decomp-label"><span class="n">3</span> Graphical <i class="info-i" title="The same character taken all the way down to individual strokes">i</i></div>
        <div class="decomp-body glyphs"><span class="gbox han ${Store.compKnown(ch) ? 'known' : ''}">${esc(ch)}</span><span class="arrow">→</span>
          ${d.gr.map(g => `<span class="gbox han stroke">${esc(g)}</span>`).join('')}</div>
      </div>
    </div>

    <h2 class="sec-h">Pinyin &amp; Meaning</h2>
    <div class="decomp-box pad">
      ${d.rd.map((r, n) => `<div class="reading">
        <p class="r-head">${n + 1}. ${esc(r[1])} <span>(${esc(r[0])})</span></p>
        <p class="r-defs">${r[2].map(esc).join(' • ')}</p></div>`).join('')
        || '<p class="empty">No dictionary entry.</p>'}
    </div>

    <h2 class="sec-h">Phonetic Components</h2>
    <p class="tip"><i class="info-i">i</i> A phonetic component hints at how the
       character is pronounced.</p>
    <div class="decomp-box pad">
      ${d.ph.length ? d.ph.map((p, n) => `<div class="clue">
        <p>${n + 1}. ${charLink(ch, 'han')} <b>${esc(first ? first[1] : '')}</b> has component
          ${charLink(p.c, 'han')} <b>${esc(p.t)}</b>.
          <span class="rel-${p.r}">${esc(REL[p.r])}</span></p>
        ${p.m.length ? `<p class="muted small" style="margin:0 0 6px">${esc(p.c)} is also a clue in:</p>
          <div class="chips">${p.m.slice(0, 12).map(m => chip(m[0], m[2])).join('')}</div>
          ${p.m.length > 12 ? `<p style="margin-top:8px"><button class="more"
             data-chips='${esc(JSON.stringify(p.m.slice(12)))}'>Show ${p.m.length - 12} more</button></p>` : ''}` : ''}
        </div>`).join('')
        : '<p class="empty">There are no phonetic clues for this character.</p>'}
    </div>

    ${d.ai.length ? `<h2 class="sec-h">Appears In</h2>
      <div class="decomp-box pad">
        <p class="muted small">${esc(ch)} is a component of these characters:</p>
        <div class="chips">${d.ai.slice(0, 60).map(m => chip(m[0], m[2])).join('')}</div></div>` : ''}

    <h2 class="sec-h">Example Words</h2>
    <div class="decomp-box pad">
      ${(group('Common', words[0], 40) + group('Uncommon', words[1], 40) +
         group('Rare', words[2], 0)) || '<p class="empty">No words recorded.</p>'}
    </div>

    <h2 class="sec-h">Your Note</h2>
    <div class="decomp-box pad">
      <textarea id="note" rows="3" style="width:100%;font:inherit;padding:10px;
        border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)"
        placeholder="A mnemonic, an example sentence, anything…">${esc(store.notes[ch] || '')}</textarea>
      <p class="small muted" id="note-state">Saved automatically.</p>
    </div>`);

  // stroke order: play it, trace it, or write it from memory
  makeWriter('writer', ch, 220, { showOutline: true }).then(writer => {
    const sec = document.getElementById('stroke-sec');
    if (!writer || !sec) return;
    sec.hidden = false;
    const msg = document.getElementById('writer-msg');
    const n = strokeCount(ch);
    const intro = `${n ? n + ' strokes. ' : ''}The radical's strokes are in red. Play them in order, then write it yourself.`;
    msg.textContent = intro;
    const say = t => { msg.textContent = t; };
    document.getElementById('w-play').addEventListener('click', () => { writer.cancelQuiz(); say(intro); writer.animateCharacter(); });
    const practise = memory => () => {
      say(memory ? 'Write it from memory: draw each stroke in order.' : 'Trace over the outline, stroke by stroke.');
      writeQuiz(writer, memory, say, (mistakes) => say(mistakes
        ? `Done, with ${mistakes} ${mistakes === 1 ? 'slip' : 'slips'}. Again, or play it to compare.`
        : 'Done, without a slip.'));
    };
    document.getElementById('w-trace').addEventListener('click', practise(false));
    document.getElementById('w-recall').addEventListener('click', practise(true));
  });

  const dd = (btnId, popId, build) => {
    const btn = document.getElementById(btnId), pop = document.getElementById(popId);
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = pop.hidden;
      document.querySelectorAll('.dd-pop').forEach(p => { p.hidden = true; });
      if (build && open) build(pop);
      pop.hidden = !open;
    });
    pop.addEventListener('click', e => e.stopPropagation());
  };
  dd('statusbtn', 'statuspop');
  wireLearnButton(ch, () => ({ pin: first ? first[1] : '', mean: first ? first[2].slice(0, 2).join('; ') : '',
    alts: first ? first[2].slice(0, 6) : [] }));
  document.getElementById('statuspop').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    Store.setStatus(ch, b.dataset.s || null);
    rerenderKeepingScroll();
  });
  dd('addlistbtn', 'listpop', pop => {
    const lists = Store.load().lists;
    pop.innerHTML = lists.map(l =>
      `<button data-id="${esc(l.id)}">${l.chars.includes(ch) ? '✓ ' : ''}${esc(l.name)}</button>`).join('')
      + '<button data-new="1">＋ New list…</button>';
    pop.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.new) {
        const name = prompt('Name the new list:', '');
        if (name && name.trim()) {
          const l = Store.addList(name.trim());
          Store.listToggle(l.id, ch);
        }
      } else Store.listToggle(b.dataset.id, ch);
      rerenderKeepingScroll();
    }));
  });
  app.querySelectorAll('.comp-btn').forEach(b => b.addEventListener('click', () => {
    b.classList.toggle('known', Store.toggleComp(b.dataset.c));
    paintRail();
  }));
  app.querySelectorAll('button.more').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.chips) {
      b.parentElement.previousElementSibling.insertAdjacentHTML('beforeend',
        JSON.parse(b.dataset.chips).map(m => chip(m[0], m[2])).join(''));
    } else {
      const t = b.dataset.g, list = t === 'Common' ? words[0] : t === 'Uncommon' ? words[1] : words[2];
      document.getElementById('g' + t).insertAdjacentHTML('beforeend',
        list.slice(+b.dataset.from).map(wordChip).join(''));
    }
    b.remove();
  }));
  const note = document.getElementById('note');
  let t;
  note.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      Store.note(ch, note.value);
      document.getElementById('note-state').textContent = 'Saved.';
    }, 400);
  });
  paintRail();
}

/* ============================ search page ============================ */

async function pageSearch(q) {
  app.innerHTML = '<p class="muted">Searching…</p>';
  const han = [...q].filter(c => isHan(c) && HZ.index[c]);
  const chars = han.length ? [...new Set(han)] : searchChars(q, 60);
  let words = [];
  try {
    await optional(need.words());
    // pinyin: "gaosu" matches 告诉 whatever its tones, "gao4su" only that way
    // (a neutral tone may be left out); v or ü for ü
    const s = q.toLowerCase();
    const spelt = x => x.replace(/[\s:5]/g, '').replace(/[üv]/g, 'u');
    const pin = /^[a-zü:\s1-5]+$/.test(s) ? (/[1-4]/.test(s) ? spelt : x => spelt(x).replace(/[1-4]/g, '')) : null;
    const want = pin && pin(s);
    words = HZ.words.filter(w => w[0] === q || w[1] === q || (want && pin(w[4]) === want) ||
      (han.length > 1 && w[0].includes(q)) ||
      (s.length > 2 && w[3].toLowerCase().includes(s))).slice(0, 60);
  } catch (e) { /* word index is optional */ }

  app.innerHTML = `<h1 class="page-title">Results for “${esc(q)}”</h1>` + withRail(`
    ${chars.length ? `<section class="card"><h2>Characters</h2><table><tbody>
      ${chars.map(c => { const e = HZ.index[c];
        return `<tr><td class="g">${charLink(c)}</td><td class="num">${e[0] ? '#' + e[0] : '—'}</td>
        <td><b>${esc(e[2] || '')}</b><br><span class="muted">${esc(e[3] || '')}</span></td></tr>`; }).join('')}
      </tbody></table></section>` : ''}
    ${words.length ? `<section class="card"><h2>Words</h2><table><tbody>
      ${words.map(w => `<tr>
        <td class="g">${[...w[0]].map(c => HZ.index[c] ? charLink(c) : esc(c)).join('')}</td>
        <td class="num">${esc(w[1] || '')}</td>
        <td><b>${esc(w[2])}</b><br><span class="muted">${esc(w[3])}</span></td></tr>`).join('')}
      </tbody></table></section>` : ''}
    ${!chars.length && !words.length ? '<div class="card"><p class="empty">Nothing found.</p></div>' : ''}`);
  paintRail();
}

/* ============================ study ============================
   Lessons and reviews live in study.js (pageStudy, pageLessons, pageReviews),
   loaded before this file; learn.js does their scheduling. */

/* ============================ reader ============================ */

const uniqueHan = lines => {
  const set = new Set();
  for (const ln of lines) for (const c of ln) if (isHan(c) && HZ.index[c]) set.add(c);
  return [...set];
};
const trackedIn = chars => chars.filter(c => Store.status(c)).length;

/* The text pasted into the reader. Kept in this browser so #/reader/text
   survives a reload; not synced, since it is a scratch pad rather than progress.
   A title is optional: the desktop app gives text read off the screen "On screen
   now"; pasted text is titled by its first line. */
const READER_TEXT_KEY = 'hanzihome.readerText', READER_TITLE_KEY = 'hanzihome.readerTitle';
let _readerText = '', _readerTitle = '';
function readerText() {
  try { return localStorage.getItem(READER_TEXT_KEY) || _readerText; } catch (e) { return _readerText; }
}
function readerTitle() {
  try { return localStorage.getItem(READER_TITLE_KEY) || ''; } catch (e) { return _readerTitle; }
}
function setReaderText(t, title) {
  _readerText = t;
  _readerTitle = title || '';
  try {
    localStorage.setItem(READER_TEXT_KEY, t);
    if (title) localStorage.setItem(READER_TITLE_KEY, title); else localStorage.removeItem(READER_TITLE_KEY);
  } catch (e) { /* kept in memory for this visit */ }
}

async function pageReader() {
  app.innerHTML = '<p class="muted">Loading…</p>';
  await optional(need.stories());
  const byLevel = {};
  HZ.stories.forEach(st => (byLevel[st.l] = byLevel[st.l] || []).push(st));

  const card = st => {
    const chars = st.c.map(r => r[0]);   // precomputed at build time; st.t is gone
    return `<a class="story" href="#/reader/${st.id}">
      <span class="story-tag">HSK ${st.l} · ${esc(st.tag)}</span>
      <span class="story-zh han">${esc(st.zh)}</span>
      <span class="story-en">${esc(st.en)}</span>
      <span class="story-stat">${trackedIn(chars)} of ${chars.length} unique characters tracked</span>
    </a>`;
  };

  app.innerHTML = '<h1 class="page-title">Reader <em class="beta">beta</em></h1>' + withRail(`
    <p class="lede">Characters stick far better in context than in a list. These are short
       original stories graded by HSK level — every character is clickable, and the ones you
       have marked are coloured as you read. You can paste your own text at the bottom.</p>
    ${Object.keys(byLevel).sort().map(l => `
      <h2 class="sec-h">${esc(HZ.levelNames[l])} (HSK ${l})</h2>
      <div class="storygrid">${byLevel[l].map(card).join('')}</div>`).join('')}

    <h2 class="sec-h">Your own text</h2>
    <div class="decomp-box pad">
      <p class="muted small">Paste anything — an article, a chat, a textbook passage. It opens in
        the same reader as the stories, split into words with the meaning each one has there.
        The meanings are worked out from the dictionary, so now and then one will be off.</p>
      <textarea id="reader-text" placeholder="把中文放在这里…">${esc(readerText())}</textarea>
      <p class="row" style="margin-top:10px"><button class="btn" id="do-read">Read it</button></p>
    </div>`);
  document.getElementById('do-read').addEventListener('click', () => {
    const t = document.getElementById('reader-text').value;
    if (!t.trim()) return;
    setReaderText(t);
    go('/reader/text');
  });
  paintRail();
}

/* A word is learned only when every character in it is; if any character is
   marked at all it counts as learning; otherwise it is new. */
function wordState(w) {
  const cs = [...w].filter(c => isHan(c) && HZ.index[c]);
  if (!cs.length) return '';
  if (cs.every(c => Store.status(c) === 'learned')) return 'learned';
  if (cs.some(c => Store.status(c))) return 'learning';
  return 'new';
}

let _story = null;
let _tab = 'v';

async function pageStory(id) {
  if (id === 'text') return pageText();
  app.innerHTML = '<p class="muted">Loading…</p>';
  await optional(need.stories());
  const st = (HZ.stories || []).find(x => x.id === id);
  if (!st) {
    app.innerHTML = '<div class="card"><p class="empty">No such story.</p></div>';
    return;
  }
  showStory(st, 'Back to stories');
}

/* Pasted text, glossed by textstory.js into the same shape as a story, so
   everything below draws it the way it draws the graded stories. */
async function pageText() {
  const text = readerText();
  if (!text.trim()) { go('/reader'); return; }
  app.innerHTML = '<p class="muted">Loading the dictionary…</p>';
  await need.textStory();
  const st = TextStory.textToStory(text, HZ);
  const title = readerTitle();
  if (title) {
    st.zh = title;
    st.en = `${num(st.n)} characters`;
  } else {
    // the first line stands in for a title
    const first = text.trim().split(/\r?\n/)[0];
    st.zh = [...first].length > 18 ? [...first].slice(0, 18).join('') + '…' : first;
    st.en = `Your text · ${num(st.n)} characters`;
  }
  showStory(st, 'Back to the reader to edit or paste new text');
}

/* Desktop app only: read the screen, which opens the result at #/reader/text.
   The app hides this window first, so it reads what is underneath. */
function pageScreen() {
  if (!window.hanzihomeDesktop) {
    app.innerHTML = '<div class="card"><p class="empty">This page is part of the HanziHome desktop app, '
      + 'which reads Chinese off your screen.</p></div>';
    return;
  }
  app.innerHTML = '<p class="muted">Reading the screen…</p>';
  window.hanzihomeDesktop.readScreen();
}

function showStory(st, back) {
  _story = st;
  app.innerHTML = `
    <p class="crumb"><a href="#/reader">← ${esc(back)}</a></p>
    <div class="readlayout">
      <aside class="readside">
        <section class="card" id="read-stats-card"></section>
        <section class="card readlist">
          <div class="tabs2" id="read-tabs">
            <button data-t="v" class="${_tab === 'v' ? 'on' : ''}">Vocabulary</button>
            <button data-t="c" class="${_tab === 'c' ? 'on' : ''}">Characters</button>
          </div>
          <div id="read-list"></div>
        </section>
      </aside>
      <div class="readmain">
        <h1 class="storytitle han">${esc(st.zh)}</h1>
        <p class="storysub">${esc(st.en)}</p>
        <div class="reading-pane" id="pane"></div>
      </div>
    </div>`;

  document.getElementById('read-tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    _tab = b.dataset.t;
    document.querySelectorAll('#read-tabs button').forEach(x => x.classList.toggle('on', x === b));
    paintReadList();
  });
  paintStory();
}

/* the text itself, one span per word. Each token is a key into the story's
   glossary (st.g), which holds the meaning that word has in this story. */
function paintStory() {
  const st = _story, pane = document.getElementById('pane');
  if (!st || !pane) return;
  pane.innerHTML = st.seg.map(par => '<p>' + par.map(tk => {
    if (tk.br) return '<br>';               // a new speaker starts a new line
    if (typeof tk !== 'string') return esc(tk.s);
    const w = st.g[tk][0];
    return `<span class="w ${wordState(w)}" data-k="${esc(tk)}">${esc(w)}</span>`;
  }).join('') + '</p>').join('');
  pane.querySelectorAll('.w').forEach(el => {
    el.addEventListener('mouseenter', () => showWordPop(el));
    el.addEventListener('mouseleave', () => { if (!isTouch()) hideWordPop(); });
  });
  paintStatsCard();
  paintReadList();
}

function paintStatsCard() {
  const st = _story, box = document.getElementById('read-stats-card');
  if (!st || !box) return;
  const chars = st.c.map(r => r[0]);
  const learned = chars.filter(c => Store.status(c) === 'learned').length;
  const learning = chars.filter(c => Store.status(c) === 'learning').length;
  const fresh = chars.length - learned - learning;
  const pane = document.getElementById('pane');
  const on = k => !pane || !pane.classList.contains('hide-' + k);
  box.innerHTML = `
    <h3>Characters learned</h3>
    <p class="bigcount"><b>${learned}</b> / ${chars.length}</p>
    <div class="bar"><i style="width:${chars.length ? learned / chars.length * 100 : 0}%"></i></div>
    <div class="readfilters">
      <label><input type="checkbox" data-f="learned" ${on('learned') ? 'checked' : ''}>
        <i class="sw learned"></i> ${learned} learned</label>
      <label><input type="checkbox" data-f="learning" ${on('learning') ? 'checked' : ''}>
        <i class="sw learning"></i> ${learning} learning</label>
      <label><input type="checkbox" data-f="new" ${on('new') ? 'checked' : ''}>
        <i class="sw new"></i> ${fresh} new</label>
    </div>`;
  box.querySelectorAll('input[data-f]').forEach(cb => cb.addEventListener('change', () => {
    document.getElementById('pane').classList.toggle('hide-' + cb.dataset.f, !cb.checked);
  }));
}

let _cfilter = 'all';

function paintReadList() {
  const st = _story, box = document.getElementById('read-list');
  if (!st || !box) return;
  box.innerHTML = _tab === 'v' ? vocabList(st) : charList(st);

  const f = document.getElementById('cfilters');
  if (f) f.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    _cfilter = b.dataset.f;
    paintReadList();
  });
}

function vocabList(st) {
  if (!st.v.length) return '<p class="empty small">No multi-character words here.</p>';
  return '<h4 class="paneltitle">Vocabulary</h4>' + st.v.map(r => {
    const state = wordState(r[0]);
    return `<a class="vrow ${state}" href="#/character/${encodeURIComponent(r[0][0])}">
      <span class="vw han">${esc(r[0])}</span>
      <span class="vp">${esc(r[1] || '')}</span>
      <span class="vd">${esc(r[2] || '')}</span></a>`;
  }).join('');
}

/* the character list is filtered and ordered by frequency, like the dashboard */
function charList(st) {
  const inStory = {};
  st.c.forEach(r => { inStory[r[0]] = r; });
  const all = st.c.map(r => r[0])
    .sort((a, b) => ((HZ.index[a] || [])[0] || 99999) - ((HZ.index[b] || [])[0] || 99999));
  const stat = c => Store.status(c);
  const counts = {
    all: all.length,
    unknown: all.filter(c => !stat(c)).length,
    learning: all.filter(c => stat(c) === 'learning').length,
    learned: all.filter(c => stat(c) === 'learned').length,
  };
  const rows = all.filter(c => _cfilter === 'all' ? true
    : _cfilter === 'unknown' ? !stat(c) : stat(c) === _cfilter);

  const btn = (k, label, cls) =>
    `<button data-f="${k}" class="${_cfilter === k ? 'on ' : ''}${cls || ''}">${label} (${counts[k]})</button>`;

  return '<h4 class="paneltitle">Characters</h4>'
    + `<div class="filters tight" id="cfilters">
        ${btn('all', 'All')}${btn('unknown', 'Not known')}
        ${btn('learning', 'Learning', 'learning')}${btn('learned', 'Learned', 'learned')}
      </div>`
    + `<p class="band">${rows.length ? '1–' + rows.length : '—'}</p>`
    + (rows.length ? `<div class="crows">${rows.map(c => {
        const e = HZ.index[c] || [], r = inStory[c];
        return `<a class="crow ${stat(c) || ''}" href="#/character/${encodeURIComponent(c)}">
          <span class="han">${esc(c)}</span>
          <span class="rk">${e[0] ? '#' + e[0] : ''}</span>
          <span class="cp"><b>${esc(r[1])}</b> ${esc(r[2])}</span></a>`;
      }).join('')}</div>` : '<p class="empty small">Nothing in this group.</p>');
}

/* ---- hover popup: the word, then a control per character ---- */
let _wpEl = null, _wpHide = null;

function wordPop() {
  if (_wpEl) return _wpEl;
  _wpEl = document.createElement('div');
  _wpEl.id = 'word-pop';
  _wpEl.hidden = true;
  document.body.appendChild(_wpEl);
  _wpEl.addEventListener('mouseenter', () => clearTimeout(_wpHide));
  _wpEl.addEventListener('mouseleave', hideWordPop);
  _wpEl.addEventListener('click', e => {
    const l = e.target.closest('button[data-learn]');
    if (l && _wpAnchor && !Store.item(learnKey(l.dataset.learn))) {
      const a = _wpAnchor, [w, p, d] = _story.g[a.dataset.k];
      learnFromReader(w, p, d, sentenceAround(a, w)).then(() => {
        if (_wpAnchor === a) showWordPop(a);
        markNav(currentPath());
      });
      return;
    }
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    Store.setStatus(b.dataset.c, b.dataset.s || null);
    paintStory();
    const anchor = _wpAnchor;
    if (anchor && document.body.contains(anchor)) showWordPop(anchor);
    markNav(currentPath());
  });
  return _wpEl;
}

let _wpAnchor = null;

function showWordPop(el) {
  clearTimeout(_wpHide);
  const pop = wordPop();
  _wpAnchor = el;
  // pasted text may also name other likely senses (extra.alt) when context can't decide
  const [w, p, d, parts, extra] = _story.g[el.dataset.k];
  const alt = (extra && extra.alt) || [];
  const han = [...w].filter(isHan);
  const multi = han.length > 1;
  const row = (c, i) => {
    const st = Store.status(c) || '';
    const [cp, cg] = parts[i] || ['', ''];
    const btn = (v, label, cls) =>
      `<button type="button" data-c="${esc(c)}" data-s="${v}"` +
      `${st === v ? ' class="on ' + cls + '"' : ''}>${label}</button>`;
    // a one-character word already shows its meaning in the heading
    const meaning = multi
      ? `<span class="wp-cm"><b>${esc(cp)}</b> ${esc(cg)}</span>` : '';
    return `<div class="wp-char${multi ? ' multi' : ''}">
      <a class="wp-c han" href="#/character/${encodeURIComponent(c)}">${esc(c)}</a>
      <span class="wp-cbody">${meaning}${HZ.index[c]
        ? `<span class="seg3">${btn('', 'Not known', 'none')}${btn('learning', 'Learning', 'learning')}${btn('learned', 'Learned', 'learned')}</span>`
        : ''}</span>
    </div>`;
  };
  pop.innerHTML = `
    <div class="wp-head"><span class="han">${esc(w)}</span>
      <b>${esc(p)}</b><span class="wp-d">${esc(d)}</span></div>
    ${alt.map(([ap, ad]) => `<p class="wp-alt">or: <b>${esc(ap)}</b> ${esc(ad)}</p>`).join('')}
    <p class="wp-learn">${Store.item(learnKey(w))
      ? `<a href="#/study">✓ ${esc(Store.item(learnKey(w)).stage ? Learn.stageName(Store.item(learnKey(w)).stage) : 'In lessons')}</a>`
      : `<button type="button" data-learn="${esc(w)}">＋ Add to lessons</button>`}</p>
    ${han.map((c, i) => han.indexOf(c) === i ? row(c, i) : '').join('')}`;
  pop.hidden = false;

  const r = el.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
  let top = r.top - 8 - ph;
  if (top < 60) top = r.bottom + 8;
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
}

function hideWordPop() {
  clearTimeout(_wpHide);
  _wpHide = setTimeout(() => { if (_wpEl) _wpEl.hidden = true; }, 140);
}
window.addEventListener('scroll', () => { if (_wpEl) _wpEl.hidden = true; }, true);

document.addEventListener('click', () => {
  document.querySelectorAll('.dd-pop').forEach(p => { p.hidden = true; });
});

/* ============================ list pages ============================ */

function pageFrequency() {
  const all = byRank();
  app.innerHTML = '<h1 class="page-title">Most common characters</h1>' + withRail(`
    <section class="card">
      <p class="muted small">${num(all.length)} characters ranked by frequency in modern
         written Chinese. The number under each is its rank.</p>
      ${tileBoard('freq', all)}
    </section>`);
  wireTileBoard('freq', all, { band: 250 });
  paintRail();
}

async function pageHsk(level) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  await Promise.all([need.hskChars(), need.hsk()]);
  const chars = HZ.hskChars[String(level)] || [];
  const words = HZ.hsk[String(level)] || [];
  const learned = Store.chars('learned');
  const readable = words.filter(w => [...w[0]].every(c => !isHan(c) || learned.includes(c)));
  app.innerHTML = '<h1 class="page-title">HSK character lists</h1>' + withRail(`
    <p class="lede">Track your progress through the HSK levels. Each level lists the
       characters it introduces, then its vocabulary.</p>
    <div class="tabs">${[1, 2, 3, 4, 5, 6].map(n =>
      `<a class="${n === level ? 'on' : ''}" href="#/hsk-${n}">HSK ${n}</a>`).join('')}</div>
    <section class="card">
      <h2>Characters introduced at HSK ${level}</h2>
      ${chars.length ? tileBoard('hsk', chars) : '<p class="empty">No characters listed.</p>'}
    </section>
    <section class="card">
      <h2>HSK ${level} vocabulary <span class="muted">(${num(words.length)})</span></h2>
      <div class="bar accent"><i style="width:${words.length ? readable.length / words.length * 100 : 0}%"></i></div>
      <p class="small muted">${readable.length} of ${words.length} words use only characters
         you have marked as learned</p>
      <table><thead><tr><th>Word</th><th>Pinyin</th><th>Meaning</th></tr></thead><tbody>
        ${words.map(w => `<tr>
          <td class="g">${[...w[0]].map(c => HZ.index[c] ? charLink(c) : esc(c)).join('')}</td>
          <td><b>${esc(w[1])}</b></td><td class="muted">${esc(w[2])}</td></tr>`).join('')}
      </tbody></table>
    </section>`);
  if (chars.length) wireTileBoard('hsk', chars, { band: 100, label: c => (HZ.index[c] || [])[0] || '' });
  paintRail();
}

async function pageRadicals() {
  app.innerHTML = '<p class="muted">Loading…</p>';
  await optional(need.radicals());
  app.innerHTML = '<h1 class="page-title">The 214 Kangxi radicals</h1>' + withRail(`
    <p class="lede">Every character is filed under one of these. Tick the ones you know —
       they count towards your component knowledge.</p>
    <section class="card"><table>
      <thead><tr><th>#</th><th>Radical</th><th>Variants</th><th>Meaning</th>
        <th>Pinyin</th><th>Characters</th><th>Known</th></tr></thead>
      <tbody>${HZ.radicals.map(r => `<tr>
        <td class="num">${r[0]}</td><td class="g">${charLink(r[1])}</td>
        <td class="g" style="font-size:19px">${r[2].map(v => charLink(v)).join(' ')}</td>
        <td>${esc(r[3])}</td><td class="muted">${esc(r[5] || '')}</td>
        <td class="num">${num(r[4])}</td>
        <td><input type="checkbox" class="comp-known" data-c="${esc(r[1])}"
             ${Store.compKnown(r[1]) ? 'checked' : ''}></td></tr>`).join('')}
      </tbody></table></section>`);
  wireCompChecks();
  paintRail();
}

function wireCompChecks() {
  app.querySelectorAll('.comp-known').forEach(cb => cb.addEventListener('change', () => {
    Store.toggleComp(cb.dataset.c);
    paintRail();
  }));
}

async function pagePhonetic(degree, page) {
  degree = degree === 2 ? 2 : 1; page = page || 1;
  app.innerHTML = '<p class="muted">Loading…</p>';
  await optional(need.phon(degree));
  const all = HZ.phoneticSets[degree] || [], per = 30;
  const rows = all.slice((page - 1) * per, page * per);
  app.innerHTML = '<h1 class="page-title">Phonetic sets</h1>' + withRail(`
    <p class="lede">Many characters carry a built-in pronunciation hint. A phonetic set
       is a component together with the characters whose sound it predicts.</p>
    <div class="tabs">
      <a class="${degree === 1 ? 'on' : ''}" href="#/phonetic-sets/1">Degree one — exact, including tone</a>
      <a class="${degree === 2 ? 'on' : ''}" href="#/phonetic-sets/2">Degree two — tone may differ</a>
    </div>
    <div class="grid">${rows.map(r => `<div class="card">
      <p style="margin-bottom:9px"><a class="han" style="font-size:22px"
         href="#/character/${encodeURIComponent(r[0])}">${esc(r[0])}</a>
         <b>${esc(r[1] || '')}</b> <span class="muted small">· ${r[2]} characters</span></p>
      <div class="tilegrid">${r[3].map(m => tile(m[0], m[2])).join('')}</div>
    </div>`).join('') || '<p class="empty">Nothing here.</p>'}</div>
    ${pager('/phonetic-sets/' + degree, page, all.length, per)}`);
  paintRail();
}

async function pageProdComponents(page) {
  page = page || 1;
  app.innerHTML = '<p class="muted">Loading…</p>';
  await optional(need.components());
  const all = HZ.productiveComponents, per = 100;
  const rows = all.slice((page - 1) * per, page * per);
  app.innerHTML = '<h1 class="page-title">Productive components</h1>' + withRail(`
    <p class="lede">Which building blocks matter most. The score adds 1 ÷ frequency-rank
       for every character a component appears in, so parts used in common characters
       outrank ones buried in rare ones. Tick what you already know.</p>
    <section class="card"><table>
      <thead><tr><th>#</th><th>Part</th><th>Meaning</th><th>Pinyin</th>
        <th>In characters</th><th>Score</th><th>Known</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="num">${r[0]}</td><td class="g">${charLink(r[1])}</td>
        <td>${esc(r[2] || '—')}</td><td class="muted">${esc(r[3] || '')}</td>
        <td class="num">${num(r[4])}</td><td class="num">${r[5].toFixed(4)}</td>
        <td><input type="checkbox" class="comp-known" data-c="${esc(r[1])}"
             ${Store.compKnown(r[1]) ? 'checked' : ''}></td></tr>`).join('')}
      </tbody></table>
      ${pager('/productive-components', page, all.length, per)}</section>`);
  wireCompChecks();
  paintRail();
}

async function pageProdCharacters(page) {
  page = page || 1;
  app.innerHTML = '<p class="muted">Loading…</p>';
  await optional(need.prodchars());
  const all = HZ.productiveCharacters, per = 150;
  const rows = all.slice((page - 1) * per, page * per);
  app.innerHTML = '<h1 class="page-title">Productive characters</h1>' + withRail(`
    <p class="lede">Which characters unlock the most vocabulary. Ranked by the words each
       one forms, weighted by how common those words are: a word at position N in the word
       frequency list contributes 1/N. Only multi-character words count.</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
      ${rows.map(r => `<a class="card" style="display:flex;gap:11px;align-items:center;margin:0"
         href="#/character/${encodeURIComponent(r[1])}">
         <span class="muted num">${r[0]}</span>
         <span class="han" style="font-size:26px;color:var(--accent)">${esc(r[1])}</span>
         <span><b>${num(r[5])}</b> words<br>
           <span class="muted small">${esc(r[3] || '')}</span></span></a>`).join('')}
    </div>
    ${pager('/productive-characters', page, all.length, per)}`);
  paintRail();
}

/* ============================ personal pages ============================ */

function pageLists() {
  const d = Store.load();
  const learned = Store.chars('learned'), learning = Store.chars('learning');
  app.innerHTML = `<h1 class="page-title">Your lists</h1>` + withRail(`
    <section class="card">
      <div class="spread"><h2>Learned</h2><span class="muted small">${learned.length}</span></div>
      <div class="chips">${learned.map(c => chip(c)).join('') || '<span class="empty">Nothing yet.</span>'}</div>
    </section>
    <section class="card">
      <div class="spread"><h2>Learning</h2><span class="muted small">${learning.length}</span></div>
      <div class="chips">${learning.map(c => chip(c)).join('') || '<span class="empty">Nothing yet.</span>'}</div>
    </section>
    ${d.lists.map(l => `<section class="card">
      <div class="spread"><h2>${esc(l.name)}</h2>
        <span><span class="muted small">${l.chars.length}</span>
        <button class="more del-list" data-id="${esc(l.id)}">Delete</button></span></div>
      <div class="chips">${l.chars.map(c => chip(c)).join('')
        || '<span class="empty">Empty — add characters from their page.</span>'}</div>
    </section>`).join('')}
    <section class="card"><div class="row">
      <input id="newlist" placeholder="New list name" style="flex:1;font:inherit;padding:8px 12px;
        border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)">
      <button class="btn" id="mklist">Create list</button></div></section>`);
  document.getElementById('mklist').addEventListener('click', () => {
    const v = document.getElementById('newlist').value.trim();
    if (v) { Store.addList(v); render(); }
  });
  app.querySelectorAll('.del-list').forEach(b => b.addEventListener('click', () => {
    if (!confirm('Delete this list?')) return;
    const d2 = Store.load();
    d2.lists = d2.lists.filter(x => x.id !== b.dataset.id);
    Store.save(); render();
  }));
  paintRail();
}

function pageNotes() {
  const d = Store.load(), keys = Object.keys(d.notes);
  app.innerHTML = '<h1 class="page-title">Notes</h1>' + withRail(
    keys.length ? keys.map(c => `<section class="card">
      <h2>${charLink(c, 'han')} <span class="muted">${esc((HZ.index[c] || [])[2] || '')}</span></h2>
      <p style="white-space:pre-wrap">${esc(d.notes[c])}</p></section>`).join('')
    : '<div class="card"><p class="empty">No notes yet — write one on any character page.</p></div>');
  paintRail();
}

function pageHistory() {
  const d = Store.load();
  app.innerHTML = '<h1 class="page-title">History</h1>' + withRail(`
    <section class="card">
      <h2>Recent searches</h2>
      ${d.history.length ? `<div class="tilegrid">${d.history.map(h => tile(h.c)).join('')}</div>`
        : '<p class="empty">Nothing yet.</p>'}
    </section>`);
  paintRail();
}

function pageSettings() {
  const d = Store.load();
  app.innerHTML = '<h1 class="page-title">Settings</h1>' + withRail(`
    ${window.hanzihomeDesktop ? '<section class="card" id="desktop-card"><h2>Desktop app</h2></section>' : ''}
    <section class="card">
      <h2>Appearance</h2>
      <div class="st-field"><div class="st-label">Theme</div>
        <select class="st-select" id="theme">${[['system', 'Same as this device'], ['light', 'Light'], ['dark', 'Dark']]
          .map(([v, l]) => `<option value="${v}"${theme() === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <p class="st-note">Kept on this device only, so a phone can be dark and a laptop light.</p></div>
    </section>
    <section class="card" id="study-card"></section>
    <section class="card">
      <h2>Learning goal</h2>
      <p class="muted small">How many of the most frequent characters the dashboard tracks.</p>
      <div class="row"><input id="goal" type="number" min="100" max="9933" value="${d.goal}"
        style="width:120px;font:inherit;padding:8px 12px;border:1px solid var(--line);
        border-radius:8px;background:var(--bg);color:var(--ink)">
        <button class="btn" id="savegoal">Save</button></div>
    </section>
    <section class="card" id="sync-card">
      <h2>Sync with Google Sheets</h2>
      ${syncCardBody()}
    </section>
    <section class="card">
      <h2>Your data</h2>
      <p class="muted small">Progress lives in this browser's localStorage. Unless you turn on
         sync above, nothing leaves the machine. Export keeps a copy you can re-import later.</p>
      <div class="row">
        <button class="btn quiet" id="export">Export JSON</button>
        <button class="btn quiet" id="import">Import JSON</button>
        <button class="btn quiet" id="import-file">Import a file…</button>
        <input type="file" id="import-pick" accept=".json,application/json" hidden>
        <button class="btn quiet" id="reset">Reset everything</button></div>
      <textarea id="io" rows="4" style="width:100%;margin-top:11px;display:none;font:inherit;
        padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)"></textarea>
    </section>
    <section class="card">
      <h2>Data set</h2>
      <ul class="facts">
        <li><b>${num(+HZ.meta.n_chars)}</b> characters indexed</li>
        <li><b>${num(+HZ.meta.n_ranked)}</b> in the frequency list</li>
        <li><b>${num(+HZ.meta.n_words)}</b> words</li>
      </ul>
      <p class="small muted">Built from CC-CEDICT, cjk-decomp, Jun Da's character frequency
         list, jieba word counts, Make Me a Hanzi and the HSK vocabulary lists.</p>
    </section>`);
  document.getElementById('savegoal').addEventListener('click', () => {
    const v = parseInt(document.getElementById('goal').value, 10);
    if (v > 0) { Store.load().goal = v; Store.save(); go('/dashboard'); }
  });
  const io = document.getElementById('io');
  document.getElementById('export').addEventListener('click', () => {
    io.style.display = 'block'; io.value = JSON.stringify(Store.load()); io.select();
  });
  document.getElementById('import').addEventListener('click', () => {
    if (io.style.display === 'none') { io.style.display = 'block'; io.value = ''; io.focus(); return; }
    try {
      localStorage.setItem(Store.key, JSON.stringify(JSON.parse(io.value)));
      Store.data = null; Store.load(); Store.save(); render();
    } catch (e) { alert('That is not valid JSON.'); }
  });
  // a file exported earlier, or a recovered copy: it replaces what is here
  document.getElementById('import-file').addEventListener('click', () => document.getElementById('import-pick').click());
  document.getElementById('import-pick').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (err) { alert('That file is not valid JSON.'); return; }
    if (!data || typeof data !== 'object' || !data.status) { alert('That file is not a HanziHome export.'); return; }
    const count = Object.keys(data.status).length;
    if (!confirm(`Replace this device's progress with the file's (${count} characters marked)?`)) return;
    localStorage.setItem(Store.key, JSON.stringify(data));
    if (Sync.on()) Sync.update({ held: null });
    Store.data = null; Store.load(); Store.save(); render();
  });
  document.getElementById('reset').addEventListener('click', () => {
    const msg = Sync.on() ? 'Erase all progress, lists and notes? This also empties the synced copy in your Google Sheet.'
                          : 'Erase all progress, lists and notes?';
    if (confirm(msg)) {
      Sync.update({ reset: true, held: null });     // (the script only lets an emptied copy through on purpose)
      localStorage.removeItem(Store.key); Store.data = null; Store.load(); Store.save(); render();
    }
  });
  document.getElementById('theme').addEventListener('change', e => { setTheme(e.target.value); render(true); });
  wireSyncCard();
  paintStudySettings();
  paintRail();
  if (window.hanzihomeDesktop) window.hanzihomeDesktop.settings().then(paintDesktopCard);
}

/* the app's version, and what its updates are doing (desktop/src/updates.js) */
function desktopUpdateLine(state) {
  const u = state.update || {};
  if (!state.version) return '';
  const button = (what, label) => `<button type="button" class="btn quiet" id="dk-update" data-what="${what}">${label}</button>`;
  const say = {
    off: 'Updates come with the installed app.',
    idle: 'Looks for a newer version every few hours. ' + button('check', 'Check now'),
    checking: 'Looking for a newer version…',
    downloading: `Downloading version ${esc(u.version || '')}…`,
    ready: `Version ${esc(u.version || '')} is ready and installs when you quit. ` + button('install', 'Restart now'),
    error: `Couldn't check for updates${u.error ? ` (${esc(u.error)})` : ''}. ` + button('check', 'Try again'),
  }[u.status] || '';
  return `<p class="small muted dk-update">HanziHome ${esc(state.version)}. ${say}</p>`;
}

/* Desktop app only: its switches for the rest of the screen, the same ones the
   tray menu has, plus start with Windows and the programs to pause in. */
function paintDesktopCard(state) {
  const box = document.getElementById('desktop-card');
  if (!box || !state) return;
  const s = state.settings, D = window.hanzihomeDesktop;
  const set = patch => D.set(patch).then(paintDesktopCard);
  const check = (id, on, label, off) =>
    `<label class="dk-row"><input type="checkbox" id="${id}"${on ? ' checked' : ''}${off ? ' disabled' : ''}> ${label}</label>`;
  const suggest = state.recent.filter(n => !s.pause.includes(n));
  box.innerHTML = `
    <h2>Desktop app</h2>
    <p class="muted small">How HanziHome works on the rest of your screen. The tray icon has the same switches.</p>
    ${check('dk-overlay', s.overlay, 'Colour words on screen')}
    <div class="dk-indent">
      ${check('dk-learned', s.show.learned, '<i class="sw learned"></i> Learned', !s.overlay)}
      ${check('dk-learning', s.show.learning, '<i class="sw learning"></i> Learning', !s.overlay)}
      ${check('dk-new', s.show.new, '<i class="sw new"></i> New', !s.overlay)}
    </div>
    <label class="dk-row">Look-up key
      <select id="dk-key">${[['ctrl', 'Ctrl'], ['alt', 'Alt'], ['shift', 'Shift'], ['off', 'Off']]
        .map(([k, l]) => `<option value="${k}"${s.hoverKey === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="small muted dk-note">Hold it and point at a word for its meaning. Alt makes some programs open their menus when you let go.</p>
    ${check('dk-direct', s.directText !== false, 'Take text straight from programs that offer it')}
    <p class="small muted dk-note">Browsers, Word, Notepad and most programs hand over their text: exact, and much
      quicker than reading the screen, which is then only read for the rest (pictures, video, games).</p>
    ${check('dk-auto', state.autostart, 'Start with Windows', !state.canAutostart)}
    ${state.canAutostart ? '' : '<p class="small muted dk-note">Only the installed app can start with Windows.</p>'}
    ${desktopUpdateLine(state)}
    <h3 class="dk-h">Pause in these programs</h3>
    <p class="small muted">While one of them is in front, the colours and look-ups stay out of the way: for games, say.</p>
    <div class="dk-chips">${s.pause.map(n => `<span class="dk-chip">${esc(n)}
      <button type="button" data-unpause="${esc(n)}" aria-label="Stop pausing in ${esc(n)}">×</button></span>`).join('')
      || '<span class="small muted">None yet.</span>'}</div>
    ${suggest.length ? `<p class="small muted dk-recent">In front lately: ${suggest.map(n =>
      `<button type="button" class="btn quiet" data-pause="${esc(n)}">+ ${esc(n)}</button>`).join(' ')}</p>` : ''}
    <div class="row"><input id="dk-add" class="dk-input" placeholder="Program name, like eldenring" spellcheck="false">
      <button type="button" class="btn quiet" id="dk-addbtn">Add</button></div>`;

  const on = id => document.getElementById(id).checked;
  document.getElementById('dk-overlay').addEventListener('change', () => set({ overlay: on('dk-overlay') }));
  for (const k of ['learned', 'learning', 'new']) {
    document.getElementById('dk-' + k).addEventListener('change', () => set({ show: { [k]: on('dk-' + k) } }));
  }
  document.getElementById('dk-key').addEventListener('change', e => set({ hoverKey: e.target.value }));
  document.getElementById('dk-direct').addEventListener('change', () => set({ directText: on('dk-direct') }));
  document.getElementById('dk-auto').addEventListener('change', () => set({ autostart: on('dk-auto') }));
  const upd = document.getElementById('dk-update');
  if (upd) upd.addEventListener('click', () => D.update(upd.dataset.what));
  box.querySelectorAll('[data-unpause]').forEach(b => b.addEventListener('click', () =>
    set({ pause: s.pause.filter(n => n !== b.dataset.unpause) })));
  box.querySelectorAll('[data-pause]').forEach(b => b.addEventListener('click', () =>
    set({ pause: s.pause.concat(b.dataset.pause) })));
  const add = () => {
    const v = document.getElementById('dk-add').value.trim();
    if (v) set({ pause: s.pause.concat(v) });
  };
  document.getElementById('dk-addbtn').addEventListener('click', add);
  document.getElementById('dk-add').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
}

function syncCardBody() {
  const c = Sync.cfg();
  const steps = `<details class="sync-help">
      <summary>How to set it up (about 5 minutes)</summary>
      <ol>
        <li>Create a new Google Sheet, then choose <b>Extensions → Apps Script</b>.</li>
        <li>Replace the editor's contents with
          <a href="https://github.com/EidurEwan/hanzihome/blob/main/sync/Code.gs" target="_blank" rel="noopener">sync/Code.gs</a>
          and save.</li>
        <li><b>Deploy → New deployment</b>, type <b>Web app</b>. Execute as <b>Me</b>, who has
          access <b>Anyone</b>. Authorise it, then copy the web app URL (it ends in <code>/exec</code>).</li>
        <li>Paste the URL into this card. Do the same in every browser you use.</li>
      </ol>
      <p class="small muted">The script can only open the one Sheet it is attached to. "Anyone" lets
        your browsers reach it without signing in, so anyone with the URL can read and change your
        synced progress. Keep the URL to yourself, and lock it with a passphrase once connected.
        After editing the script later, deploy a new version of the same deployment so the URL stays the same.</p>
    </details>`;
  if (c) {
    return `<p class="muted small">This browser keeps its progress in step with your Google Sheet.
        Changes are sent a few seconds after you make them and picked up when you come back to the tab.</p>
      <p class="small sync-line" id="sync-status"></p>
      <div id="sync-held" class="sync-held" hidden>
        <p class="small">Which copy should both keep?</p>
        <div class="row">
          <button class="btn" id="sync-keep">Keep this device's data</button>
          <button class="btn quiet" id="sync-take">Use the synced copy</button>
        </div>
        <p class="small muted">Keeping this device's data also keeps anything the synced copy has that this
          device doesn't. The synced copy's earlier versions are below, if the script keeps them.</p>
      </div>
      <div id="sync-help-box"></div>
      <div id="sync-lock-box"></div>
      <div class="row">
        <button class="btn" id="sync-now">Sync now</button>
        <button class="btn quiet" id="sync-backups">Earlier copies…</button>
        <button class="btn quiet" id="sync-off">Disconnect</button>
      </div>
      <div id="sync-backup-list"></div>
      ${steps}`;
  }
  return `<p class="muted small">Keep your statuses, lists, notes and study schedule in step across
      browsers and devices. It uses a small Google Apps Script in your own Google account, and your
      data is stored in a Google Sheet you own.</p>
    <div class="sync-form">
      <label>Web app URL<input id="sync-url" type="url" spellcheck="false" autocomplete="off"
        placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label>Passphrase <span class="muted">(only if you locked it)</span><input id="sync-key-new" type="password"
        autocomplete="off"></label>
      <div class="row"><button class="btn" id="sync-connect">Connect</button>
        <span class="small" id="sync-msg"></span></div>
      <div id="sync-help-box"></div>
    </div>
    ${steps}`;
}

/* shown under the form or status line when the script can't be reached */
function syncTroubleHtml(url) {
  return `<div class="sync-trouble">
    <p><b>Open <a href="${esc(url)}" target="_blank" rel="noopener">the web app URL</a> in a new tab</b> to see why:</p>
    <ul>
      <li><b>{"ok":true, … "version":3, "sheet":"ok"}</b>: the script works. Now open the same URL in a
        <b>private window</b>. The site isn't signed in to Google, so that is what it sees.</li>
      <li><b>A Google sign-in page, or "You need access"</b> (often only in the private window): set <i>Execute as</i> to
        <b>Me</b> and <i>Who has access</i> to <b>Anyone</b> (not "Anyone with Google account"), under
        <b>Deploy → Manage deployments → Edit</b>.</li>
      <li><b>"sheet":"error"</b> with a "problem": the script can't open its Sheet; the message says why.</li>
      <li><b>"hint"</b>, or a version below 3: the deployment runs old code. Paste the current Code.gs, save, then
        <b>Manage deployments → Edit → Version: New version → Deploy</b>.</li>
      <li><b>"Script function not found: doGet"</b>: the code wasn't saved when you deployed. Save it, then
        <b>Manage deployments → Edit → Version: New version → Deploy</b>.</li>
      <li><b>"Sorry, unable to open the file"</b>: the URL is incomplete. Copy it again from <b>Deploy → Manage deployments</b>.</li>
      <li><b>"Authorization is required"</b>: open the script, run <code>doGet</code> once from the editor and allow access.</li>
    </ul>
    <p class="muted">School or work Google accounts sometimes don't allow <i>Anyone</i>. If the option is missing, use a personal Google account.</p>
  </div>`;
}

/* catch the links people most often paste instead of the /exec URL */
function syncUrlProblem(url) {
  if (/docs\.google\.com\/spreadsheets/.test(url)) return "That's the Sheet's link. Use the web app URL from Deploy → Manage deployments.";
  if (/script\.google\.com\/(home|d\/|u\/\d+\/home)/.test(url)) return "That's the script editor's link. Use the web app URL from Deploy → Manage deployments.";
  if (/\/dev(\?|$)/.test(url)) return "That's the test deployment URL (ending in /dev), which only works while you're signed in to the editor. Use the URL ending in /exec.";
  if (/script\.google(usercontent)?\.com/.test(url) && !/\/exec(\?|$)/.test(url)) return 'The web app URL ends in /exec. Copy it again from Deploy → Manage deployments.';
  if (!/^https:\/\/\S+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) return 'Paste the web app URL from the deployment (https://script.google.com/…/exec).';
  return '';
}

function wireSyncCard() {
  const $ = id => document.getElementById(id);
  if ($('sync-connect')) {
    $('sync-connect').addEventListener('click', async () => {
      const url = $('sync-url').value.trim();
      const msg = $('sync-msg');
      msg.classList.remove('sync-err');
      const help = $('sync-help-box');
      help.innerHTML = '';
      const problem = syncUrlProblem(url);
      if (problem) { msg.textContent = problem; msg.classList.add('sync-err'); return; }
      $('sync-connect').disabled = true;
      msg.textContent = 'Connecting…';
      try {
        await Sync.connect(url, $('sync-key-new').value);
        if (Sync.error) throw new Error(Sync.error);
        render(true);
      } catch (e) {
        msg.textContent = e.message; msg.classList.add('sync-err');
        if (e.code === 'unreachable' || Sync.errorCode === 'unreachable') help.innerHTML = syncTroubleHtml(url);
        $('sync-connect').disabled = false;
      }
    });
  }
  if ($('sync-now')) $('sync-now').addEventListener('click', () => Sync.run());
  if ($('sync-keep')) $('sync-keep').addEventListener('click', () => Sync.keepHere());
  if ($('sync-take')) $('sync-take').addEventListener('click', () => {
    if (confirm('Replace this device’s data with the synced copy? It has far less in it.')) Sync.takeThere();
  });
  if ($('sync-backups')) $('sync-backups').addEventListener('click', async () => {
    const box = $('sync-backup-list');
    box.innerHTML = '<p class="small muted">Asking the script…</p>';
    let list;
    try { list = await Sync.backups(); } catch (e) { box.innerHTML = `<p class="small sync-err">${esc(e.message)}</p>`; return; }
    if (!list) {
      box.innerHTML = `<p class="small muted">Your deployment's script keeps no earlier copies. Update it to the current
        sync/Code.gs (version ${SCRIPT_VERSION}) and it keeps the last 30.</p>`;
      return;
    }
    box.innerHTML = list.length ? `<ul class="sync-backups">${list.map(b => `<li>
      <span>${esc(new Date(b.time).toLocaleString())}</span><span class="muted">${b.heft} entries · version ${b.rev}</span>
      <button class="btn quiet" data-restore="${b.rev}">Restore</button></li>`).join('')}</ul>`
      : '<p class="small muted">No earlier copies yet: one is kept at most every half hour, as copies are saved.</p>';
    box.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Put this copy back? It becomes the synced copy on every device.')) return;
      b.disabled = true;
      try { await Sync.restore(+b.dataset.restore); render(true); }
      catch (e) { box.insertAdjacentHTML('beforeend', `<p class="small sync-err">${esc(e.message)}</p>`); }
    }));
  });
  if ($('sync-off')) {
    $('sync-off').addEventListener('click', () => {
      if (confirm('Stop syncing this browser? Your progress stays here, and the Google Sheet keeps its copy.')) {
        Sync.disconnect(); render(true);
      }
    });
  }
  Sync.paint();
}

/* ============================ appearance ============================
   Light or dark: the device's preference unless Settings says otherwise. The
   choice is this device's own (localStorage, not the synced store); index.html
   applies it before the page draws, so a dark page never flashes white. */
const THEME_KEY = 'hanzihome.theme';
function theme() {
  try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch (e) { return 'system'; }
}
function setTheme(t) {
  try { t === 'system' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, t); } catch (e) { /* this visit only */ }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
// a page drawn with the theme's colours (stroke order) follows the device switching
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme() === 'system') render(true); });

/* ============================ dispatch ============================ */

function render(keepScroll) {
  _boardUpdate = null;
  const path = currentPath();
  markNav(path);
  setNav(false);
  if (!keepScroll) window.scrollTo(0, 0);
  const seg = path.split('/').filter(Boolean);
  const n = i => parseInt(seg[i], 10) || 1;
  leaveStudy(seg[0]);

  if (path === '/' || seg[0] === 'dashboard') return pageDashboard();
  if (seg[0] === 'character') return pageCharacter(seg.slice(1).join('/'));
  if (seg[0] === 'search') return pageSearch(seg.slice(1).join('/'));
  if (seg[0] === 'study') return pageStudy();
  if (seg[0] === 'lessons') return pageLessons();
  if (seg[0] === 'reviews') return pageReviews();
  if (seg[0] === 'calibrate') return pageCalibrate();
  if (seg[0] === 'reader') return seg[1] ? pageStory(seg[1]) : pageReader();
  if (seg[0] === 'screen') return pageScreen();
  if (seg[0] === 'frequency') return pageFrequency();
  if (seg[0] === 'radicals') return pageRadicals();
  if (seg[0] === 'phonetic-sets') return pagePhonetic(n(1), n(2));
  if (seg[0] === 'productive-components') return pageProdComponents(n(1));
  if (seg[0] === 'productive-characters') return pageProdCharacters(n(1));
  if (/^hsk-\d$/.test(seg[0] || '')) return pageHsk(+seg[0].slice(4));
  if (seg[0] === 'lists') return pageLists();
  if (seg[0] === 'notes') return pageNotes();
  if (seg[0] === 'history') return pageHistory();
  if (seg[0] === 'settings') return pageSettings();

  app.innerHTML = `<div class="card"><h1>Not found</h1>
    <p class="empty">No page at ${esc(path)}.</p>
    <p><a href="#/dashboard">Go to the dashboard</a></p></div>`;
}

/* the sidebar slides in on narrow screens; body.nav-open drives the scrim */
function setNav(open) {
  document.getElementById('sidebar').classList.toggle('open', open);
  document.body.classList.toggle('nav-open', open);
}
document.getElementById('sidebar-toggle').addEventListener('click', e => {
  e.stopPropagation();
  setNav(!document.getElementById('sidebar').classList.contains('open'));
});

/* one outside-tap handler for everything that floats */
document.addEventListener('pointerdown', e => {
  const t = e.target;
  if (document.body.classList.contains('nav-open')
      && !t.closest('#sidebar') && !t.closest('#sidebar-toggle')) setNav(false);
  if (_menuEl && !_menuEl.hidden && !t.closest('#tile-menu')
      && !(_menuAnchor && _menuAnchor.contains(t))) {
    _menuEl.hidden = true;
    if (_menuAnchor) { _menuAnchor.classList.remove('hot'); _menuAnchor = null; }
  }
  if (_wpEl && !_wpEl.hidden && !t.closest('#word-pop') && !t.closest('.reading-pane .w')) {
    _wpEl.hidden = true;
  }
}, true);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  setNav(false);
  if (_menuEl) _menuEl.hidden = true;
  if (_wpEl) _wpEl.hidden = true;
});

initSearch();
if (!location.hash) location.hash = '#/dashboard';
render();
tellDesktop();
if (window.hanzihomeDesktop) {
  document.getElementById('nav-screen').hidden = false;
  window.hanzihomeDesktop.onSettings(paintDesktopCard);   // the tray changed something
}

/* sync: on load, when the tab comes back, every few minutes while open, and a
   last push when the tab is hidden with changes still waiting */
Sync.paint();
Sync.run();
document.addEventListener('visibilitychange', () => {
  if (!Sync.on()) return;
  if (document.visibilityState === 'hidden') { if ((Sync.cfg() || {}).dirty) Sync.run(); }
  else if (Date.now() - Sync.lastRun > 30000) Sync.run();
});
setInterval(() => { if (document.visibilityState === 'visible' && Sync.on()) Sync.run(); }, 5 * 60 * 1000);
setInterval(() => Sync.paint(), 60 * 1000);

/* another tab (or the desktop app's second window, from a review's "open in a new
   tab") saved the store: start again from its copy, so neither overwrites the other */
window.addEventListener('storage', e => {
  if (e.key !== Store.key) return;
  Store.data = null;
  tellDesktop();
  markNav(currentPath());
});
