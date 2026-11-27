/* study.js — lessons and reviews, drawn the way HanziHero draws them.
 *
 * Characters and words go into a lesson queue from a character's page or the
 * reader's word popup (Store.learnAdd), each remembering the sentence it was met
 * in. A lesson shows the item's parts, your mnemonic and examples, then asks for
 * its pinyin and meaning; after that it comes back in reviews on learn.js's
 * schedule, which asks both again. Everything lives in the store, so it syncs.
 * HanziHero's application settings (limits, unlocking, ordering, sounds, vacation)
 * are on the Settings page; Store.plan() applies them.
 *
 * Loaded before app.js, whose helpers (app, esc, withRail, charData, Store, …)
 * these functions use when they run. */

'use strict';

let lessonState = null, reviewState = null;

/* the router calls this on every page: leaving a session ends it */
function leaveStudy(page) {
  if (page !== 'lessons') lessonState = null;
  if (page !== 'reviews') reviewState = null;
}

// ------------------------------------------------------------------ helpers

/* 'rèn shi' -> 'ren4shi5', how HanziHero writes it and how answers are typed */
function numbered(pin) {
  return String(pin || '').split(/\s+/).filter(Boolean).map(s => {
    const p = Learn.parsePinyin(s);
    return p.letters.replace(/v/g, 'ü') + (p.tones[0] || 5);
  }).join('');
}

/* is this answer a meaning in its own right: of a character in the dictionary, or of
   one of your items? Then it is not let through as a typo of another meaning (tell for
   sell). Built at the first answer of a session (about a tenth of a second; the words'
   ninety thousand meanings would take five times that and add little). */
let wordSet = null;
function isWord(a) {
  if (!wordSet) {
    wordSet = new Set();
    for (const e of Object.values(HZ.index)) Learn.meanings({ mean: e[3] }).forEach(m => wordSet.add(m));
    for (const it of Object.values(Store.load().items)) Learn.meanings(it).forEach(m => wordSet.add(m));
  }
  return wordSet.has(a);
}

const kindName = it => ({ word: 'Word', comp: 'Component', sound: 'Sound' })[it.kind] || 'Character';

/* what Store.plan() needs to know about characters, for unlocking: how far along each
   is (its item's stage, or 5 when marked Known without one), and a
   character's components (kept on its item once looked up) */
function learnEnv() {
  const d = Store.load();
  const level = c => {
    if (!HZ.index[c]) return null;                    // not a character to wait for
    const it = d.items[c], st = d.status[c];
    // (a lesson makes a character Known as well: its stage says how far along it really is)
    return it ? it.stage || 0 : st === 'learned' ? Learn.LEARNED_FROM : 0;
  };
  return {
    level,
    comps: k => (d.items[k] && d.items[k].cm) || null,
    compOk: (c, need) => !!d.comps[c] || (level(c) || 0) >= need,
  };
}

/* a character's reading and meaning for a new item; in a word, the reading the word
   gives it (觉 in 睡觉 is jiào) when the readings are loaded */
function charInfo(c, syl) {
  const e = HZ.index[c] || [], all = String(e[3] || '');
  const info = { pin: e[2] || '', mean: all.split(/;\s*/).filter(x => !/…$/.test(x)).join('; ') || all };
  const r = syl && HZ.readings && (HZ.readings[c] || []).find(x => x[0].toLowerCase() === syl.toLowerCase());
  if (r && r[0] !== info.pin) Object.assign(info, { pin: r[0], mean: r[1].slice(0, 2).join('; '), alts: r[1].slice(0, 6) });
  return info;
}

/* ------------------------------------------------ parts: components and sounds

   A character is learnt from its parts, as HanziHero teaches it: its components
   (the first level of its breakdown, or itself when it is a component of others, as
   半 is) and its sound: an initial, a final and a tone (site/data/sounds.js: a person,
   a building, and where at that building). Each part not known yet gets a short lesson of its own just
   before the character (Learn.plan puts it there), which opens on a Prerequisites
   page showing the character and which of its parts you know.

   Parts are items too, under keys of their own: c:半 a component (the character 半 is
   another item), i:b an initial (i: for none), f:an a final, t:4 a tone. */

const partKind = k => /^c:/.test(k) ? 'comp' : /^[ift]:/.test(k) ? 'sound' : null;
const glyphOf = k => /^c:/.test(k) ? k.slice(2) : k;
const finalText = f => f.replace(/^v/, 'ü').replace('ih', 'i');
/* an item's key as shown: 半, b-, -an, 4 */
function itemText(k) {
  if (k.startsWith('c:')) return k.slice(2);
  const S = HZ.sounds, v = k.slice(2);
  if (k.startsWith('i:')) return ((S && S.initials[v] && S.initials[v][2]) || v || 'Ø') + '-';
  if (k.startsWith('f:')) return (S && S.finals[v] && S.finals[v][2]) || '-' + finalText(v);
  if (k.startsWith('t:')) return k.slice(2);
  return k;
}
const itemHtml = k => partKind(k) === 'sound' ? `<span class="snd-key">${esc(itemText(k))}</span>` : zh(glyphOf(k));
/* where an item's own page is */
function itemHref(k) {
  const it = Store.item(k);
  if (partKind(k) === 'sound') return soundHref(k);
  if (it && it.kind === 'word') return '#/word/' + encodeURIComponent(k);
  return '#/character/' + encodeURIComponent(glyphOf(k));
}
/* a sound part's page in the sound library (library.js); no initial is "none" */
const soundHref = k => '#/sounds/' + { i: 'beginning', f: 'ending', t: 'tone' }[k[0]] + '/' + (k.slice(2) || 'none');
/* A reading's sounds as chips: each syllable's beginning, ending and tone. For a mnemonic
   that doesn't carry them in its story (words, your own, characters with no scene yet);
   linked to the library, except in a lesson or review, which a link would walk out of. */
function soundStrip(pin, link) {
  if (!HZ.sounds || !pin) return '';
  const syls = String(pin).trim().split(/\s+/).map(syl => {
    const parts = soundParts(syl);
    if (!parts.length) return '';
    const chip = p => {
      const inner = `<span class="snd-key">${esc(itemText(p))}</span>${esc(partName(p))}`;
      return link ? `<a class="mn-chip snd" href="${soundHref(p)}">${inner}</a>` : `<span class="mn-chip snd">${inner}</span>`;
    };
    return `<span class="snd-syl"><b>${esc(syl)}</b> ${parts.map(chip).join(' ')}</span>`;
  }).filter(Boolean);
  return syls.length ? `<p class="snd-strip">${syls.join('')}</p>` : '';
}
/* a sound part's picture: [name, why] */
function soundInfo(k) {
  const S = HZ.sounds || {}, v = k.slice(2);
  return ((k[0] === 'i' ? S.initials : k[0] === 'f' ? S.finals : S.tones) || {})[v] || [itemText(k), ''];
}
/* a part's name, as its lesson teaches it */
const partName = k => partKind(k) === 'sound' ? soundInfo(k)[0] : compName(glyphOf(k));

/* the sound parts of a reading */
function soundParts(pin) {
  if (!pin) return [];
  const s = Learn.soundOf(pin);
  if (!HZ.sounds || !HZ.sounds.initials[s.initial] || !HZ.sounds.finals[s.final]) return [];
  return ['i:' + s.initial, 'f:' + s.final, 't:' + s.tone];
}

/* a character's component parts, from its breakdown (data/c/): itself when it is a
   named component (半), else the first-level parts that have a picture name, going one
   level further down for a part that has none */
function compParts(k, cd) {
  const named = c => HZ.cnames && HZ.cnames[c];
  if (named(k)) return ['c:' + k];
  const out = [];
  const walk = (nodes, depth) => {
    for (const [c, kids] of nodes || []) {
      if (c === k) continue;
      if (named(c)) out.push('c:' + c);
      else if (depth < 2) walk(kids, depth + 1);
    }
  };
  walk(cd && cd.bd ? cd.bd[1] : [], 0);
  return [...new Set(out)];
}

/* the reading a character's lesson teaches: the reviewed key's (长 cháng "long"),
   unless it came from a sentence, where the reading it had there wins */
function teachReading(k, it, cd) {
  const cm = HZ.cmnem && HZ.cmnem[k];
  if (!cm || it.stage || (it.ex && it.ex.text)) return;
  const row = cm[2] && cm[2] !== it.pin && (cd.rd || []).find(x => x[1] === cm[2]);
  if (row) { it.pin = row[1]; it.alts = row[2].slice(0, 6); it.mean = row[2].slice(0, 2).join('; '); }
  if (!String(it.mean).toLowerCase().startsWith(cm[0].toLowerCase())) it.mean = cm[0] + '; ' + it.mean;
}

/* look up a character's parts and keep them on its item (it.cm: its components, for
   "unlock when its components are…"; it.parts: what it is learnt from); the ones not
   known yet join the lessons */
async function rememberParts(k) {
  const r = await optional(Promise.all([charData(k), need.cnames(), need.cmnem(), need.sounds()]));
  const cd = r && r[0], it = Store.item(k);
  if (!cd || !it) return;
  if (!it.cm) it.cm = cd.cm || [];
  teachReading(k, it, cd);
  it.parts = compParts(k, cd).concat(soundParts(it.pin));
  if (!it.stage) addParts(it.parts);
  Store.save();
}

/* a part is known once its lesson is done; a component also when ticked, or when it
   is a character marked learned */
const partKnown = p => {
  const it = Store.item(p);
  if (it && it.stage >= 1) return true;
  return partKind(p) === 'comp' && Store.compKnown(glyphOf(p));
};

/* "Teach components and sounds first" (Settings): a lesson for each part not known */
function addParts(parts) {
  if (!Store.cfg().autoComps) return;
  const d = Store.load(), now = Date.now();
  for (const p of parts) {
    if (d.items[p] || partKnown(p)) continue;
    if (partKind(p) === 'comp') {
      const c = glyphOf(p), e = HZ.index[c], name = HZ.cnames[c];
      const gloss = [glossOf(c), ...String((e || [])[3] || '').split(/;\s*/)].filter(x => x && !/…$/.test(x) && x !== name[0]);
      d.items[p] = Learn.newItem('comp', { pin: '', mean: name[0], alts: [...new Set(gloss)].slice(0, 4) }, now);
    } else {
      d.items[p] = Learn.newItem('sound', { pin: '', mean: soundInfo(p)[0], alts: [] }, now);
    }
    d.items[p].prio = true;
  }
}

/* The learning path (Settings) keeps the queue full: the next characters along it, a whole
   day's new items of them (characters fill what the words don't use), whatever you have done
   today (Learn.plan holds back those past the day's numbers until tomorrow). The queue follows the settings: change the path or the number
   and what the path put there changes, while what you added, starred or pushed stays
   (Learn.pathSync). Characters you know, have queued or have taken out are skipped. Returns
   how many items changed. */
async function fillPath() {
  const first = Store.cfg();
  // (everything that could wait comes before anything changes, so two calls can't both add)
  const active = first.path && first.path !== 'off' && first.lessonLimit;
  if (active) await optional(Promise.all([need.cmnem(), need.cnames(), need.sounds()]));
  if (first.path === 'mix') await optional(need.charorder());
  if (first.path === 'hsk') await optional(need.hskChars());
  if (active && Learn.dailySplit(first).words > 0) await optional(need.wordorder());
  const cfg = Store.cfg(), d = Store.load();
  const { drop, want } = Learn.pathSync(d.items, cfg);
  dropQueued(drop);
  const parts = syncParts(cfg);
  const skipped = new Set(d.study.skip || []);
  const skip = c => !!(d.items[c] || d.status[c] || skipped.has(c));
  let order = [];
  if (want > 0 && cfg.path === 'mix' && HZ.charorder) {
    // simple, common, early in the HSK, and made of what you know (Learn.pickChars)
    order = Learn.pickChars(HZ.charorder, want, p => !!(d.items['c:' + p] || d.items[p] || Store.compKnown(p)), skip);
  } else if (want > 0 && cfg.path === 'hsk') {
    order = Object.keys(HZ.hskChars || {}).sort((a, b) => a - b).flatMap(lv => HZ.hskChars[lv]);
  } else if (want > 0) order = byRank();
  const added = [];
  for (const c of order) {
    if (added.length >= want) break;
    if (!HZ.index[c] || skip(c)) continue;
    const it = Store.learnAdd(c, 'char', charInfo(c));
    it.path = cfg.path;
    added.push(c);
  }
  const words = syncPathWords(cfg, skipped);
  delete d.study.pathLog;                // (from when the day's number was counted here)
  if (added.length || drop.length || parts || words) Store.save();
  await Promise.all(added.map(c => rememberParts(c)));
  return added.length + drop.length + parts + words;
}

/* The path's words, in Learn.wordOrder's order, once all a word's characters have had their
   lessons. Returns how many changed. */
function syncPathWords(cfg, skipped) {
  // (as many queued as the day's words)
  const d = Store.load(), { drop, want } = Learn.pathSync(d.items, cfg, 'word');
  dropQueued(drop);
  if (want <= 0 || !HZ.wordorder) return drop.length;
  // a word can be learnt once all its characters have had their lessons
  const env = learnEnv(), charPos = c => ((env.level(c) || 0) >= 1 ? 0 : undefined);
  const list = Learn.wordOrder(HZ.wordorder, charPos, w => !!d.items[w] || skipped.has(w) || d.wstatus[w] === 'learned');
  for (const w of list.slice(0, want)) {
    orderAdd(w, 'word').path = cfg.path;
  }
  return drop.length + Math.min(want, list.length);
}

/* takes queued items out, with any components and sounds only they needed */
function dropQueued(keys) {
  const d = Store.load(), parts = new Set();
  for (const k of keys) {
    if (!d.items[k]) continue;
    (d.items[k].parts || []).forEach(p => parts.add(p));
    delete d.items[k];
  }
  if (!parts.size) return;
  const needed = new Set(Object.values(d.items).filter(it => it.stage === 0).flatMap(it => it.parts || []));
  for (const p of parts) {
    const it = d.items[p];
    if (it && it.stage === 0 && !it.learnt && !needed.has(p) && partKind(p)) delete d.items[p];
  }
}

/* "Teach components and sounds first": on, the queue's characters bring theirs; off, those
   not yet learnt leave the queue. Returns how many changed. */
function syncParts(cfg) {
  const d = Store.load();
  const before = Object.keys(d.items).length;
  if (!cfg.autoComps) {
    for (const [k, it] of Object.entries(d.items)) if (partKind(k) && it.stage === 0 && !it.learnt) delete d.items[k];
  } else if (HZ.cnames && HZ.sounds) {
    for (const it of Object.values(d.items)) if (it.stage === 0 && it.kind === 'char' && it.parts) addParts(it.parts);
  }
  return Math.abs(Object.keys(d.items).length - before);
}

/* Finishing an HSK level: the progress through each level, a button when one is close,
   and the push itself, which puts what is left at the front of the lessons. */
function hskStanding() {
  const d = Store.load();
  const isDone = c => d.status[c] === 'learned' || (d.items[c] && d.items[c].stage >= 1);
  return Learn.hskProgress(HZ.hskChars, isDone);
}
const hskPushed = p => p.left.every(c => { const it = Store.load().items[c]; return it && it.prio; });
/* the card for a level (p, from hskStanding), or nothing unless it is close to complete: a
   badge with the level, how far through it you are, and the characters left as small tiles */
function hskPushCard(p) {
  if (!p || !Learn.hskIsNear(p)) return '';
  const n = p.left.length, on = hskPushed(p);
  const tiles = p.left.slice(0, 24).map(c => `<a class="tp-char han" href="#/character/${encodeURIComponent(c)}">${zh(c)}</a>`).join('')
    + (n > 24 ? `<span class="tp-more">+${n - 24}</span>` : '');
  const pct = Math.round(p.done / p.total * 100);
  return `<section class="card td-prompt hsk-push${on ? ' on' : ''}">
      <div class="tp-head"><span class="tp-badge hsk" aria-hidden="true"><small>HSK</small>${+p.level === 7 ? '7–9' : p.level}</span>
        <div class="tp-title"><h2>${on ? `Finishing ${hskName(p.level)}` : `${hskName(p.level)} is almost done`}</h2>
          <p class="tp-sub">${p.done} of ${p.total} characters learned</p></div></div>
      <span class="tp-bar" role="img" aria-label="${pct}% of ${hskName(p.level)} learned"><i style="width:${pct}%"></i></span>
      <p class="tp-text">${on ? `The last ${n} ${n === 1 ? 'is' : 'are'} at the front of your lessons, within your daily limit.
        The learning path waits until they are done.` : `Learn the last ${n} next, and the level is complete.`}</p>
      <div class="tp-chars">${tiles}</div>
      <p class="tp-act">${on ? `<button class="btn quiet" data-hsk-undo="${p.level}">Stop prioritising</button>`
        : `<button class="btn" data-hsk-push="${p.level}">Prioritise ${n} character${n === 1 ? '' : 's'}</button>`}</p>
    </section>`;
}
function hskPush(level) {
  const p = hskStanding().find(x => x.level === level);
  if (!p) return;
  const d = Store.load();
  // commonest first; a character already queued and starred is left as it was
  for (const c of p.left.slice().sort((a, b) => (HZ.index[a] || [])[0] - (HZ.index[b] || [])[0] || 0)) {
    if (!HZ.index[c]) continue;
    const had = d.items[c];
    if (had && had.prio) continue;
    const it = had || Store.learnAdd(c, 'char', charInfo(c));
    it.prio = true;
    it.hskPush = had ? 'kept' : 'added';
  }
  Store.save();
}
/* takes the push back: what it added goes (with any parts only they needed), and what
   was queued already goes back to its place */
function hskUnpush() {
  const d = Store.load(), added = [];
  for (const [k, it] of Object.entries(d.items)) {
    if (!it.hskPush) continue;
    // (already learnt, even if it is back for a second lesson: not the push's to take back)
    if (it.stage !== 0 || it.learnt) { delete it.hskPush; continue; }
    if (it.hskPush === 'added') added.push(k);
    else { delete it.prio; delete it.hskPush; }
  }
  dropQueued(added);
  Store.save();
}
/* the buttons of hskPushCard, then again(): draws the page anew */
function wireHskPush(root, again) {
  root.querySelectorAll('[data-hsk-push]').forEach(b => b.addEventListener('click', () => { hskPush(+b.dataset.hskPush); again(); }));
  root.querySelectorAll('[data-hsk-undo]').forEach(b => b.addEventListener('click', () => { hskUnpush(); again(); }));
}

/* before planning with character unlocking on: look up the components not known yet
   (true when there were some) */
async function fillParts() {
  const d = Store.load();
  const missing = Object.keys(d.items).filter(k => d.items[k].stage === 0 && d.items[k].kind === 'char' && !d.items[k].parts);
  if (!missing.length) return false;
  await Promise.all(missing.map(k => rememberParts(k)));
  return true;
}

/* sounds: a ding for a right answer, a rip for taking a miss back (both muted with
   "Mute sound effects"), and the item read aloud by the browser's Chinese voice
   ("Mute the voiced pronunciation"): when a lesson opens and when its pronunciation
   is answered right */
const Sound = {
  ctx: null,
  audio() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (this.ctx.state !== 'running' && this.ctx.resume) this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  ding() {
    const a = !Store.cfg().muteSfx && this.audio();
    if (!a) return;
    [[880, 0], [1320, 0.09]].forEach(([f, at]) => {
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(a.destination);
      o.start(t); o.stop(t + 0.4);
    });
  },
  rip() {
    const a = !Store.cfg().muteSfx && this.audio();
    if (!a) return;
    const n = Math.floor(a.sampleRate * 0.16), buf = a.createBuffer(1, n, a.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 1800; g.gain.value = 0.25;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  },
  /* Mandarin voices on this device (not Cantonese), best first for the chosen voice */
  voices() {
    const all = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    return all.filter(v => /^(zh|cmn)/i.test(v.lang) && !/HK|yue/i.test(v.lang));
  },
  gender(v) {
    if (/xiaoxiao|xiaoyi|xiaochen|xiaohan|xiaomeng|xiaomo|xiaoqiu|xiaorui|xiaoshuang|xiaoxuan|xiaoyan|xiaoyou|xiaozhen|huihui|yaoyao|hanhan|tingting|meijia|lili|female|女/i.test(v.name)) return 'female';
    if (/yunxi|yunyang|yunjian|yunye|yunfeng|yunhao|yunze|kangkang|zhiwei|\bmale\b|男/i.test(v.name)) return 'male';
    return '';
  },
  voice() {
    const want = Store.cfg().voice, vs = this.voices();
    return vs.find(v => this.gender(v) === want && /CN/i.test(v.lang)) || vs.find(v => this.gender(v) === want)
      || vs.find(v => /CN/i.test(v.lang)) || vs[0] || null;
  },
  /* Say a character or word: a person's recording when there is one (site/audio/,
     audio-cmn, CC BY-SA): the word's own (the HSK's 8,500), else its syllables one
     after another; failing that, the browser's Chinese voice. */
  say(text, force, pin) {
    const cfg = Store.cfg();
    if ((cfg.muteVoice && !force) || !text) return;
    if (partKind(text) === 'sound') return this.part(text);
    if (partKind(text)) return;
    if (cfg.audio === 'browser') return this.speak(text, cfg);
    need.audio().then(() => this.recorded(text, pin, cfg) || this.speak(text, cfg), () => this.speak(text, cfg));
  },
  /* Say one syllable of the library (ma, 4); the character is the browser voice's fallback.
     The neutral tone's recordings are few: playFiles falls back to the first tone. */
  syllable(letters, tone, fallback) {
    this.playFiles([`audio/s/${letters}${tone || 5}.mp3`], fallback || '', Store.cfg());
  },
  /* Say a character in one reading (a pinyin syllable). A character's own recording has
     only the one reading, so one with several (行 xíng, háng) is said on the syllable's
     recording. Not in the neutral tone, which few syllables have: that is the word's. */
  reading(c, pin, several) {
    const p = Learn.parsePinyin(pin), tone = p.tones[0] || 5;
    if (!several || tone === 5 || Store.cfg().audio === 'browser') return this.say(c, true, pin);
    this.syllable(p.letters, tone, c);
  },
  /* Say a sound part (i:m, f:ang, t:4), on the syllable data/sounds.js gives for it. The
     neutral tone has a person's recording only as a word: 吗. */
  part(k) {
    const S = HZ.sounds, kind = k[0], v = k.slice(2);
    if (!S) return;
    if (kind === 't') return v === '5' ? this.say('吗', true, 'ma') : this.syllable('ma', +v, '妈麻马骂'[v - 1]);
    const syl = (kind === 'i' ? S.heard.initials : S.heard.finals)[v];
    if (syl) this.syllable(syl, 1);
  },
  /* play the recording(s) for text; false when there are none to play */
  recorded(text, pin, cfg) {
    if (!HZ.audio) return false;
    const words = this.words || (this.words = new Set(HZ.audio.w.split('|')));
    const k = typeof learnKey === 'function' ? learnKey(text) : text;
    // (characters whose own recording stops short: their syllable's is whole. HZ.audio.c)
    const clipped = this.clipped || (this.clipped = new Set((HZ.audio.c || '').split('|')));
    const own = words.has(k) ? ['audio/w/' + k + '.mp3'] : null;
    let files;
    if (own && !clipped.has(k)) files = own;
    else {
      // the syllables, from the reading the item, the dictionary or the word list gives
      const it = Store.item(k);
      const p = pin || (it && it.pin) || ([...k].length === 1 ? (HZ.index[k] || [])[2]
        : (HZ.audio.p || {})[k] || (typeof wordEntries === 'function' && wordEntries(k)[0] ? wordEntries(k)[0][2] : ''));
      // (no way to say it on syllables: a recording that ends a little short beats the browser's voice)
      if (!p) { if (!own) return false; this.playFiles(own, text, cfg); return true; }
      files = String(p).trim().split(/\s+/).map(syl => {
        const x = Learn.parsePinyin(syl);
        return 'audio/s/' + x.letters + (x.tones[0] || 5) + '.mp3';
      });
      if (files.length !== [...k].filter(isHan).length) {
        if (!own) return false;
        files = own;
      }
    }
    this.playFiles(files, text, cfg);
    return true;
  },
  /* Play recordings one after another, on the one element unlock() has opened: phones
     let an element play without a tap only once a tap has started it, so a new Audio()
     for each syllable would be refused. If this play is refused too (nothing tapped
     yet), it waits for the first tap, as long as that comes soon. */
  playFiles(files, text, cfg) {
    files = files.slice();
    const a = this.player(), run = ++this.run;
    this.waiting = null;
    a.pause();
    if (window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    const rate = cfg.slow ? 0.75 : 1;
    const play = (i, retry) => {
      if (run !== this.run || i >= files.length) return;
      a.onended = () => play(i + 1);
      // a neutral tone (5) the collection hasn't got: its first tone, lightly
      a.onerror = () => {
        if (run !== this.run) return;
        if (!retry && /5\.mp3$/.test(files[i])) { files[i] = files[i].replace(/5\.mp3$/, '1.mp3'); play(i, true); }
        // a recording the collection hasn't got (ju4): the voice says the rest, so the
        // word doesn't just stop there
        else if (text) this.speak([...text].filter(isHan).slice(i).join('') || text, cfg);
      };
      // loading a new file puts playbackRate back to the default rate
      a.defaultPlaybackRate = rate;
      a.src = files[i] + '?v=1';
      a.playbackRate = rate;
      const p = a.play();
      if (p) p.catch(e => {
        if (e && e.name === 'NotAllowedError' && run === this.run) {
          this.waiting = { go: () => play(i, retry), at: Date.now() };
        }
      });
    };
    play(0);
  },
  run: 0,
  el: null,
  waiting: null,
  player() {
    if (!this.el) { this.el = new Audio(); this.el.preload = 'auto'; this.el.setAttribute('playsinline', ''); }
    return this.el;
  },
  /* Called inside every tap and key press. Phones start audio only from one: this opens
     the sound effects' context (a phone creates it suspended, and suspends it again
     when the page is put away), the recordings' element and the browser's voice, and
     plays whatever was refused a moment ago. */
  unlock() {
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.resume) this.ctx.resume().catch(() => {});
    const w = this.waiting;
    if (w) {
      this.waiting = null;
      if (Date.now() - w.at < 15000) { w.go(); this.opened = true; return; }
    }
    if (this.opened) return;
    this.opened = true;
    const a = this.player();
    if (!a.paused) return;              // already speaking: it needs no opening, and no cutting off
    // a moment of silence
    a.src ='data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQ4AAAAAAAAAAAAAAAAAAAAAAA==';
    const p = a.play();
    if (p) p.then(() => { if (a.src.startsWith('data:')) a.pause(); }).catch(e => { if (e && e.name === 'NotAllowedError') this.opened = false; });
    if (window.speechSynthesis && !speechSynthesis.speaking) {
      try { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* no voice: nothing to open */ }
    }
  },
  opened: false,
  /* can this device say things: recordings (on unless Settings says the browser's voice),
     or a Chinese voice in the browser */
  canSay() { return Store.cfg().audio !== 'browser' || this.voices().length > 0; },
  speak(text, cfg) {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = this.voice();
    if (v) u.voice = v;
    u.lang = v ? v.lang.replace('_', '-') : 'zh-CN';   // (Android writes zh_CN)
    u.rate = cfg.slow ? 0.7 : 1;
    // cancelling when nothing is speaking makes Android's voice drop what comes next
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    speechSynthesis.speak(u);
  },
};
for (const ev of ['touchend', 'click', 'keydown']) {
  document.addEventListener(ev, () => Sound.unlock(), { capture: true, passive: true });
}
if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', () => {
  if (document.getElementById('st-voice-note')) paintStudySettings();
});

/* a sentence with the word in it, for targeted sentence reviews: where you found it,
   or else the first in the graded stories */
async function sentenceFor(k, it) {
  if (it.ex && it.ex.text && it.ex.text.includes(it.ex.w || k)) return { text: it.ex.text, w: it.ex.w || k };
  await optional(need.stories());
  for (const st of HZ.stories || []) {
    for (const para of st.seg || []) {
      let cur = '';
      for (const t of para) {
        // a word (maybe with its sense: 了@done), punctuation {s}, or a line break {br}
        cur += typeof t === 'string' ? t.split('@')[0] : (t && t.s) || '';
        if (typeof t !== 'string' && t && (t.br || /[。！？!?]/.test(t.s || ''))) {
          if (cur.includes(k)) return { text: cur.trim(), w: k };
          cur = '';
        }
      }
      if (cur.includes(k)) return { text: cur.trim(), w: k };
    }
  }
  return null;
}

/* a part's meaning: its radical name (口 mouth), or else its own first sense (乞 to beg) */
const partGloss = c => glossOf(c) || String((HZ.index[c] || [])[3] || '').split(/;|…/)[0].trim();

/* the item's main meaning, and the rest */
const primary = it => {
  // the first sense, without the notes in brackets that open some: "(pronoun) this",
  // "(third-person singular) (…) he"; a sense that is only a note stays as it is
  const raw = String(it.mean || '').split(';').map(x => x.trim()).filter(Boolean);
  const bare = raw.map(x => x.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim());
  let p = bare.find(Boolean) || raw[0] || '';
  // cut short in the dictionary's index: end at the last whole phrase
  if (p.endsWith('…')) { const cut = p.lastIndexOf(','); if (cut > 8) p = p.slice(0, cut); }
  return p;
};
const others = it => Learn.meanings(it).filter(m => m !== primary(it).toLowerCase().replace(/^to /, ''));

/* what a page needs about an item beyond what is stored: its parts, the words it is
   in, and (for items added before they were known) its meanings */
async function itemFacts(k, it) {
  const f = { parts: [], comps: [], sounds: [], words: [], sound: null, mn: '', ex: [], subs: [] };
  // HanziHome's own mnemonics, the components' picture names and the sound cast
  await Promise.all([optional(need.cnames()), optional(need.sounds()),
    optional(it.kind === 'word' ? need.winfo() : need.cmnem()), it.kind === 'char' ? optional(need.charex()) : null]);
  if (it.kind === 'word') {
    f.mn = builtinMnemonic(k);
    if (HZ.winfo && HZ.winfo[k]) f.ex = HZ.winfo[k][2];
    f.parts = [...k].filter(isHan).map(c => [c, partGloss(c)]);
  } else if (it.kind === 'char') {
    f.mn = builtinMnemonic(k);
    if (HZ.charex && HZ.charex[k]) f.ex = HZ.charex[k];
    const d = await charData(k);
    if (d) {
      f.words = (d.w || []).slice(0, 6).map(w => [w[0], w[2]]);
      const ph = (d.ph || []).find(p => p.r <= 2);
      if (ph) f.sound = [ph.c, ph.t];
      const r = d.rd && d.rd[0];
      if (r) {
        if (!it.pin) it.pin = r[1];
        if (!it.alts.length) it.alts = r[2].slice(0, 6);
        if (!it.mean || /…$/.test(it.mean)) it.mean = r[2].slice(0, 2).join('; ');   // (the index's are cut short)
      }
      teachReading(k, it, d);
      const parts = it.parts || compParts(k, d).concat(soundParts(it.pin));
      f.comps = parts.filter(p => partKind(p) === 'comp').map(p => [glyphOf(p), partName(p)]);
      f.sounds = parts.filter(p => partKind(p) === 'sound').map(p => [itemText(p), partName(p), p]);
    }
  } else if (it.kind === 'comp') {
    // a component: its own parts and mnemonic, and common characters it is in
    const c = glyphOf(k), name = (HZ.cnames && HZ.cnames[c]) || [];
    f.mn = name[2] || (name[1] ? `The *${name[0]}*: ${name[1]}` : '');
    const d = await optional(charData(c));
    if (d && d.bd) f.subs = d.bd[1].map(x => x[0]).filter(x => x !== c && HZ.cnames[x]).map(x => [x, compName(x)]);
    await optional(need.comps());
    f.words = byRank().slice(0, 3000).filter(x => x === c || ((HZ.comps || {})[x] || []).includes(c)).slice(0, 8)
      .map(x => [x, String(HZ.index[x][3] || '').split(/;|…/)[0]]);
  } else if (it.kind === 'sound') {
    // a sound: its picture, and common characters that have it
    const [name, why] = soundInfo(k), part = k[0], v = k.slice(2);
    f.mn = `*${name}*: ${why}`;
    f.words = byRank().slice(0, 1500).filter(x => {
      const so = Learn.soundOf(HZ.index[x][2]);
      return String(part === 'i' ? so.initial : part === 'f' ? so.final : so.tone) === v;
    }).slice(0, 8).map(x => [x, HZ.index[x][2]]);
  }
  return f;
}

/* what a mnemonic's chips stand for (words.js mnHtml) */
const mnCtx = (k, it, f) => it.kind === 'comp' ? { comps: (f.subs || []).concat([[glyphOf(k), it.mean]]) }
  : it.kind === 'sound' ? { sounds: [[itemText(k), it.mean]] }
  : { self: it.kind === 'char' || it.kind === 'word' ? glyphOf(k) : '', comps: f.comps || [], sounds: f.sounds || [] };

/* a word's characters on one line, smaller the more there are, so a long one fits the band */
const GLYPH_FIT = [1, 1, 1, .74, .58, .48, .42];
function glyphFit(k, it) {
  const n = it.kind === 'word' ? [...glyphOf(k)].length : 1;
  return n < 3 ? itemHtml(k) : `<span class="lx-fit" style="font-size:${GLYPH_FIT[Math.min(n, 6)]}em">${itemHtml(k)}</span>`;
}
/* the coloured band at the top: the item, and optionally its reading and meaning */
function band(k, it, show) {
  return `<div class="lx-band ${it.kind}">
    ${show ? `<div class="lx-pin">${esc(it.pin)}</div>` : '<div class="lx-pin">&nbsp;</div>'}
    <div class="lx-glyph han">${glyphFit(k, it)}</div>
    ${show ? `<div class="lx-mean">${esc((it.mean || '').split(';')[0])}</div>` : ''}
    <span class="lx-kind">${kindName(it)}</span>
  </div>`;
}

/* The card, as the lessons and reviews draw it: the item's band in a deck, with cards
   peeking out behind it, and a dark foot joined under it (the question, or the lesson's
   steps). What peeks out says what the card stands among: in a review, the colours of the
   next items to come; in a lesson, a character's parts (or, for a part, the character it
   is for), so its prerequisites show. */
function deck(bandHtml, behind, foot, extra) {
  return `<div class="dk${behind ? ' dk-has-behind' : ''}">${behind || ''}
    <div class="dk-front"><div class="dk-card">${bandHtml}${extra || ''}</div>
    <div class="dk-foot">${foot}</div></div></div>`;
}
/* A prerequisite's lesson opening, as the deck changing places (s.fly, kept by Learn): the
   part grows out of where it sat in the row into the front card, the character it is for
   steps back into the card behind ("part of"), and the other parts sink away behind them.
   Instead of a card dealt in; once only. */
/* where an element is on the page (not the window, which may scroll in between) */
const pageRect = el => { const r = el.getBoundingClientRect(), z = uiZoom(); return { left: (r.left + scrollX) / z, top: (r.top + scrollY) / z, width: r.width / z, height: r.height / z }; };
function flyFromPart(s, k) {
  const fly = s.fly, from = fly && fly.parts[k];
  s.fly = null;
  const dk = app.querySelector('.dk'), front = app.querySelector('.dk-front');
  if (!from || !dk || !front || Motion.reduced()) return false;
  toLessonTop();
  const to = pageRect(front);
  if (!to.width || !to.height) return false;
  const ease = 'cubic-bezier(.2, .8, .2, 1)';
  // r1 drawn where r0 is: the transform that puts it there
  const at = (r0, r1) => `translate(${r0.left + r0.width / 2 - (r1.left + r1.width / 2)}px, ${r0.top + r0.height / 2 - (r1.top + r1.height / 2)}px) scale(${r0.width / r1.width}, ${r0.height / r1.height})`;
  front.animate([{ transform: at(from.rect, to), opacity: .5 }, { opacity: 1, offset: .3 }, { transform: 'none', opacity: 1 }],
    { duration: 600, easing: ease });
  // the character, from the front to the card behind
  const owner = app.querySelector('.dk-o');
  if (owner && fly.card) {
    owner.animate([{ transform: at(fly.card, pageRect(owner)), opacity: .9 }, { transform: 'none', opacity: 1 }],
      { duration: 600, easing: ease });
  }
  // the other parts, where they were, sinking behind the cards
  const base = pageRect(dk);
  for (const [p, { rect, html }] of Object.entries(fly.parts)) {
    if (p === k) continue;
    const box = document.createElement('div');
    box.innerHTML = html;
    const g = box.firstElementChild;
    g.removeAttribute('data-k');
    g.classList.add('dk-ghost');
    Object.assign(g.style, { left: `${rect.left - base.left}px`, top: `${rect.top - base.top}px` });
    dk.prepend(g);
    g.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(46px) scale(.75)', opacity: 0 }],
      { duration: 380, easing: 'ease-in', fill: 'forwards' }).onfinish = () => g.remove();
  }
  return true;
}
/* a new card dealt onto the deck: its band and foot together, as one card */
const dealCard = () => Motion.play(app.querySelector('.dk-front') || app.querySelector('.lx-band'), 'm-deal');
/* The next cards, in the order they will come (n of them): the queue from here, with each
   question put off as deferQuestion will put it off, the one being asked taken as answered.
   One card an item: an item's other question is not another card, so one review left shows
   one card, two show two. */
function upNext(s, n = 2) {
  const { k, q } = s.queue[s.i];
  const t = Object.assign({}, s, { queue: [...s.queue],
    answered: Object.assign({}, s.answered, { [k]: Object.assign({}, s.answered[k], { [q]: true }) }),
    first: Object.assign({}, s.first, { [k]: Object.assign({ [q]: { ok: true } }, s.first[k]) }) });
  const out = [];
  for (let i = s.i + 1; i < t.queue.length && out.length < n; i++) {
    t.i = i;
    for (let m = 0; m < t.queue.length && deferQuestion(t); m++);
    const nk = t.queue[i].k;
    if (nk !== k && !out.includes(nk) && Store.item(nk)) out.push(nk);
  }
  return out;
}
/* behind a review's card: the next two cards, each in its kind's colour (the nearer one in front) */
function deckNext(s) {
  const next = upNext(s);
  if (!next.length) return '';
  return `<div class="dk-behind dk-next" aria-hidden="true">${next.map((k, i) =>
    `<span class="dk-b b${i + 1} ${Store.item(k).kind || 'char'}"></span>`).reverse().join('')}</div>`;
}
/* Reviews: a new card, as the stack moving up. The card just answered goes off to the side,
   the card behind it comes forward to the front, the one behind that takes its place, and a
   new one shows at the back. (st: the deck as it was, from deckState, before the page was drawn.)
   The first card of all is dealt. */
const deckState = () => {
  const dk = app.querySelector('.dk');
  if (!dk) return null;
  const r = el => el && pageRect(el), front = dk.querySelector('.dk-front');
  return { front: r(front), html: front && front.outerHTML, b1: r(dk.querySelector('.dk-b.b1')), b2: r(dk.querySelector('.dk-b.b2')) };
};
function stackForward(st) {
  const dk = app.querySelector('.dk'), front = dk && dk.querySelector('.dk-front');
  if (!st || !st.front || !st.b1 || !front || Motion.reduced()) return dealCard();
  const ease = 'cubic-bezier(.2, .8, .2, 1)';
  const at = (r0, r1) => `translate(${r0.left + r0.width / 2 - (r1.left + r1.width / 2)}px, ${r0.top + r0.height / 2 - (r1.top + r1.height / 2)}px) scale(${r0.width / r1.width}, ${r0.height / r1.height})`;
  const base = pageRect(dk);
  // the card answered, off to the left
  const box = document.createElement('div');
  box.innerHTML = st.html;
  const ghost = box.firstElementChild;
  ghost.classList.add('dk-gone');
  Object.assign(ghost.style, { left: `${st.front.left - base.left}px`, top: `${st.front.top - base.top}px`, width: `${st.front.width}px` });
  dk.append(ghost);
  ghost.animate([{ transform: 'none', opacity: 1 }, { transform: 'translate(-70%, 30px) rotate(-12deg)', opacity: 0 }],
    { duration: 260, easing: 'cubic-bezier(.4, 0, .9, .6)', fill: 'forwards' }).onfinish = () => ghost.remove();
  // the one behind, to the front: its own colour growing to the full card, its face fading in
  front.animate([{ transform: at(st.b1, pageRect(front)), opacity: .8 }, { transform: 'none', opacity: 1 }],
    { duration: 280, easing: ease });
  front.querySelectorAll('.lx-band > *, .dk-foot > *').forEach(x => x.animate([{ opacity: 0 }, { opacity: 0, offset: .35 }, { opacity: 1 }], { duration: 280 }));
  // the back card to the middle, and a new one in at the back
  const b1 = dk.querySelector('.dk-b.b1'), b2 = dk.querySelector('.dk-b.b2');
  if (b1 && st.b2) b1.animate([{ transform: at(st.b2, pageRect(b1)), opacity: .5 }, { transform: 'none' }], { duration: 280, easing: ease });
  else if (b1) b1.animate([{ transform: 'translateY(-14px) scale(.94)', opacity: 0 }, { transform: 'none' }], { duration: 280, easing: ease });
  if (b2) b2.animate([{ transform: 'translateY(-14px) scale(.94)', opacity: 0 }, { opacity: 0, offset: .3 }, { transform: 'none' }], { duration: 320, easing: ease });
}
/* behind a lesson's card: what it is made of ([[glyph, gloss, kind]]), as small cards */
function deckParts(parts) {
  if (!parts.length) return '';
  return `<div class="dk-behind dk-parts" aria-label="Made of: ${esc(parts.map(p => p[1] || p[0]).join(', '))}">${parts.slice(0, 6).map(([c, , kd, k], i) =>
    `<span class="dk-p ${kd}" style="--i:${i}"${k ? ` data-k="${esc(k)}"` : ''}>${kd === 'sound' ? `<span class="snd-key">${esc(c)}</span>` : `<span class="han">${esc(c)}</span>`}</span>`).join('')}</div>`;
}
/* behind a part's card: the character (or word) it is learned for */
function deckOwner(owner) {
  if (!owner) return '';
  const it = Store.item(owner);
  return `<div class="dk-behind dk-owner"><span class="dk-o ${it ? it.kind : 'char'}"><small>part of</small>
    <span class="han">${zh(glyphOf(owner))}</span>${it ? `<span>${esc(primary(it))}</span>` : ''}</span></div>`;
}
/* a lesson's parts, as deckParts takes them */
const lessonParts = (it, f) => it.kind === 'word' ? (f.parts || []).map(([c, g]) => [c, g, 'char'])
  : it.kind === 'char' ? (f.comps || []).map(([c, g]) => [c, g, 'comp']).concat((f.sounds || []).map(([c, g]) => [c, g, 'sound'])) : [];
/* a section of a lesson, or of the info panel, as a tile */
/* Practice, redrawn (2026-11): each page leads with one card in its own colour (what to do
   next, with a few glyphs or shapes) and a dark button under it, which Enter presses too.
   o: {kind: char|word|comp|sound|phrase|grammar, eyebrow, chips: [html], title, sub, go,
   href, or id for a button wired by the page; note: a line under the button} */
function heroCard(o) {
  const chips = (o.chips || []).map(c => c === '+' ? '<span class="hero-plus" aria-hidden="true">+</span>' : `<span class="hero-chip">${c}</span>`).join('');
  const go = o.href ? `<a class="hero-go" href="${o.href}">${o.go}<span class="hero-key" aria-hidden="true">· Enter</span></a>`
    : `<button type="button" class="hero-go" id="${o.id}">${o.go}<span class="hero-key" aria-hidden="true">· Enter</span></button>`;
  return `<div class="hero">
    <div class="hero-card ${o.kind || 'char'}" data-hero aria-hidden="true">
      ${o.eyebrow ? `<span class="hero-eyebrow">${o.eyebrow}</span>` : ''}
      ${chips ? `<span class="hero-chips">${chips}</span>` : ''}
      <b class="hero-title">${o.title}</b>${o.sub ? `<span class="hero-sub">${o.sub}</span>` : ''}
    </div>
    ${go}${o.note ? `<p class="hero-note">${o.note}</p>` : ''}</div>`;
}
/* the card does what its button does; Enter, from nowhere in particular, presses it */
document.addEventListener('click', e => {
  const card = e.target.closest && e.target.closest('[data-hero]');
  if (card) { const b = card.parentNode.querySelector('.hero-go'); if (b) b.click(); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
  const t = e.target;
  if (t && t !== document.body && t.closest && t.closest('a, button, input, textarea, select, [contenteditable], dialog')) return;
  if (document.querySelector('dialog[open]')) return;
  const b = document.querySelector('#app .hero-go');
  if (b) { e.preventDefault(); b.click(); }
});
/* a practice round's head, as a review's: what it is, how far, right and missed, and a way out.
   res: one entry per question so far, true (right) or false (missed) */
function practiceHead(title, at, n, res, quit) {
  const right = res.filter(r => r).length, missed = res.length - right;
  const segs = n <= 60 ? `<div class="rv-segs" style="--n:${n}" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
    `<i class="${i < res.length ? (res[i] ? 'ok' : 'bad') : i === at ? 'now' : ''}"></i>`).join('')}</div>` : '';
  return `<div class="rv-head pq-head"><span class="rv-title">${title}</span>
    <span class="rv-of"><b>${Math.min(at + 1, n)}</b> of ${n}</span><span class="rv-flex"></span>
    ${res.length ? `<span class="rv-dot ok">${right} right</span><span class="rv-dot bad">${missed} missed</span>` : ''}
    ${quit ? `<a class="rv-icon" href="${quit}" aria-label="Stop" title="Stop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></a>` : ''}
  </div>${segs}`;
}
/* a white tile, for practice pages (as lessons' lxTile) */
const ptTile = (label, body, cls = '') => `<section class="pt-tile${cls ? ' ' + cls : ''}">${label ? `<h3>${label}</h3>` : ''}${body}</section>`;
const ptBar = (p, cls = '') => `<span class="pt-bar${cls ? ' ' + cls : ''}" aria-hidden="true"><i style="--w:${Math.round(100 * Math.max(0, Math.min(1, p)))}%"></i></span>`;
const lxTile = (title, body, cls) => `<section class="lt-tile${cls ? ' ' + cls : ''}">${title ? `<h3>${title}</h3>` : ''}${body}</section>`;

/* a listening question: only the sound, played as it opens (▶ or P plays it again) */
function listenBand(it) {
  return `<div class="lx-band ${it.kind}">
    <div class="lx-pin">&nbsp;</div>
    <button type="button" class="lx-listen" data-tool="sound" aria-label="Play it again (P)" title="Play it again (P)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12L7.5 14.5H4zM16.5 9.5a4 4 0 0 1 0 5M19 7a7.5 7.5 0 0 1 0 10"/></svg></button>
    <span class="lx-kind">Listen</span>
  </div>`;
}

/* a writing question: the pinyin and meaning as the cue, and a square to write in */
function writeBand(it, shown) {
  return `<div class="lx-band ${it.kind} lx-write">
    <div class="lx-pin">${esc(it.pin)}</div>
    ${writerBox('rv-writer', 240)}
    <div class="lx-mean">${esc(primary(it))}</div>
    <span class="lx-kind">${shown ? kindName(it) : 'Write it'}</span>
  </div>`;
}

/* The writing question's quiz, or once answered the character as it is written. No
   strokes for this character (a rare one): the question is skipped. */
async function reviewWriting(k, shown) {
  const s = reviewState;
  const writer = await makeWriter('rv-writer', k, 240, shown
    ? { showCharacter: true, showOutline: true } : { showCharacter: false, showOutline: false });
  if (s !== reviewState || !s.queue[s.i] || s.queue[s.i].k !== k || s.queue[s.i].q !== 'write') return;
  if (!writer) {
    (s.answered[k] = s.answered[k] || {}).write = true;
    s.shown = { ok: true, answer: '' };
    return nextQuestion();
  }
  if (shown) { if (shown.revealed) writer.animateCharacter(); return; }
  const msg = document.getElementById('rv-write-msg');
  let hinted = 0;
  writer.quiz({
    showHintAfterMisses: 3, leniency: 1.1,
    onMistake: m => {
      if (m.mistakesOnStroke === 3) hinted++;
      msg.textContent = m.mistakesOnStroke >= 3 ? `Stroke ${m.strokeNum + 1}: follow its outline.` : `Not quite: stroke ${m.strokeNum + 1} again.`;
    },
    onCorrectStroke: m => { msg.textContent = m.strokesRemaining ? `${m.strokesRemaining} more.` : ''; },
    onComplete: m => {
      if (s !== reviewState) return;
      const f = s.first[k] = s.first[k] || {};
      // writing is a skill of its own: needing the outline makes the review hard, never forgotten
      if (!f.write) f.write = { ok: true, near: hinted > 0, ms: 0 };
      s.shown = { ok: !hinted, answer: '', slips: m.totalMistakes, hinted };
      if (hinted) {
        s.misses[k] = (s.misses[k] || 0) + 1;
        (s.typed[k] = s.typed[k] || []).push({ q: 'write', answer: '' });
        s.queue.push({ k, q: 'write' });
      } else Sound.ding();
      setTimeout(() => { if (s === reviewState && s.shown) pageReviews(); }, 700);
    },
  });
}

/* targeted sentence reviews: the band shows the word in a sentence */
function sentenceBand(it, sent) {
  const parts = sent.text.split(sent.w);
  return `<div class="lx-band word lx-sentence">
    <div class="lx-pin">&nbsp;</div>
    <div class="lx-glyph han">${parts.map(esc).join(`<mark>${esc(sent.w)}</mark>`)}</div>
    <span class="lx-kind">Word in a sentence</span>
  </div>`;
}

/* the sentence the item was met in, with the item marked */
function foundIn(k, it) {
  if (!it.ex || !it.ex.text) return '';
  const w = it.ex.w || k;                          // as it was written there (maybe traditional)
  const parts = it.ex.text.split(w);
  return `<blockquote class="lx-ex han">${parts.map(esc).join(`<mark>${esc(w)}</mark>`)}</blockquote>`;
}

function lxChip(c, gloss, href) {
  return `<a class="lx-chip" href="${href || '#/character/' + encodeURIComponent(c)}">
    <span class="han">${esc(c)}</span><span>${esc(gloss || '')}</span></a>`;
}

// ------------------------------------------------------- adding things to learn

/* the "Add to lessons" button on a character's page; once added it names the stage */
function learnButton(k) {
  const it = Store.item(k);
  const label = !it ? '＋ Add to lessons' : it.stage ? '✓ ' + Learn.stageName(it.stage) : '✓ In lessons';
  return `<button class="btn ${it ? 'quiet' : ''} learn-btn" id="learnbtn">${label}</button>`;
}

function wireLearnButton(k, info) {
  const b = document.getElementById('learnbtn');
  if (!b) return;
  b.addEventListener('click', () => {
    if (Store.item(k)) { go('/study'); return; }
    Store.learnAdd(k, [...k].length > 1 ? 'word' : 'char', info());
    b.outerHTML = learnButton(k);
    wireLearnButton(k, info);
    markNav(currentPath());
  });
}

/* The reader's popup: add the word pointed at, with the meaning it has there and the
   sentence it is in. Words also take the dictionary's other senses as answers. */
/* the key an item is kept under: the simplified form, as the rest of the site has it */
const learnKey = w => (HZ.rwordsT2S || {})[w] || [...w].map(c => (HZ.t2s || {})[c] || c).join('');

async function learnFromReader(w, pin, gloss, sentence) {
  // the table that simplifies traditional text comes with the characters' readings
  if (!HZ.readings) await optional(loadScript('data/readings.js'));
  const s = learnKey(w);
  const kind = [...w].filter(isHan).length > 1 ? 'word' : 'char';
  let alts = [];
  if (kind === 'word' && HZ.rwords) {
    const e = HZ.rwords[s] || HZ.rwords[w];
    if (e && e[2]) alts = e[2].filter(r => r[0][0] === r[0][0].toLowerCase()).map(r => r[1]);
  } else if (kind === 'char' && HZ.readings) {
    const row = (HZ.readings[s] || []).find(r => r[0] === pin) || (HZ.readings[s] || [])[0];
    if (row) alts = row[1].slice(0, 6);
  }
  return Store.learnAdd(s, kind, { pin, mean: gloss, alts, ex: sentence ? { text: sentence, w, t: Date.now() } : null });
}

/* the sentence around a word in the reading pane */
function sentenceAround(el, w) {
  // the reader wraps each sentence in .sent: the one this word is actually in
  const s = el.closest('.sent');
  if (s) return s.textContent.trim().slice(0, 160);
  const p = el.closest('p');
  if (!p) return '';
  const parts = p.textContent.split(/(?<=[。！？!?；…])/);
  const hit = parts.find(x => x.includes(w)) || p.textContent;
  return hit.trim().slice(0, 160);
}

// ---------------------------------------------------------------------- hub

/* Practice: extra study that doesn't change when anything comes back. Today shows the two
   that change from day to day (brief); the Practice page (#/practice) shows them all. */
function extraStudy(weak, brief, quiet) {
  const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const body = (ico, colour, title, note) => `<span class="ico ${colour}">${icon(ico)}</span>
    <span class="xs-text"><b>${title}</b><small>${note}</small></span>`;
  const doneToday = (Store.load().grammar._daily || {}).day === today();
  // (on Today, quiet while lessons or reviews wait: those come first)
  return `<section class="xs${quiet ? ' quiet' : ''}" aria-labelledby="xs-h">
    ${brief ? `<h2 class="sec-h xs-head" id="xs-h">Practice <a class="small" href="#/practice">All practice →</a></h2>`
      : '<h2 class="sr-only" id="xs-h">Practice</h2>'}
    <div class="xs-grid">
      <a class="xs-tile daily${doneToday ? ' done' : ''}" href="#/grammar/daily">${body(doneToday ? '<path d="m5 12.5 4.5 4.5L19 7.5"/>' : '<path d="M4 7h7v4H4zM13 7h7v4h-7zM8 15h8v4H8z"/>', 'white',
        'Daily grammar practice', doneToday ? 'Done for today. Fancy another round?' : 'A short round. Anything new is taught first.')}</a>
      ${brief && !weak ? '' : `<a class="xs-tile wide" href="#/weak">${body('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>', 'pink',
        'Weak spots', weak ? `${weak} to work on` : 'Nothing yet. What you keep missing will show up here.')}</a>`}
      ${brief ? '' : `<a class="xs-tile" href="#/grammar">${body('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6"/>', 'mint',
        'Grammar', 'Explanations and practice')}</a>
      <a class="xs-tile" href="#/phrases">${body('<path d="M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5"/>', 'pink',
        'Phrases', 'Common phrases, questions and answers')}</a>
      <a class="xs-tile" href="#/tones">${body('<path d="M3 12h2l2-6 3 13 3-16 3 13 2-4h3"/>', 'yellow',
        'Tones', 'Train your ear to hear the four tones')}</a>
      <a class="xs-tile" href="#/lookalikes">${body('<rect x="3.5" y="3.5" width="11" height="11" rx="2"/><path d="M9.5 18.5v.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 19 9.5h-.5"/>', 'sky',
        'Look-alikes', 'Tell apart 未 and 末')}</a>`}
    </div>
  </section>`;
}

/* Today on a first visit, under the first lesson: how the days go (learn, review, read),
   and the other ways in: mark what you know, the tones, a story */
function firstSteps() {
  const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const step = (n, colour, title, text) => `<li class="fs-step"><span class="fs-n ${colour}" aria-hidden="true">${n}</span>
      <span><b>${title}</b><small>${text}</small></span></li>`;
  const way = (href, ico, colour, title, note) => `<a class="xs-tile" href="${href}"><span class="ico ${colour}">${icon(ico)}</span>
      <span class="xs-text"><b>${title}</b><small>${note}</small></span></a>`;
  return `<section class="card fs-how" aria-labelledby="fs-how-h">
      <h2 id="fs-how-h">How it works</h2>
      <ol class="fs-steps">
        ${step(1, 'pink', 'Learn', 'Each lesson shows a character’s parts, sound and meaning, then a short quiz.')}
        ${step(2, 'sky', 'Review', 'It comes back just before you would forget it, a little later each time.')}
        ${step(3, 'mint', 'Read', 'Stories open up as you learn. Tap any word in one for its meaning.')}
      </ol>
    </section>
    <section class="xs fs-ways" aria-labelledby="fs-ways-h">
      <h2 class="sec-h" id="fs-ways-h">Other ways to start</h2>
      <div class="xs-grid">
        ${way('#/frequency', '<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'mint', 'Know some already?', 'Mark them, and your lessons skip them')}
        ${way('#/tones', '<path d="M3 12h2l2-6 3 13 3-16 3 13 2-4h3"/>', 'yellow', 'Hear the tones', 'Train your ear for the four tones')}
        ${way('#/reader', '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>', 'sky', 'Try a story', 'Read with help on every word')}
      </div>
    </section>`;
}

/* Practice (#/practice): everything that is extra study, in one place. On top, the one thing
   worth doing now; under it every kind of practice, each with where you are in it. It is drawn
   at once from what is on this device, and again once the lists (grammar points, phrases,
   look-alikes) have loaded, for the numbers that need them. */
function pagePractice() {
  drawPractice();
  Promise.all([optional(need.gpoints()), optional(need.phrases()), optional(need.comps()),
    HZ.lookalike ? null : optional(loadScript('data/lookalike.js'))])
    .then(() => { if (currentPath() === '/practice') drawPractice(true); });
}

/* what each tile said last time Practice was open (this device only), so a tile whose
   numbers moved since (a round just done) can light up once */
const PR_SEEN = 'hanzihome.practiceSeen';
function practiceChanged(lines) {
  let was = null;
  try { was = JSON.parse(sessionStorage.getItem(PR_SEEN) || 'null'); } catch (e) { /* no storage */ }
  try { sessionStorage.setItem(PR_SEEN, JSON.stringify(lines)); } catch (e) { /* private mode */ }
  if (!was) return new Set();
  return new Set(Object.keys(lines).filter(k => was[k] !== undefined && was[k] !== lines[k]));
}

/* where you are in each kind of practice: a line to say so, and how far along (0 to 1, or
   null where there is nothing to measure yet) */
function practiceState() {
  const d = Store.load(), now = Date.now(), day = 864e5;
  const ago = t => !t ? null : now - t < day ? 'today' : now - t < 2 * day ? 'yesterday' : `${Math.floor((now - t) / day)} days ago`;
  const out = {};
  // grammar: the points read or practised, of all of them
  const g = d.grammar || {};
  const daily = (g._daily || {}).day === today();
  if (HZ.gpoints) {
    const seen = HZ.gpoints.filter(p => g[p.id] && (g[p.id].read || g[p.id].runs)).length, all = HZ.gpoints.length;
    out.grammar = { line: seen ? `${seen} of ${all} points seen` : `${all} points, from the basics up`, p: seen / all };
  } else out.grammar = { line: 'Explanations and practice', p: null };
  out.grammar.last = Math.max(0, ...Object.entries(g).filter(([k]) => k[0] !== '_').map(([, v]) => v.last || v.read || 0));
  out.daily = { done: daily };
  // phrases: learned, of all of them, and when you last practised
  const ph = d.phrases || {};
  const phLast = Math.max(0, ...Object.entries(ph).map(([, v]) => v.last || v.learned || 0));
  if (HZ.phrases) {
    const all = HZ.phrases.reduce((n, c) => n + c.units.length, 0);
    const have = Object.values(ph).filter(v => v.learned).length;
    out.phrases = { line: have ? `${have} of ${all} learned${phLast ? ` · practised ${ago(phLast)}` : ''}` : `${all} to learn, in ${HZ.phrases.length} topics`, p: have / all };
  } else out.phrases = { line: 'Common phrases, questions and answers', p: null };
  out.phrases.last = phLast;
  // tones: how often your ear is right, or your best round
  const tn = d.tones || {};
  let right = 0, heard = 0;
  for (const t of [1, 2, 3, 4]) { const e = tn['ear:' + t]; if (e) { right += e[0]; heard += e[1]; } }
  const rounds = Object.keys(TN_KINDS).map(k => tn[k]).filter(r => r && r.runs && r.of);
  const tnLast = Math.max(0, ...rounds.map(r => r.last || 0));
  out.tones = heard >= 6 ? { line: `Your ear: ${Math.round(100 * right / heard)}% right${tnLast ? ` · ${ago(tnLast)}` : ''}`, p: right / heard }
    : rounds.length ? { line: `Best round: ${Math.max(...rounds.map(r => r.best))} of ${rounds[0].of}`, p: Math.max(...rounds.map(r => r.best / r.of)) }
    : { line: 'Train your ear to hear the four tones', p: null };
  out.tones.last = tnLast;
  // look-alikes: the sets among what you've learned, how many you've practised, and the one you mix up most
  const la = laStats(), known = laKnown();
  out.looks = { line: 'Opens once you know two that look alike', p: null, open: false, last: Math.max(0, ...Object.values(la).map(x => x[2] || 0)) };
  if (HZ.lookalike) {
    const pool = [...known].filter(c => laKnownLike(c, known).length);
    if (pool.length) {
      const missed = c => (la[c] || [0, 0])[1];
      const c = pool.slice().sort((a, b) => missed(b) - missed(a))[0], other = laKnownLike(c, known)[0];
      const done = pool.filter(x => la[x]).length;
      out.looks = { ...out.looks, open: true, pair: [c, other], p: done / pool.length,
        line: `${missed(c) ? 'You mix up' : 'Tell apart'} <span class="han">${zhOne(c)}</span> and <span class="han">${zhOne(other)}</span> · ${pool.length} to practise` };
    }
  }
  // weak spots: what you keep missing, across all of it
  const items = wkItems().length, looks = wkLooks().length, tone = wkTones() ? 1 : 0;
  out.weak = { n: items + looks + tone, items, looks, tone };
  return out;
}

/* the one thing worth doing now: weak spots piling up, then the daily grammar, then a few weak
   spots, then whatever you've left longest */
function practiceNext(st) {
  const mins = n => `about ${Math.max(1, Math.round(n))} minute${Math.round(n) > 1 ? 's' : ''}`;
  const w = st.weak;
  const what = [w.items && `${w.items} character${w.items > 1 ? 's' : ''}`, w.looks && `${w.looks} look-alike${w.looks > 1 ? 's' : ''}`, w.tone && 'a tone'].filter(Boolean).join(', ');
  const weak = { href: '#/weak', colour: 'pink', title: `Clear ${w.n} weak spot${w.n > 1 ? 's' : ''}`,
    why: `What you keep missing: ${what}. A round takes ${mins(w.n * 0.4)}.` };
  if (w.n >= 3) return weak;
  if (!st.daily.done) return { href: '#/grammar/daily', colour: 'mint', title: 'Daily grammar practice',
    why: `Today's round isn't done yet: six sentences, ${mins(2)}. Anything new is taught first.` };
  if (w.n) return weak;
  const DAY = 864e5, now = Date.now();
  const left = [
    st.looks.open && { href: '#/lookalikes', colour: 'sky', title: 'Look-alikes', last: st.looks.last,
      why: `Twelve quick questions, ${mins(2)}, on characters you've learned that look alike.` },
    { href: '#/tones', colour: 'yellow', title: 'Tones', last: st.tones.last, why: `Ten sounds to tell apart, ${mins(2)}.` },
    { href: '#/phrases', colour: 'pink', title: 'Phrases', last: st.phrases.last, why: `A few phrases to learn whole, or a round on the ones you know, ${mins(3)}.` },
  ].filter(Boolean).sort((a, b) => a.last - b.last);
  const pick = left[0], days = Math.floor((now - pick.last) / DAY);
  const when = !pick.last ? 'You haven\'t tried it yet.' : days < 1 ? 'Last practised earlier today.'
    : days === 1 ? 'Last practised yesterday.' : `Last practised ${days} days ago.`;
  return { ...pick, why: `${when} ${pick.why}` };
}

/* the suggestion, as Practice's lead card: its colour, and a few of what it is about */
function practiceHero(next, st) {
  const tone = t => `<svg viewBox="0 0 40 28" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" aria-hidden="true">${TN_SHAPE[t]}</svg>`;
  const han = c => `<span class="han">${zhOne(c)}</span>`;
  let kind = 'char', chips = [];
  if (next.href === '#/weak') {
    chips = wkItems().slice(0, 4).map(k => `<span class="han">${itemHtml(k)}</span>`);
    if (!chips.length) chips = wkLooks().slice(0, 4).map(han);
    if (!chips.length) chips = [1, 2, 3, 4].map(tone);
  } else if (next.href === '#/grammar/daily') { kind = 'grammar'; chips = ['A', '+', han('是'), '+', 'B']; }
  else if (next.href === '#/lookalikes') { kind = 'comp'; chips = (st.looks.pair || []).map(han); }
  else if (next.href === '#/tones') { kind = 'sound'; chips = [1, 2, 3, 4].map(tone); }
  else if (next.href === '#/phrases') {
    kind = 'phrase';
    const n = typeof phNext === 'function' && HZ.phrases ? phNext() : null;
    chips = n && n.chips ? n.chips.slice(0, 3).map(han) : [han('你好')];
  }
  return { kind, eyebrow: 'Suggested now', chips, title: esc(next.title), sub: esc(next.why), go: 'Start', href: next.href };
}

/* Practice this week: the days you practised anything (from the times each kind keeps: a
   round's last, a point read, a phrase learned, a look-alike or weak spot asked), the rounds
   done in all, and how often you're right where that is counted. */
function practiceWeek() {
  const d = Store.load(), times = [];
  for (const [k, v] of Object.entries(d.grammar || {})) if (k[0] !== '_' && v) times.push(v.last, v.read);
  for (const v of Object.values(d.phrases || {})) if (v) times.push(v.last, v.learned);
  for (const v of Object.values(d.tones || {})) if (v && v.last) times.push(v.last);
  for (const v of Object.values(d.weak || {})) times.push(v);
  const la = laStats();
  for (const x of Object.values(la)) times.push(x[2]);
  const now = new Date(), dow = (now.getDay() + 6) % 7, monday = new Date(now.toDateString());
  monday.setDate(monday.getDate() - dow);
  const week = Array(7).fill(false);
  for (const t of times) {
    if (!t) continue;
    const i = Math.floor((new Date(new Date(t).toDateString()) - monday) / 864e5);
    if (i >= 0 && i < 7) week[i] = true;
  }
  const dailyDay = ((d.grammar || {})._daily || {}).day;
  if (dailyDay === today()) week[dow] = true;
  const runs = [...Object.entries(d.grammar || {}).filter(([k]) => k[0] !== '_').map(([, v]) => v),
    ...Object.entries(d.phrases || {}).filter(([k]) => k[0] === '#').map(([, v]) => v),
    ...Object.values(d.tones || {})].reduce((n, v) => n + ((v && v.runs) || 0), 0);
  let r = 0, w = 0;
  for (const x of Object.values(la)) { r += x[0]; w += x[1]; }
  const tn = d.tones || {};
  let er = 0, eh = 0;
  for (const t of [1, 2, 3, 4]) { const e = tn['ear:' + t]; if (e) { er += e[0]; eh += e[1]; } }
  return { week, dow, days: week.filter(Boolean).length, runs, looks: r + w >= 5 ? Math.round(100 * r / (r + w)) : null,
    ear: eh >= 6 ? Math.round(100 * er / eh) : null, any: times.some(Boolean) || runs > 0 };
}

function practiceWeekHtml() {
  const p = practiceWeek(), names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const stat = (label, value, note) => `<div><dt>${label}</dt><dd>${value}${note ? ` <small>${note}</small>` : ''}</dd></div>`;
  return `<section class="card pr-week" aria-labelledby="pr-week-h">
    <div class="pr-week-top"><h2 id="pr-week-h">This week</h2>
      <span class="small muted">${p.days ? `Practised on ${p.days} day${p.days > 1 ? 's' : ''}` : p.any ? 'Nothing yet this week' : 'Your practice will show up here'}</span></div>
    <ol class="pr-days">${p.week.map((on, i) => `<li class="${on ? 'on' : ''}${i === p.dow ? ' today' : ''}${i > p.dow ? ' future' : ''}"
      aria-label="${names[i]}${i === p.dow ? ', today' : ''}: ${i > p.dow ? 'to come' : on ? 'practised' : 'no practice'}">
      <span aria-hidden="true">${on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : ''}</span>
      <b aria-hidden="true">${i === p.dow ? 'Today' : 'MTWTFSS'[i]}</b></li>`).join('')}</ol>
    <dl class="pr-stats">
      ${stat('Rounds done', num(p.runs), 'in all')}
      ${stat('Tones', p.ear === null ? '–' : `${p.ear}%`, p.ear === null ? 'not enough yet' : 'heard right')}
      ${stat('Look-alikes', p.looks === null ? '–' : `${p.looks}%`, p.looks === null ? 'not enough yet' : 'told apart')}
    </dl>
  </section>`;
}

function drawPractice(final) {
  const st = practiceState(), next = practiceNext(st);
  // (compared once the lists are in, so the first, quicker drawing doesn't count as a change)
  const lines = { daily: String(st.daily.done), weak: String(st.weak.n), grammar: st.grammar.line, phrases: st.phrases.line,
    tones: st.tones.line, looks: st.looks.line };
  const moved = final ? practiceChanged(lines) : new Set();
  const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICO = {
    daily: '<path d="M4 7h7v4H4zM13 7h7v4h-7zM8 15h8v4H8z"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    weak: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>',
    grammar: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    phrases: '<path d="M4 5h16v11H9l-5 4zM8 9.5h8M8 12.5h5"/>', tones: '<path d="M3 12h2l2-6 3 13 3-16 3 13 2-4h3"/>',
    looks: '<rect x="3.5" y="3.5" width="11" height="11" rx="2"/><path d="M9.5 18.5v.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 19 9.5h-.5"/>',
  };
  const bar = p => p === null || p === undefined ? '' : `<span class="xs-bar" aria-hidden="true"><i style="--w:${Math.round(100 * Math.min(1, p))}%"></i></span>`;
  const tile = (href, ico, colour, title, line, p, cls = '', key = '') => `<a class="xs-tile${cls}${moved.has(key) ? ' pr-moved' : ''}" href="${href}"><span class="ico ${colour}">${icon(ico)}</span>
    <span class="xs-text"><b>${title}</b><small>${line}</small>${bar(p)}</span></a>`;
  const nextIco = { '#/weak': ICO.weak, '#/grammar/daily': ICO.daily, '#/lookalikes': ICO.looks, '#/tones': ICO.tones, '#/phrases': ICO.phrases }[next.href];
  app.innerHTML = '<h1 class="page-title">Practice</h1>' + withRail(`
    <p class="lede">Extra practice, whenever you like. It never adds to your reviews.</p>
    ${heroCard(practiceHero(next, st))}
    <a class="pr-mix" href="#/weak/mix"><span class="pr-mix-ico" aria-hidden="true">${icon('<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>')}</span>
      <span class="pr-mix-text"><b>Can't choose? Quick mix</b><small>A few tones${st.looks.open ? ', look-alikes' : ''}${st.weak.n ? ' and weak spots' : ''} in one round · about 2 minutes</small></span>
      <span class="pr-mix-go" aria-hidden="true">→</span></a>
    <section class="xs" aria-labelledby="pr-all-h"><h2 class="sec-h" id="pr-all-h">All practice</h2>
      <div class="xs-grid pr-grid">
        ${tile('#/grammar/daily', st.daily.done ? ICO.check : ICO.daily, st.daily.done ? 'mint' : 'yellow', 'Daily grammar',
          st.daily.done ? 'Done for today. Another round?' : 'Today\'s round: six sentences', null, st.daily.done ? ' pr-done' : '', 'daily')}
        ${tile('#/weak', ICO.weak, 'pink', 'Weak spots', st.weak.n ? `${st.weak.n} to work on` : 'Nothing to work on. Nice.', null, st.weak.n ? ' pr-alert' : ' pr-calm', 'weak')}
        ${tile('#/grammar', ICO.grammar, 'mint', 'Grammar', st.grammar.line, st.grammar.p, '', 'grammar')}
        ${tile('#/phrases', ICO.phrases, 'pink', 'Phrases', st.phrases.line, st.phrases.p, '', 'phrases')}
        ${tile('#/tones', ICO.tones, 'yellow', 'Tones', st.tones.line, st.tones.p, '', 'tones')}
        ${tile('#/lookalikes', ICO.looks, 'sky', 'Look-alikes', st.looks.line, st.looks.p, st.looks.open ? '' : ' pr-calm', 'looks')}
      </div>
    </section>
    ${practiceWeekHtml()}`, true);
}

/* Choosing a learning path: on Today and on the Lessons page when nothing is queued and no
   path is on, and at the end of the tutorial (tour.js). */
const PATH_CHOICES = [
  ['mix', 'Balanced', 'Common and simple characters first, in step with the HSK levels. The one to pick if you are not sure.'],
  ['common', 'Most common first', 'Straight down the frequency list: the quickest way to reading real text.'],
  ['hsk', 'HSK 1 to 9', 'The exam\'s own order, level by level.'],
];
function pathPick() {
  return `<div class="path-pick">${PATH_CHOICES.map(([id, name, note], i) =>
    `<button type="button" class="path-opt${i ? '' : ' best'}" data-path="${id}"><b>${name}</b><small>${note}</small></button>`).join('')}</div>`;
}
function wirePathPick(root, after) {
  root.querySelectorAll('[data-path]').forEach(b => b.addEventListener('click', async () => {
    root.querySelectorAll('[data-path]').forEach(x => { x.disabled = true; });
    Store.setCfg({ path: b.dataset.path });
    await fillPath();
    await fillParts();
    after();
  }));
}

function pageStudy() {
  drawStudy();
  // today's characters from the learning path, and the parts of what is queued
  fillPath().then(n => fillParts().then(changed => {
    if ((n || changed) && currentPath() === '/study') drawStudy();
  }));
  // (the HSK lists, for the button that finishes a level)
  if (!HZ.hskChars) optional(need.hskChars()).then(() => { if (HZ.hskChars && currentPath() === '/study') drawStudy(); });
}

/* Today, the home page: what to do now first (how to start, for a newcomer; lessons and
   reviews; something to read once they are done), then the streak, practice, what is coming,
   and your progress. */
function drawStudy() {
  const d = Store.load(), cfg = Store.cfg(), items = Object.entries(d.items), now = Date.now();
  const p = Store.plan(), unsorted = calibrationSets().unsorted.length;
  const fc = Learn.forecast(items.map(e => e[1]), now, 7);
  const max = Math.max(1, ...fc);
  const dayName = i => i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
    : new Date(now + i * Learn.DAY).toLocaleDateString(undefined, { weekday: 'long' });
  const groups = ['Novice', 'Apprentice', 'Adept', 'Expert', 'Master'];
  const inGroup = g => items.filter(([, it]) => Learn.group(it.stage) === g).length;

  // the tiles: what you can start now, and why not when it's nothing
  const nLocked = Object.keys(p.locked).length;
  const lessonNote = p.vacation ? 'On vacation' : p.lessons.length || !p.waiting.length ? ''
    : p.tomorrow.length === p.waiting.length ? 'Words open tomorrow'
    : nLocked === p.waiting.length ? 'Waiting to unlock' : 'Today\'s limit reached';
  const overLimit = !p.vacation && p.due.length && !p.reviewsLeft;
  const reviewNote = p.vacation ? 'On vacation' : overLimit ? `Today's limit reached · ${p.due.length} due` : '';
  // a tile: its name, how many, a note, and (when there is something to start) what
  // pressing it does and about how long it takes
  const tile = (cls, name, n, note, active = n, go = '') => `<a class="lx-tile ${cls}${active ? '' : ' idle'}" href="#/${cls}"${active ? ` aria-keyshortcuts="${cls[0].toUpperCase()}"` : ''}>
    <b>${name}</b><span>${n}</span>${note ? `<em>${esc(note)}</em>` : ''}${active && go ? `<small class="lx-go"><span class="lx-go-t">${go}</span></small>` : ''}</a>`;
  // about how long: a lesson (meet it, then its quiz) ~40 s, a sound ~15 s, a review ~10 s
  // ("about" goes on a phone, where the tile is narrow)
  const aboutMin = sec => `<span class="lx-about">about </span>${Math.max(1, Math.round(sec / 60))}&nbsp;min`;

  // what the Lessons tile's number is made of: sounds are lessons too, but short ones the
  // daily limit doesn't count, so the tile can say more than the limit
  const ready = { char: 0, word: 0, comp: 0, sound: 0 };
  for (const k of p.lessons) ready[d.items[k].kind || 'char']++;
  const readyList = [['char', 'character'], ['word', 'word'], ['comp', 'component'], ['sound', 'sound']]
    .filter(([k]) => ready[k]).map(([k, name]) => `${ready[k]} ${name}${ready[k] === 1 ? '' : 's'}`);
  const listed = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  // the Lessons tile's number: what counts towards the daily limit (sounds don't), the same
  // thing the meter under it counts; the sounds are said beside it
  const counted = p.lessons.length - ready.sound;
  // the day so far: done of the limit, with a bar when there is one
  // (ahead: what is ready now, as a lighter stretch after what's done, and said under it,
  // so "0 / 15" with 11 ready doesn't look like 4 have gone missing)
  const fill = (v, lim) => `transform: translateX(${Math.min(100, v / lim * 100) - 100}%)`;
  const meter = (name, done, lim, info, ahead = 0) => `<div class="lx-m">
      <span class="lx-m-h">${name} today${info ? ` <i class="info-i" tabindex="0" title="${esc(info)}" aria-label="${esc(info)}">i</i>` : ''}</span>
      <b>${num(done)}${lim ? `<small> / ${num(lim)}</small>` : ''}</b>
      ${lim ? `<span class="lx-m-bar" aria-hidden="true">${ahead ? `<i class="lx-m-ahead" style="${fill(done + ahead, lim)}"></i>` : ''}<i style="${fill(done, lim)}"></i></span>` : ''}
      ${ahead ? `<span class="lx-m-note">${num(ahead)} ready now</span>` : ''}
    </div>`;

  const nextTen = typeof nextUp === 'function' ? nextUp(10) : [];
  const started = items.some(([, it]) => it.stage >= 1);            // a lesson has been finished
  const newcomer = !items.length && !Object.keys(d.status || {}).length;
  const noPath = (!cfg.path || cfg.path === 'off') && !p.waiting.length;
  // lessons and reviews both done (or none yet today): time to read
  const dayDone = started && !p.vacation && !p.lessons.length && !p.reviewsLeft;
  // nothing learned or marked yet: the first lesson is the one thing to do, so the parts
  // that would only show zeros (reviews, the week, your progress) wait until there is one
  const fresh = !started && !p.due.length && !p.vacation;
  // when the next review falls due, for the Reviews tile when there is none now
  let nextDue = Infinity;
  for (const [, it] of items) if (it.stage >= 1) nextDue = Math.min(nextDue, Math.max(it.due, it.rest || 0));
  const whenNext = t => {
    if (!isFinite(t)) return '';
    const mins = Math.max(1, Math.round((t - now) / 60000)), days = Math.round((Learn.dayStart(t) - Learn.dayStart(now)) / Learn.DAY);
    return days <= 0 ? (mins < 60 ? `Next in ${mins} min` : `Next in ${Math.round(mins / 60)} h`)
      : days === 1 ? 'Next tomorrow' : `Next in ${days} days`;
  };
  const reviewsTile = tile('reviews', 'Reviews', p.reviewsLeft, reviewNote || (p.reviewsLeft ? '' : whenNext(nextDue)),
    p.reviewsLeft, `Start · ${aboutMin(p.reviewsLeft * 10)}`);
  // the Lessons tile's number: the characters and words; the components and short sounds
  // that come with them are said under it (or, with no character or word ready, counted)
  const mainN = ready.char + ready.word;
  const parts = [ready.comp && `${ready.comp} component${ready.comp === 1 ? '' : 's'}`,
    ready.sound && `${ready.sound} short sound${ready.sound === 1 ? '' : 's'}`].filter(Boolean);
  const partsNote = !parts.length ? '' : mainN ? '+ ' + parts.join(' · ')
    : [ready.comp && 'Components', ready.sound && (ready.comp ? 'short sounds' : 'Short sounds')].filter(Boolean).join(' and ');
  const lessonsTile = tile('lessons', 'Lessons', mainN || ready.comp + ready.sound, partsNote || lessonNote,
    p.lessons.length, `${fresh ? 'Start your first lesson' : 'Start'} · ${aboutMin(counted * 40 + ready.sound * 15)}`);
  // the reviews to come, so a big day isn't a surprise: tomorrow, and the week after today
  const fc8 = Learn.forecast(items.map(e => e[1]), now, 8);
  const week = fc8.slice(1).reduce((a, b) => a + b, 0);
  const aheadLine = fresh || !week ? '' : `<p class="lx-ahead small">Coming up: ${fc8[1]
    ? `<b>${num(fc8[1])}</b> review${fc8[1] === 1 ? '' : 's'} tomorrow` : 'no reviews tomorrow'} · <b>${num(week)}</b> in the next 7 days</p>`;
  // the day done: the tiles shrink to one line, since there is nothing to start
  const doneRow = `<p class="lx-mini">
      <a href="#/lessons">Lessons <b>${p.lessons.length}</b>${lessonNote ? ` <span>· ${esc(lessonNote)}</span>` : ''}</a>
      <a href="#/reviews">Reviews <b>${p.reviewsLeft}</b>${reviewNote ? ` <span>· ${esc(reviewNote)}</span>` : ''}</a></p>`;

  // the reviews to come, day by day, for the Coming up card
  const fcRows = fc.map((v, i) => `<div class="td-fc-row"><span>${dayName(i)}</span>
      <span class="td-fc-bar" aria-hidden="true"><i style="width:${Math.round(v / max * 100)}%"></i></span><b>${num(v)}</b></div>`).join('');
  const comingCard = `<section class="card td-coming" aria-labelledby="td-coming-h">
      <div class="td-card-head"><h2 class="caps" id="td-coming-h">Coming up</h2>
        ${fresh ? '' : `<span class="small muted">${num(fc.reduce((a, b) => a + b, 0))} in the next 7 days</span>`}</div>
      <div class="lx-today${fresh ? ' solo' : ''}" aria-label="Done today">
      ${meter('Lessons', p.lessonsToday, cfg.lessonLimit, readyList.length ? `Ready now: ${listed(readyList)}.${ready.sound
        ? ' Sounds are short: they do not count towards the daily limit, or this number.' : ''}` : '', counted)}
      ${fresh ? '' : meter('Reviews', p.reviewsToday, cfg.reviewLimit, '', p.reviewsLeft)}
      </div>
      ${fresh ? '' : `<div class="td-fc" role="list" aria-label="Reviews due each day">${fcRows}</div>`}
      ${learnedCount(learnedToday()) ? `<a class="lx-learned small" href="#/learned">Learned today (${learnedCount(learnedToday())}) →</a>` : ''}
    </section>`;
  app.dataset.layout = 'wide';
  const dateLine = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  app.innerHTML = `<h1 class="page-title">Today</h1><p class="lede td-date">${esc(dateLine)}</p>` + withRail(`
    ${p.vacation ? `<section class="card lx-vac">
      <h2>On vacation</h2>
      <p class="muted">Since ${esc(new Date(cfg.vacation).toLocaleDateString())}. Lessons and reviews wait until
        you're back; then every review is moved on by the time you were away.</p>
      <p><button class="btn" id="lx-back">I'm back</button></p></section>` : ''}
    ${noPath && !p.vacation ? `<section class="card lx-path" id="lx-path">
      <h2 class="caps">${newcomer ? 'Choose how to start' : 'Nothing to learn next?'}</h2>
      <p class="muted">HanziHome can fill your lessons each day: ${dailyLine(cfg)}, each character with its
        components and sounds before it. Pick an order; you can change it at any time in
        <a href="#/settings">Settings</a>.</p>
      ${pathPick()}
      <p class="small muted">${newcomer ? `Know some characters already? <a href="#/frequency">Mark them as learned</a> and the lessons
        skip them. ` : ''}Rather choose for yourself? <b>Add to lessons</b> on any
        character's or word's page does that, with or without a path.</p></section>` : ''}
    <div class="td-grid${fresh ? ' first' : ''}">
    <div class="td-main lx-top${fresh ? ' first' : ''}">
    ${dayDone ? '' : `<div class="lx-hub${fresh ? ' solo' : ''}">
      ${lessonsTile}
      ${p.reviewsLeft || !fresh ? reviewsTile : ''}
    </div>`}
    ${dayDone ? `<section class="lx-done" aria-labelledby="lx-done-h">
      <h2 id="lx-done-h"><span class="lx-done-tick" aria-hidden="true">✓</span>Done for today</h2>
      <p class="muted small">Your lessons and reviews are finished.${whenNext(nextDue) ? ` ${whenNext(nextDue).replace('Next', 'The next review is due')}.` : ''}</p>
      ${doneRow}
    </section>
    ${storyNextCard()}` : ''}
    ${comingCard}
    </div>
    <div class="td-side">
    ${fresh ? '' : coverageCard()}
    ${nextTen.length ? `<section class="card lx-next" aria-labelledby="lx-next-h">
      <div class="lx-next-head"><h2 id="lx-next-h">Next up</h2><a class="small" href="#/queue">See all →</a></div>
      <div class="lx-queue">${nextTen.map(k => { const kind = d.items[k] ? d.items[k].kind : 'char';
        return `<a class="lx-q ${kind} han" href="${itemHref(k)}" title="${kind === 'word' ? 'Word' : 'Character'}: open its page">${zh(k)}</a>`; }).join('')}</div>
      <p class="lx-key small" aria-hidden="true">${[['char', 'Characters'], ['word', 'Words']]
        .filter(([k]) => nextTen.some(x => (d.items[x] ? d.items[x].kind : 'char') === k))
        .map(([k, name]) => `<span><i class="${k}"></i>${name}</span>`).join('')}</p>
      ${cfg.path && cfg.path !== 'off' ? `<p class="small muted lx-pathline">Learning path: ${cfg.path === 'hsk' ? 'HSK 1 to 9' : cfg.path === 'mix' ? 'balanced' : 'the most common characters'},
        ${dailyLine(cfg)} · <a href="#/settings">change</a></p>` : ''}
    </section>` : ''}
    </div>
    </div>
    ${fresh && !p.vacation ? firstSteps() : ''}
    ${fresh ? '' : streakCard()}
    ${!p.vacation && !fresh ? extraStudy(wkCount(), true, !!(p.lessons.length || p.reviewsLeft)) : ''}
    ${/* the things to do, together (side by side when there is room); then the chart of how far you've come */ ''}
    ${(() => {
      const cards = (unsorted ? `<section class="card td-prompt cb-cta">
        <div class="tp-head"><span class="tp-badge cal" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M4 12h7M4 18h5"/><path d="m14 15 2.5 2.5L21 12"/></svg></span>
          <div class="tp-title"><h2>Sort your learned characters</h2>
            <p class="tp-sub">${unsorted.toLocaleString()} not checked yet</p></div></div>
        <p class="tp-text">You marked these as learned, so they joined your reviews at Novice without a check. A calibration
          test, typing each one's pronunciation and meaning, puts each at the stage it belongs.</p>
        <p class="tp-act"><a class="btn" href="#/calibrate">Calibration test</a></p></section>` : '')
        + (HZ.hskChars ? hskPushCard(Learn.hskNearlyDone(hskStanding())) : '');
      return cards ? `<div class="td-prompts">${cards}</div>` : '';
    })()}
    ${leechCard(d, now)}
    ${fresh ? '' : `<div class="td-more">${studyNextCard()}</div>`}
    <section class="card" id="lc-card" hidden></section>
`, true);
  const redraw = () => { drawStudy(); markNav(currentPath()); };
  wireLeeches(redraw);
  // (at once, then again when the parts of what was added have been looked up)
  wireHskPush(app, () => {
    redraw();
    fillParts().then(changed => { if (changed && currentPath() === '/study') redraw(); });
  });
  drawLearnedChart(document.getElementById('lc-card'), d.items, now);
  wirePathPick(app, () => { redraw(); window.scrollTo(0, 0); announce('Your lessons are ready.'); });
  const back = document.getElementById('lx-back');
  if (back) back.addEventListener('click', () => { Store.vacation(false); redraw(); });
  paintRail();
  if (dayDone) fillStoryNext();
}

/* The study page's chart of items learned: a running total for each kind, stacked,
   day by day since the first lesson (Learn.learnedByDay). The areas are an SVG
   stretched to the box; the labels are HTML over it, so they keep their size on a
   phone. A series' key hides or shows it; pointing (or a tap) shows a day's totals. */
const LC_SERIES = [['sound', 'Sounds'], ['comp', 'Components'], ['char', 'Characters'], ['word', 'Words']];
const _lcHidden = new Set();

function niceStep(max, lines = 4) {
  const raw = Math.max(1, max / lines), p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(m => m * p).find(x => x >= raw);
}

function drawLearnedChart(box, items, now) {
  if (!box) return;
  const { days, series } = Learn.learnedByDay(items, now);
  const all = LC_SERIES.filter(([k]) => series[k][series[k].length - 1]);
  if (!all.length) { box.hidden = true; return; }
  box.hidden = false;
  const shown = all.filter(([k]) => !_lcHidden.has(k));
  const n = days.length, W = 1000, H = 300;
  const total = i => shown.reduce((t, [k]) => t + series[k][i], 0);
  const step = niceStep(Math.max(1, ...days.map((_, i) => total(i))));
  const top = step * Math.max(1, Math.ceil(Math.max(1, ...days.map((_, i) => total(i))) / step));
  const x = i => n === 1 ? (i ? W : 0) : (W * i) / (n - 1);
  const y = v => H - (H * v) / top;
  const pts = n === 1 ? [0, 0] : days.map((_, i) => i);           // one day: a flat band
  // the stack, bottom up: each band between the running totals below and with it
  let under = days.map(() => 0);
  const bands = shown.map(([k]) => {
    const over = under.map((u, i) => u + series[k][i]);
    const line = pts.map((i, j) => `${x(j && n === 1 ? 1 : i).toFixed(1)},${y(over[i]).toFixed(1)}`);
    const back = pts.map((i, j) => `${x(j && n === 1 ? 1 : i).toFixed(1)},${y(under[i]).toFixed(1)}`).reverse();
    under = over;
    return `<path class="lc-${k}" d="M${line.join('L')}L${back.join('L')}Z"/><path class="lc-${k} lc-line" d="M${line.join('L')}"/>`;
  }).join('');
  const grid = [];
  for (let v = 0; v <= top; v += step) grid.push(v);
  const fmt = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const nt = (box.clientWidth || 600) < 480 ? 3 : 5;                // date labels: fewer on a phone
  const ticks = n === 1 ? [0] : [...new Set(Array.from({ length: nt + 1 }, (_, j) => Math.round(j * (n - 1) / nt)))];
  const pct = i => n === 1 ? 50 : (100 * i) / (n - 1);
  box.innerHTML = `<h2 class="caps">Items learned</h2>
    <div class="lc-keys">${all.map(([k, name]) => `<button class="lc-key${_lcHidden.has(k) ? ' off' : ''}" data-lc="${k}"
      aria-pressed="${!_lcHidden.has(k)}"><i class="lc-${k}"></i>${name}</button>`).join('')}</div>
    <div class="lc-plot">
      <div class="lc-y">${grid.map(v => `<span style="bottom:${(100 * v) / top}%">${v.toLocaleString()}</span>`).join('')}</div>
      <div class="lc-area" tabindex="0" aria-label="Items learned: ${esc(all.map(([k, name]) => `${series[k][n - 1]} ${name.toLowerCase()}`).join(', '))}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${grid.map(v => `<line class="lc-grid" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}${bands}</svg>
        <i class="lc-cursor" hidden></i><div class="lc-tip" hidden></div>
        <div class="lc-x">${ticks.map(i => `<span style="left:${pct(i)}%">${esc(fmt(days[i]))}</span>`).join('')}</div>
      </div>
    </div>`;
  box.querySelectorAll('[data-lc]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.lc;
    if (_lcHidden.has(k)) _lcHidden.delete(k); else if (shown.length > 1) _lcHidden.add(k);
    drawLearnedChart(box, items, now);
  }));
  const area = box.querySelector('.lc-area'), cur = box.querySelector('.lc-cursor'), tip = box.querySelector('.lc-tip');
  const point = e => {
    const r = area.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const i = n === 1 ? 0 : Math.round(f * (n - 1));
    cur.hidden = tip.hidden = false;
    cur.style.left = pct(i) + '%';
    tip.innerHTML = `<b>${esc(new Date(days[i]).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</b>
      ${shown.slice().reverse().map(([k, name]) => `<span><i class="lc-${k}"></i>${name} <b>${series[k][i].toLocaleString()}</b></span>`).join('')}
      ${shown.length > 1 ? `<span>All <b>${total(i).toLocaleString()}</b></span>` : ''}`;
    // beside the cursor, on whichever side has room
    const left = (pct(i) / 100) * r.width;
    tip.style.left = (left > r.width / 2 ? left - tip.offsetWidth - 10 : left + 10) + 'px';
  };
  area.addEventListener('pointermove', point);
  area.addEventListener('pointerdown', point);
  area.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') cur.hidden = tip.hidden = true; });
}

// ------------------------------------------------------------------ lessons

async function pageLessons() {
  if (!lessonState) {
    await fillPath();
    await fillParts();
    const cfg = Store.cfg(), p = Store.plan();
    const batch = nextBatch([]);
    if (!batch.length) {
      const nLocked = Object.keys(p.locked).length;
      const why = p.vacation ? '<p class="empty">Lessons are paused while you\'re on vacation.</p>'
        : !p.waiting.length && (!cfg.path || cfg.path === 'off') ? `<p class="empty">No lessons waiting.</p>
          <p class="muted">Choose a learning path and HanziHome fills your lessons each day:
            ${dailyLine(cfg)}.</p>
          ${pathPick()}
          <p class="small muted">Or add characters and words yourself, with <b>Add to lessons</b> on a character's page
            or in the reader's word popup.</p>`
        : !p.waiting.length ? `<p class="empty">No lessons waiting.</p>
          <p class="small muted">Your learning path has nothing more to add today. Add characters and words yourself with
            <b>Add to lessons</b> on a character's page or in the reader's word popup.</p>`
        : p.tomorrow.length === p.waiting.length ? `<p class="empty">Your ${p.waiting.length} word${p.waiting.length === 1 ? ' opens' : 's open'} tomorrow.</p>
            <p class="small muted">A word's lesson comes the day after its characters', so they have time to settle.</p>`
        : nLocked === p.waiting.length ? `<p class="empty">Your ${p.waiting.length} lesson${p.waiting.length === 1 ? ' is' : 's are'}
            waiting to unlock.</p><p class="small muted">Words wait for their characters, as set in Settings;
            <a href="#/queue">Upcoming</a> shows the order they come in.</p>`
        : `<p class="empty">That's today's lessons done.</p><p class="small muted">You learn ${dailyLine(cfg)};
            ${p.waiting.length - nLocked} more are ready for tomorrow.</p>`;
      app.innerHTML = '<h1 class="page-title">Lessons</h1>' + withRail(`<div class="card">
        ${why}
        <p class="row">${learnedCount(learnedToday()) ? `<a class="btn" href="#/learned">See what you learned today</a>` : ''}
          <a class="btn${learnedCount(learnedToday()) ? ' quiet' : ''}" href="#/study">Back to Today</a></p></div>
        ${learnedCount(learnedToday()) && !p.vacation ? storyNextCard() : ''}`, true);
      wirePathPick(app, () => { markNav(currentPath()); pageLessons(); });
      paintRail();
      if (document.getElementById('read-next')) fillStoryNext();
      return;
    }
    lessonState = { batch, i: 0, tab: 0, done: [], intro: [], grade: {} };
    // the first lessons ever open on how the picture names work (tour.js)
    if (typeof picturesFirst === 'function') picturesFirst(batch);
    wordSet = null;
  }
  const s = lessonState;
  if (s.i >= s.batch.length) {
    // the next batch, if there are lessons left today; the quiz once there are none
    const next = nextBatch(s.done);
    if (next.length) Object.assign(s, { batch: next, i: 0, tab: 0, round: (s.round || 1) + 1 });
    else return s.done.length ? lessonQuiz(s) : lessonsDone();
  }
  const k = s.batch[s.i], it = Store.item(k);
  if (!it) { s.i++; return pageLessons(); }
  // a part (component or sound) has no composition: its lesson opens on the mnemonic
  const part = it.kind === 'comp' || it.kind === 'sound', first = part ? 1 : 0;
  if (s.tab < first) s.tab = first;
  // before anything else, the character (or word) coming up: its Prerequisites page
  if (s.tab === first) {
    const goal = introFor(k, s);
    if (goal) return lessonIntro(goal, k, s);
  }
  const f = await itemFacts(k, it);
  const tabs = [it.kind === 'word' ? 'Characters' : 'Composition', 'Mnemonic', 'Examples', 'Confirmation'];
  const quiz = s.tab === 3;
  const rightHtml = `<p class="lx-right">Right: <b>${esc(primary(it))}</b>${others(it).length ? `<span class="muted"> · also ${esc(others(it).slice(0, 4).join(', '))}</span>` : ''}</p>`;
  const ctx = mnCtx(k, it, f);
  const chips = (xs, cls) => `<div class="lx-chips ${cls || ''}">${xs.map(([c, g, key]) => cls === 'snd'
    ? `<span class="lx-chip snd-chip"><span class="snd-key">${esc(c)}</span><span>${esc(g)}</span></span>` : lxChip(c, g)).join('')}</div>`;

  let body = '';
  if (s.tab === 0) {
    body = it.kind === 'word'
      ? lxTile('Characters', `<p class="muted">This word is made of these characters. Can you see how they
          make its meaning and its sound?</p>${chips(f.parts)}`, 'wide')
      : lxTile('Made of', `${f.comps.length ? chips(f.comps, 'comp') : '<p class="muted small">It has no components with a name of their own.</p>'}
           <p class="muted small">Can you see where they are?</p>`, f.sounds.length ? '' : 'wide')
        + (f.sounds.length ? lxTile('Sounds like', `${chips(f.sounds, 'snd')}<p class="muted small">Its pronunciation, <b>${esc(it.pin)}</b>, is these three
           sounds: its beginning is a person, its ending a building, and its tone where at that building (1 in front, 2 inside, 3 basement, 4 bathroom, 5 roof). Can you hear how they make the syllable?</p>
           ${f.sound ? `<p class="muted small"><span class="han">${esc(f.sound[0])}</span> ${esc(f.sound[1])} also hints at the sound.</p>` : ''}`, 'span2') : '');
  } else if (s.tab === 1) {
    const scaffold = it.kind === 'word' ? f.parts.map(([c, g]) => `<b class="han">${esc(c)}</b> ${esc(g)}`).join(' + ')
      : it.kind === 'char' ? f.comps.map(([c, g]) => `<b class="han">${esc(c)}</b> ${esc(g || '?')}`).join(' + ')
      : it.kind === 'comp' ? f.subs.map(([c, g]) => `<b class="han">${esc(c)}</b> ${esc(g)}`).join(' + ') : '';
    // (your own story is optional when there is one already: it waits behind a link until
    // you write one)
    const ownShut = !!f.mn && !it.mnemonic;
    body = lxTile('Mnemonic', `
      ${scaffold || it.kind === 'char' ? `<p class="muted">${scaffold ? scaffold + ' → ' : ''}<b class="han">${esc(itemText(k))}</b> ${esc(primary(it))}
        ${it.pin ? `· sounds <b>${esc(it.pin)}</b>` : ''}</p>` : ''}
      ${f.mn ? `<div class="mn lx-mn-builtin">${mnHtml(f.mn, ctx)}</div>` : ''}
      ${(it.kind === 'char' || it.kind === 'word') && !/\{[^}]+\}/.test(f.mn || '') ? soundStrip(it.pin) : ''}
      ${f.mn ? `<p class="small muted lx-mn-note">Picture it for a moment.${ownShut
        ? ' <button type="button" class="lx-mn-open" id="lx-mn-open" aria-expanded="false" aria-controls="lx-own">✎ Write your own</button>'
        : ' Or write a story of your own, which is shown instead:'}</p>` : ''}
      <div class="lx-own" id="lx-own"${ownShut ? ' hidden' : ''}>
        <textarea id="lx-mn" rows="${f.mn ? 2 : 4}" placeholder="${f.mn ? 'Your own story, shown instead of the one above…' : 'Make up a little story that joins the parts, the meaning and the sound…'}">${esc(it.mnemonic || '')}</textarea>
        <p class="small muted" id="lx-mn-state">Saved as you type.</p>
      </div>`, 'wide')
      + lxTile(part ? 'Name' : 'Meaning', `<dl class="lx-dl"><dt>Primary</dt><dd><b>${esc(primary(it))}</b></dd>
        <dt>Alternatives</dt><dd>${others(it).length ? esc(others(it).join(', ')) : '<span class="muted">none</span>'}</dd></dl>
      ${it.kind === 'sound' ? `<p><button type="button" class="btn quiet lx-say" id="lx-say">▶ Hear it</button></p>` : ''}`, part ? 'wide' : 'span2')
      + (part ? '' : lxTile('Pronunciation', `<dl class="lx-dl"><dt>Primary</dt><dd><b>${esc(numbered(it.pin))}</b> · ${esc(it.pin)}
        ${Sound.canSay() ? '<button type="button" class="btn quiet lx-say" id="lx-say">▶ Hear it</button>' : ''}</dd></dl>`));
  } else if (s.tab === 2) {
    body = it.kind === 'comp' ? lxTile('Examples', `<p class="muted">Characters with this component. Can you see where it is in each of them?</p>${chips(f.words)}`, 'wide')
      : it.kind === 'sound' ? lxTile('Examples', `<p class="muted">Common characters with this sound:</p>${chips(f.words)}`, 'wide')
      : `${it.ex && it.ex.text ? lxTile('Where you found it', foundIn(k, it), 'wide') : ''}
      ${f.ex.length ? lxTile('In sentences <span class="lt-hint">· tap one for its pinyin</span>', f.ex.map(ex =>
          `<div class="example lx-pinless" tabindex="0" aria-label="A sentence: Enter shows its pinyin">${exampleHtml(ex, k)}</div>`).join('')
        + (it.kind === 'word' && HZ.winfo[k][3] ? `<p class="word-use"><b>Good to know:</b> ${esc(HZ.winfo[k][3])}</p>` : ''), 'wide lx-ex') : ''}
      ${f.words.length ? lxTile('Words it is in', `<div class="lx-chips">${f.words.map(([w, p]) => lxChip(w, p, '#/word/' + encodeURIComponent(w))).join('')}</div>`, 'wide') : ''}
      ${!(it.ex && it.ex.text) && !f.words.length && !f.ex.length ? lxTile('Examples', '<p class="muted">No examples yet.</p>', 'wide') : ''}
      ${it.kind === 'word' ? `<p class="lt-after"><a class="small" href="#/word/${encodeURIComponent(k)}" target="_blank">The word's card →</a></p>` : ''}`;
  } else {
    // the pronunciation first; the meaning only once that is right (a part: its name only)
    if (part && s.pinOk !== k) { s.pinOk = k; s.pinAnswer = ''; }
    const pinDone = s.pinOk === k;
    // answered right: it stays, with the answer, until you go on (Next, or Enter)
    var passed = s.passed === k;
    body = lxTile('Confirmation', `
      <p class="muted">${part ? `Its <b>name</b>?` : 'Its <b>pronunciation</b>, with tone numbers (like pin1yin1), and its <b>meaning</b>.'}</p>
      <form id="lx-quiz" autocomplete="off">
        ${part ? '' : `<input id="lx-pin" class="lx-input${pinDone ? ' ok' : ''}" placeholder="Pronunciation…" spellcheck="false"
          autocapitalize="off" autocorrect="off" autocomplete="off" lang="en" enterkeyhint="go" aria-label="Pronunciation, with tone numbers"${pinDone ? ` value="${esc(s.pinAnswer)}" readonly` : ''}>`}
        ${pinDone || !part ? `<input id="lx-mean" class="lx-input${passed ? ' ok' : ''}" placeholder="${part ? 'Name…' : 'Meaning…'}" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off" lang="en" enterkeyhint="go" aria-label="${part ? 'Name' : 'Meaning'}"${passed ? ` value="${esc(s.meanAnswer || '')}" readonly` : ''}>` : ''}
        <div id="lx-verdict" aria-live="assertive">${passed ? rightHtml : ''}</div>
        <button class="btn" type="submit">${passed ? 'Next ›' : 'Check'}</button>
      </form>`, 'wide');
  }

  // what peeks out behind the card: a character's parts; for a part, the character it is for
  const owner = part ? s.batch.slice(s.i + 1).find(x => { const xi = Store.item(x); return xi && Learn.partsOf(x, xi).includes(k); }) : null;
  app.innerHTML = lxTop(s) + deck(band(k, it, !quiz), part ? deckOwner(owner) : deckParts(lessonParts(it, f)),
    `<nav class="lx-tabs" role="tablist" aria-label="Lesson steps">${tabs.map((t, i) => i < first ? '' : `<button type="button" role="tab"
      data-t="${i}" class="${i === s.tab ? 'on' : ''}" aria-selected="${i === s.tab}" aria-controls="lx-panel" aria-label="${t}"
      >${SHORT_TAB[t] ? `<span class="lx-tab-long">${t}</span><span class="lx-tab-short">${SHORT_TAB[t]}</span>` : t}</button>`).join('')}</nav>`,
    `<span class="dk-stage">New · ${esc(kindName(it))}</span>`) + `
    <div class="lx-body">
      <button type="button" class="lx-arrow prev" ${s.tab === first ? 'disabled' : ''} aria-label="Previous step">‹</button>
      <div class="lx-main lt-tiles" id="lx-panel" role="tabpanel" aria-label="${tabs[s.tab]}">${body}</div>
      <button type="button" class="lx-arrow next" ${quiz ? 'disabled' : ''} aria-label="Next step">›</button>
    </div>
    <div class="lx-step">
      <button type="button" class="btn quiet lx-back" ${s.tab === first ? 'disabled' : ''}>‹ Back</button>
      ${quiz ? '' : `<button type="button" class="btn lx-fwd">${s.tab === 2 ? 'Quiz me' : 'Next'} ›</button>`}
    </div>
    <p class="lx-keys small muted"><span class="kb">${quiz ? (s.passed === k ? 'Enter for the next one' : 'Enter checks your answer') : 'Enter or → for the next step · ← back'}</span>
      <span class="touch">${quiz ? '' : 'Swipe sideways to move between steps'}</span></p>`;

  wireQuizNow(s);
  // a new item is dealt in; another tab slides in from the side it is on
  if (!s.drawn || s.drawn.k !== k) { if (!flyFromPart(s, k)) dealCard(); }
  else if (s.drawn.tab !== s.tab) Motion.play(app.querySelector('.lx-main'), s.tab > s.drawn.tab ? 'm-next' : 'm-prev');
  // (a phone scrolled down to the last step's end would open the next one half-way down)
  if (!s.drawn || s.drawn.k !== k || s.drawn.tab !== s.tab) toLessonTop();
  s.drawn = { k, tab: s.tab };
  const go2 = t => {
    t = Math.max(first, Math.min(3, t));
    if (t === s.tab) return;
    s.tab = t;
    pageLessons().then(() => {
      // keyboard and screen reader users stay where they were: on the step's tab
      const on = app.querySelector('.lx-tabs button.on');
      if (on && document.activeElement === document.body && !document.getElementById('lx-quiz')) on.focus({ preventScroll: true });
    });
  };
  app.querySelectorAll('.lx-tabs button').forEach(b => b.addEventListener('click', () => go2(+b.dataset.t)));
  // arrow keys along the tabs, as a tablist has them
  const tabBar = app.querySelector('.lx-tabs');
  // (on a phone the tabs scroll sideways: the open one in the middle)
  const onTab = tabBar.querySelector('.on');
  if (onTab && tabBar.scrollWidth > tabBar.clientWidth) {
    const r = localRect(onTab), box = localRect(tabBar);
    tabBar.scrollLeft += r.left - box.left - (box.width - r.width) / 2;
  }
  tabBar.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    go2(e.key === 'Home' ? first : e.key === 'End' ? 3 : s.tab + (e.key === 'ArrowRight' ? 1 : -1));
  });
  app.querySelector('.lx-arrow.prev').addEventListener('click', () => go2(s.tab - 1));
  app.querySelector('.lx-arrow.next').addEventListener('click', () => go2(s.tab + 1));
  app.querySelector('.lx-back').addEventListener('click', () => go2(s.tab - 1));
  const fwd = app.querySelector('.lx-fwd');
  if (fwd) fwd.addEventListener('click', () => go2(s.tab + 1));
  onSwipe(app.querySelector('.lx-body'), dir => { if (dir > 0 ? !quiz : s.tab > first) go2(s.tab + dir); });

  // read the item aloud once, when its lesson opens
  if (s.said !== k) { s.said = k; Sound.say(k); }
  const say = document.getElementById('lx-say');
  if (say) say.addEventListener('click', () => Sound.say(k, true));
  // a sentence's pinyin shows only once you ask for it: a click (or Enter) on the sentence
  app.querySelectorAll('.lx-pinless').forEach(ex => {
    const flip = e => {
      if (ex.classList.contains('pin-on') && e.target.closest('a')) return;   // (shown: its words open as links)
      if (e.target.closest('a')) e.preventDefault();
      ex.classList.toggle('pin-on');
    };
    ex.addEventListener('click', flip);
    ex.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === ex) { e.preventDefault(); e.stopPropagation(); flip(e); } });
  });

  const mn = document.getElementById('lx-mn'), mnOpen = document.getElementById('lx-mn-open');
  if (mnOpen) mnOpen.addEventListener('click', () => {
    document.getElementById('lx-own').hidden = false;
    mnOpen.setAttribute('aria-expanded', 'true');
    mnOpen.hidden = true;
    mn.focus();
  });
  if (mn) {
    let timer;
    mn.addEventListener('input', () => {
      clearTimeout(timer);
      document.getElementById('lx-mn-state').textContent = 'Saving…';
      timer = setTimeout(() => {
        (Store.item(k) || it).mnemonic = mn.value.trim();     // (the store may have been reloaded meanwhile)
        Store.save();
        document.getElementById('lx-mn-state').textContent = 'Saved.';
      }, 500);
    });
  }

  const form = document.getElementById('lx-quiz');
  if (form) {
    // both boxes are there from the start: the pronunciation is checked first (Enter in it
    // checks it and goes on to the meaning; with both filled in, one Check does both)
    const pinBox = document.getElementById('lx-pin'), meanBox = document.getElementById('lx-mean');
    (s.pinOk === k || !pinBox ? meanBox : pinBox).focus();
    if (s.passed === k) form.querySelector('button[type=submit]').focus();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const verdict = document.getElementById('lx-verdict');
      // answered already: on to the next one
      if (s.passed === k) {
        s.i++; s.tab = 0; s.pinOk = null; s.passed = null;   // (a part's lesson moves on to its first tab)
        return pageLessons();
      }
      if (s.pinOk !== k) {
        const pa = pinBox.value;
        if (!pa.trim()) { pinBox.focus(); return; }
        if (!Learn.checkPinyin(pa, it.pin)) {
          s.missed = (s.missed || 0) + 1;
          verdict.innerHTML = `<p class="lx-wrong">It is <b>${esc(numbered(it.pin))}</b> (${esc(it.pin)}). Try again.</p>`;
          Motion.play(pinBox, 'm-shake');
          pinBox.focus();
          return;
        }
        Sound.ding();
        Sound.say(k);
        s.pinOk = k;
        s.pinAnswer = pa;
        pinBox.readOnly = true;
        pinBox.classList.add('ok');
        verdict.innerHTML = '';
        if (!meanBox.value.trim()) { announce('Right. Now its meaning.'); meanBox.focus(); return; }
      }
      const ma = meanBox.value;
      if (!ma.trim()) { meanBox.focus(); return; }
      if (Learn.checkMeaning(ma, it, isWord)) {
        Sound.ding();
        // the quiz is the item's first rating for FSRS: right first time is good, one
        // miss hard, more again
        // (the lesson only ends with the quiz after the batch: lessonQuiz)
        s.grade[k] = !s.missed ? 3 : s.missed === 1 ? 2 : 1;
        s.missed = 0;
        s.done.push(k);
        s.passed = k;
        s.meanAnswer = ma;
        // (it stays: the answer, right, and Next to go on)
        meanBox.readOnly = true;
        meanBox.classList.add('ok');
        verdict.innerHTML = rightHtml;
        const go = form.querySelector('button[type=submit]');
        go.textContent = 'Next ›';
        go.focus();
        const kb = app.querySelector('.lx-keys .kb');
        if (kb) kb.textContent = 'Enter for the next one';
        markNav(currentPath());
        return;
      }
      s.missed = (s.missed || 0) + 1;
      verdict.innerHTML = `<p class="lx-wrong">It means <b>${esc(primary(it))}</b>. Try again.</p>`;
    });
  }
  paintRail();
}

/* The next batch of lessons, leaving out those done in this session: the day's lessons,
   as many characters and words as new items a day (with no limit, twenty at a time), each
   with the components and sounds that come just before it (they don't count). The quiz
   comes once none are left today (lessonQuiz). */
function nextBatch(done) {
  const d = Store.load(), out = [], limit = Store.cfg().lessonLimit, size = limit > 0 ? limit : 20;
  let n = 0;
  for (const k of Store.plan().lessons) {
    if (done.includes(k) || !d.items[k]) continue;
    if (n >= size) break;                             // (the next character's parts start a new batch)
    out.push(k);
    if (d.items[k].kind !== 'comp' && d.items[k].kind !== 'sound') n++;
  }
  return out;
}

/* the batch and the way out to its quiz, at the top of a lesson: where you are in it, seen
   first, without scrolling past the lesson to find it */
const lxTop = (s, goal) => `<div class="lx-batchbar">${batchStrip(s, goal)}${quizNow(s)}</div>`;

/* stop early: the quiz over the lessons done so far (the rest wait for another time) */
const quizNow = s => s.done.length ? `<button type="button" class="rv-link lx-quiznow" id="lx-quiznow"
  title="Wrap up: stop here and take the quiz on the ${s.done.length} done. The lessons not done yet stay in the queue."
  >Wrap up</button>` : '';
function wireQuizNow(s) {
  const b = document.getElementById('lx-quiznow');
  if (b) b.addEventListener('click', () => lessonQuiz(s));
}

/* the batch, under the lesson: its characters and words, the one open, the ones done. The
   components and sounds that come before each are shown only for the one being learned
   now: they are its prerequisites, there while you work through them and it. */
function batchStrip(s, goal) {
  const whole = b => { const it = Store.item(b); return !!it && (it.kind === 'char' || it.kind === 'word'); };
  // the group the open item is in: from after the character before it, to its character
  let from = s.i, to = s.i;
  while (from > 0 && !whole(s.batch[from - 1])) from--;
  while (to < s.batch.length - 1 && !whole(s.batch[to])) to++;
  // its parts open out to the right of its character, once you've chosen to learn it
  const owner = whole(s.batch[to]) ? to : -1;
  const open = owner >= 0 && s.intro.includes(s.batch[owner]) && !s.done.includes(s.batch[owner]);
  const opening = open && s.justOpened === s.batch[owner];
  if (opening) s.justOpened = null;
  // what changed since the strip was last drawn, to animate: the item you've moved on to,
  // what you've just finished, and the parts of a character just finished, folding away
  const last = s.strip && s.strip.batch === s.batch ? s.strip : null;
  const moved = last && last.i !== s.i;
  const justDone = new Set(last ? s.done.filter(b => !last.done.includes(b)) : []);
  const folding = last && last.open && last.open.owner !== (open ? owner : -1) && s.done.includes(s.batch[last.open.owner])
    ? last.open : null;
  s.strip = { batch: s.batch, i: s.i, done: [...s.done], open: open && from < owner ? { owner, from } : null };
  const tile = i => {
    const b = s.batch[i];
    return `<span role="listitem" class="${Store.item(b) ? Store.item(b).kind : ''}
    ${i === s.i ? 'on' : ''} ${b === goal ? 'goal' : ''} ${s.done.includes(b) ? 'done' : ''} ${whole(b) ? '' : 'pre'}${
      moved && (i === s.i || b === goal) ? ' arrive' : ''}${justDone.has(b) ? ' just-done' : ''}"${i === s.i ? ' aria-current="step"' : ''}>${esc(itemText(b))}</span>`;
  };
  const range = (a, z) => Array.from({ length: z - a }, (_, n) => a + n);
  let html = '';
  s.batch.forEach((b, i) => {
    if (whole(b)) {
      if (i === owner && open && from < owner) {
        html += `<div class="lx-grp${opening ? ' opening' : ''}">${tile(i)}<div class="lx-subs" role="list" aria-label="Its parts">${
          range(from, owner).map(tile).join('')}</div></div>`;
      } else if (folding && i === folding.owner) {
        html += `<div class="lx-grp folding">${tile(i)}<div class="lx-subs" aria-hidden="true">${
          range(folding.from, folding.owner).map(tile).join('')}</div></div>`;
      } else html += tile(i);
    } else if (!s.batch.slice(i + 1).some(whole)) html += tile(i);   // (parts with no character after them: always)
  });
  const chars = s.batch.filter(whole);
  return `<div class="lx-batch" role="list" aria-label="This batch: ${chars.filter(b => s.done.includes(b)).length} of ${chars.length} done">${html}</div>`;
}

/* the lesson tabs' names on the narrowest phones, where four long ones don't fit */
const SHORT_TAB = { Composition: 'Parts', Characters: 'Parts', Confirmation: 'Check' };

/* back up to the lesson's band, if the page is scrolled past it */
function toLessonTop() {
  const band = app.querySelector('.lx-batchbar') || app.querySelector('.lx-band');
  if (band && band.getBoundingClientRect().top < 0) window.scrollTo(0, Math.max(0, window.scrollY + band.getBoundingClientRect().top - 70));
}

/* A sideways swipe on el: fn(+1) for right-to-left (next), fn(-1) for back. Not from a
   box being typed in, nor a mostly-vertical scroll, nor a text selection. */
function onSwipe(el, fn) {
  if (!el) return;
  let x0 = null, y0 = 0, t0 = 0;
  el.addEventListener('touchstart', e => {
    const t = e.target;
    if (e.touches.length !== 1 || (t.closest && t.closest('input, textarea, select, [contenteditable], .lx-chips'))) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Date.now() - t0 > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    const sel = window.getSelection && String(window.getSelection());
    if (sel) return;
    fn(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/* The Prerequisites page to show before lesson k, if any: for a character or word,
   before the lessons of its parts (outermost first: before 亻, 你好's and then 你's),
   or before its own lesson when every part is known. */
function introFor(k, s) {
  const d = Store.load(), chain = [];
  let cur = k;
  for (let n = 0; n < 4; n++) {
    const later = s.batch.slice(s.batch.indexOf(cur) + 1).find(x => d.items[x] && Learn.partsOf(x, d.items[x]).includes(cur));
    if (!later) break;
    chain.push(later);
    cur = later;
  }
  chain.reverse();
  const it = d.items[k];
  if (it && (it.kind === 'char' || it.kind === 'word')) chain.push(k);
  return chain.find(g => !s.intro.includes(g)) || null;
}

/* Prerequisites: the character (or word) coming up, its components and sounds (its
   characters, for a word), which you know and which you learn first. Learn goes on;
   Skip leaves it, and the parts only it needed, for another day. */
async function lessonIntro(goal, k, s) {
  const d = Store.load(), g = d.items[goal];
  await Promise.all([optional(need.cnames()), optional(need.sounds()), optional(need.cmnem())]);
  if (g.kind === 'char' && !g.parts) await rememberParts(goal);
  const parts = [...new Set(Learn.partsOf(goal, g))];
  const name = p => g.kind === 'word' ? partGloss(p) : partName(p);
  const state = p => partKnown(p) ? 'known' : s.batch.includes(p) || d.items[p] ? 'new' : 'other';
  const fresh = parts.filter(p => state(p) === 'new');
  const label = { known: '✓ known', new: 'new', other: 'no lesson' };
  const chip = p => `<span class="lx-chip intro-part ${state(p)} ${partKind(p) || ''}">
    ${partKind(p) === 'sound' ? `<span class="snd-key">${esc(itemText(p))}</span>` : `<span class="han">${zh(glyphOf(p))}</span>`}
    <span>${esc(name(p))}</span><small>${label[state(p)]}</small></span>`;
  const comps = parts.filter(p => partKind(p) !== 'sound'), sounds = parts.filter(p => partKind(p) === 'sound');
  const behind = comps.concat(sounds).map(p => [partKind(p) === 'sound' ? itemText(p) : glyphOf(p), name(p),
    g.kind === 'word' ? 'char' : partKind(p) || 'comp', p]);
  app.innerHTML = lxTop(s, goal) + deck(band(goal, g, true), deckParts(behind),
    `<span>Learn this <b>${g.kind === 'word' ? 'word' : 'character'}</b>?</span>`, `<span class="dk-stage">New · ${esc(kindName(g))}</span>`) + `
    <div class="lx-body"><div class="lx-main lx-intro lt-tiles">
      ${lxTile(fresh.length ? `First, its ${fresh.length} new part${fresh.length === 1 ? '' : 's'}` : 'Its parts', `
      ${parts.length ? `<div class="lx-chips intro-parts">${comps.concat(sounds).map(chip).join('')}</div>` : ''}
      <p class="muted small">${g.kind === 'word' ? 'These are the characters this word is made of.'
        : 'These are the components and sounds this character is made of.'}
        ${fresh.length ? `The ones you haven't learned yet come first, each with a short lesson, then ${zh(goal)} itself.`
          : `You know them all: straight on to ${zh(goal)}.`}</p>`, 'wide')}
      <p class="row intro-go"><button class="btn quiet" id="lx-intro-skip">⏭ Skip</button>
        <button class="btn" id="lx-intro-go">Learn</button></p>
    </div></div>`;
  wireQuizNow(s);
  // the character comes in, once: Learn going straight on to its own lesson doesn't bring it in again
  if (!s.drawn || s.drawn.k !== goal) { dealCard(); Motion.play(app.querySelector('.dk-parts'), 'm-parts-in'); }
  s.drawn = { k: goal, tab: s.tab };
  toLessonTop();
  const go = document.getElementById('lx-intro-go');
  go.focus({ preventScroll: true });
  go.addEventListener('click', () => {
    s.fly = { parts: {}, card: pageRect(app.querySelector('.dk-front')) };
    app.querySelectorAll('.dk-p[data-k]').forEach(p => { s.fly.parts[p.dataset.k] = { rect: pageRect(p), html: p.outerHTML }; });
    s.intro.push(goal); s.justOpened = goal; pageLessons();
  });
  document.getElementById('lx-intro-skip').addEventListener('click', () => {
    // to the back of the queue, with the parts nothing else waiting needs
    const now = Date.now(), others = Object.keys(d.items).filter(x => x !== goal && d.items[x].stage === 0);
    const needed = new Set(others.flatMap(x => Learn.partsOf(x, d.items[x])));
    for (const x of [goal, ...fresh]) {
      if (x !== goal && needed.has(x)) continue;
      if (!d.items[x] || d.items[x].stage) continue;
      delete d.items[x].prio;
      d.items[x].added = now;
    }
    Store.save();
    lessonState = null;
    pageLessons();
  });
  paintRail();
}

/* After the lessons, a quiz over all of them, mixed, in the reviews' page:
   recall a few minutes on, not with the lesson still on screen. Its first answers,
   with the lesson's own check, rate each item's first review (Learn.finishLesson).
   Leaving it half-way leaves the rest waiting for their lessons. */
function lessonQuiz(ls) {
  reviewState = newSession(shuffle(ls.done.slice()), 'lessonquiz');
  reviewState.lessonGrade = ls.grade;
  lessonState = null;
  go('/reviews');
}

function lessonsDone() {
  const s = lessonState, more = Store.plan().lessons.length;
  lessonState = null;
  app.innerHTML = '<h1 class="page-title">Lessons</h1>' + withRail(`<div class="card">
    <h2>${s.done.length} lesson${s.done.length === 1 ? '' : 's'} done</h2>
    <p class="muted">They come back for their first review when FSRS expects you to start forgetting them: in a few days for those you got right first time.</p>
    <p class="row">${more ? `<a class="btn" href="#/lessons" id="lx-more">More lessons (${more})</a>` : ''}
      <a class="btn quiet" href="#/study">Back to Today</a></p></div>
    ${more ? '' : storyNextCard()}`, true);
  if (!more) fillStoryNext();
  const m = document.getElementById('lx-more');
  if (m) m.addEventListener('click', e => { e.preventDefault(); pageLessons(); });
  if (s.done.length) Motion.confetti();
  Motion.play(app.querySelector('.card'), 'm-rise');
  paintRail();
}

// ------------------------------------------------------------------ reviews

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* the review toolbar, as HanziHero has it: item info, play the pronunciation, quiz
   settings, reveal the answer, open the item in a new tab, wrap up, undo */
const TOOL_ICONS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>',
  sound: '<path d="M4 9.5h3.5L12 6v12L7.5 14.5H4zM16.5 9.5a4 4 0 0 1 0 5M19 7a7.5 7.5 0 0 1 0 10"/>',
  settings: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  reveal: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  wrap: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
};
const TOOLS = ['info', 'sound', 'settings', 'reveal', 'open', 'wrap', 'undo'];
const toolIcon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TOOL_ICONS[name]}</svg>`;

/* a session over these items: 'review'; 'practice', which leaves the schedule alone;
   or 'calibrate' (the calibration test) */
/* the questions an item is asked: its meaning from its sound alone (Listening, when
   this device can speak Chinese), its pronunciation and meaning, and writing it (for
   a character, with Writing on) */
function questionsFor(it, cfg) {
  if (it && (it.kind === 'comp' || it.kind === 'sound')) return ['meaning'];   // a part is asked its name
  const qs = ['pinyin', 'meaning'];
  if (cfg.listen && Sound.canSay()) qs.unshift('listen');
  if (cfg.write && it && it.kind !== 'word') qs.push('write');
  return qs;
}

function newSession(keys, mode = 'review') {
  wordSet = null;                                  // (isWord: your items as they are now)
  // Item question order: pronunciation then meaning, in pairs or shuffled (a meaning
  // still waits for its pronunciation, listening comes first and writing last: see
  // deferQuestion)
  const cfg = Store.cfg(), d = Store.load();
  const need = Object.fromEntries(keys.map(k => [k, questionsFor(d.items[k], cfg)]));
  let queue = [];
  keys.forEach(k => need[k].forEach(q => queue.push({ k, q })));
  if (cfg.questionOrder === 'random') queue = shuffle(queue);
  return {
    queue, need, i: 0, answered: {}, misses: {}, right: [], wrong: [], shown: null, sent: {}, facts: {},
    panel: null,        // 'info' | 'settings'
    secs: {},           // info sections opened or closed by hand, for this question
    edit: null,         // 'mnemonic' | 'note', being edited in the info panel
    wrap: false, parked: [],
    mode, practice: mode === 'practice', calibrating: mode === 'calibrate', start: Date.now(),
    before: Object.fromEntries(keys.map(k => [k, d.items[k] ? d.items[k].stage : 0])),   // for the summary
    order: [],          // the items, in the order finished
    typed: {},          // the misses: {key: [{q, answer}]}
    first: {},          // each question's first answer: {key: {pinyin: {ok, near, ms}, meaning: …}}
    grades: {},         // the rating each item earned (1 again … 4 easy)
    asked: -1, askedAt: 0, keyAt: 0,   // the question on screen, since when, its first key
  };
}

async function pageReviews() {
  if (!reviewState) {
    const cfg = Store.cfg(), p = Store.plan();
    // the daily limit is soft: once today's are done, another session of the same size
    const keys = cfg.reviewLimit ? p.reviews.slice(0, p.reviewsLeft || cfg.reviewLimit) : p.reviews;
    if (!keys.length) {
      const next = Object.values(Store.load().items).filter(it => it.stage >= 1 && it.stage < Learn.MASTER)
        .map(it => it.due).sort((a, b) => a - b)[0];
      app.innerHTML = '<h1 class="page-title">Reviews</h1>' + withRail(`<div class="card">
        ${p.vacation ? '<p class="empty">Reviews are paused while you’re on vacation.</p>' : `<p class="empty">No reviews due.</p>
        ${next ? `<p class="small muted">The next one is due ${esc(new Date(next).toLocaleString())}.</p>` : ''}`}
        <p><a class="btn" href="#/study">Back to Today</a></p></div>`, true);
      paintRail();
      return;
    }
    reviewState = newSession(keys, 'review');
  }
  const s = reviewState;
  if (s.i >= s.queue.length) return reviewsDone();
  for (let n = 0; n < s.queue.length && deferQuestion(s); n++);
  const { k, q } = s.queue[s.i], it = Store.item(k);
  if (!it) { s.i++; return pageReviews(); }
  if (!it.alts.length || !it.pin) await itemFacts(k, it);
  const cfg = Store.cfg();
  // targeted sentences: a word is shown in a sentence
  if (cfg.sentences && it.kind === 'word' && !(k in s.sent)) s.sent[k] = await sentenceFor(k, it);
  if (s.panel === 'info' && !s.facts[k]) s.facts[k] = await itemFacts(k, it);
  const total = new Set(s.queue.map(x => x.k)).size, finished = s.right.length + s.wrong.length;
  const shown = s.shown;
  const can = { info: !!shown, sound: (!!shown || q === 'listen') && Sound.canSay(), settings: true, reveal: !shown,
    open: !!shown, wrap: true, undo: !!shown };
  const labels = { info: 'Item info (I)', sound: 'Play the pronunciation (P)', settings: 'Quiz settings (Q)',
    reveal: 'Reveal the answer (Ctrl+Enter)', open: 'Open in a new tab (O)',
    wrap: s.wrap ? 'Stop wrapping up (W)' : 'Wrap up: finish the items started, then stop (W)', undo: 'Undo this answer (Ctrl+Z)' };

  // how far through, and (with the percentage on) how the first answers are going, by skill
  const live = { pron: [0, 0], mean: [0, 0] };
  for (const f of Object.values(s.first)) for (const [qq, a] of Object.entries(f)) {
    if (qq === 'write' || !a) continue;
    const b = live[qq === 'pinyin' ? 'pron' : 'mean'];
    b[1]++;
    if (a.ok && !a.near) b[0]++;
  }
  const bars = { prog: total ? 100 * finished / total : 0 };
  for (const b of ['pron', 'mean']) bars[b] = live[b][1] ? 100 * live[b][0] / live[b][1] : 0;
  const was = s.bars || bars;
  s.bars = bars;
  const mini = (b, name) => `<span class="rv-mini ${b}" title="${name}: right first time">
    <span class="rv-mini-bar"><i data-w="${bars[b]}" style="width:${was[b]}%"></i></span>${name}
    <b>${live[b][1] ? `${Math.round(bars[b])}%` : '–'}</b></span>`;

  // the session: each item a segment (a long one, a single bar), done right, missed, now, to come
  const order = [...new Set(s.queue.map(x => x.k))];
  const segs = order.length <= 60 ? `<div class="rv-segs" role="progressbar" aria-label="Items finished" aria-valuemin="0"
      aria-valuemax="${total}" aria-valuenow="${finished}" style="--n:${order.length}">${order.map(x =>
      `<i class="${s.right.includes(x) ? 'ok' : s.wrong.includes(x) ? 'bad' : x === k ? 'now' : s.misses[x] ? 'miss' : ''}"></i>`).join('')}</div>`
    : `<div class="rv-bars"><div class="rv-prog" role="progressbar" aria-label="Items finished" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${finished}">
        <i data-w="${bars.prog}" style="width:${was.prog}%"></i></div></div>`;
  const modeName = s.practice ? 'Practice' : s.calibrating ? 'Calibration test' : s.mode === 'lessonquiz' ? 'Lesson quiz' : 'Reviews';
  const ask = q === 'pinyin' ? 'What\'s the <b>pronunciation</b>?' : q === 'write' ? '<b>Write</b> it'
    : it.kind === 'comp' ? 'What\'s its <b>name</b>?' : q === 'listen' ? 'What does it <b>mean</b>? <span class="dk-sub">from its sound</span>'
    : 'What does it <b>mean</b>?';
  const stage = it.stage >= 1 && !s.calibrating ? `<span class="dk-stage">${esc(Learn.stageName(it.stage))}</span>` : '';

  // a miss: the answer, to show in the box (the pinyin with its tone marks, or the meaning)
  const fix = shown && !shown.ok && q !== 'write' ? (q === 'pinyin' ? it.pin : primary(it)) : '';
  const wasDeck = s.asked !== s.i && s.asked != null ? deckState() : null;
  app.innerHTML = `
    <div class="rv-head">
      <span class="rv-title">${modeName}</span>
      <span class="rv-of"><b>${Math.min(finished + 1, total)}</b> of ${total}</span>
      ${cfg.showPct ? `<span class="rv-live rv-bars">${mini('pron', 'Pronunciation')}${mini('mean', 'Meaning')}</span>` : ''}
      <span class="rv-flex"></span>
      ${cfg.showCount ? `<span class="rv-dot ok" title="Right first time">${s.right.length} right</span>
        <span class="rv-dot bad">${s.wrong.length + order.filter(x => s.misses[x] && !s.wrong.includes(x)).length} missed</span>` : ''}
      <span class="rv-end"><button type="button" class="rv-link${s.wrap ? ' on' : ''}" data-tool="wrap" title="${esc(labels.wrap)}">${s.wrap ? 'Wrapping up' : 'Wrap up'}</button>
      <button type="button" class="rv-icon${s.panel === 'settings' ? ' on' : ''}" data-tool="settings" title="${esc(labels.settings)}"
        aria-label="${esc(labels.settings)}">${toolIcon('settings')}</button></span>
    </div>
    ${s.panel === 'settings' ? `<div class="rv-panel rv-panel2">${quizSettings(cfg)}</div>` : ''}
    ${segs}
    ${s.practice ? '<p class="rv-note">Practice: the schedule stays as it is</p>' : ''}
    ${deck(q === 'listen' && !shown ? listenBand(it) : q === 'write' ? writeBand(it, shown)
      : cfg.sentences && s.sent[k] ? sentenceBand(it, s.sent[k]) : band(k, it, false), deckNext(s), `<span>${ask}</span>`, stage)}
    <form id="rv-form" autocomplete="off"${q === 'write' ? ' class="rv-writing"' : ''}>
      ${q === 'write' ? `<p class="rv-write-msg" id="rv-write-msg">${shown ? '' : 'Draw each stroke in order. After three misses on a stroke, its outline shows.'}</p>
        <button class="rv-enter" ${shown ? '' : 'hidden'}>Next</button>` : `
      <input id="rv-in" class="rv-input ${shown ? (shown.ok ? 'ok' : 'bad') : ''}" enterkeyhint="go"
        aria-label="${q === 'pinyin' ? 'Pronunciation, with tone numbers' : it.kind === 'comp' ? 'Name' : 'Meaning'}${shown ? (shown.ok ? ': right' : `: wrong, it is ${fix}`) : ''}"
        placeholder="${q === 'pinyin' ? 'pin1yin1' : it.kind === 'comp' ? 'Name…' : 'Meaning…'}" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off" lang="en"
        ${shown ? 'readonly' : ''} value="${shown ? esc(shown.answer) : ''}"${fix ? ' data-fix' : ''}>
      ${fix ? `<p class="rv-fix" aria-hidden="true">${shown.answer.trim() ? `<s>${esc(shown.answer)}</s><span class="rv-fix-to">→</span>` : ''}<b>${esc(fix)}</b></p>` : ''}
      <p class="rv-hint" id="rv-hint" hidden>That isn't pinyin. Check it and try again.</p>`}
    </form>
    ${shown && (q === 'write' || shown.mixed) ? `<div class="rv-after">
      ${q === 'write' ? `<p class="${shown.ok ? 'lx-right' : 'lx-wrong'}">${shown.revealed ? 'Here is how it is written: it comes again later.'
        : shown.ok ? (shown.slips ? `Written, with ${shown.slips} ${shown.slips === 1 ? 'slip' : 'slips'}.` : 'Written without a slip.')
        : `${shown.hinted} ${shown.hinted === 1 ? 'stroke' : 'strokes'} needed the outline: it comes again later.`}</p>`
      : `<p class="small">${shown.mixed ? `<span class="rv-mixed">“${esc(shown.answer)}” is <a href="${itemHref(shown.mixed)}" target="_blank" class="han">${itemHtml(shown.mixed)}</a>
          ${esc((Store.item(shown.mixed) || {}).pin || '')}: compare them on the Today page.</span>` : ''}</p>`}
    </div>` : ''}
    <div class="rv-tools">${['info', 'sound', 'reveal', 'open', 'undo'].map(t => `<button type="button" class="rv-tool${s.panel === t ? ' on' : ''}"
      data-tool="${t}" title="${esc(labels[t])}" aria-label="${esc(labels[t])}"${can[t] ? '' : ' disabled'}>${toolIcon(t)}<span>${
      { info: 'Info', sound: 'Hear it', reveal: 'I don\'t know', open: 'Open', undo: 'Undo' }[t]}</span></button>`).join('')}${fix && shown.answer.trim() ? `<button type="button" class="rv-tool rv-typo" id="rv-typo" title="It was a typo: count it as right">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg><span>It was a typo</span></button>` : ''}${shown && q !== 'write' ? '<button type="button" class="btn rv-next" id="rv-next">Next ›</button>' : ''}</div>
    ${s.panel === 'info' && shown ? `<div class="rv-panel rv-panel2 rv-tiles">${infoPanel(k, Store.item(k), q)}</div>` : ''}`;

  // the bars ease from where they were to where they are now
  requestAnimationFrame(() => app.querySelectorAll('.rv-bars i[data-w]').forEach(i => { i.style.width = `${i.dataset.w}%`; }));
  const input = document.getElementById('rv-in') || document.querySelector('#rv-form .rv-enter');
  const fresh = s.asked !== s.i;
  // a new question is dealt in; an answer just given pops (right) or shakes (wrong)
  if (fresh) stackForward(wasDeck);
  const nextBtn = document.getElementById('rv-next');
  if (nextBtn) nextBtn.addEventListener('click', () => nextQuestion());
  if (s.judged) {
    announce(s.shown && s.shown.ok ? 'Right.' : fix ? `Not quite. ${q === 'pinyin' ? 'It is' : 'It means'} ${fix}.` : 'Not quite.');
    Motion.play(document.getElementById('rv-in'), s.shown && s.shown.ok ? 'm-pop' : 'm-shake');
    Motion.play(app.querySelector('.rv-after'), 'm-rise');
    s.judged = false;
  }
  if (fresh) { s.asked = s.i; s.askedAt = Date.now(); s.keyAt = 0; }
  if (fresh && q === 'listen') Sound.say(k, true);
  if (q !== 'write') input.addEventListener('input', () => { if (!s.keyAt) s.keyAt = Date.now(); });
  const edit = document.getElementById('rv-edit');
  if (edit) edit.focus();
  else if (s.focus === 'syn' && document.getElementById('rv-synin')) document.getElementById('rv-synin').focus();
  else if (q !== 'write' || shown) input.focus();
  s.focus = null;
  if (q === 'write') reviewWriting(k, shown);

  document.getElementById('rv-form').addEventListener('submit', e => {
    e.preventDefault();
    if (s.shown) return nextQuestion();
    if (q === 'write') return;                     // answered by writing
    const answer = input.value;
    if (!answer.trim()) return;
    // pinyin answer validation: not pinyin at all is a typo to fix, not a wrong answer
    if (q === 'pinyin' && cfg.validate && !Learn.validPinyin(answer)) {
      input.classList.remove('shake');
      void input.offsetWidth;
      input.classList.add('shake');
      document.getElementById('rv-hint').hidden = false;
      return;
    }
    const ok = q === 'pinyin' ? Learn.checkPinyin(answer, it.pin) : Learn.checkMeaning(answer, it, isWord);   // (listen: the meaning)
    if (ok) {
      Sound.ding();
      if (q === 'pinyin') Sound.say(k);
    }
    // the first answer to each question is what the rating goes by: right or wrong,
    // a slip (the right syllables with a wrong tone), and how soon typing began
    const f = s.first[k] = s.first[k] || {};
    const fresh = !f[q];                           // (this answer is the first: undo and typo may change it)
    if (fresh) {
      const nearly = !ok && q === 'pinyin' && Learn.parsePinyin(answer).letters === Learn.parsePinyin(it.pin).letters;
      f[q] = { ok, near: nearly, ms: (s.keyAt || Date.now()) - s.askedAt };
    }
    s.shown = { ok, answer, fresh };
    s.judged = true;
    if (!ok) {
      s.misses[k] = (s.misses[k] || 0) + 1;
      (s.typed[k] = s.typed[k] || []).push({ q, answer });
      // what the answer belongs to, if it is another item's: a confusion to remember
      if (q === 'meaning' || q === 'listen') {
        const d = Store.load(), other = Object.keys(d.items).find(x => x !== k && d.items[x].stage >= 1
          && d.items[x].kind === it.kind && Learn.checkMeaning(answer, d.items[x]));
        if (other) { s.shown.mixed = other; noteConfusion(k, other); }
      }
      // the mnemonic, straight away, unless it would give away a question still to come
      const pending = s.queue.slice(s.i + 1).some(x => x.k === k && x.q !== q);
      if (!pending) { s.panel = 'info'; s.secs = { Mnemonic: true }; s.toMnemonic = true; }
      s.queue.push({ k, q });                      // asked again before the session ends
    }
    pageReviews();
  });
  const typo = document.getElementById('rv-typo');
  if (typo) typo.addEventListener('click', () => {
    // a slip of the keys: take back the miss and the repeat, and count it as right
    Sound.rip();
    takeBack(k, q);
    // (only a first answer: a slip on the repeat doesn't undo the miss before it)
    const f = (s.first[k] || {})[q];
    if (f && shown.fresh) { f.ok = true; f.near = false; }
    s.shown = { ok: true, answer: shown.answer, fresh: shown.fresh };
    pageReviews();
  });
  app.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => reviewTool(b.dataset.tool)));
  wireReviewPanel(k);
  if (s.toMnemonic) {                              // (after a miss: the mnemonic, in view)
    s.toMnemonic = false;
    const mn = app.querySelector('[data-sec="Mnemonic"]');
    if (mn) mn.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  paintRail();
}

/* What a question waits for. An item's meaning is only asked once its pronunciation
   is right; listening comes before anything shows the item (it would give the sound
   away), and writing after its pronunciation and meaning have been asked (its cue
   shows them). A question whose turn hasn't come (missed, undone, or shuffled ahead)
   moves to just after the last question it waits for. True when it moved one. */
const WAITS = { meaning: [['pinyin', 'right'], ['listen', 'asked']], pinyin: [['listen', 'asked']],
  write: [['pinyin', 'asked'], ['meaning', 'asked'], ['listen', 'asked']] };
function deferQuestion(s) {
  const { k, q } = s.queue[s.i];
  let last = -1;
  for (const [p, how] of WAITS[q] || []) {
    if (how === 'right' ? (s.answered[k] || {})[p] : (s.first[k] || {})[p]) continue;
    for (let j = s.queue.length - 1; j > s.i; j--) {
      if (s.queue[j].k === k && s.queue[j].q === p) { last = Math.max(last, j); break; }
    }
  }
  if (last < 0) return false;
  const [m] = s.queue.splice(s.i, 1);              // what it waits for is now at last - 1
  s.queue.splice(last, 0, m);
  return true;
}

/* Leeches on Today: the items that keep slipping, what you mix them up
   with (side by side, with both mnemonics), and three ways out: learn it again from
   a lesson, write a mnemonic of your own, or rest it for two weeks. */
function leechCard(d, now) {
  const leeches = Object.keys(d.items).filter(k => Learn.isLeech(d.items[k]))
    .sort((a, b) => (d.items[b].lapses || 0) - (d.items[a].lapses || 0)).slice(0, 12);
  if (!leeches.length) return '';
  const row = k => {
    const it = d.items[k], conf = (it.confused || []).filter(x => d.items[x]);
    const resting = it.rest > now;
    const side = x => `<div class="lc-side"><a class="han" href="${itemHref(x)}">${itemHtml(x)}</a>
      <b>${esc(d.items[x].pin)}</b> ${esc(primary(d.items[x]))}
      ${d.items[x].mnemonic || builtinMnemonic(glyphOf(x)) ? `<p class="small mn">${d.items[x].mnemonic ? esc(d.items[x].mnemonic) : mnHtml(builtinMnemonic(glyphOf(x)), { self: glyphOf(x) })}</p>` : ''}</div>`;
    return `<div class="lc-row" data-k="${esc(k)}">
      <div class="lc-head"><a class="han lc-glyph" href="${itemHref(k)}">${itemHtml(k)}</a>
        <span><b>${esc(it.pin)}</b> ${esc(primary(it))}<br><span class="small muted">${it.lapses || 0} lapses
          ${conf.length ? ` · mixed up with ${conf.map(x => `<span class="han">${itemHtml(x)}</span>`).join(' ')}` : ''}
          ${resting ? ` · resting until ${esc(new Date(it.rest).toLocaleDateString())}` : ''}</span></span>
        <span class="lc-acts">
          ${conf.length ? '<button class="btn quiet small" data-lc="compare">Compare</button>' : ''}
          <button class="btn quiet small" data-lc="mn">My mnemonic</button>
          <button class="btn quiet small" data-lc="relearn" title="Back to the lesson queue, at the front: its lesson again, then reviews from the start">Learn again</button>
          <button class="btn quiet small" data-lc="${resting ? 'wake' : 'rest'}">${resting ? 'Bring back' : 'Rest 2 weeks'}</button></span></div>
      <div class="lc-compare" hidden>${side(k)}${conf.map(side).join('')}</div>
      <div class="lc-mn" hidden><textarea rows="2" placeholder="A new story for ${esc(itemText(k))}…">${esc(it.mnemonic || '')}</textarea>
        <button class="btn small" data-lc="save">Save</button></div>
    </div>`;
  };
  return `<section class="card lc">
    <h2 class="caps">Leeches (${leeches.length})</h2>
    <p class="small muted">Items that keep slipping: forgotten four times, or missed four times in their last eight
      reviews. A new mnemonic usually fixes one; so does seeing it next to what you mix it up with.</p>
    ${leeches.map(row).join('')}</section>`;
}

function wireLeeches(redraw) {
  app.querySelectorAll('.lc-row').forEach(r => r.addEventListener('click', e => {
    const b = e.target.closest('button[data-lc]');
    if (!b) return;
    const k = r.dataset.k, it = Store.item(k), what = b.dataset.lc;
    if (!it) return;
    if (what === 'compare') r.querySelector('.lc-compare').hidden = !r.querySelector('.lc-compare').hidden;
    else if (what === 'mn') r.querySelector('.lc-mn').hidden = !r.querySelector('.lc-mn').hidden;
    else if (what === 'save') { it.mnemonic = r.querySelector('.lc-mn textarea').value.trim(); Store.save(); redraw(); }
    else if (what === 'rest') { it.rest = Date.now() + 14 * Learn.DAY; Store.save(); redraw(); }
    else if (what === 'wake') { delete it.rest; Store.save(); redraw(); }
    else if (what === 'relearn') {
      // a fresh start: its lesson again, at the front of the queue (which clears its misses,
      // so it is no longer a leech unless it starts slipping again; relearn counts the times)
      Object.assign(it, { stage: 0, due: 0, prio: true, relearn: (it.relearn || 0) + 1 });
      delete it.rest; delete it.learnt;
      Store.save();
      redraw();
    }
  }));
}

/* remember that k was answered as other (both ways round), the latest first, a few each */
function noteConfusion(k, other) {
  const d = Store.load();
  for (const [a, b] of [[k, other], [other, k]]) {
    const it = d.items[a];
    if (!it) continue;
    it.confused = [b, ...(it.confused || []).filter(x => x !== b)].slice(0, 4);
  }
  Store.save();
}

/* a missed question taken back: the miss, and its repeat at the end of the queue */
function takeBack(k, q) {
  const s = reviewState;
  s.misses[k] = Math.max(0, (s.misses[k] || 0) - 1);
  const t = s.typed[k] || [];
  for (let j = t.length - 1; j >= 0; j--) if (t[j].q === q) { t.splice(j, 1); break; }
  for (let j = s.queue.length - 1; j > s.i; j--) {
    if (s.queue[j].k === k && s.queue[j].q === q) { s.queue.splice(j, 1); break; }
  }
}

function addSynonym(k, text) {
  const it = Store.item(k), t = String(text || '').trim();
  if (!it || !t || (it.syn || []).includes(t)) return;
  it.syn = (it.syn || []).concat(t);
  Store.save();
}

function reviewTool(name) {
  const s = reviewState;
  if (!s || s.i >= s.queue.length) return;
  const { k, q } = s.queue[s.i], it = Store.item(k);
  if (name === 'settings') { s.panel = s.panel === 'settings' ? null : 'settings'; return pageReviews(); }
  if (name === 'wrap') return toggleWrap();
  if (name === 'sound' && (s.shown || q === 'listen')) return Sound.say(k, true);
  if (name === 'reveal') {
    // don't know it: count it as missed, show the answer and the item
    if (s.shown) return;
    const f = s.first[k] = s.first[k] || {};
    s.shown = { ok: false, answer: '', revealed: true, fresh: !f[q] };
    s.misses[k] = (s.misses[k] || 0) + 1;
    // (writing it is a skill of its own: needing it shown makes a review hard, not forgotten)
    if (!f[q]) f[q] = q === 'write' ? { ok: true, near: true, ms: 0 } : { ok: false, near: false, ms: Infinity };
    (s.typed[k] = s.typed[k] || []).push({ q, answer: '' });
    s.queue.push({ k, q });
    s.panel = 'info';
    return pageReviews();
  }
  if (!s.shown) return;                            // the rest wait for an answer
  if (name === 'info') { s.panel = s.panel === 'info' ? null : 'info'; s.edit = null; return pageReviews(); }
  if (name === 'syn') { s.panel = 'info'; s.secs.Meaning = true; s.focus = 'syn'; return pageReviews(); }
  if (name === 'open') {
    return window.open(location.href.split('#')[0] + itemHref(k), '_blank');
  }
  if (name === 'undo') {
    // don't count this answer: the question goes back into the queue, later on
    Sound.rip();
    if (!s.shown.ok) takeBack(k, q);
    if (s.shown.fresh && s.first[k]) delete s.first[k][q];   // (a repeat's undo keeps the first answer)
    s.asked = -1;
    const [cur] = s.queue.splice(s.i, 1);
    const at = s.i + 1 + Math.floor(Math.random() * Math.max(0, s.queue.length - s.i));
    s.queue.splice(Math.min(at, s.queue.length), 0, cur);
    s.shown = null; s.panel = null; s.edit = null; s.secs = {};
    return pageReviews();
  }
}

/* Wrap up: only the items already started (a question answered or missed) stay in
   the session; the rest wait for the next one. Again to carry on as before. */
function toggleWrap() {
  const s = reviewState;
  if (!s.wrap) {
    const started = new Set([s.queue[s.i].k, ...Object.keys(s.answered), ...Object.keys(s.misses)]);
    const rest = s.queue.slice(s.i + 1);
    s.queue = s.queue.slice(0, s.i + 1).concat(rest.filter(x => started.has(x.k)));
    s.parked = rest.filter(x => !started.has(x.k));
    s.wrap = true;
  } else {
    s.queue = s.queue.concat(s.parked);
    s.parked = [];
    s.wrap = false;
  }
  pageReviews();
}

/* the quiz settings panel: the progress indicators and the sounds */
function quizSettings(cfg) {
  const tog = (k, label) => `<label class="st-toggle"><input type="checkbox" data-qk="${k}"${cfg[k] ? ' checked' : ''}>
    <i></i><span>${label}</span></label>`;
  return `<div class="rv-qs">
    <div><h4>Progress indicators</h4>${tog('showPct', 'Show the percentage correct')}${tog('showCount', 'Show the number correct and left over')}</div>
    <div><h4>Audio</h4>${tog('muteSfx', 'Mute sound effects')}${tog('muteVoice', 'Mute the voiced pronunciation')}</div>
  </div>`;
}

/* the item info panel, once the question is answered. A section that would give away
   the item's other question, still to come, starts closed. */
function infoPanel(k, it, q) {
  const s = reviewState, f = s.facts[k] || { parts: [], comps: [], words: [] };
  const pending = other => s.queue.slice(s.i + 1).some(x => x.k === k && x.q === other);
  const sec = (title, body, open) => `<details class="rv-sec" data-sec="${title}"${(title in s.secs ? s.secs[title] : open) ? ' open' : ''}>
    <summary>${title}</summary><div>${body}</div></details>`;
  const parts = it.kind === 'word' ? f.parts : f.comps;
  const note = it.kind === 'word' ? it.note || '' : Store.load().notes[k] || '';
  const alts = others(Object.assign({}, it, { syn: [] }));
  const editing = (what, value, placeholder) => `<textarea id="rv-edit" rows="3" placeholder="${placeholder}">${esc(value)}</textarea>
    <p class="row"><button class="btn" data-save="${what}">Save</button><button class="btn quiet" data-cancel>Cancel</button></p>`;
  return `
    <p class="rv-stage"><b class="han">${esc(itemText(k))}</b> · ${esc(Learn.stageName(it.stage))}</p>
    ${parts.length ? sec(it.kind === 'word' ? 'Characters' : 'Composition',
      `<div class="lx-chips">${parts.map(([c, g]) => lxChip(c, g)).join('')}</div>`, true) : ''}
    ${sec('Pronunciation', `<dl class="lx-dl"><dt>Primary</dt><dd><b>${esc(numbered(it.pin))}</b> · ${esc(it.pin)}</dd></dl>`,
      !(q === 'meaning' && pending('pinyin')))}
    ${sec('Meaning', `<dl class="lx-dl"><dt>Primary</dt><dd><b>${esc(primary(it))}</b></dd>
      <dt>Alternatives</dt><dd>${alts.length ? esc(alts.join(', ')) : '<span class="muted">none</span>'}</dd>
      <dt>Your synonyms</dt><dd><span class="rv-syns">${(it.syn || []).map(x => `<span>${esc(x)}
        <button type="button" data-unsyn="${esc(x)}" aria-label="Remove ${esc(x)}">×</button></span>`).join('')}</span>
        <form id="rv-synform" class="rv-synform" autocomplete="off"><input id="rv-synin" placeholder="Add a synonym (+)"
          spellcheck="false" autocapitalize="off" lang="en"><button class="btn quiet">Add</button></form></dd></dl>`,
      !(q === 'pinyin' && pending('meaning')))}
    ${sec('Mnemonic', s.edit === 'mnemonic' ? editing('mnemonic', it.mnemonic || '', 'A little story that joins the parts, the meaning and the sound…')
      : `${it.mnemonic ? `<p class="rv-text">${esc(it.mnemonic)}</p>` : f.mn ? `<div class="rv-text mn">${mnHtml(f.mn, mnCtx(k, it, f))}</div>` : '<p class="muted">No mnemonic yet.</p>'}
        ${(it.kind === 'char' || it.kind === 'word') && (it.mnemonic || !/\{[^}]+\}/.test(f.mn || '')) ? soundStrip(it.pin) : ''}
        <p><button class="btn quiet" data-edit="mnemonic">${it.mnemonic ? 'Edit' : 'Write your own'}</button></p>`, true)}
    ${sec('Notes', s.edit === 'note' ? editing('note', note, 'Anything to remember about it…')
      : `${note ? `<p class="rv-text">${esc(note)}</p>` : ''}
        <p><button class="btn quiet" data-edit="note">${note ? 'Edit' : 'Add a note'}</button></p>`, true)}
    ${sec('Memory', memoryPanel(it), false)}
    ${sec('Usage', `${it.ex && it.ex.text ? `<p class="muted small">Where you found it:</p>${foundIn(k, it)}` : ''}
      ${(f.ex || []).map(ex => `<div class="example">${exampleHtml(ex, k)}</div>`).join('')}
      ${f.words.length ? `<p class="muted small">Words it is in:</p><div class="lx-chips">${f.words.map(([w, p]) =>
        lxChip(w, p, '#/word/' + encodeURIComponent(w))).join('')}</div>` : ''}
      ${!(it.ex && it.ex.text) && !f.words.length && !(f.ex || []).length ? '<p class="muted">No examples yet.</p>' : ''}`, false)}`;
}

function wireReviewPanel(k) {
  const s = reviewState;
  app.querySelectorAll('[data-qk]').forEach(el => el.addEventListener('change', () => {
    Store.setCfg({ [el.dataset.qk]: el.checked });
    pageReviews();
  }));
  app.querySelectorAll('details[data-sec]').forEach(d => d.addEventListener('toggle', () => { s.secs[d.dataset.sec] = d.open; }));
  app.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { s.edit = b.dataset.edit; pageReviews(); }));
  app.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => { s.edit = null; pageReviews(); }));
  app.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => {
    const it = Store.item(k), v = document.getElementById('rv-edit').value.trim();
    if (b.dataset.save === 'mnemonic') { it.mnemonic = v; Store.save(); }
    else if (it.kind === 'word') { if (v) it.note = v; else delete it.note; Store.save(); }
    else Store.note(k, v);                         // a character's note, as on its page
    s.edit = null;
    pageReviews();
  }));
  const form = document.getElementById('rv-synform');
  if (form) form.addEventListener('submit', e => {
    e.preventDefault();
    addSynonym(k, document.getElementById('rv-synin').value);
    s.focus = 'syn';
    pageReviews();
  });
  app.querySelectorAll('[data-unsyn]').forEach(b => b.addEventListener('click', () => {
    const it = Store.item(k);
    it.syn = (it.syn || []).filter(x => x !== b.dataset.unsyn);
    Store.save();
    pageReviews();
  }));
}

/* Lessons by keyboard: Enter (or →) goes to the next step, Prerequisites → Composition
   → Mnemonic → Examples → Confirmation, where Enter checks the answer and, once it's
   right, goes on to the next one; ← goes back.
   Typing in a box (your mnemonic, the answers) keeps Enter for the box. */
document.addEventListener('keydown', e => {
  const s = lessonState;
  if (!s || currentPath() !== '/lessons' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
  const intro = document.getElementById('lx-intro-go');
  if (intro) {
    if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); intro.click(); }
    return;
  }
  const next = app.querySelector('.lx-arrow.next'), prev = app.querySelector('.lx-arrow.prev');
  if ((e.key === 'Enter' || e.key === 'ArrowRight') && next && !next.disabled) { e.preventDefault(); next.click(); }
  else if ((e.key === 'Enter' || e.key === 'ArrowRight') && document.getElementById('lx-quiz') && s.passed === s.batch[s.i]) {
    e.preventDefault();                            // (answered right: on to the next one)
    document.getElementById('lx-quiz').requestSubmit();
  } else if (e.key === 'Enter' && document.getElementById('lx-quiz')) {
    e.preventDefault();
    (document.getElementById('lx-mean') || document.getElementById('lx-pin')).focus();
  } else if (e.key === 'ArrowLeft' && prev && !prev.disabled) { e.preventDefault(); prev.click(); }
});

/* HanziHero's review keys: I, P, Q, O, W and + once the question is answered;
   Ctrl+Enter reveals the answer, Ctrl+Z undoes it */
document.addEventListener('keydown', e => {
  const s = reviewState;
  if (!s || currentPath() !== '/reviews' || s.i >= s.queue.length) return;
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && t.id !== 'rv-in'))) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'Enter') { e.preventDefault(); reviewTool('reveal'); return; }
  if (ctrl && e.key.toLowerCase() === 'z') { if (s.shown) { e.preventDefault(); reviewTool('undo'); } return; }
  if (!s.shown || ctrl || e.altKey) return;
  // Enter goes on to the next question from anywhere on the page, not only the answer box
  if (e.key === 'Enter' && t.id !== 'rv-in') { e.preventDefault(); nextQuestion(); return; }
  const name = { i: 'info', p: 'sound', q: 'settings', o: 'open', w: 'wrap', '+': 'syn' }[e.key.toLowerCase()];
  if (!name) return;
  e.preventDefault();
  reviewTool(name);
});

function nextQuestion() {
  const s = reviewState, { k, q } = s.queue[s.i];
  if (s.shown.ok) {
    const a = s.answered[k] = s.answered[k] || {};
    a[q] = true;
    if ((s.need[k] || ['pinyin', 'meaning']).every(x => a[x])) {
      const it = Store.item(k), right = !s.misses[k];
      let g = s.grades[k] = Learn.gradeFrom(Object.values(s.first[k] || {}), it, s.calibrating);
      const opts = { retention: Store.cfg().retention };
      if (s.mode === 'lessonquiz') {
        // the first review: the quiz, and the lesson's check before it, the worse of the two
        g = s.grades[k] = Math.min(g, (s.lessonGrade || {})[k] || 4);
        Learn.finishLesson(it, Date.now(), g, Object.assign(opts, { rnd: Math.random }));
      } else if (s.calibrating) Learn.calibrate(it, g, Date.now(), Math.random, opts);
      else if (!s.practice) Learn.review(it, g, Date.now(), Math.random, opts);
      if (!s.practice) Store.learnSaved(k);
      if (!s.practice) Store.logDay(s.mode === 'lessonquiz' ? { l: 1 } : { r: 1, ok: right ? 1 : 0 });
      (right ? s.right : s.wrong).push(k);
      s.order.push(k);
      markNav(currentPath());
    }
  }
  s.i++;
  s.asked = -1;
  s.shown = null;
  s.panel = s.panel === 'settings' ? 'settings' : null;
  s.edit = null;
  s.secs = {};
  pageReviews();
}

/* After a session: the retention rate (all of it, then pronunciation and meaning), and
   every item as a tile, four ways: in the order finished (or by how many tries each
   took), by type, by SRS stage before and after, and by when each comes back. Hovering
   Review again lights up the ones it would go over. */
function reviewsDone() {
  const s = reviewState;
  reviewState = null;
  if (s.onDone) return s.onDone(s);        // (a part of something longer: Weak spots)
  if (!s.practice) { Store.logDay({ s: Math.round((Date.now() - s.start) / 1000) }); Store.save(); }
  const d = Store.load(), p = Store.plan(), now = Date.now();
  const title = s.practice ? 'Practice Summary' : s.calibrating ? 'Calibration Summary'
    : s.mode === 'lessonquiz' ? 'Lesson Summary' : 'Session Summary';
  const order = (s.order && s.order.length ? s.order : [...s.right, ...s.wrong]).filter(k => d.items[k]);
  const asked = [...new Set(order)];
  const done = asked.length;
  const tries = k => 1 + (s.typed[k] || []).length;
  const isNew = k => s.mode === 'lessonquiz' || s.before[k] <= 1;

  // retention: each question's first answer, all together, then pronunciation and meaning
  const tally = { pron: [0, 0], mean: [0, 0], write: [0, 0] };
  for (const k of asked) for (const [q, f] of Object.entries(s.first[k] || {})) {
    const b = q === 'pinyin' ? 'pron' : q === 'write' ? 'write' : 'mean';
    tally[b][1]++;
    if (f && f.ok && !f.near) tally[b][0]++;
  }
  const pc = ([ok, n]) => n ? Math.round(100 * ok / n) : null;
  const allQ = [tally.pron[0] + tally.mean[0] + tally.write[0], tally.pron[1] + tally.mean[1] + tally.write[1]];
  const total = pc(allQ) ?? (done ? Math.round(100 * s.right.length / done) : 100);
  const bars = [['total', 'Total', total], ['pron', 'Pronunciation', pc(tally.pron)],
    ['mean', 'Meaning', pc(tally.mean)], ['write', 'Writing', pc(tally.write)]].filter(b => b[2] != null);

  // what Review again goes over: the missed, and the ones back by tomorrow
  const tomorrow = new Date(now).setHours(0, 0, 0, 0) + 2 * 864e5;
  const pick = new Set(asked.filter(k => tries(k) > 1 || (d.items[k].stage >= 1 && d.items[k].due && d.items[k].due < tomorrow)));

  const t1 = asked.filter(k => tries(k) === 1), t2 = asked.filter(k => tries(k) === 2), t3 = asked.filter(k => tries(k) > 2);
  const items = itemsCard(asked, {
    before: s.before, pick,
    count: `<b>${done}</b> total${asked.some(isNew) ? `<b>${asked.filter(isNew).length}</b> new` : ''}`,
    views: [['order', 'Finished order', asked],
      ['tries', 'Tries', [['First try', t1, `${t1.length} / ${done}`], ['2 tries', t2, t2.length], ['3+ tries', t3, t3.length]]]],
    good: k => tries(k) === 1,           // By type: the right first time, then the missed
  });

  const more = s.practice || s.calibrating ? 0 : p.reviewsLeft;
  const unsorted = s.calibrating ? calibrationSets().unsorted : [];

  const mins = Math.max(1, Math.round((now - s.start) / 60000));
  const head = s.practice ? 'Practice done' : s.calibrating ? 'Calibration done' : s.mode === 'lessonquiz' ? 'Lesson quiz done' : 'Reviews done';
  const counts = { total: allQ, pron: tally.pron, mean: tally.mean, write: tally.write };
  app.innerHTML = `<div class="ss-top"><h1 class="page-title ss-title">${head}</h1>
      <p class="ss-meta">${done} item${done === 1 ? '' : 's'} · ${mins} min</p></div>` + withRail(`
    <section class="card ss-card ss-ret">
      <div class="ss-ring" style="--p:${total}" role="img" aria-label="${total}% right first time"><span><b>${total}</b>%</span></div>
      <div class="ss-ring-lab"><b>Right first time</b>${allQ[1] ? `<span>${allQ[0]} of ${allQ[1]} answers</span>` : ''}</div>
      <div class="ss-bars2">
        ${bars.filter(([c]) => c !== 'total').map(([c, name, v]) => `<div class="ss-bar2 ${c}"><p><span>${name}</span>
          <span><b>${v}%</b>${counts[c][1] ? ` · ${counts[c][0]} of ${counts[c][1]}` : ''}</span></p><div class="ss-bar ${c}"><i style="--w:${v}%"></i></div></div>`).join('')}
      </div>
      ${s.practice ? '<p class="small muted ss-note">Practice doesn’t change when they come back.</p>' : ''}
    </section>
    ${done ? items : '<section class="card ss-card"><p class="empty">Nothing was finished in this session.</p></section>'}
    <div class="ss-actions">
      ${pick.size ? `<button class="btn ss-btn ss-again" id="ss-again">Review again (${pick.size})</button>` : ''}
      ${more ? `<button class="btn quiet ss-btn" id="ss-more">Keep reviewing (${more})</button>` : ''}
      ${unsorted.length ? `<button class="btn quiet ss-btn" id="ss-calibrate">Carry on sorting (${unsorted.length} left)</button>` : ''}
      <a class="btn quiet ss-btn" href="#/study">Back to Today</a>
    </div>`, true);

  const card = document.getElementById('ss-items');
  wireItemsCard(card);
  const again = document.getElementById('ss-again');
  if (again) {
    again.addEventListener('click', () => startPractice([...pick]));
    const on = v => card && card.classList.toggle('preview', v);
    again.addEventListener('pointerenter', () => on(true));
    again.addEventListener('pointerleave', () => on(false));
    again.addEventListener('focus', () => on(true));
    again.addEventListener('blur', () => on(false));
  }
  const next = document.getElementById('ss-more');
  if (next) next.addEventListener('click', () => pageReviews());       // (already at #/reviews)
  const cal = document.getElementById('ss-calibrate');
  if (cal) cal.addEventListener('click', () => startCalibration(byCommon(unsorted).slice(0, 50)));
  if (done && !s.practice) Motion.confetti(app.querySelector('.ss-ring'));
}

/* The Items card: these items as coloured tiles, four ways. All (in the orders given in o.views:
   a flat list of keys, or [heading, keys, count] groups), by type, by SRS stage, and by when each
   comes back. o.before (stages before a session) adds Promoted/Demoted and Before/After to the
   stage chart; o.pick marks the ones a button will go over; o.good splits By type into two rows. */
function itemsCard(keys, o = {}) {
  const d = Store.load(), now = Date.now();
  const before = o.before || null, pick = o.pick || new Set();
  const byKind = k => (d.items[k].kind || 'char');
  const day0 = new Date(now).setHours(0, 0, 0, 0);
  const dayOf = t => Math.max(0, Math.round((new Date(t).setHours(0, 0, 0, 0) - day0) / 864e5));
  const due = k => d.items[k].due && d.items[k].stage >= 1;
  const moveOf = k => { if (!before) return ''; const b = before[k], a = d.items[k].stage; return a > b ? 'up' : a < b ? 'down' : ''; };

  const glyph = k => byKind(k) === 'sound' ? soundGlyph(k) : `<span class="han">${zh(glyphOf(k))}</span>`;
  const tile = k => {
    const it = d.items[k], len = byKind(k) === 'word' ? Math.min(4, [...glyphOf(k)].length) : 1;
    const move = before && before[k] !== it.stage ? `${Learn.stageName(before[k])} → ${Learn.stageName(it.stage)}` : '';
    return `<a class="fc-chip ss-t ${byKind(k)} l${len}${pick.has(k) ? ' pick' : ''}" href="${itemHref(k)}" data-k="${esc(k)}"
      data-move="${esc(move)}" aria-label="${esc(`${itemText(k)} ${it.pin || primary(it) || ''}`)}">${glyph(k)}</a>`;
  };
  const tiles = (ks, cls = '') => `<div class="ss-tiles ${cls}">${ks.map(tile).join('')}</div>`;
  const group = (name, n, body) => `<div class="ss-grp"><p class="ss-gh">${name}<span>${n}</span></p>${body}</div>`;
  const seg = (name, opts, on) => `<div class="ss-seg" role="group" data-seg="${name}">${opts.map(([v, label]) =>
    `<button type="button" data-v="${v}" aria-pressed="${v === on}">${label}</button>`).join('')}</div>`;

  // All: a list, or groups of them
  const views = o.views || [['all', 'All', keys]];
  const viewHtml = body => body.length && Array.isArray(body[0])
    ? body.filter(g => g[1].length).map(([h, ks, n]) => group(h, n, tiles(ks))).join('') : tiles(body);
  const allPane = `${views.length > 1 ? `<div class="ss-sub ss-sub-end">${seg('all', views.map(([v, label]) => [v, label]), views[0][0])}</div>` : ''}
    ${views.map(([v, , body], i) => `<div data-view="${v}"${i ? ' hidden' : ''}>${viewHtml(body)}</div>`).join('')}`;

  // By type: with o.good, the good ones first, then (on a line of their own) the rest
  const KINDS = [['char', 'Characters'], ['word', 'Words'], ['comp', 'Components'], ['sound', 'Sounds']];
  const typePane = KINDS.map(([kind, name]) => {
    const ks = keys.filter(k => byKind(k) === kind);
    if (!ks.length) return '';
    if (!o.good) return group(name, ks.length, tiles(ks, 'sm'));
    const ok = ks.filter(o.good), rest = ks.filter(k => !o.good(k));
    return group(name, `${ok.length} / ${ks.length}`, (ok.length ? tiles(ok, 'sm') : '') + (rest.length ? tiles(rest, 'sm') : ''));
  }).join('');

  // a chart: a column of stacked tiles each, a count on top, a label or a coloured line under;
  // each column as wide as its pile needs (about square), an empty one only a sliver: the lines
  // under the stages span their columns, so they grow and shrink with them
  const colWidth = n => !n ? 'minmax(10px, .25fr)' : `minmax(28px, ${Math.max(1, Math.ceil(Math.sqrt(n * 1.6)))}fr)`;
  const cols = (columns, foot) => `<div class="ss-cols" style="grid-template-columns:${columns.map(c => colWidth(c.ks.length)).join(' ')}">${columns.map(c =>
    `<div class="ss-col${c.ks.length ? '' : ' none'}" title="${esc(c.title || '')}"><span class="ss-n">${c.ks.length || ''}</span>
      <div class="ss-stack">${c.ks.map(tile).join('')}</div></div>`).join('')}${foot}</div>`;

  // SRS stage: each on the stage it stands on now (or, after a session, stood on before);
  // after a session, all of them, the promoted or the demoted
  const STEPS = Learn.MASTER;
  const stageGroups = [];
  for (let i = 0; i <= STEPS; i++) {
    const g = Learn.group(i), last = stageGroups[stageGroups.length - 1];
    if (last && last[0] === g) last[2] = i; else stageGroups.push([g, i, i]);
  }
  // a line under each stage, in its group's colour: the group's lower levels in paler shades of it
  const stageFoot = stageGroups.map(([g, x, y]) => Array.from({ length: y - x + 1 }, (_, j) => {
    const i = x + j, shade = y - i === 0 ? '' : y - i === 1 ? ' sh-b' : ' sh-a';
    return `<span class="ss-line ${g.toLowerCase()}${y - x === 1 && shade ? ' sh-a' : shade}" data-k="line:${i}" style="grid-column:${i + 1}"
      title="${esc(Learn.stageName(i))}"></span>`;
  }).join('')).join('');
  // under the lines, the names of the groups that have any of these items (an empty one is only a sliver)
  const stageLabs = (ks, when) => stageGroups.filter(([, x, y]) => ks.some(k => {
    const st = when === 'before' ? before[k] : d.items[k].stage; return st >= x && st <= y;
  })).map(([g, x]) => `<span class="ss-lab ss-stage-lab" style="grid-column:${x + 1}">${esc(g)}</span>`).join('');
  const stageChart = (ks, when) => cols(Array.from({ length: STEPS + 1 }, (_, i) => ({
    title: Learn.stageName(i), ks: ks.filter(k => (when === 'before' ? before[k] : d.items[k].stage) === i) })), stageFoot + stageLabs(ks, when));
  let stagePane;
  if (before) {
    const ups = keys.filter(k => moveOf(k) === 'up'), downs = keys.filter(k => moveOf(k) === 'down');
    stagePane = `<div class="ss-sub">
        ${seg('move', [['all', 'All'], ['up', `Promoted ${ups.length}`], ['down', `Demoted ${downs.length}`]], 'all')}
        ${seg('when', [['before', 'Before'], ['after', 'After']], 'after')}</div>
      ${[['all', keys], ['up', ups], ['down', downs]].map(([m, ks]) => ['before', 'after'].map(w =>
        `<div data-chart="${m}-${w}"${m === 'all' && w === 'after' ? '' : ' hidden'}>${stageChart(ks, w)}</div>`).join('')).join('')}`;
  } else stagePane = `<div data-chart="all-after">${stageChart(keys, 'after')}</div>`;

  // Next review: by how far off (due already, for ones waiting in the reviews)
  const BUCKETS = [['Due now', -1, -1], ['Today', 0, 0], ['Tomorrow', 1, 1], ['2–3 days', 2, 3], ['4–7 days', 4, 7],
    ['8–14 days', 8, 14], ['15+ days', 15, Infinity]];
  const when = k => d.items[k].due <= now ? -1 : dayOf(d.items[k].due);
  const byDue = keys.filter(due).sort((a, b) => d.items[a].due - d.items[b].due);
  const nextCols = BUCKETS.map(([label, a, b]) => ({ label, title: label,
    ks: byDue.filter(k => { const n = when(k); return n >= a && n <= b; }) })).filter(c => c.ks.length);
  const nextPane = nextCols.length ? cols(nextCols, nextCols.map((c, i) =>
    `<span class="ss-lab" style="grid-column:${i + 1}">${esc(c.label)}</span>`).join(''))
    : '<p class="small muted">None of these are scheduled.</p>';

  return `<section class="card ss-card ss-items" id="${o.id || 'ss-items'}" data-view0="${esc(views[0][0])}">
      <div class="ss-items-head"><h2 class="ss-h">${o.title || 'Items'} <span class="ss-count">${o.count || `<b>${keys.length}</b> total`}</span></h2>
        ${seg('tab', [['all', 'All'], ['type', 'By type'], ['stage', 'SRS stage'], ['next', 'Next review']], 'all')}</div>
      <div data-pane="all">${allPane}</div>
      <div data-pane="type" hidden>${typePane}</div>
      <div data-pane="stage" hidden>${stagePane}</div>
      <div data-pane="next" hidden>${nextPane}</div>
    </section>`;
}
/* the Items card's switches (the tab, All's order, the stage chart's filter and before/after),
   each change glided; and each tile's card on hover */
function wireItemsCard(card) {
  if (!card) return;
  const state = { tab: 'all', all: card.dataset.view0, move: 'all', when: 'after' };
  card.querySelectorAll('.ss-seg').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    state[g.dataset.seg] = b.dataset.v;
    g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    ssGlide(card, () => {
      card.querySelectorAll('[data-pane]').forEach(x => { x.hidden = x.dataset.pane !== state.tab; });
      card.querySelectorAll('[data-view]').forEach(x => { x.hidden = x.dataset.view !== state.all; });
      card.querySelectorAll('[data-chart]').forEach(x => { x.hidden = x.dataset.chart !== `${state.move}-${state.when}`; });
    });
  }));
  fcPopover(card);
  wireSounds(card);
}

/* A switch in the summary's Items card: each tile glides from where it was to its place in
   the new view (and grows or shrinks to its new size), ones new to the view pop in, ones
   leaving it fade where they stood; everything else (counts, labels, headings, the view's own
   switches) cross-fades; and the card eases to its new height. */
const SS_FADE = '.ss-n, .ss-lab, .ss-gh, .ss-count, .ss-sub .ss-seg, [data-pane] > p';
function ssGlide(card, change) {
  const shown = () => [...card.querySelectorAll('.ss-t, .ss-line')].filter(t => t.offsetParent);
  const texts = () => [...card.querySelectorAll(SS_FADE)].filter(t => t.offsetParent);
  if (Motion.reduced() || !card.animate) return change();
  card.getAnimations({ subtree: true }).forEach(a => a.finish());
  card.querySelectorAll('.ss-ghost').forEach(g => g.remove());
  const box0 = localRect(card);
  const was = new Map(shown().map(t => [t.dataset.k, [t, localRect(t)]]));
  const wasText = new Map(texts().map(t => [t, localRect(t)]));
  // a copy of something leaving, fading (and shrinking, for a tile) where it stood
  const ghost = (t, a, shrink) => {
    const cs = getComputedStyle(t), g = t.cloneNode(true);
    g.classList.add('ss-ghost');
    g.removeAttribute('href');
    g.removeAttribute('data-pane');
    g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, { position: 'absolute', left: `${a.left - box0.left}px`, top: `${a.top - box0.top}px`,
      width: `${a.width}px`, height: `${a.height}px`, margin: 0, pointerEvents: 'none', boxSizing: 'border-box',
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color, whiteSpace: 'nowrap' });
    card.appendChild(g);
    g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: shrink ? 'scale(.5)' : 'none' }],
      { duration: shrink ? 260 : 200, easing: 'ease-in', fill: 'forwards' })
      .finished.then(() => g.remove(), () => g.remove());
  };
  change();
  const box1 = localRect(card);
  const EASE = 'cubic-bezier(.2, .8, .2, 1)', MS = 520;
  if (Math.abs(box1.height - box0.height) > 1) {
    card.style.overflow = 'hidden';
    card.animate([{ height: `${box0.height}px` }, { height: `${box1.height}px` }], { duration: MS, easing: EASE })
      .finished.then(() => { card.style.overflow = ''; }, () => { card.style.overflow = ''; });
  }
  const now = shown(), stay = new Set();
  now.forEach((t, i) => {
    const old = was.get(t.dataset.k), r = localRect(t);
    const delay = Math.min(i * 3, 180);
    if (old) {
      stay.add(t.dataset.k);
      const [, a] = old;
      t.animate([
        { transformOrigin: '0 0', transform: `translate(${a.left - r.left}px, ${a.top - r.top}px) scale(${r.width ? a.width / r.width : 1}, ${r.height ? a.height / r.height : 1})` },
        { transformOrigin: '0 0', transform: 'none' }], { duration: MS, delay, easing: EASE, fill: 'backwards' });
    } else {
      t.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }],
        { duration: 320, delay: 160 + delay, easing: 'cubic-bezier(.3, 1.4, .5, 1)', fill: 'backwards' });
    }
  });
  for (const [k, [t, a]] of was) if (!stay.has(k)) ghost(t, a, true);
  // the rest: what stays put stays; what goes fades out, what comes fades in as the tiles land
  const nowText = new Set(texts());
  for (const [t, a] of wasText) if (!nowText.has(t)) ghost(t, a, false);
  for (const t of nowText) if (!wasText.has(t))
    t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 180, easing: 'ease-out', fill: 'backwards' });
}

/* ---- the end of a session, drawn ---- */

/* a sound part as shown: a tone by its shape, the rest by their letters */
const soundGlyph = k => k.startsWith('t:') && typeof tnShape === 'function'
  ? `<span class="snd-key tn-m t${k.slice(2)}">${tnShape(+k.slice(2))}</span>` : `<span class="snd-key">${esc(itemText(k))}</span>`;
/* a button that says a sound part, with a little wave while it plays */
const soundPlayBtn = (k, cls) => `<button type="button" class="${cls} snd-play" data-part="${esc(k)}" aria-label="Hear ${esc(partName(k))}">
  ${soundGlyph(k)}<i class="snd-wave" aria-hidden="true"><b></b><b></b><b></b><b></b></i></button>`;
function wireSounds(root) {
  if (!root) return;
  root.querySelectorAll('.snd-play[data-part]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    Sound.part(b.dataset.part);
    b.classList.remove('playing'); void b.offsetWidth; b.classList.add('playing');
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove('playing'), 1200);
  }));
}

/* a forecast chip's card, on hover or focus: the item, what it is, and when it's back */
const FC_KIND = { char: 'Character', word: 'Word', comp: 'Component', sound: 'Sound' };
function fcPopHtml(k, move) {
  const it = Store.item(k);
  if (!it) return '';
  const kind = it.kind || 'char', sound = kind === 'sound';
  const due = new Date(it.due), today = new Date().setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(it.due).setHours(0, 0, 0, 0) - today) / 864e5);
  const at = due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : due.toLocaleDateString(undefined, { weekday: 'long' });
  const name = sound ? esc(partName(k)) : kind === 'comp' ? esc(partName(k)) : esc(it.pin || '');
  const mean = sound ? { i: 'how a syllable begins', f: 'how a syllable ends', t: 'a tone' }[k[0]] : kind === 'comp' ? '' : primary(it);
  return `<span class="fc-pop-g ${kind}">${sound ? soundGlyph(k) : `<span class="han">${zh(glyphOf(k))}</span>`}</span>
    <span class="fc-pop-t"><b>${name}</b>${mean ? `<small>${esc(mean)}</small>` : ''}
      <span class="fc-pop-kind">${FC_KIND[kind]}${move ? '' : ` · ${esc(Learn.stageName(it.stage))}`}</span></span>
    ${move ? `<span class="fc-pop-move">${esc(move)}</span>` : ''}
    <span class="fc-pop-when"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      Back ${day}${diff > 6 ? ` ${due.getDate()}` : ''} at ${at}</span>`;
}
function fcPopover(fc) {
  const pop = document.createElement('div');
  pop.className = 'fc-pop';
  pop.setAttribute('aria-hidden', 'true');
  fc.appendChild(pop);
  let on = null;
  const show = chip => {
    if (on === chip) return;
    on = chip;
    pop.innerHTML = fcPopHtml(chip.dataset.k, chip.dataset.move);
    pop.className = 'fc-pop';
    const box = localRect(fc), r = localRect(chip);
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const mid = r.left + r.width / 2 - box.left;
    const left = Math.max(8, Math.min(mid - w / 2, box.width - w - 8));
    const below = r.top - h - 12 < 64;                    // no room above in the window (under the top bar): under the chip
    pop.style.left = `${left}px`;
    pop.style.top = `${below ? r.bottom - box.top + 10 : r.top - box.top - h - 10}px`;
    pop.style.setProperty('--ax', `${mid - left}px`);
    pop.classList.add('on', below ? 'below' : 'above');
  };
  const hide = () => { on = null; pop.classList.remove('on'); };
  fc.querySelectorAll('.fc-chip').forEach(chip => {
    chip.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') show(chip); });
    chip.addEventListener('pointerleave', hide);
    chip.addEventListener('focus', () => show(chip));
    chip.addEventListener('blur', hide);
  });
}

/* Learned today: every character, word, component and sound that had its lesson today, as it
   looks and nothing else. Each opens its own page in a new tab. At the end of a lesson quiz,
   and at #/learned. */
const LEARNED_GROUPS = [['char', 'Characters'], ['word', 'Words'], ['comp', 'Components'], ['sound', 'Sounds']];
// what the smaller groups are, beside the characters and words they serve
const LEARNED_NOTES = { comp: 'The parts these characters are built from', sound: 'The pinyin sounds they use, each with its memory word' };
const learnedToday = () => Learn.learnedOn(Store.load().items, Date.now());
const learnedCount = by => LEARNED_GROUPS.reduce((n, [g]) => n + by[g].length, 0);

function fillLearned(box, keys) {
  // (or the given ones, by kind: the end of a review)
  const by = keys ? Object.fromEntries(LEARNED_GROUPS.map(([g]) => [g, keys.filter(k => ((Store.item(k) || {}).kind || 'char') === g)]))
    : learnedToday();
  box.innerHTML = !learnedCount(by) ? '<section class="card"><p class="empty">Nothing learned yet today.</p></section>'
    : LEARNED_GROUPS.filter(([g]) => by[g].length).map(([g, title]) => `<section class="ls-group ${g}"><h2 class="sec-h">${title} <span class="muted">${by[g].length}</span></h2>
        ${LEARNED_NOTES[g] && (by.char.length || by.word.length) ? `<p class="ls-note">${LEARNED_NOTES[g]}</p>` : ''}
        <div class="ls-tiles">${by[g].map(k => g === 'sound'
          ? `<span class="ls-snd">${soundPlayBtn(k, 'ls-snd-play')}<a class="ls-snd-name" href="${itemHref(k)}" target="_blank" rel="noopener"
              aria-label="${esc(partName(k))}, opens in a new tab">${esc(partName(k))}</a></span>`
          : `<a class="ls-tile ${g} han" href="${itemHref(k)}" target="_blank" rel="noopener" aria-label="${esc(itemText(k))}, opens in a new tab">${itemHtml(k)}</a>`).join('')}</div></section>`).join('');
  wireSounds(box);
}

function pageLearned() {
  const more = Store.plan().lessons.length;
  app.innerHTML = '<h1 class="page-title">Learned today</h1>' + withRail(`
    <p class="row ls-actions">${more ? `<a class="btn" href="#/lessons">More lessons (${more})</a>` : ''}
      <a class="btn${more ? ' quiet' : ''}" href="#/study">Back to Today</a></p>
    <div id="learned-sheet"></div>`, true);
  paintRail();
  fillLearned(document.getElementById('learned-sheet'));
}

/* a stability (days) in words */
function days(S) {
  return S < 1 ? Math.max(1, Math.round(S * 24)) + ' h' : S < 60 ? Math.round(S) + ' d'
    : S < 730 ? Math.round(S / 30.4) + ' mo' : (S / 365).toFixed(1) + ' y';
}

/* an item's memory as FSRS has it, before this review */
function memoryPanel(it) {
  const m = Learn.memory(it, Date.now());
  if (!m) return '<p class="muted">Nothing yet: it hasn’t had its lesson.</p>';
  return `<dl class="lx-dl">
    <dt>Stability</dt><dd><b>${days(m.S)}</b> <span class="small muted">until the chance of recalling it falls to 90%</span></dd>
    <dt>Difficulty</dt><dd><b>${m.D.toFixed(1)}</b> <span class="small muted">of 10</span></dd>
    <dt>Recall now</dt><dd><b>${Math.round(m.R * 100)}%</b> <span class="small muted">likely, going by the time since its last review</span></dd>
    <dt>Reviews</dt><dd>${it.reps || 0}${it.lapses ? `, forgotten ${it.lapses} time${it.lapses === 1 ? '' : 's'}` : ''}${(it.grades || []).length
      ? ` · lately ${it.grades.slice(-5).map(g => Learn.GRADE_NAMES[g].toLowerCase()).join(', ')}` : ''}</dd>
  </dl>`;
}

/* why the app gives a rating (Learn.gradeFrom) */
const GRADE_WHY = [null,
  'A wrong answer (or the answer shown)',
  'Right, but with a slip of tone (or, in a calibration test, after a long think)',
  'Right first time',
  'In a calibration test: right first time, and you started typing within ' + Learn.QUICK / 1000 + ' seconds on every question'
    + ' (on an item remembered a month or more, or marked Known and not yet checked, and not missed or hard last time)'];

/* Practice: a session over the given items that leaves their schedule alone */
function startPractice(keys) {
  reviewState = newSession(shuffle(keys.slice()), 'practice');
  if (currentPath() === '/reviews') pageReviews(); else go('/reviews');
}

// -------------------------------------------------------------- calibration

/* The calibration test: characters you marked as learned all joined the reviews at
   Novice I, unchecked. The test is a review session over them (typed answers,
   pronunciation first), rated by the app from the answers like any review, and
   taken as if each came right when due (Learn.calibrate): FSRS moves each to the
   stability that fits, and reviews carry on from there. No asking how well you
   know them. */

/* what could be sorted: items in reviews, and those never checked since joining */
function calibrationSets() {
  const d = Store.load();
  const all = Object.keys(d.items).filter(k => d.items[k].stage >= 1);
  return { all, unsorted: all.filter(k => Learn.uncalibrated(d.items[k])) };
}

/* most common first: a character by its frequency rank, a word by its rarest character */
function byCommon(keys) {
  const rank = k => Math.max(...[...k].map(c => (HZ.index[c] || [])[0] || 1e6));
  return keys.slice().sort((a, b) => rank(a) - rank(b));
}

function pageCalibrate() {
  const { all, unsorted } = calibrationSets();
  app.innerHTML = '<h1 class="page-title">Calibration test</h1>' + withRail(`<section class="card">
    <p>Characters you marked as learned all joined your reviews at Novice, whether you know them well
      or hardly at all. This sorts them by how well you really know them: type each one's pronunciation and
      meaning, as in a review, and HanziHome judges from your answers.</p>
    <div class="cb-map">
      <div class="g1"><b>Wrong</b><span>stays at Novice I: again tomorrow</span></div>
      <div class="g2"><b>A slip, or a long think</b><span>up to Novice II: in about 5 days</span></div>
      <div class="g3"><b>Right</b><span>up to Apprentice I: in about 11 days</span></div>
      <div class="g4"><b>Right at once</b><span>up to Apprentice II: in about 4 weeks</span></div>
    </div>
    <p class="small muted">“At once” is starting to type within ${Learn.QUICK / 1000} seconds; a long think is over
      ${Learn.SLOW / 1000}. From there FSRS takes over: every review moves each one's stability up or down.
      Each answer counts at once, so you can stop whenever you like (wrap up, or leave the page) and carry on later.
      Characters count as learned across HanziHome once they reach Adept.</p>
    <div class="st-field"><div class="st-label">Which</div>
      <label class="cb-opt"><input type="radio" name="cb-set" value="unsorted"${unsorted.length ? ' checked' : ' disabled'}>
        Not sorted yet (${unsorted.length})</label>
      <label class="cb-opt"><input type="radio" name="cb-set" value="all"${unsorted.length ? '' : ' checked'}>
        Everything in your reviews (${all.length})</label></div>
    <div class="st-field"><div class="st-label">How many at a time</div>
      <select class="st-select" id="cb-size">${[20, 50, 100, 0].map(n =>
        `<option value="${n}"${n === 50 ? ' selected' : ''}>${n || 'All of them'}</option>`).join('')}</select></div>
    <div class="st-field"><div class="st-label">Order</div>
      <label class="cb-opt"><input type="radio" name="cb-order" value="common" checked> Most common first</label>
      <label class="cb-opt"><input type="radio" name="cb-order" value="random"> Shuffled</label></div>
    <p class="row"><button class="btn" id="cb-start"${all.length ? '' : ' disabled'}>Start</button>
      <a class="btn quiet" href="#/study">Back to Today</a></p>
  </section>`, true);
  document.getElementById('cb-start').addEventListener('click', () => {
    const set = (app.querySelector('input[name="cb-set"]:checked') || {}).value === 'unsorted' ? unsorted : all;
    const order = (app.querySelector('input[name="cb-order"]:checked') || {}).value;
    const size = +document.getElementById('cb-size').value;
    const keys = order === 'random' ? shuffle(set.slice()) : byCommon(set);
    startCalibration(size ? keys.slice(0, size) : keys);
  });
  paintRail();
}

/* a calibration session: a review session over these, rated the same way */
function startCalibration(keys) {
  reviewState = newSession(keys, 'calibrate');
  if (currentPath() === '/reviews') pageReviews(); else go('/reviews');
}

// ----------------------------------------------------------------- settings

/* A new retention: every review moves to when the chance of recall falls to it.
   (Items never reviewed keep their first dates, which are spread out on purpose.) */
function reschedule(retention) {
  for (const it of Object.values(Store.load().items)) {
    if (!(it.stage >= 1)) continue;
    Learn.adopt(it);
    const since = it.last || it.learnt;
    if (since) it.due = since + Learn.intervalFor(it.S, retention) * Learn.DAY;
  }
  Store.save();
}

/* The Settings page's "Lessons and reviews" card: HanziHero's application settings,
   saved as you change them (in the store, so they sync) */
/* Settings: what each learning path is good and bad at, with when each HSK level is complete
   (Learn.PATH_FACTS) and how long that is at the number a day chosen. */
function pathCompare(c) {
  const F = Learn.PATH_FACTS, daily = Math.max(1, Learn.dailySplit(c).chars);
  const cols = [['mix', 'Balanced'], ['common', 'Most common'], ['hsk', 'HSK order']];
  const span = pos => {
    const days = Math.ceil(pos / daily);
    if (days < 60) return days + ' days';
    const months = days / 30.4;
    return months < 24 ? Math.round(months) + ' months' : (Math.round(months / 12 * 2) / 2) + ' years';
  };
  const cell = (id, html) => `<td class="${c.path === id ? 'on' : ''}">${html}</td>`;
  const when = i => cols.map(([id]) => {
    const pos = F[id].hsk[i];
    return cell(id, pos === Infinity ? 'never*' : `<b>#${pos.toLocaleString()}</b><small>${span(pos)}</small>`);
  }).join('');
  const mode = (id, name, good, bad) => `<div class="pc-mode ${c.path === id ? 'on' : ''}">
    <h4>${name}${c.path === id ? ' <small>your path</small>' : ''}</h4>
    <ul>${good.map(x => `<li class="good">${x}</li>`).join('')}${bad.map(x => `<li class="bad">${x}</li>`).join('')}</ul></div>`;
  return `<details class="path-compare">
    <summary>Compare the learning paths</summary>
    <div class="pc-scroll"><table>
      <thead><tr><th>HSK level complete at</th>${cols.map(([id, l]) => `<th class="${c.path === id ? 'on' : ''}">${l}</th>`).join('')}</tr></thead>
      <tbody>${F.hsk.hsk.map((_, i) => `<tr><th>${hskName(i + 1)}</th>${when(i)}</tr>`).join('')}
        <tr class="pc-gap"><th>Share of everyday text you can recognise, after 500 characters</th>${cols.map(([id]) => cell(id, F[id].cover[500] + '%')).join('')}</tr>
        <tr><th>…after 1,000 characters</th>${cols.map(([id]) => cell(id, F[id].cover[1000] + '%')).join('')}</tr>
        <tr><th>New components per character (first 1,000)</th>${cols.map(([id]) => cell(id, F[id].newComps.toFixed(2))).join('')}</tr>
      </tbody></table></div>
    <p class="st-note">Times are at ${daily} new characters a day, if you do them all every day. Levels are HSK 3.0's,
      with 7–9 taken together as the exam does.</p>
    ${(() => {
      // (the numbers from Learn.PATH_FACTS, which test/learn.js checks against the data)
      const n = x => '#' + x.toLocaleString(), top = F.hsk.hsk.length - 1;
      return mode('mix', 'Balanced', [
        `Finishes the first HSK levels early: HSK 1 by ${n(F.mix.hsk[0])} and HSK 2 by ${n(F.mix.hsk[1])}, instead of waiting until ${n(F.common.hsk[0])} or later.`,
        `Nearly as good for reading as most common: ${F.mix.cover[1000]}% of everyday text after 1,000 characters, against ${F.common.cover[1000]}%.`,
        'Goes on past the HSK: the nearly 6,000 characters it can teach include common ones the HSK leaves out.',
      ], [
        'Levels overlap: you\'ll be learning HSK 3 before HSK 1 is done, so there\'s no single level to focus on.',
        `Finishes each level later than HSK order does, ${hskName(top + 1)} especially (${n(F.mix.hsk[top])} against ${n(F.hsk.hsk[top])}).`,
        'Doesn\'t make characters easier: stroke counts and new components are about the same as most common, because those count for little in its score.',
      ]) + mode('common', 'Most common first', [
        `The fastest way to read real Chinese: ${F.common.cover[500]}% of everyday text after 500 characters and ${F.common.cover[1000]}% after 1,000, the most of any path.`,
        'Every character you learn is one you\'ll see often, so reviews get help from everything you read.',
      ], [
        `Very late for HSK: HSK 1 isn't complete until ${n(F.common.hsk[0])}, because everyday words like 渴 (thirsty), 饿 (hungry) and 桌 (table) are rare in writing.`,
        'Poor for an exam: only 72 of HSK 1\'s 300 characters come in the first 100.',
        'Includes place names and foreign-word sounds (欧, 韩, 莱) that the HSK leaves out: common in text, but not much use to a beginner.',
      ]) + mode('hsk', 'HSK 1 to 9, level by level', [
        `Finishes every level first: HSK 1 by ${n(F.hsk.hsk[0])}, HSK 2 by ${n(F.hsk.hsk[1])}, ${hskName(top + 1)} by ${n(F.hsk.hsk[top])}. The best choice for an exam.`,
        'One level at a time, with clear milestones, and the everyday words textbooks teach (渴, 饿, 桌子) come early.',
      ], [
        `The slowest start for reading: ${F.hsk.cover[500]}% of everyday text after 500 characters, against ${F.common.cover[500]}% for most common.`,
        `The most new components per character, ${F.hsk.newComps.toFixed(2)} against ${F.mix.newComps.toFixed(2)}, so lessons are a little heavier.`,
        `Stops after ${hskName(top + 1)}: common characters outside the lists (46 of the top 2,000, such as 州, 欧) never come up. Add those yourself.`,
      ]);
    })()}
    ${mode('off', 'Off', [
      'You choose everything: add characters from what you\'re reading, a textbook or a class.',
      'Nothing joins your lessons that you didn\'t ask for.',
    ], [
      'No lessons appear on their own, so progress depends on you adding them.',
      'No order to follow: you may miss common characters, and an HSK level finishes only if you make sure of it.',
    ])}
    <p class="st-note">Whichever you choose, when an HSK level is nearly done (at least 75% learned and at most 50 characters left), Today and that
      level's page offer a button that puts the rest at the front of your lessons.</p>
  </details>`;
}

/* the day's split in words: "10 words and 5 characters a day" */
function dailyLine(cfg) {
  const s = Learn.dailySplit(cfg);
  if (!isFinite(s.total)) return 'as many new items a day as are ready';
  const n = (x, one) => `${x} ${one}${x === 1 ? '' : 's'}`;
  return !s.words ? `${n(s.total, 'new character')} a day` : !s.chars ? `${n(s.total, 'new word')} a day`
    : `${s.total} new items a day: ${n(s.words, 'word')} and ${n(s.chars, 'character')}`;
}
/* under the words slider: what the rest is */
const splitNote = s => !s.chars ? 'Every new item a word, as long as there are words ready (characters fill in when there aren\'t).'
  : !s.words ? `No words: all ${s.chars} are characters and the components they need.`
  : `${s.words} word${s.words === 1 ? '' : 's'}, and ${s.chars} character${s.chars === 1 ? '' : 's'} and the components they need.`;
/* the day's split as a bar: words, then characters and their prerequisites */
const splitBar = s => `<div class="st-split" aria-hidden="true"><i class="w" style="flex-grow:${s.words}"></i><i class="c" style="flex-grow:${s.chars}"></i></div>
  <p class="st-split-key"><span><i class="w"></i>Words <b data-n="w">${s.words}</b></span><span><i class="c"></i>Characters &amp; prerequisites <b data-n="c">${s.chars}</b></span></p>`;
/* the recommended share of words: a badge when that is what you have, else a button back to it */
const splitRec = s => {
  const pct = Math.round(Learn.WORD_SHARE * 100), n = Learn.recommendedWords(s.total);
  return s.recommended || s.words === n
    ? `<p class="st-rec on"><span class="st-rec-badge">Recommended</span> ${pct}% words${s.recommended ? ', following the total' : ''}</p>`
    : `<p class="st-rec"><button type="button" class="btn quiet st-rec-btn" data-rec>Use recommended: ${n} (${pct}%)</button></p>`;
};

function paintStudySettings() {
  const box = document.getElementById('study-card');
  if (!box) return;
  const c = Store.cfg();
  const sel = (k, opts, kind = 'str') => `<select class="st-select" data-k="${k}" data-t="${kind}">${opts.map(([v, l]) =>
    `<option value="${v}"${String(c[k]) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const tog = (k, label) => `<label class="st-toggle"><input type="checkbox" data-k="${k}" data-t="bool"${c[k] ? ' checked' : ''}>
    <i></i><span>${label}</span></label>`;
  const range = (k, min, max) => `<div class="st-range"><input type="range" data-k="${k}" data-t="int"
    min="${min}" max="${max}" value="${Math.min(c[k], max)}"><output>${Math.min(c[k], max)}</output></div>`;
  const field = (label, body, note) => `<div class="st-field"><div class="st-label">${label}</div>${body}
    ${note ? `<p class="st-note">${note}</p>` : ''}</div>`;

  const limits = [[5, 'Casual — 5 items / day'], [10, 'Regular — 10 items / day'], [15, 'Serious — 15 items / day'],
    [20, 'Intense — 20 items / day'], [25, 'Jump start — 25 items / day'], [30, 'Jump start — 30 items / day'],
    [35, 'Jump start — 35 items / day'], [40, 'Jump start — 40 items / day'], [50, 'Jump start — 50 items / day']];
  if (!limits.some(([n]) => n === c.lessonLimit)) limits.push([c.lessonLimit, `${c.lessonLimit} items / day`]);
  const split = Learn.dailySplit(c), total = split.total;
  const reviewLimits = [[0, 'None']].concat([50, 100, 150, 200, 250, 300, 400, 500].map(n => [n, n + ' items / day']));
  const voice = Sound.voice();
  const tz = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone;

  box.innerHTML = `
    <h2>Lessons and reviews <span class="st-saved" id="st-saved" hidden>Saved</span></h2>
    <p class="muted small">Changes are saved as you make them, and sync with the rest of your progress.</p>
    ${field('Learning path', sel('path', [['off', 'Off: I add what I learn myself'], ['mix', 'Balanced: simple, common, early HSK, parts you know'], ['common', 'The most common characters first'],
      ['hsk', 'HSK 1 to 9, level by level']]),
      'Where the new characters and words come from. The path keeps its next characters and their words in your lesson queue, skipping the ones you know, with their new components and sounds before them; the Daily lessons numbers below decide how many of each you learn a day. Change it and the queue changes straight away; what you added yourself or prioritised stays. See and change the order on the <a href="#/queue">Upcoming page</a>.')}
    ${pathCompare(c)}
    <h3 class="st-h">Daily lessons</h3>
    <p class="muted small">Two numbers decide each day's lessons: how many new things you learn, and how many of
      those are words. Characters, with the components (prerequisites) they need first, fill the rest.</p>
    ${field('New items a day', sel('lessonLimit', limits, 'int'),
      `Everything new you learn in a day, counted together: words, characters and their new components. Sounds are short and don't count. You'll have about <b>${total * 10} reviews</b> a day once they settle in.`)}
    ${field('How many are words', `<div class="st-range"><input type="range" data-k="lessonWords" data-t="int"
      min="0" max="${total}" value="${split.words}" aria-label="Words a day, out of ${total}"><output>${split.words}</output></div>
      ${splitBar(split)}<div class="st-rec-box">${splitRec(split)}</div>`,
      `<span id="st-split">${splitNote(split)}</span> About ${Math.round(Learn.WORD_SHARE * 100)}% words is recommended, and is where it starts: until you choose a number yourself, it stays at that share when you change the total. A word is ready the day after all its characters have had their lessons; when fewer words than this are ready, characters take their place, so the day is still full.`)}
    <h3 class="st-h">Reviews</h3>
    ${field('Daily review limit', sel('reviewLimit', reviewLimits, 'int'),
      'A soft limit: a session stops there, and once today\'s are done the Reviews tile greys out. You can still start another session.')}

    <details class="st-more">
      <summary>More lesson and review settings</summary>
    ${field('Desired retention', `<div class="st-range"><input type="range" data-k="retention" data-t="pct" min="80" max="97"
      value="${Math.round(c.retention * 100)}"><output>${Math.round(c.retention * 100)}%</output></div>`,
      'Reviews are scheduled by FSRS: an item comes back when your chance of recalling it has fallen to this. Higher means '
      + 'more reviews, each easier; 90% is FSRS’s own choice. The rating of each review (again, hard, good, easy) isn’t asked: '
      + 'it comes from your answers, not from how fast you give them. Wrong is again; a slip of tone is hard; right is good. '
      + 'Only a calibration test times you: there a long think (over ' + Learn.SLOW / 1000 + ' seconds before you start typing) '
      + 'is hard too, and right and started within ' + Learn.QUICK / 1000 + ' seconds is easy.')}
    ${field('Character unlocking', sel('charUnlock', [['now', 'Unlock right away'],
      ['learned', 'Unlock when its components are learned'], ['familiar', 'Unlock when its components are familiar']]),
      'A component counts once you mark it known on the Top components page or mark it learned, or once it has had its own lesson (learned) or reached Apprentice I (familiar).')}
    ${field('Item question order', sel('questionOrder', [['pinyin', 'Pair pronunciation, then meaning'],
      ['random', 'Select questions randomly']]),
      'Either way, an item’s meaning is only asked once its pronunciation is right.')}
    ${field('Review order', sel('reviewOrder', [['random', 'Random'], ['type', 'Characters, then words'],
      ['oldest', 'Oldest first'], ['newest', 'Newest first'], ['easiest', 'Easiest first'], ['lowest', 'Lowest SRS stage first']]))}
    <div class="st-field">
      ${tog('showPct', 'Show the percentage correct')}
      ${tog('showCount', 'Show the number correct and left over')}
      ${tog('listen', 'Listening: ask what an item means from its sound alone')}
      <p class="st-note">Asked first, before you see it. Needs this device's Chinese voice (below); counts like the other questions.</p>
    </div>
    </details>

    <h3 class="st-h">Sounds</h3>
    ${field('Pronunciation', sel('audio', [['recorded', 'Recordings by Chinese speakers'], ['browser', 'The browser\'s voice']]),
      'Recordings: the 8,500 words and characters of the HSK lists read by a speaker, and any other word read syllable by syllable (audio-cmn, CC BY-SA: Chen Wang and Yue Tan). Where there is none, the browser\'s voice reads it.')}
    ${field('Browser voice', sel('voice', [['female', 'Female'], ['male', 'Male']]),
      `<span id="st-voice-note">${voice ? `Reading with ${esc(voice.name)}${Sound.gender(voice) && Sound.gender(voice) !== c.voice
        ? ` (this device has no ${c.voice} Chinese voice)` : ''}.`
        : 'This device has no Chinese voice, so nothing is read aloud. On Windows: Settings → Time &amp; language → Speech → Add voices → Chinese (Simplified).'}</span>`)}
    <div class="st-field">
      ${tog('muteSfx', 'Mute sound effects')}
      ${tog('muteVoice', 'Mute the voiced pronunciation')}
    </div>

    <h3 class="st-h">Vacation mode</h3>
    ${c.vacation ? `<p class="muted small">On vacation since ${esc(new Date(c.vacation).toLocaleDateString())}: lessons and
        reviews are paused. Coming back moves every review on by the time you were away.</p>
      <p><button type="button" class="btn" id="st-vac">End vacation</button></p>`
    : `<p class="muted small">Take a break: lessons and reviews stop until you come back, and then every
        review waits as long again as you were away, so nothing piles up.</p>
      <p><button type="button" class="btn quiet" id="st-vac">Go on vacation</button></p>`}
    <p class="small muted">The day's new items and the review limit start again at midnight in this device's time zone${tz ? ` (${esc(tz)})` : ''}.</p>`;

  let flash;
  const saved = () => {
    const el = document.getElementById('st-saved');
    if (!el) return;
    el.hidden = false;
    clearTimeout(flash);
    flash = setTimeout(() => { el.hidden = true; }, 1500);
  };
  box.querySelectorAll('[data-k]').forEach(el => {
    const k = el.dataset.k, t = el.dataset.t;
    const value = () => t === 'bool' ? el.checked : t === 'int' ? parseInt(el.value, 10) || 0
      : t === 'pct' ? (parseInt(el.value, 10) || 90) / 100 : el.value;
    if (el.type === 'range') {
      // the track fills with yellow up to the knob (style.css .st-range)
      const fill = () => el.style.setProperty('--fill', 100 * (el.value - el.min) / ((el.max - el.min) || 1) + '%');
      fill();
      el.addEventListener('input', () => {
        el.nextElementSibling.textContent = el.value + (t === 'pct' ? '%' : '');
        fill();
        const note = k === 'lessonWords' && document.getElementById('st-split');
        if (note) {
          const s = Learn.dailySplit({ ...Store.cfg(), lessonWords: +el.value }), f = el.closest('.st-field');
          note.textContent = splitNote(s);
          f.querySelector('.st-split .w').style.flexGrow = s.words;
          f.querySelector('.st-split .c').style.flexGrow = s.chars;
          f.querySelector('[data-n="w"]').textContent = s.words;
          f.querySelector('[data-n="c"]').textContent = s.chars;
          f.querySelector('.st-rec-box').innerHTML = splitRec({ ...s, recommended: s.words === Learn.recommendedWords(s.total) });
        }
      });
    }
    el.addEventListener('change', () => {
      const patch = { [k]: value() };
      // (never more words than the day's total; the recommended number is kept unset, so it
      // follows the total)
      if (k === 'lessonLimit' && Store.cfg().lessonWords > patch.lessonLimit) patch.lessonWords = patch.lessonLimit;
      if (k === 'lessonWords' && patch.lessonWords === Learn.recommendedWords(Learn.dailySplit(Store.cfg()).total)) patch.lessonWords = null;
      Store.setCfg(patch);
      if (k === 'retention') reschedule(patch.retention);
      markNav(currentPath());
      if (['lessonLimit', 'lessonWords', 'voice', 'path'].includes(k)) paintStudySettings();
      // the queue follows these at once
      if (['path', 'lessonLimit', 'lessonWords'].includes(k)) fillPath().then(fillParts).then(() => markNav(currentPath()));
      saved();
    });
  });
  // back to the recommended share (event delegation: the button is redrawn as the slider moves)
  if (!box.dataset.recWired) box.addEventListener('click', e => {
    if (!e.target.closest('[data-rec]')) return;
    Store.setCfg({ lessonWords: null });
    markNav(currentPath());
    paintStudySettings();
    fillPath().then(fillParts).then(() => markNav(currentPath()));
    const el = document.getElementById('st-saved');
    if (el) { el.hidden = false; setTimeout(() => { el.hidden = true; }, 1500); }
  });
  box.dataset.recWired = '1';
  document.getElementById('st-vac').addEventListener('click', () => {
    Store.vacation(!c.vacation);
    markNav(currentPath());
    paintStudySettings();
  });
}

// ------------------------------------------------------------------ statistics

/* #/stats: how your studying is going. Answers by type, reviews and lessons by day
   (the store's log), how much you would remember now (FSRS's retrievability) against
   the retention you asked for, what is coming, where your items are, and the hardest. */
function pageStats() {
  const d = Store.load(), cfg = Store.cfg(), now = Date.now();
  const items = Object.entries(d.items).filter(([, it]) => it.stage >= 1);
  const KINDS = [['char', 'Characters'], ['word', 'Words'], ['comp', 'Components'], ['sound', 'Sounds']];
  const pc = (a, b) => b ? Math.round(100 * a / b) + '%' : '—';

  // answers lately, by type: each item's last ten reviews
  const byKind = KINDS.map(([kind, name]) => {
    const its = items.filter(([, it]) => (it.kind || 'char') === kind).map(e => e[1]);
    const h = its.flatMap(it => it.hist || []);
    const mem = its.map(it => Learn.memory(it, now)).filter(Boolean);
    const R = mem.length ? mem.reduce((t, m) => t + m.R, 0) / mem.length : 0;
    return { kind, name, n: its.length, right: h.filter(Boolean).length, all: h.length, R,
      learned: its.filter(it => it.stage >= Learn.LEARNED_FROM).length };
  }).filter(x => x.n);

  // the last 30 days
  const days = Array.from({ length: 30 }, (_, i) => dayKey(now - (29 - i) * Learn.DAY));
  const log = days.map(k => Object.assign({ r: 0, ok: 0, l: 0, s: 0 }, d.log[k] || {}));
  const maxR = Math.max(1, ...log.map(x => x.r + x.l));
  const total = log.reduce((t, x) => ({ r: t.r + x.r, ok: t.ok + x.ok, l: t.l + x.l, s: t.s + x.s }), { r: 0, ok: 0, l: 0, s: 0 });
  let streak = 0;
  for (let i = log.length - 1; i >= 0 && (log[i].r || log[i].l); i--) streak++;
  if (!streak && log.length > 1) for (let i = log.length - 2; i >= 0 && (log[i].r || log[i].l); i--) streak++;   // today not yet

  const fc = Learn.forecast(items.map(e => e[1]), now, 14), maxF = Math.max(1, ...fc);
  const hardest = items.filter(([, it]) => (it.hist || []).length >= 3)
    .map(([k, it]) => [k, it, (it.hist || []).filter(Boolean).length / it.hist.length])
    .sort((a, b) => a[2] - b[2] || (b[1].D || 0) - (a[1].D || 0)).slice(0, 12);
  const mins = sec => sec < 3600 ? Math.round(sec / 60) + ' min' : (sec / 3600).toFixed(1) + ' h';
  // FSRS's chance of recall at each logged review, against what happened (Learn.predictionCheck)
  const pred = Learn.predictionCheck(d.items), PRED_MIN = 30;
  const pp = x => Math.round(100 * x) + '%';

  // the study calendar: 26 weeks, Monday first, each day by how much you did
  const CAL_WEEKS = 26, today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const calStart = new Date(today0); calStart.setDate(calStart.getDate() - ((calStart.getDay() + 6) % 7) - (CAL_WEEKS - 1) * 7);
  const calDays = Array.from({ length: CAL_WEEKS * 7 }, (_, i) => {
    const dt = new Date(calStart); dt.setDate(dt.getDate() + i);
    const x = d.log[dayKey(dt.getTime() + 12 * 36e5)] || {};
    return { dt, r: x.r || 0, ok: x.ok || 0, l: x.l || 0, future: dt > today0 };
  });
  const calMax = Math.max(1, ...calDays.map(x => x.r + x.l));
  const calLevel = n => !n ? 0 : Math.min(4, 1 + Math.floor(3.999 * n / calMax));
  const calActive = calDays.filter(x => x.r + x.l).length;
  const calHtml = `<div class="st-cal" style="--weeks:${CAL_WEEKS}">
      <div class="st-cal-m">${Array.from({ length: CAL_WEEKS }, (_, w) => {
        // a month's name over its first week (and over the first column, unless the next month is about to start)
        const a = calDays[w * 7].dt, b = w ? calDays[w * 7 - 7].dt : null, soon = calDays[Math.min(w * 7 + 14, calDays.length - 1)].dt;
        const named = b ? a.getMonth() !== b.getMonth() : soon.getMonth() === a.getMonth();
        return `<span>${named ? a.toLocaleDateString(undefined, { month: 'short' }) : ''}</span>`;
      }).join('')}</div>
      <div class="st-cal-w" aria-hidden="true"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
      <div class="st-cal-g" role="img" aria-label="${calActive} days studied in the last ${CAL_WEEKS} weeks">${calDays.map((x, i) => x.future
        ? '<i class="st-cal-c future"></i>'
        : `<i class="st-cal-c l${calLevel(x.r + x.l)}${x.dt.getTime() === today0.getTime() ? ' today' : ''}" style="--i:${i}" data-tip="${esc(`<b>${x.dt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</b>${
            x.r + x.l ? `<span>${x.r} review${x.r === 1 ? '' : 's'}${x.r ? ` · ${pc(x.ok, x.r)} right` : ''}</span><span>${x.l} lesson${x.l === 1 ? '' : 's'}</span>` : '<span>Nothing studied</span>'}`)}"></i>`).join('')}</div>
      <div class="st-cal-key small muted"><span>Less</span>${[0, 1, 2, 3, 4].map(l => `<i class="st-cal-c l${l}"></i>`).join('')}<span>More</span></div>
    </div>`;

  // every item by its chance of recall today, strongest first (Your items: weakest first)
  const memOf = items.map(([k, it]) => [k, it, (Learn.memory(it, now) || { R: 0 }).R]).sort((a, b) => b[2] - a[2]);

  // your items, as the session summary shows a session's: newest first, or weakest first
  const keys = items.map(([k]) => k);
  const newest = keys.slice().sort((x, y) => (d.items[y].learnt || 0) - (d.items[x].learnt || 0));
  const learnedN = keys.filter(k => d.items[k].stage >= Learn.LEARNED_FROM).length;
  const itemsHtml = itemsCard(keys, {
    id: 'st-items', title: 'Your items',
    count: `<b>${keys.length}</b> total<b>${learnedN}</b> learned`,
    views: [['newest', 'Newest', newest], ['weakest', 'Weakest', memOf.map(([k]) => k).reverse()]],
    good: k => d.items[k].stage >= Learn.LEARNED_FROM,     // By type: the learned, then the rest
  });

  if (!items.length) {
    app.innerHTML = '<h1 class="page-title">Statistics</h1>' + withRail(`
    <section class="card st-empty">
      <h2>No statistics yet</h2>
      <p class="muted">Your streak, review accuracy, upcoming reviews and stages show up here after your first lessons.</p>
      <p><a class="btn" href="#/lessons">Start your lessons</a></p>
    </section>`, true);
    paintRail();
    return;
  }
  app.innerHTML = '<h1 class="page-title">Statistics</h1>' + withRail(`
    <section class="card">
      <div class="st-tiles">
        <div class="st-streak${streak ? ' on' : ''}"><b data-count="${streak}">${streak}</b><span>day${streak === 1 ? '' : 's'} in a row</span></div>
        <div><b data-count="${total.r}">${total.r}</b><span>reviews in 30 days</span></div>
        <div><b ${total.r ? `data-count="${Math.round(100 * total.ok / total.r)}" data-suffix="%"` : ''}>${pc(total.ok, total.r)}</b><span>right first time</span></div>
        <div><b data-count="${total.l}">${total.l}</b><span>lessons in 30 days</span></div>
        <div><b>${mins(total.s)}</b><span>studied in 30 days</span></div>
      </div>
    </section>
    <section class="card st-read" id="st-read" aria-busy="true"><h2 class="caps">How much you can read</h2><div class="st-wait"></div></section>
    <section class="card st-grow" id="st-grow" aria-busy="true"><h2 class="caps">Characters you know</h2><div class="st-wait"></div></section>
    <section class="card st-anim">
      <div class="st-head"><h2 class="caps">Your study calendar</h2><span class="small muted">${calActive} day${calActive === 1 ? '' : 's'} in ${CAL_WEEKS} weeks</span></div>
      ${calHtml}
    </section>
    ${itemsHtml}
    <section class="card">
      <h2 class="caps">The last 30 days</h2>
      <div class="st-days">${log.map((x, i) => `<div title="${esc(days[i])}: ${x.r} reviews (${pc(x.ok, x.r)} right), ${x.l} lessons">
        <i class="r" style="height:${Math.round(100 * x.r / maxR)}%"></i><i class="l" style="height:${Math.round(100 * x.l / maxR)}%"></i></div>`).join('')}</div>
      <p class="small muted"><span class="st-key r"></span> reviews <span class="st-key l"></span> lessons · today on the right</p>
    </section>
    <section class="card">
      <h2 class="caps">By type</h2>
      ${byKind.length ? `<table><thead><tr><th></th><th>In reviews</th><th>Learned</th><th>Right lately</th>
        <th title="The average chance you'd recall one now, by FSRS">Would recall now</th></tr></thead><tbody>
        ${byKind.map(x => `<tr><td><b>${x.name}</b></td><td class="num">${x.n}</td><td class="num">${x.learned}</td>
          <td class="num">${pc(x.right, x.all)}</td><td class="num ${x.R < cfg.retention - 0.05 ? 'st-low' : ''}">${Math.round(100 * x.R)}%</td></tr>`).join('')}
      </tbody></table>
      <p class="small muted">You asked for ${Math.round(cfg.retention * 100)}% retention (Settings). Reviews come when
        an item's chance of recall falls there, so "would recall now" sits a little above it when you are up to date,
        and below it when reviews have piled up.</p>` : '<p class="empty">Nothing reviewed yet.</p>'}
    </section>
    <section class="card">
      <h2 class="caps">How well FSRS predicts you</h2>
      ${pred.n >= PRED_MIN ? `<table><thead><tr><th>FSRS gave it</th><th>Reviews</th><th>Expected right</th><th>You got right</th></tr></thead><tbody>
        ${pred.groups.map(x => `<tr><td>${x.to >= 1 ? pp(x.from) + ' or more' : pp(x.from) + '–' + pp(x.to)}</td><td class="num">${x.n}</td>
          <td class="num">${pp(x.predicted)}</td><td class="num ${x.n >= 20 && x.actual < x.predicted - 0.1 ? 'st-low' : ''}">${pp(x.actual)}</td></tr>`).join('')}
        <tr><td><b>All</b></td><td class="num"><b>${pred.n}</b></td><td class="num"><b>${pp(pred.predicted)}</b></td><td class="num"><b>${pp(pred.actual)}</b></td></tr>
      </tbody></table>
      <p class="small muted">Each review, FSRS says how likely you are to recall the item. When it knows you well, the
        two columns agree. Far fewer right than expected means it waits too long for you (a higher retention in Settings
        brings reviews sooner); far more, that it could wait longer. Anything but a wrong answer counts as right.</p>`
        : `<p class="empty">This builds up as you review: ${pred.n} of the first ${PRED_MIN} reviews logged so far.</p>`}
      <p class="row"><button class="btn quiet" id="st-revlog">Download the review log</button></p>
      <p class="small muted">A CSV for the <a href="https://github.com/open-spaced-repetition/fsrs-optimizer" target="_blank" rel="noopener">FSRS
        optimizer</a>, which fits FSRS's weights to your own reviews (worth it after a thousand or so). Each item is in it from its
        lesson on; characters marked Known without a lesson are not.</p>
    </section>
    <section class="card">
      <h2 class="caps">The next two weeks</h2>
      <div class="lx-fc">${fc.map((n, i) => `<div><span>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
        : new Date(now + i * Learn.DAY).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>
        <i style="width:${Math.round(100 * n / maxF)}%"></i><b>${n ? '+' + n : ''}</b></div>`).join('')}</div>
    </section>
    ${hardest.length ? `<section class="card">
      <h2 class="caps">Hardest for you</h2>
      <div class="lx-chips">${hardest.map(([k, it, r]) => `<a class="lx-chip" href="${itemHref(k)}">
        <span class="han">${itemHtml(k)}</span><span>${esc(primary(it))} <small class="muted">${Math.round(100 * r)}% right</small></span></a>`).join('')}</div>
    </section>` : ''}`, true);
  stDraw();
  wireItemsCard(document.getElementById('st-items'));
  stReading(d);
  document.getElementById('st-revlog').addEventListener('click', () => {
    const blob = new Blob([Learn.reviewLogCsv(Store.load().items).csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hanzihome-revlog-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  paintRail();
}

/* the statistics page comes alive: numbers count up, cards play in as they scroll into
   view, everything with data-tip gets a tooltip, and the curve a crosshair */
function stDraw() {
  const reduced = Motion.reduced();
  // count up
  app.querySelectorAll('.st-tiles b[data-count]').forEach(b => {
    const to = +b.dataset.count, suf = b.dataset.suffix || '';
    if (reduced || !to) return;
    const t0 = performance.now(), dur = 900 + Math.min(600, to * 8);
    const step = t => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      b.textContent = Math.round(to * e).toLocaleString() + suf;
      if (p < 1 && b.isConnected) requestAnimationFrame(step);
    };
    b.textContent = '0' + suf;
    requestAnimationFrame(step);
  });
  stWire(app);
}

/* cards that play in as they scroll into view, and the tooltip for anything with data-tip */
function stWire(root) {
  const cards = root.matches && root.matches('.st-anim') ? [root] : [...root.querySelectorAll('.st-anim')];
  if (Motion.reduced() || !('IntersectionObserver' in window)) cards.forEach(c => c.classList.add('go'));
  else {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.replace('wait', 'go'); io.unobserve(e.target); }
    }), { threshold: 0.2 });
    cards.forEach(c => { c.classList.add('wait'); io.observe(c); });
  }
  root.querySelectorAll('[data-tip]').forEach(el => {
    const on = () => { const r = el.getBoundingClientRect(); stTip(el.dataset.tip, r.left + r.width / 2, r.top); };
    el.addEventListener('pointerenter', on);
    el.addEventListener('focus', on);
    el.addEventListener('pointerleave', stTipHide);
    el.addEventListener('blur', stTipHide);
  });
  window.addEventListener('hashchange', stTipHide, { once: true });
}
function stTip(html, x, y) {
  let tip = document.querySelector('.st-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'st-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + window.scrollX}px`;
  tip.style.top = `${(y - h - 12 < 8 ? y + 22 : y - h - 12) + window.scrollY}px`;
}
function stTipHide() { const tip = document.querySelector('.st-tip'); if (tip) tip.hidden = true; }

/* a chart's crosshair: the nearest point to the pointer, a line and dot on it, and its tooltip.
   g: W (the viewBox width), L and R (the plot's margins), n (the last index), x(i), y(i), html(i) */
function stCrosshair(svg, g) {
  if (!svg) return;
  const hair = svg.querySelector('.st-hair'), line = hair.querySelector('line'), dot = hair.querySelector('circle');
  const move = e => {
    const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) * g.W / r.width;
    const i = Math.max(0, Math.min(g.n, Math.round((sx - g.L) / (g.W - g.L - g.R) * g.n)));
    const x = g.x(i), y = g.y(i);
    hair.hidden = false;
    line.setAttribute('x1', x); line.setAttribute('x2', x);
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    stTip(g.html(i), r.left + x * r.width / g.W, r.top + y * r.height / svg.viewBox.baseVal.height);
  };
  const hit = svg.querySelector('.st-hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', () => { hair.hidden = true; stTipHide(); });
}

/* an original short passage of everyday Chinese, to show what you can read of it */
const ST_PASSAGE = '今天天气很好，我和朋友一起去公园散步。我们看到很多人在那里跑步、唱歌和跳舞。有一个小孩子在学骑自行车，他的妈妈在后面帮他。大家都很开心。';

/* How much you can read, and Characters you know: they need the character frequencies and the
   HSK lists, so they fill in once those have loaded */
async function stReading(d) {
  await Promise.all([optional(need.charfreq()), optional(need.hskChars())]);
  const read = document.getElementById('st-read'), grow = document.getElementById('st-grow');
  if (!read || !grow) return;                          // gone to another page meanwhile
  const known = Learn.knownChars(d), F = HZ.charfreq || {};
  const pp1 = x => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10) + '%';

  // ---- how much of everyday text your characters cover ----
  if (!HZ.charfreq) read.remove();
  else {
    const ranked = Object.keys(F);                     // most common first
    const cover = [...known].reduce((s, c) => s + (F[c] || 0), 0);
    const unknown = ranked.filter(c => !known.has(c));
    const need = goal => {
      let s = cover, n = 0;
      for (const c of unknown) { if (s >= goal) break; s += F[c]; n++; }
      return s >= goal ? n : null;
    };
    const GOALS = [50, 75, 90];
    const next = unknown.slice(0, 10);
    const rankOf = new Map(ranked.map((c, i) => [c, i + 1]));
    const R = 54, C = 2 * Math.PI * R;
    const tick = g => { const a = 2 * Math.PI * g / 100 - Math.PI / 2; return [60 + 61 * Math.cos(a), 60 + 61 * Math.sin(a), 60 + 47 * Math.cos(a), 60 + 47 * Math.sin(a)]; };
    const han = [...ST_PASSAGE].filter(c => /\p{Script=Han}/u.test(c));
    const canRead = han.filter(c => known.has(c)).length;
    read.removeAttribute('aria-busy');
    read.classList.add('st-anim');
    read.innerHTML = `<div class="st-head"><h2 class="caps">How much you can read</h2><span class="small muted">${known.size.toLocaleString()} character${known.size === 1 ? '' : 's'} known</span></div>
      <div class="st-read-top">
        <div class="st-ring" role="img" aria-label="Your characters make up ${pp1(cover)} of everyday Chinese text">
          <svg viewBox="0 0 120 120"><circle class="st-ring-bg" cx="60" cy="60" r="${R}"/>
            <circle class="st-ring-fg" cx="60" cy="60" r="${R}" style="--c:${C.toFixed(1)};--to:${(C * (1 - cover / 100)).toFixed(1)}"/>
            ${GOALS.map(g => { const [x1, y1, x2, y2] = tick(g); return `<line class="st-ring-t${cover >= g ? ' done' : ''}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`; }).join('')}
          </svg>
          <div class="st-ring-n"><b data-count="${Math.round(cover)}" data-suffix="%">${pp1(cover)}</b><span>of everyday text</span></div>
        </div>
        <div class="st-read-txt">
          <p>Of every 100 characters in everyday Chinese, about <b>${Math.round(cover)}</b> ${Math.round(cover) === 1 ? 'is one' : 'are ones'} you know.
            The most common characters do most of the work, so each early one counts for a lot.</p>
          <ul class="st-goals">${GOALS.map(g => {
            const n = cover >= g ? 0 : need(g);
            return `<li class="${cover >= g ? 'done' : ''}"><b>${g}%</b><span>${cover >= g ? 'Reached' : n == null ? 'Out of reach of this list'
              : `${n.toLocaleString()} more of the most common characters`}</span></li>`;
          }).join('')}</ul>
        </div>
      </div>
      <h3 class="st-sub">Biggest jumps next</h3>
      <div class="st-next">${next.map(c => `<a class="st-next-c" href="#/character/${encodeURIComponent(c)}"
        data-tip="${esc(`<b class="han">${esc(c)}</b><span>The ${ordinal(rankOf.get(c))} most common character</span><span>${pp1(F[c])} of everyday text</span>`)}">
        <span class="han">${zh(c)}</span><small>+${pp1(F[c])}</small></a>`).join('')}</div>
      <h3 class="st-sub">What you can read of this</h3>
      <p class="st-passage" aria-label="${canRead} of ${han.length} characters known">${[...ST_PASSAGE].map(c => /\p{Script=Han}/u.test(c)
        ? `<span class="${known.has(c) ? 'k' : 'u'}">${esc(c)}</span>` : `<span class="p">${esc(c)}</span>`).join('')}</p>
      <p class="small muted">You know <b>${canRead}</b> of its ${han.length} characters; the ones you don't are dimmed.</p>`;
    stWire(read);
    stCountUp(read);
  }

  // ---- characters you know, over time, against the size of each HSK level ----
  const at = new Map();
  const note = (c, when) => { if (when && (!at.has(c) || at.get(c) > when)) at.set(c, when); };
  for (const [k, it] of Object.entries(d.items)) {
    if (!(it.stage >= 1)) continue;
    const when = it.learnt || it.joined || it.added;
    if ((it.kind || 'char') === 'char') note(k, when);
    else if (it.kind === 'word') for (const c of k) if (known.has(c)) note(c, when);
  }
  const undated = [...known].filter(c => !at.has(c)).length;      // marked known: there from the start
  const DAY = Learn.DAY, day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const today = day0.getTime();
  const first = at.size ? Math.min(...at.values()) : today;
  const start = Math.min(new Date(first).setHours(0, 0, 0, 0), today - 13 * DAY);
  const past = Math.round((today - start) / DAY);
  const times = [...at.values()].sort((a, b) => a - b);
  const countBy = end => { let n = 0; while (n < times.length && times[n] < end) n++; return n; };
  const actual = Array.from({ length: past + 1 }, (_, i) => undated + countBy(start + (i + 1) * DAY));
  const cur = actual[past];
  const since = Math.max(7, Math.min(30, Math.ceil((Date.now() - first) / DAY)));
  const pace = times.filter(x => x >= Date.now() - since * DAY).length / since;    // characters a day lately
  // HSK levels by size: how many characters up to and including each
  const sizes = [];
  if (HZ.hskChars) {
    const seen = new Set();
    Object.keys(HZ.hskChars).sort((a, b) => a - b).forEach(l => { HZ.hskChars[l].forEach(c => seen.add(c)); sizes.push([+l, seen.size]); });
  }
  const goal = sizes.find(([, n]) => n > cur);
  const ahead = goal && pace > 0 ? Math.min(365, Math.ceil((goal[1] - cur) / pace)) : 0;
  const n = past + Math.max(ahead, pace > 0 ? 7 : 0);
  const proj = i => i <= past ? actual[i] : Math.round(cur + pace * (i - past));
  const top = Math.max(proj(n), goal ? goal[1] : cur, 10) * 1.1;
  const W = 640, H = 240, L = 44, Rm = 14, T = 16, B = 28;
  const x = i => L + (W - L - Rm) * i / Math.max(1, n), y = v => T + (H - T - B) * (1 - v / top);
  const dateOf = i => new Date(start + i * DAY);
  const fmt = (i, o = { day: 'numeric', month: 'short' }) => dateOf(i).toLocaleDateString(undefined, o);
  const line = actual.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  // dates: the start, today, the end, and a couple between where there's room
  const ticks = [];
  for (const v of [past, n, 0, Math.round(n / 3), Math.round(2 * n / 3)]) if (ticks.every(w => Math.abs(w - v) > n / 7)) ticks.push(v);
  // counts: a round step (1, 2 or 5 times a power of ten), about four of them
  const raw = top / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), stepY = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw);
  const yTicks = Array.from({ length: Math.floor(top / stepY) + 1 }, (_, i) => i * stepY);
  const goalDate = goal && ahead ? fmt(past + ahead, { day: 'numeric', month: 'long', year: past + ahead > 300 ? 'numeric' : undefined }) : '';
  grow.removeAttribute('aria-busy');
  grow.classList.add('st-anim');
  grow.innerHTML = `<div class="st-head"><h2 class="caps">Characters you know</h2><span class="small muted">${pace > 0
      ? `About ${pace >= 1 ? Math.round(pace * 10) / 10 : (Math.round(pace * 70) / 10)} a ${pace >= 1 ? 'day' : 'week'} lately` : 'None new lately'}</span></div>
    <div class="st-curve st-growc">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${cur} characters known${goalDate ? `; at this pace ${goal[1]}, as many as HSK 1${goal[0] > 1 ? `–${goal[0]}` : ''}, by ${goalDate}` : ''}">
        <defs><linearGradient id="st-grow-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--green)" stop-opacity=".3"/><stop offset="1" stop-color="var(--green)" stop-opacity="0"/></linearGradient></defs>
        ${yTicks.map(v => `<line class="st-grid" x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}"/><text class="st-ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString()}</text>`).join('')}
        ${sizes.filter(([, s]) => s <= top).map(([l, s]) => `<line class="st-hsk" x1="${L}" x2="${W - Rm}" y1="${y(s)}" y2="${y(s)}"/>
          <text class="st-hsk-t" x="${L + 6}" y="${y(s) - 6}">HSK ${l > 1 ? `1–${+l === 7 ? 9 : l}` : '1'} · ${s.toLocaleString()}</text>`).join('')}
        ${ticks.map(i => `<text class="st-ax" x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}">${i === past ? 'Today' : fmt(i)}</text>`).join('')}
        <path class="st-grow-a" d="${line} L${x(past)} ${y(0)} L${x(0)} ${y(0)} Z" fill="url(#st-grow-fill)"/>
        <path class="st-grow-l" d="${line}" pathLength="1"/>
        ${n > past ? `<path class="st-grow-p" d="M${x(past)} ${y(cur)} L${x(n)} ${y(proj(n))}"/>` : ''}
        <circle class="st-grow-now" cx="${x(past)}" cy="${y(cur)}" r="5"/>
        ${goalDate ? `<circle class="st-grow-goal" cx="${x(past + ahead)}" cy="${y(goal[1])}" r="5"/>` : ''}
        <g class="st-hair" hidden><line y1="${T}" y2="${H - B}"/><circle r="5"/></g>
        <rect class="st-hit" x="${L}" y="0" width="${W - L - Rm}" height="${H}"/>
      </svg></div>
    <p class="small muted">${goalDate ? `At this pace you'd know <b>${goal[1].toLocaleString()}</b> characters, as many as HSK 1${goal[0] > 1 ? `–${goal[0]}` : ''},
      by <b>${goalDate}</b>.` : goal ? 'Learn some new characters to see when you would reach the next HSK level.' : 'You know as many characters as all of HSK 1–6.'}
      The dashed lines are the size of each HSK level; the dotted one is your pace carried on.</p>`;
  stCrosshair(grow.querySelector('svg'), { W, L, R: Rm, n, x, y: i => y(proj(i)),
    html: i => `<b>${i === past ? 'Today' : fmt(i, { weekday: 'short', day: 'numeric', month: 'short' })}</b>${i <= past
      ? `<span>${proj(i).toLocaleString()} characters known</span>` : `<span>About ${proj(i).toLocaleString()} at this pace</span>`}` });
  stWire(grow);
}

/* numbers that count up to their value */
function stCountUp(root) {
  if (Motion.reduced()) return;
  root.querySelectorAll('b[data-count]').forEach(b => {
    const to = +b.dataset.count, suf = b.dataset.suffix || '', end = b.textContent;
    if (!to) return;
    const t0 = performance.now(), dur = 900 + Math.min(600, to * 8);
    const step = t => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      b.textContent = p < 1 ? Math.round(to * e).toLocaleString() + suf : end;
      if (p < 1 && b.isConnected) requestAnimationFrame(step);
    };
    b.textContent = '0' + suf;
    requestAnimationFrame(step);
  });
}

/* L starts the lessons and R the reviews, from Today, when the tile has something to
   start (not while typing, with a dialog up, or with the menu open) */
document.addEventListener('keydown', e => {
  const k = e.key && e.key.toLowerCase();
  if ((k !== 'l' && k !== 'r') || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (typeof currentPath !== 'function' || currentPath() !== '/study') return;
  const t = e.target;
  if (t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog[open]')) return;
  if (document.querySelector('dialog[open]') || document.body.classList.contains('nav-open')) return;
  const tile = document.querySelector(`.lx-tile.${k === 'l' ? 'lessons' : 'reviews'}:not(.idle)`);
  if (!tile) return;
  e.preventDefault();
  location.hash = tile.getAttribute('href');
});
