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

const kindName = it => ({ word: 'Word', comp: 'Component', sound: 'Sound' })[it.kind] || 'Character';

/* what Store.plan() needs to know about characters, for unlocking: how far along each
   is (its item's stage, or 5 when marked learned, 1 when marked learning), and a
   character's components (kept on its item once looked up) */
function learnEnv() {
  const d = Store.load();
  const level = c => {
    if (!HZ.index[c]) return null;                    // not a character to wait for
    const it = d.items[c], st = d.status[c];
    return Math.max(it ? it.stage : 0, st === 'learned' ? Learn.LEARNED_FROM : st === 'learning' ? 1 : 0);
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
   a place, a room). Each part not known yet gets a short lesson of its own just
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
  if (k.startsWith('i:')) return (k.slice(2) || 'Ø') + '-';
  if (k.startsWith('f:')) return '-' + finalText(k.slice(2));
  if (k.startsWith('t:')) return k.slice(2) === '5' ? '·' : k.slice(2);
  return k;
}
const itemHtml = k => partKind(k) === 'sound' ? `<span class="snd-key">${esc(itemText(k))}</span>` : zh(glyphOf(k));
/* where an item's own page is */
function itemHref(k) {
  const it = Store.item(k);
  if (partKind(k) === 'sound') return '#/study';
  if (it && it.kind === 'word') return '#/word/' + encodeURIComponent(k);
  return '#/character/' + encodeURIComponent(glyphOf(k));
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
  say(text, force) {
    const cfg = Store.cfg();
    if ((cfg.muteVoice && !force) || !window.speechSynthesis || !text || partKind(text)) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = this.voice();
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'zh-CN';
    u.rate = { slow: 0.7, normal: 1, fast: 1.3 }[cfg.speed] || 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  },
};
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
    optional(it.kind === 'word' ? need.winfo() : need.cmnem())]);
  if (it.kind === 'word') {
    f.mn = builtinMnemonic(k);
    if (HZ.winfo && HZ.winfo[k]) f.ex = HZ.winfo[k][2];
    f.parts = [...k].filter(isHan).map(c => [c, partGloss(c)]);
  } else if (it.kind === 'char') {
    f.mn = builtinMnemonic(k);
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
  : it.kind === 'sound' ? { sounds: [[itemText(k), it.mean]] } : { comps: f.comps || [], sounds: f.sounds || [] };

/* the coloured band at the top: the item, and optionally its reading and meaning */
function band(k, it, show) {
  return `<div class="lx-band ${it.kind}">
    ${show ? `<div class="lx-pin">${esc(it.pin)}</div>` : '<div class="lx-pin">&nbsp;</div>'}
    <div class="lx-glyph han">${itemHtml(k)}</div>
    ${show ? `<div class="lx-mean">${esc((it.mean || '').split(';')[0])}</div>` : ''}
    <span class="lx-kind">${kindName(it)}</span>
  </div>`;
}

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
  const p = el.closest('p');
  if (!p) return '';
  const parts = p.textContent.split(/(?<=[。！？!?；…])/);
  const hit = parts.find(x => x.includes(w)) || p.textContent;
  return hit.trim().slice(0, 160);
}

// --------------------------------------------------------------------- Anki

const needAnki = () => Promise.all([
  loadScript('zip.js'),
  loadScript('anki.js'),
  window.fzstd ? null : loadScript('vendor/fzstd.js'),
  need.textStory(),                                // learnKey's traditional → simplified, the words' readings
]);

function wireAnki(redraw) {
  const exp = document.getElementById('anki-export'), file = document.getElementById('anki-file');
  if (!exp || !file) return;
  exp.addEventListener('click', async () => {
    await needAnki();
    const blob = new Blob([Anki.exportText(Store.load().items)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hanzihome-anki-${today()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  file.addEventListener('change', async () => {
    const box = document.getElementById('anki-import');
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    box.innerHTML = '<p class="small muted">Reading the deck…</p>';
    try {
      await needAnki();
      const deck = await Anki.read(f);
      if (!deck.notes.length) throw new Error('That deck has no notes in it.');
      ankiPreview(box, f.name, deck, Anki.guess(deck.names, deck.notes), redraw);
    } catch (e) {
      box.innerHTML = `<p class="small sync-err">${esc(e.message || String(e))}</p>`;
    }
  });
}

/* what an imported note becomes: the dictionary's pinyin and meanings where it has
   the character or word (so answers are checked the usual way), the deck's meaning
   first when it has one */
function ankiInfo(x) {
  let info;
  if (x.kind === 'char') info = charInfo(x.k);
  else {
    const e = HZ.rwords && HZ.rwords[x.k], rs = (e && e[2]) || [];
    info = { pin: rs[0] ? rs[0][0] : '', mean: rs[0] ? rs[0][1] : '', alts: rs.map(r => r[1]) };
  }
  if (!info.pin) info.pin = Anki.marks(x.pin);
  if (x.mean) {
    info.alts = [...new Set([info.mean].concat(info.alts || []).filter(Boolean))];
    info.mean = x.mean.length > 80 ? x.mean.slice(0, 79) + '…' : x.mean;
  }
  return info;
}

function ankiPreview(box, name, deck, cols, redraw) {
  const d = Store.load();
  const list = cols.hanzi >= 0 ? Anki.items(deck.notes, cols) : [];
  const fresh = list.filter(x => !d.items[x.k]);
  const label = i => esc(deck.names[i] || `Field ${i + 1}`) + (deck.notes[0] && deck.notes[0].fields[i]
    ? ` (${esc(deck.notes[0].fields[i].slice(0, 18))})` : '');
  const pick = (id, at, none) => `<select class="st-select" data-col="${id}">${none ? `<option value="-1">${none}</option>` : ''}${
    Array.from({ length: cols.fields }, (_, i) => `<option value="${i}"${i === at ? ' selected' : ''}>${label(i)}</option>`).join('')}</select>`;
  box.innerHTML = `<div class="anki-prev">
    <p class="small"><b>${esc(name)}</b>: ${deck.notes.length} notes, ${list.length} with Chinese in them,
      <b>${fresh.length} new</b> to HanziHome${list.length - fresh.length ? `, ${list.length - fresh.length} already here` : ''}.</p>
    <div class="anki-cols">
      <label>Hanzi ${pick('hanzi', cols.hanzi)}</label>
      <label>Pinyin ${pick('pinyin', cols.pinyin, 'none (from the dictionary)')}</label>
      <label>Meaning ${pick('meaning', cols.meaning, 'none (from the dictionary)')}</label>
    </div>
    ${list.length ? `<table class="anki-table"><tbody>${list.slice(0, 6).map(x => `<tr>
      <td class="han">${zhOne(x.k)}</td><td>${esc(x.pin)}</td><td class="muted">${esc(x.mean.slice(0, 60))}</td></tr>`).join('')}
      </tbody></table>` : '<p class="small sync-err">No field holds just Chinese characters: choose the hanzi field above.</p>'}
    ${fresh.length ? `<div class="row">
      <button class="btn" id="anki-lessons">Add ${fresh.length} to lessons</button>
      <button class="btn quiet" id="anki-known">I know these: add ${fresh.length} to reviews</button></div>
      <p class="small muted">To lessons: each is taught before it's reviewed, within your daily limits. Known: they join the
        reviews at Journeyman, the first ones spread over the next month (20 a day at most), and a calibration test can
        sort them.</p>` : ''}
  </div>`;
  box.querySelectorAll('[data-col]').forEach(sel => sel.addEventListener('change', () => {
    ankiPreview(box, name, deck, Object.assign({}, cols, { [sel.dataset.col]: +sel.value }), redraw);
  }));
  const before = Object.keys(d.items).length;
  const done = n => {
    Store.save(); redraw();
    const more = Object.keys(Store.load().items).length - before - n;   // characters a word brought along
    document.getElementById('anki-import').innerHTML = `<p class="small">Added ${n} from ${esc(name)}${more > 0
      ? `, and ${more} character${more === 1 ? '' : 's'} in those words, ahead of them` : ''}.</p>`;
  };
  const lessons = document.getElementById('anki-lessons');
  if (lessons) lessons.addEventListener('click', () => {
    for (const x of fresh) Store.learnAdd(x.k, x.kind, ankiInfo(x));
    done(fresh.length);
  });
  const known = document.getElementById('anki-known');
  if (known) known.addEventListener('click', () => {
    const now = Date.now(), span = Math.max(30, Math.ceil(fresh.length / 20)) * Learn.DAY;
    fresh.forEach((x, i) => {
      d.items[x.k] = Learn.known(x.kind, ankiInfo(x), now, Math.round(span * i / fresh.length));
      if (x.kind === 'char') d.status[x.k] = 'learned';
    });
    done(fresh.length);
  });
}

// ---------------------------------------------------------------------- hub

function pageStudy() {
  drawStudy();
  // with character unlocking on, components still to look up may lock a lesson or two
  fillParts().then(changed => { if (changed && currentPath() === '/study') drawStudy(); });
}

function drawStudy() {
  const d = Store.load(), cfg = Store.cfg(), items = Object.entries(d.items), now = Date.now();
  const p = Store.plan(), mistakes = recentMistakes(), unsorted = calibrationSets().unsorted.length;
  const fc = Learn.forecast(items.map(e => e[1]), now, 7);
  const max = Math.max(1, ...fc);
  const dayName = i => i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
    : new Date(now + i * Learn.DAY).toLocaleDateString(undefined, { weekday: 'long' });
  const groups = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
  const inGroup = g => items.filter(([, it]) => Learn.group(it.stage) === g).length;

  // the tiles: what you can start now, and why not when it's nothing
  const nLocked = Object.keys(p.locked).length;
  const lessonNote = p.vacation ? 'On vacation' : p.lessons.length || !p.waiting.length ? ''
    : nLocked === p.waiting.length ? 'Waiting to unlock' : 'Today\'s limit reached';
  const overLimit = !p.vacation && p.due.length && !p.reviewsLeft;
  const reviewNote = p.vacation ? 'On vacation' : overLimit ? `Today's limit reached · ${p.due.length} due` : '';
  const tile = (cls, name, n, note) => `<a class="lx-tile ${cls}${n ? '' : ' idle'}" href="#/${cls}">
    <b>${name}</b><span>${n}</span>${note ? `<em>${esc(note)}</em>` : ''}</a>`;
  const of = (n, lim) => lim ? `${n} of ${lim}` : String(n);

  // what locked lessons wait for that isn't in your lessons yet
  const missing = [...new Set([].concat(...Object.values(p.locked)))].filter(c => HZ.index[c] && !d.items[c]);
  const why = k => {
    const it = d.items[k];
    if (p.locked[k]) {
      const need = it.kind === 'word' ? cfg.wordUnlock : cfg.charUnlock;
      return `Waits for ${p.locked[k].join(' ')} to be ${need}`;
    }
    return (p.lessons.includes(k) ? 'Ready now' : 'Waiting for another day')
      + (it.ex && it.ex.text ? ' · Found in: ' + it.ex.text : '');
  };

  app.innerHTML = '<h1 class="page-title">Study</h1>' + withRail(`
    ${p.vacation ? `<section class="card lx-vac">
      <h2>On vacation</h2>
      <p class="muted">Since ${esc(new Date(cfg.vacation).toLocaleDateString())}. Lessons and reviews wait until
        you're back; then every review is moved on by the time you were away.</p>
      <p><button class="btn" id="lx-back">I'm back</button></p></section>` : ''}
    <div class="lx-hub">
      ${tile('lessons', 'Lessons', p.lessons.length, lessonNote)}
      ${tile('reviews', 'Reviews', p.reviewsLeft, reviewNote)}
    </div>
    ${mistakes.length && !p.vacation ? `<p class="lx-extra"><span class="small muted">Extra study:</span>
      <button class="btn quiet" id="lx-mistakes" title="Missed in the last three days. Practice doesn't change when they come back.">Recent mistakes (${mistakes.length})</button></p>` : ''}
    <p class="small muted lx-today">Today: ${of(p.lessonsToday, cfg.lessonLimit)} lessons
      (${of(p.wordsToday, cfg.lessonLimit && Math.min(cfg.wordLimit, cfg.lessonLimit))} words) ·
      ${of(p.reviewsToday, cfg.reviewLimit)} reviews · <a href="#/settings">Settings</a></p>
    ${unsorted ? `<section class="card cb-cta">
      <h2>Sort your learned characters</h2>
      <p class="muted">${unsorted} character${unsorted === 1 ? '' : 's'} you marked as learned joined your reviews at
        Journeyman without being checked. A calibration test (type each one's pronunciation and meaning) puts each where it belongs.</p>
      <p><a class="btn" href="#/calibrate">Calibration test</a></p></section>` : ''}
    <section class="card">
      <h2 class="caps">Upcoming reviews</h2>
      <div class="lx-fc">${fc.map((n, i) => `<div><span>${dayName(i)}</span>
        <i style="width:${Math.round(100 * n / max)}%"></i><b>${n ? '+' + n : ''}</b></div>`).join('')}</div>
    </section>
    <section class="card">
      <h2 class="caps">Lesson queue (${p.waiting.length})</h2>
      ${p.waiting.length ? `<div class="lx-queue">${p.waiting.map(k => {
        const it = d.items[k];
        return `<span class="lx-q ${it.kind}${it.prio ? ' prio' : ''}${p.locked[k] ? ' locked' : ''}" title="${esc(why(k))}">
          <button data-prio="${esc(k)}" class="lx-star" aria-label="${it.prio ? 'Stop prioritizing' : 'Prioritize'} ${esc(k)}"
            title="${it.prio ? 'Prioritized' : 'Prioritize'}">${it.prio ? '★' : '☆'}</button>
          <a class="han" href="${itemHref(k)}">${p.locked[k] ? '🔒' : ''}${itemHtml(k)}</a>
          <button data-rm="${esc(k)}" aria-label="Remove ${esc(k)}">×</button></span>`;
      }).join('')}</div>
      <p class="small muted">In the order they come: ☆ puts one at the front. 🔒 waits to unlock
        (hover to see for what).</p>
      ${missing.length ? `<p class="small">Some locked lessons wait for characters that aren't in your lessons:
        <button class="btn quiet" id="lx-addmissing">＋ Add ${esc(missing.join(' '))}</button></p>` : ''}`
      : `<p class="empty small">Nothing yet. Use <b>Add to lessons</b> on a character's page,
        or in the reader when you point at a word.</p>`}
    </section>
    <section class="card">
      <h2 class="caps">Stages</h2>
      <div class="lx-stages">${groups.map(g =>
        `<div class="${g.toLowerCase()}"><b>${inGroup(g)}</b><span>${g}</span></div>`).join('')}</div>
      <p class="small muted">Reviews are scheduled by FSRS, which keeps each item's difficulty and
        stability (how many days until your chance of recalling it falls to 90%) and brings it back
        when that chance falls to ${Math.round(cfg.retention * 100)}%. Each review is rated from your
        answers: wrong is <i>again</i>, a slip of tone or a long think <i>hard</i>, right <i>good</i>,
        right straight away <i>easy</i>. The stages are bands of stability: Novice under 4 days,
        Apprentice from a week, Journeyman from a month (learned, on the rest of the site), Expert from
        4 months, Master from 2 years. Characters you mark learned join at Journeyman; a
        <a href="#/calibrate">calibration test</a> re-sorts them by how well you really know them.</p>
    </section>
    <section class="card" id="anki-card">
      <h2 class="caps">Anki</h2>
      <p class="small muted">Take your lessons and reviews to Anki, or bring an Anki deck here.</p>
      <div class="row">
        <button class="btn quiet" id="anki-export"${items.length ? '' : ' disabled'}>Export for Anki</button>
        <label class="btn quiet anki-pick">Import a deck…<input type="file" id="anki-file"
          accept=".apkg,.colpkg,.txt,.tsv,.csv" hidden></label>
      </div>
      <div id="anki-import"></div>
    </section>`, true);
  const redraw = () => { drawStudy(); markNav(currentPath()); };
  app.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { Store.learnRemove(b.dataset.rm); redraw(); }));
  app.querySelectorAll('[data-prio]').forEach(b => b.addEventListener('click', () => { Store.prioritize(b.dataset.prio); redraw(); }));
  const mis = document.getElementById('lx-mistakes');
  if (mis) mis.addEventListener('click', () => startPractice(mistakes));
  const back = document.getElementById('lx-back');
  if (back) back.addEventListener('click', () => { Store.vacation(false); redraw(); });
  wireAnki(redraw);
  const add = document.getElementById('lx-addmissing');
  if (add) add.addEventListener('click', () => {
    for (const c of missing) { Store.learnAdd(c, 'char', charInfo(c)).prio = true; }
    Store.save();
    redraw();
  });
  paintRail();
}

// ------------------------------------------------------------------ lessons

async function pageLessons() {
  if (!lessonState) {
    await fillParts();
    const cfg = Store.cfg(), p = Store.plan();
    const batch = p.lessons.slice(0, cfg.batch);
    // a batch that ends in parts goes on to what they are parts of (a few more at most)
    const d = Store.load();
    while (batch.length < p.lessons.length && batch.length < cfg.batch + 4) {
      const nx = p.lessons[batch.length];
      if (!Learn.partsOf(nx, d.items[nx]).some(x => batch.includes(x))) break;
      batch.push(nx);
    }
    if (!batch.length) {
      const nLocked = Object.keys(p.locked).length;
      const why = p.vacation ? '<p class="empty">Lessons are paused while you\'re on vacation.</p>'
        : !p.waiting.length ? `<p class="empty">No lessons waiting.</p>
          <p class="small muted">Add characters and words with <b>Add to lessons</b> on a character's page
            or in the reader's word popup.</p>`
        : nLocked === p.waiting.length ? `<p class="empty">Your ${p.waiting.length} lesson${p.waiting.length === 1 ? ' is' : 's are'}
            waiting to unlock.</p><p class="small muted">Words wait for their characters, as set in Settings;
            the Study page shows what each one waits for.</p>`
        : `<p class="empty">That's today's lessons done.</p><p class="small muted">Your daily limit is
            ${cfg.lessonLimit} (${Math.min(cfg.wordLimit, cfg.lessonLimit)} of them words); ${p.waiting.length - nLocked}
            more are ready for tomorrow.</p>`;
      app.innerHTML = '<h1 class="page-title">Lessons</h1>' + withRail(`<div class="card">
        ${why}
        <p><a class="btn" href="#/study">Back to study</a></p></div>`, true);
      paintRail();
      return;
    }
    lessonState = { batch, i: 0, tab: 0, done: [], intro: [] };
  }
  const s = lessonState;
  if (s.i >= s.batch.length) return lessonsDone();
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
  const ctx = mnCtx(k, it, f);
  const chips = (xs, cls) => `<div class="lx-chips ${cls || ''}">${xs.map(([c, g, key]) => cls === 'snd'
    ? `<span class="lx-chip snd-chip"><span class="snd-key">${esc(c)}</span><span>${esc(g)}</span></span>` : lxChip(c, g)).join('')}</div>`;

  let body = '';
  if (s.tab === 0) {
    body = it.kind === 'word'
      ? `<h3>Characters</h3><p class="muted">This word is made of these characters. Can you see how they
          make its meaning and its sound?</p>${chips(f.parts)}`
      : `<h3>Component composition</h3><p class="muted">This character is made of these components. Can you see where they are?</p>
         ${f.comps.length ? chips(f.comps, 'comp') : '<p class="muted small">It has no components with a name of their own.</p>'}
         ${f.sounds.length ? `<h3>Sound composition</h3><p class="muted">Its pronunciation, <b>${esc(it.pin)}</b>, is these three
           sounds: a person, a place and a room. Can you hear how they make the syllable?</p>${chips(f.sounds, 'snd')}` : ''}
         ${f.sound ? `<p class="muted small"><span class="han">${esc(f.sound[0])}</span> ${esc(f.sound[1])} also hints at the sound.</p>` : ''}`;
  } else if (s.tab === 1) {
    const scaffold = it.kind === 'word' ? f.parts.map(([c, g]) => `<b class="han">${esc(c)}</b> ${esc(g)}`).join(' + ')
      : it.kind === 'char' ? f.comps.map(([c, g]) => `<b class="han">${esc(c)}</b> ${esc(g || '?')}`).join(' + ')
      : it.kind === 'comp' ? f.subs.map(([c, g]) => `<b class="han">${esc(c)}</b> ${esc(g)}`).join(' + ') : '';
    body = `<h3>Mnemonic</h3>
      ${scaffold || it.kind === 'char' ? `<p class="muted">${scaffold ? scaffold + ' → ' : ''}<b class="han">${esc(itemText(k))}</b> ${esc(primary(it))}
        ${it.pin ? `· sounds <b>${esc(it.pin)}</b>` : ''}</p>` : ''}
      ${f.mn ? `<div class="mn lx-mn-builtin">${mnHtml(f.mn, ctx)}</div>
        <p class="small muted">Picture it for a moment. Or write a story of your own, which is shown instead:</p>` : ''}
      <textarea id="lx-mn" rows="${f.mn ? 2 : 4}" placeholder="${f.mn ? 'Your own mnemonic (optional)…' : 'Make up a little story that joins the parts, the meaning and the sound…'}">${esc(it.mnemonic || '')}</textarea>
      <p class="small muted" id="lx-mn-state">Saved as you type.</p>
      <h3>${part ? 'Name' : 'Meaning'}</h3>
      <dl class="lx-dl"><dt>Primary</dt><dd><b>${esc(primary(it))}</b></dd>
        <dt>Alternatives</dt><dd>${others(it).length ? esc(others(it).join(', ')) : '<span class="muted">none</span>'}</dd></dl>
      ${part ? '' : `<h3>Pronunciation</h3>
      <dl class="lx-dl"><dt>Primary</dt><dd><b>${esc(numbered(it.pin))}</b> · ${esc(it.pin)}
        ${Sound.voices().length ? '<button type="button" class="btn quiet lx-say" id="lx-say">▶ Hear it</button>' : ''}</dd></dl>`}`;
  } else if (s.tab === 2) {
    body = `<h3>Examples</h3>
      ${it.kind === 'comp' ? `<p class="muted">Characters with this component. Can you see where it is in each of them?</p>${chips(f.words)}`
      : it.kind === 'sound' ? `<p class="muted">Common characters with this sound:</p>${chips(f.words)}`
      : `${it.ex && it.ex.text ? `<p class="muted">Where you found it:</p>${foundIn(k, it)}` : ''}
      ${f.ex.length ? `<p class="muted">How it is used:</p>${f.ex.map(ex => `<div class="example">${exampleHtml(ex, k)}</div>`).join('')}
        ${HZ.winfo[k][3] ? `<p class="word-use"><b>Good to know:</b> ${esc(HZ.winfo[k][3])}</p>` : ''}` : ''}
      ${f.words.length ? `<p class="muted">Words it is in:</p>
        <div class="lx-chips">${f.words.map(([w, p]) => lxChip(w, p, '#/word/' + encodeURIComponent(w))).join('')}</div>` : ''}
      ${!(it.ex && it.ex.text) && !f.words.length && !f.ex.length ? '<p class="muted">No examples yet.</p>' : ''}
      ${it.kind === 'word' ? `<p><a class="small" href="#/word/${encodeURIComponent(k)}" target="_blank">The word's card →</a></p>` : ''}`}`;
  } else {
    // the pronunciation first; the meaning only once that is right (a part: its name only)
    if (part && s.pinOk !== k) { s.pinOk = k; s.pinAnswer = ''; }
    const pinDone = s.pinOk === k;
    body = `<h3>Confirmation</h3>
      <p class="muted">${part ? `Its <b>name</b>?` : pinDone ? 'Right. Now its <b>meaning</b>.'
        : 'First its <b>pronunciation</b>, with tone numbers (like pin1yin1). Its meaning comes after.'}</p>
      <form id="lx-quiz" autocomplete="off">
        ${part ? '' : `<input id="lx-pin" class="lx-input${pinDone ? ' ok' : ''}" placeholder="Pronunciation…" spellcheck="false"
          autocapitalize="off" lang="en"${pinDone ? ` value="${esc(s.pinAnswer)}" readonly` : ''}>`}
        ${pinDone ? `<input id="lx-mean" class="lx-input" placeholder="${part ? 'Name…' : 'Meaning…'}" spellcheck="false" autocapitalize="off" lang="en">` : ''}
        <div id="lx-verdict"></div>
        <button class="btn" type="submit">Check</button>
      </form>`;
  }

  app.innerHTML = band(k, it, !quiz) + `
    <nav class="lx-tabs">${tabs.map((t, i) => i < first ? '' : `<button data-t="${i}" class="${i === s.tab ? 'on' : ''}">${t}</button>`).join('')}</nav>
    <div class="lx-body">
      <button class="lx-arrow prev" ${s.tab === first ? 'disabled' : ''} aria-label="Back">‹</button>
      <div class="lx-main">${body}</div>
      <button class="lx-arrow next" ${quiz ? 'disabled' : ''} aria-label="Next">›</button>
    </div>
    ${batchStrip(s)}`;

  const go2 = t => { s.tab = Math.max(first, Math.min(3, t)); pageLessons(); };
  app.querySelectorAll('.lx-tabs button').forEach(b => b.addEventListener('click', () => go2(+b.dataset.t)));
  app.querySelector('.lx-arrow.prev').addEventListener('click', () => go2(s.tab - 1));
  app.querySelector('.lx-arrow.next').addEventListener('click', () => go2(s.tab + 1));

  // read the item aloud once, when its lesson opens
  if (s.said !== k) { s.said = k; Sound.say(k); }
  const say = document.getElementById('lx-say');
  if (say) say.addEventListener('click', () => Sound.say(k, true));

  const mn = document.getElementById('lx-mn');
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
    (document.getElementById('lx-mean') || document.getElementById('lx-pin')).focus();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const verdict = document.getElementById('lx-verdict');
      if (s.pinOk !== k) {
        const pa = document.getElementById('lx-pin').value;
        if (!pa.trim()) return;
        if (Learn.checkPinyin(pa, it.pin)) {
          Sound.ding();
          Sound.say(k);
          s.pinOk = k;
          s.pinAnswer = pa;
          return pageLessons();
        }
        s.missed = (s.missed || 0) + 1;
        verdict.innerHTML = `<p class="lx-wrong">It is <b>${esc(numbered(it.pin))}</b> (${esc(it.pin)}). Try again.</p>`;
        return;
      }
      const ma = document.getElementById('lx-mean').value;
      if (!ma.trim()) return;
      if (Learn.checkMeaning(ma, it)) {
        Sound.ding();
        // the quiz is the item's first rating for FSRS: right first time is good, one
        // miss hard, more again
        const g = !s.missed ? 3 : s.missed === 1 ? 2 : 1;
        Learn.finishLesson(Store.item(k) || it, Date.now(), g, { retention: Store.cfg().retention, rnd: Math.random });
        s.missed = 0;
        Store.learnSaved(k);
        s.done.push(k);
        s.i++; s.tab = 0; s.pinOk = null;           // (a part's lesson moves on to its first tab)
        markNav(currentPath());
        return pageLessons();
      }
      s.missed = (s.missed || 0) + 1;
      verdict.innerHTML = `<p class="lx-wrong">It means <b>${esc(primary(it))}</b>. Try again.</p>`;
    });
  }
  paintRail();
}

/* the batch, under the lesson: each item, the one open, the ones done */
function batchStrip(s, goal) {
  return `<div class="lx-batch">${s.batch.map((b, i) => `<span class="${Store.item(b) ? Store.item(b).kind : ''}
    ${i === s.i ? 'on' : ''} ${b === goal ? 'goal' : ''} ${s.done.includes(b) ? 'done' : ''}">${esc(itemText(b))}</span>`).join('')}</div>`;
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
  app.innerHTML = band(goal, g, true) + `
    <nav class="lx-tabs"><button class="on">Learn this ${g.kind === 'word' ? 'word' : 'character'}?</button></nav>
    <div class="lx-body"><div class="lx-main lx-intro">
      <h3>Prerequisites</h3>
      <p class="muted">${g.kind === 'word' ? 'These are the characters this word is made of.'
        : 'These are the components and sounds this character is made of.'}
        ${fresh.length ? `The ones you haven't learned yet come first, each with a short lesson, then ${zh(goal)} itself.`
          : `You know them all: straight on to ${zh(goal)}.`}</p>
      ${comps.length ? `<div class="lx-chips intro-parts">${comps.map(chip).join('')}</div>` : ''}
      ${sounds.length ? `<div class="lx-chips intro-parts">${sounds.map(chip).join('')}</div>` : ''}
      <p class="row intro-go"><button class="btn quiet" id="lx-intro-skip">⏭ Skip</button>
        <button class="btn" id="lx-intro-go">Learn</button></p>
    </div></div>
    ${batchStrip(s, goal)}`;
  const go = document.getElementById('lx-intro-go');
  go.focus();
  go.addEventListener('click', () => { s.intro.push(goal); pageLessons(); });
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

function lessonsDone() {
  const s = lessonState, more = Store.plan().lessons.length;
  lessonState = null;
  app.innerHTML = '<h1 class="page-title">Lessons</h1>' + withRail(`<div class="card">
    <h2>${s.done.length} lesson${s.done.length === 1 ? '' : 's'} done</h2>
    <p class="muted">They come back for their first review when FSRS expects you to start forgetting them: in a few days for those you got right first time.</p>
    <p class="row">${more ? `<a class="btn" href="#/lessons" id="lx-more">More lessons (${more})</a>` : ''}
      <a class="btn quiet" href="#/study">Back to study</a></p></div>`, true);
  const m = document.getElementById('lx-more');
  if (m) m.addEventListener('click', e => { e.preventDefault(); pageLessons(); });
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
  if (cfg.listen && Sound.voices().length) qs.unshift('listen');
  if (cfg.write && it && it.kind !== 'word') qs.push('write');
  return qs;
}

function newSession(keys, mode = 'review') {
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
        <p><a class="btn" href="#/study">Back to study</a></p></div>`, true);
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
  const pct = finished ? Math.round(100 * s.right.length / finished) : 100;
  const shown = s.shown;
  const can = { info: !!shown, sound: (!!shown || q === 'listen') && Sound.voices().length > 0, settings: true, reveal: !shown,
    open: !!shown, wrap: true, undo: !!shown };
  const labels = { info: 'Item info (I)', sound: 'Play the pronunciation (P)', settings: 'Quiz settings (Q)',
    reveal: 'Reveal the answer (Ctrl+Enter)', open: 'Open in a new tab (O)',
    wrap: s.wrap ? 'Stop wrapping up (W)' : 'Wrap up: finish the items started, then stop (W)', undo: 'Undo this answer (Ctrl+Z)' };

  app.innerHTML = `
    <div class="rv-top">${s.practice ? '<span class="rv-practice">Practice: the schedule stays as it is</span>' : ''}
      ${s.calibrating ? '<span class="rv-practice">Calibration test</span>' : ''}
      ${s.wrap ? '<span class="rv-wrapping">Wrapping up</span>' : ''}
      ${cfg.showPct ? `<span title="Right first time">${pct}%</span>` : ''}
      ${cfg.showCount ? `<span title="Right first time">✓ ${s.right.length}</span><span>${total - finished} left</span>` : ''}</div>
    ${q === 'listen' && !shown ? listenBand(it) : q === 'write' ? writeBand(it, shown)
      : cfg.sentences && s.sent[k] ? sentenceBand(it, s.sent[k]) : band(k, it, false)}
    <div class="rv-prompt">${kindName(it)} <b>${{ pinyin: 'Pronunciation', write: 'Write it' }[q] || (it.kind === 'comp' ? 'Name' : 'Meaning')}?</b>
      ${q === 'listen' ? '<span class="muted">from its sound</span>' : ''}</div>
    <form id="rv-form" autocomplete="off"${q === 'write' ? ' class="rv-writing"' : ''}>
      ${q === 'write' ? `<p class="rv-write-msg" id="rv-write-msg">${shown ? '' : 'Draw each stroke in order. After three misses on a stroke, its outline shows.'}</p>
        <button class="rv-enter" ${shown ? '' : 'hidden'}>Next</button>` : `
      <input id="rv-in" class="rv-input ${shown ? (shown.ok ? 'ok' : 'bad') : ''}"
        placeholder="${q === 'pinyin' ? 'pin1yin1' : it.kind === 'comp' ? 'Name…' : 'Meaning…'}" spellcheck="false" autocapitalize="off" lang="en"
        ${shown ? 'readonly' : ''} value="${shown ? esc(shown.answer) : ''}">
      <p class="rv-hint" id="rv-hint" hidden>That isn't pinyin. Check it and try again.</p>`}
    </form>
    ${shown ? `<div class="rv-after">
      ${q === 'write' ? `<p class="${shown.ok ? 'lx-right' : 'lx-wrong'}">${shown.revealed ? 'Here is how it is written: it comes again later.'
        : shown.ok ? (shown.slips ? `Written, with ${shown.slips} ${shown.slips === 1 ? 'slip' : 'slips'}.` : 'Written without a slip.')
        : `${shown.hinted} ${shown.hinted === 1 ? 'stroke' : 'strokes'} needed the outline: it comes again later.`}</p>`
      : shown.ok ? '' : `<p class="lx-wrong">${q === 'pinyin'
        ? `It is <b>${esc(numbered(it.pin))}</b> (${esc(it.pin)}).` : `It means <b>${esc(primary(it))}</b>.`}</p>`}
      <p class="row">
        ${!shown.ok && (q === 'meaning' || q === 'listen') && shown.answer.trim() ? '<button class="btn quiet" id="rv-syn">My answer was right</button>' : ''}
        <span class="small muted">Enter for the next one</span></p>
    </div>` : ''}
    <div class="rv-tools">${TOOLS.map(t => `<button type="button" class="rv-tool${s.panel === t || (t === 'wrap' && s.wrap) ? ' on' : ''}"
      data-tool="${t}" title="${esc(labels[t])}" aria-label="${esc(labels[t])}"${can[t] ? '' : ' disabled'}>${toolIcon(t)}</button>`).join('')}</div>
    ${s.panel === 'settings' ? `<div class="rv-panel" style="--at:${TOOLS.indexOf('settings')}">${quizSettings(cfg)}</div>` : ''}
    ${s.panel === 'info' && shown ? `<div class="rv-panel" style="--at:${TOOLS.indexOf('info')}">${infoPanel(k, Store.item(k), q)}</div>` : ''}`;

  const input = document.getElementById('rv-in') || document.querySelector('#rv-form .rv-enter');
  const fresh = s.asked !== s.i;
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
    const ok = q === 'pinyin' ? Learn.checkPinyin(answer, it.pin) : Learn.checkMeaning(answer, it);   // (listen: the meaning)
    if (ok) {
      Sound.ding();
      if (q === 'pinyin') Sound.say(k);
    }
    // the first answer to each question is what the rating goes by: right or wrong,
    // a slip (the right syllables with a wrong tone), and how soon typing began
    const f = s.first[k] = s.first[k] || {};
    if (!f[q]) {
      const nearly = !ok && q === 'pinyin' && Learn.parsePinyin(answer).letters === Learn.parsePinyin(it.pin).letters;
      f[q] = { ok, near: nearly, ms: (s.keyAt || Date.now()) - s.askedAt };
    }
    s.shown = { ok, answer };
    if (!ok) {
      s.misses[k] = (s.misses[k] || 0) + 1;
      (s.typed[k] = s.typed[k] || []).push({ q, answer });
      s.queue.push({ k, q });                      // asked again before the session ends
    }
    pageReviews();
  });
  const syn = document.getElementById('rv-syn');
  if (syn) syn.addEventListener('click', () => {
    // accept it: remember the wording, and take back the miss and the repeat
    Sound.rip();
    addSynonym(k, shown.answer);
    takeBack(k, q);
    const f = (s.first[k] || {})[q];
    if (f) { f.ok = true; f.near = false; }
    s.shown = { ok: true, answer: shown.answer };
    pageReviews();
  });
  app.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => reviewTool(b.dataset.tool)));
  wireReviewPanel(k);
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
    s.shown = { ok: false, answer: '', revealed: true };
    s.misses[k] = (s.misses[k] || 0) + 1;
    const f = s.first[k] = s.first[k] || {};
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
    if (s.first[k]) delete s.first[k][q];
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
      const g = s.grades[k] = Learn.gradeFrom(Object.values(s.first[k] || {}));
      const opts = { retention: Store.cfg().retention };
      if (s.calibrating) Learn.calibrate(it, g, Date.now(), Math.random, opts);
      else if (!s.practice) Learn.review(it, g, Date.now(), Math.random, opts);
      if (!s.practice) Store.learnSaved(k);
      (right ? s.right : s.wrong).push(k);
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

/* After a session: how it went, every item with the stage it moved to (and what you
   typed when you missed it), characters that became learned or slipped back, what's
   next, and a practice round for the ones you missed. */
function reviewsDone() {
  const s = reviewState;
  reviewState = null;
  const d = Store.load(), p = Store.plan(), now = Date.now();
  const done = s.right.length + s.wrong.length;
  const pct = done ? Math.round(100 * s.right.length / done) : 100;
  const secs = Math.round((now - s.start) / 1000);
  const time = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
  const title = s.practice ? 'Practice summary' : s.calibrating ? 'Calibration summary' : 'Review summary';
  // how the app rated each item from the answers, and how many got each rating
  const rated = [0, 0, 0, 0, 0];
  for (const k of Object.keys(s.grades)) rated[s.grades[k]]++;
  const gradeTag = g => g ? `<span class="rs-grade g${g}" title="${esc(GRADE_WHY[g])}">${Learn.GRADE_NAMES[g]}</span>` : '';

  const stage = st => `<span class="rs-stage ${Learn.group(st).toLowerCase()}">${esc(Learn.stageName(st))}</span>`;
  const tile = k => {
    const it = d.items[k];
    if (!it) return '';
    const before = s.before[k], after = it.stage;
    const move = stage(after) + (s.practice ? '' : after > before ? `<small class="up">↑ from ${esc(Learn.stageName(before))}</small>`
      : after < before ? `<small class="down">↓ from ${esc(Learn.stageName(before))}</small>` : '<small>stays</small>');
    const typed = (s.typed[k] || []).map(t => `${{ pinyin: 'pronunciation', listen: 'meaning by ear', write: 'writing' }[t.q] || 'meaning'}
      ${t.q === 'write' ? 'needed a hint' : t.answer ? `“${esc(t.answer)}”` : 'revealed'}`).join(', ');
    const m = !s.practice && Learn.memory(it, now);
    return `<a class="rs-item ${it.kind}" href="${itemHref(k)}">
      <span class="rs-glyph han">${itemHtml(k)}</span>
      <span class="rs-body"><span><b>${esc(it.pin)}</b> ${esc(primary(it))}</span>
        <span class="rs-move">${gradeTag(s.grades[k])}${move}</span>
        ${m ? `<span class="rs-mem" title="Stability: days until the chance of recall falls to 90%. Difficulty: 1 to 10.">
          stability ${days(m.S)} · difficulty ${m.D.toFixed(1)}</span>` : ''}
        ${typed ? `<span class="rs-typed">You answered: ${typed}</span>` : ''}</span></a>`;
  };
  const chars = ks => ks.filter(k => d.items[k] && d.items[k].kind !== 'word');
  const learned = s.practice ? [] : chars(s.right).filter(k => s.before[k] < Learn.LEARNED_FROM && d.items[k].stage >= Learn.LEARNED_FROM);
  const slipped = s.practice ? [] : chars(s.wrong).filter(k => s.before[k] >= Learn.LEARNED_FROM && d.items[k].stage < Learn.LEARNED_FROM);
  const mastered = s.practice ? [] : Object.keys(s.grades).filter(k => d.items[k] && d.items[k].stage >= Learn.MASTER
    && s.before[k] < Learn.MASTER);
  // calibration: the ones not known at all could start again from a lesson
  const forgot = s.calibrating ? Object.keys(s.grades).filter(k => s.grades[k] === 1 && d.items[k]) : [];
  const unsorted = s.calibrating ? calibrationSets().unsorted : [];

  // what comes next
  const upcoming = Object.values(d.items).filter(it => it.stage >= 1 && it.due > now)
    .map(it => it.due).sort((a, b) => a - b);
  const soon = upcoming.filter(t => t - now < Learn.DAY).length;
  const when = t => {
    const m = Math.round((t - now) / 60000);
    return m < 60 ? `in ${Math.max(1, m)} minute${m === 1 ? '' : 's'}` : m < 60 * 24
      ? `in ${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'}` : new Date(t).toLocaleString(undefined,
        { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  };
  const more = p.reviewsLeft, lessons = p.lessons.length;

  app.innerHTML = `<h1 class="page-title">${title}</h1>` + withRail(`
    <section class="card rs-head">
      <div class="rs-ring" style="--p:${done ? pct : 100}"><div><b>${pct}%</b><span>right first time</span></div></div>
      <div>
        <div class="rs-stats">
          <div><b>${done}</b><span>${s.practice ? 'practiced' : 'reviewed'}</span></div>
          <div class="ok"><b>${s.right.length}</b><span>right</span></div>
          <div class="bad"><b>${s.wrong.length}</b><span>missed</span></div>
          <div><b>${time}</b><span>time</span></div>
        </div>
        ${s.practice ? '<p class="small muted">Practice doesn’t change when they come back.</p>' : ''}
        ${!s.practice && done ? `<p class="rs-rated">Rated from your answers: ${[4, 3, 2, 1].filter(g => rated[g])
          .map(g => `${rated[g]} ${gradeTag(g)}`).join(' ')}</p>` : ''}
        <div class="rs-actions">
          ${unsorted.length ? `<button class="btn" id="rs-calibrate">Carry on sorting (${unsorted.length} left)</button>` : ''}
          ${forgot.length ? `<button class="btn quiet" id="rs-relearn" title="Learn them again from a lesson, with a mnemonic">
            Send the ${forgot.length} forgotten to lessons</button>` : ''}
          ${s.wrong.length && !s.calibrating ? `<button class="btn" id="rs-practice">Practice the ${s.wrong.length} missed</button>` : ''}
          ${more && !s.practice ? `<button class="btn${s.wrong.length ? ' quiet' : ''}" id="rs-more">Keep reviewing (${more})</button>` : ''}
          ${lessons ? `<a class="btn quiet" href="#/lessons">Lessons (${lessons})</a>` : ''}
          <a class="btn quiet" href="#/study">Back to study</a>
        </div>
      </div>
    </section>
    ${learned.length || slipped.length || mastered.length ? `<section class="card rs-news">
      ${learned.length ? `<p><b class="han">${esc(learned.join(' '))}</b> reached Journeyman: ${learned.length === 1 ? 'it now counts' : 'they now count'}
        as learned all over HanziHome.</p>` : ''}
      ${mastered.length ? `<p><b class="han">${esc(mastered.join(' '))}</b> reached Master: you'd remember ${mastered.length === 1 ? 'it' : 'them'}
        for two years and more.</p>` : ''}
      ${slipped.length ? `<p><b class="han">${esc(slipped.join(' '))}</b> slipped below Journeyman, so ${slipped.length === 1 ? 'it is' : 'they are'}
        back to learning until ${slipped.length === 1 ? 'it climbs' : 'they climb'} again.</p>` : ''}
    </section>` : ''}
    ${!done ? '<section class="card"><p class="empty">Nothing was finished in this session.</p></section>' : ''}
    ${s.wrong.length ? `<section class="card"><h2 class="caps">Missed (${s.wrong.length})</h2>
      <div class="rs-grid">${s.wrong.map(tile).join('')}</div></section>` : ''}
    ${s.right.length ? `<section class="card"><h2 class="caps">Right (${s.right.length})</h2>
      <div class="rs-grid">${s.right.map(tile).join('')}</div></section>` : ''}
    <p class="small muted rs-next">${more ? `${more} more due now. ` : ''}${upcoming.length
      ? `The next review is ${when(upcoming[0])}; ${soon} in the next 24 hours.` : 'No reviews coming up.'}</p>`, true);

  const again = document.getElementById('rs-practice');
  if (again) again.addEventListener('click', () => startPractice(s.wrong));
  const next = document.getElementById('rs-more');
  if (next) next.addEventListener('click', () => pageReviews());       // (already at #/reviews)
  const cal = document.getElementById('rs-calibrate');
  if (cal) cal.addEventListener('click', () => startCalibration(byCommon(unsorted).slice(0, 50)));
  const relearn = document.getElementById('rs-relearn');
  if (relearn) relearn.addEventListener('click', () => {
    for (const k of forgot) {
      const it = Store.item(k);
      if (it) { it.stage = 0; it.due = 0; it.prio = true; }     // a lesson, at the front of the queue
    }
    Store.save();
    markNav(currentPath());
    relearn.outerHTML = '<span class="small">Sent to the front of your <a href="#/lessons">lessons</a>.</span>';
  });
  paintRail();
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
  'Right, but with a slip of tone or after a long think',
  'Right first time',
  'Right first time, and you started typing within ' + Learn.QUICK / 1000 + ' seconds on every question'];

/* Practice: a session over the given items that leaves their schedule alone */
function startPractice(keys) {
  reviewState = newSession(shuffle(keys.slice()), 'practice');
  if (currentPath() === '/reviews') pageReviews(); else go('/reviews');
}

/* items whose latest review was a miss, in the last three days (HanziHero's extra
   study: recent mistakes) */
function recentMistakes() {
  const d = Store.load(), since = Learn.dayStart(Date.now()) - 2 * Learn.DAY;
  return Object.keys(d.items).filter(k => {
    const it = d.items[k], h = it.hist || [];
    return it.stage >= 1 && it.last >= since && h.length && h[h.length - 1] === false;
  });
}

// -------------------------------------------------------------- calibration

/* The calibration test: characters you marked as learned all joined the reviews at
   Journeyman I, unchecked. The test is a review session over them (typed answers,
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
    <p>Characters you marked as learned all joined your reviews at Journeyman, whether you know them well
      or hardly at all. This sorts them by how well you really know them: type each one's pronunciation and
      meaning, as in a review, and HanziHome judges from your answers.</p>
    <div class="cb-map">
      <div class="g1"><b>Wrong</b><span>back to Novice: again in days</span></div>
      <div class="g2"><b>A slip, or a long think</b><span>stays at Journeyman</span></div>
      <div class="g3"><b>Right</b><span>up to Journeyman II: in about 3 months</span></div>
      <div class="g4"><b>Right at once</b><span>up to Expert: in about 7 months</span></div>
    </div>
    <p class="small muted">“At once” is starting to type within ${Learn.QUICK / 1000} seconds; a long think is over
      ${Learn.SLOW / 1000}. From there FSRS takes over: every review moves each one's stability up or down.
      Each answer counts at once, so you can stop whenever you like (wrap up, or leave the page) and carry on later.
      Characters that fall below Journeyman count as learning again across HanziHome.</p>
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
      <a class="btn quiet" href="#/study">Back to study</a></p>
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
    [35, 'Jump start — 35 items / day'], [40, 'Jump start — 40 items / day'], [0, 'No limit']];
  const reviewLimits = [[0, 'None']].concat([50, 100, 150, 200, 250, 300, 400, 500].map(n => [n, n + ' items / day']));
  const voice = Sound.voice();
  const tz = (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone;

  box.innerHTML = `
    <h2>Lessons and reviews <span class="st-saved" id="st-saved" hidden>Saved</span></h2>
    <p class="muted small">HanziHero's settings for lessons and reviews. Changes are saved as you make them,
      and sync with the rest of your progress.</p>
    ${field('Lesson batch size', range('batch', 1, 20), 'How many lessons you go through before their quiz.')}
    ${field('Daily lesson limit', sel('lessonLimit', limits, 'int'), c.lessonLimit
      ? `You'll have about <b>${c.lessonLimit * 10} reviews</b> a day once they settle in.`
      : 'Every lesson in your queue is ready as soon as it unlocks.')}
    ${c.lessonLimit ? field('Daily word limit', range('wordLimit', 0, c.lessonLimit),
      `We recommend <b>${Math.round(c.lessonLimit * 2 / 3)} words</b> for a good balance with characters.`) : ''}
    ${field('Desired retention', `<div class="st-range"><input type="range" data-k="retention" data-t="pct" min="80" max="97"
      value="${Math.round(c.retention * 100)}"><output>${Math.round(c.retention * 100)}%</output></div>`,
      'Reviews are scheduled by FSRS: an item comes back when your chance of recalling it has fallen to this. Higher means '
      + 'more reviews, each easier; 90% is FSRS’s own choice. The rating of each review (again, hard, good, easy) isn’t asked: '
      + 'it comes from your answers. Wrong is again; a slip of tone or a long think (over ' + Learn.SLOW / 1000 + ' seconds '
      + 'before you start typing) is hard; right is good; right and started within ' + Learn.QUICK / 1000 + ' seconds is easy.')}
    ${field('Daily review limit', sel('reviewLimit', reviewLimits, 'int'),
      'A soft limit: a session stops there, and once today\'s are done the Reviews tile greys out. You can still start another session.')}
    ${field('Character unlocking', sel('charUnlock', [['now', 'Unlock right away'],
      ['learned', 'Unlock when its components are learned'], ['familiar', 'Unlock when its components are familiar']]),
      'A component counts once you mark it known on the Productive Components page or mark it learned, or once it has had its own lesson (learned) or reached Apprentice I (familiar).')}
    ${field('Components and sounds first', tog('autoComps', 'Teach a character\'s new components and sounds first'),
      'A character you add brings the parts of it you don\'t know yet: its components (by their picture names) and its sounds (the initial as a person, the final as a place, the tone as a room). Each gets a short lesson just before the character, which opens on a Prerequisites page showing them, known and new. Parts don\'t count against the daily lesson limit.')}
    ${field('Word unlocking', `${tog('wordWait', 'Words wait for their characters')}
      ${tog('autoChars', 'Automatically prioritize characters')}
      ${sel('wordUnlock', [['familiar', 'Unlock when characters are familiar'], ['learned', 'Unlock when characters are learned']])}`,
      'Familiar: its characters have reached Apprentice I, two right reviews on different days. Learned: they have had their lessons, so you learn the word alongside them. Automatically prioritizing puts the characters of a word you add, the ones you don\'t know yet, at the front of your lessons.')}
    ${field('Item question order', sel('questionOrder', [['pinyin', 'Pair pronunciation, then meaning'],
      ['random', 'Select questions randomly']]),
      'Either way, an item’s meaning is only asked once its pronunciation is right.')}
    ${field('Lesson order', sel('lessonOrder', [['words', 'Words first, then characters'],
      ['chars', 'Characters first, then words'], ['mix', 'Mix characters and words']]))}
    ${field('Priority queue', tog('prioRespect', 'Respect daily limits and lesson order'),
      'On: prioritized lessons (☆ on the Study page, and characters a word brought along) come first within the lesson order and count towards your limits. Off: they come before everything else, whatever the limits.')}
    ${field('Review order', sel('reviewOrder', [['random', 'Random'], ['type', 'Characters, then words'],
      ['oldest', 'Oldest first'], ['newest', 'Newest first'], ['easiest', 'Easiest first'], ['lowest', 'Lowest SRS stage first']]))}
    <div class="st-field">
      ${tog('showPct', 'Show the percentage correct')}
      ${tog('showCount', 'Show the number correct and left over')}
      ${tog('validate', 'Enable pinyin answer validation')}
      <p class="st-note">An answer that isn't pinyin at all (jeu4, yi22) shakes for you to fix instead of counting as wrong.</p>
      ${tog('sentences', 'Turn word reviews into targeted sentence reviews')}
      <p class="st-note">A word is shown inside the sentence you found it in, or one from the graded stories.</p>
      ${tog('listen', 'Listening: ask what an item means from its sound alone')}
      <p class="st-note">Asked first, before you see it. Needs this device's Chinese voice (below); counts like the other questions.</p>
      ${tog('write', 'Writing: ask me to write each character')}
      <p class="st-note">Asked last, from its pinyin and meaning: draw the strokes in order. After three misses on a stroke its
        outline shows; needing it makes the review count as hard, never as forgotten.</p>
    </div>

    <h3 class="st-h">Sounds</h3>
    ${field('Preferred voice', sel('voice', [['female', 'Female'], ['male', 'Male']]),
      `<span id="st-voice-note">${voice ? `Reading with ${esc(voice.name)}${Sound.gender(voice) && Sound.gender(voice) !== c.voice
        ? ` (this device has no ${c.voice} Chinese voice)` : ''}.`
        : 'This device has no Chinese voice, so nothing is read aloud. On Windows: Settings → Time &amp; language → Speech → Add voices → Chinese (Simplified).'}</span>`)}
    ${field('Playback speed', sel('speed', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']]))}
    <div class="st-field">
      ${tog('muteSfx', 'Mute sound effects')}
      ${tog('muteVoice', 'Mute the voiced pronunciation')}
      <p class="st-note">A ding for each right answer; the item read aloud when its lesson opens and when you get its pronunciation right.
        <button type="button" class="btn quiet st-try" id="st-try">▶ Try it</button></p>
    </div>

    <h3 class="st-h">Vacation mode</h3>
    ${c.vacation ? `<p class="muted small">On vacation since ${esc(new Date(c.vacation).toLocaleDateString())}: lessons and
        reviews are paused. Coming back moves every review on by the time you were away.</p>
      <p><button type="button" class="btn" id="st-vac">End vacation</button></p>`
    : `<p class="muted small">Take a break: lessons and reviews stop until you come back, and then every
        review waits as long again as you were away, so nothing piles up.</p>
      <p><button type="button" class="btn quiet" id="st-vac">Go on vacation</button></p>`}
    <p class="small muted">Daily limits start again at midnight in this device's time zone${tz ? ` (${esc(tz)})` : ''}.</p>`;

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
    if (el.type === 'range') el.addEventListener('input', () => { el.nextElementSibling.textContent = el.value + (t === 'pct' ? '%' : ''); });
    el.addEventListener('change', () => {
      const patch = { [k]: value() };
      // the word limit is at most the lesson limit
      if (k === 'lessonLimit' && patch.lessonLimit && c.wordLimit > patch.lessonLimit) patch.wordLimit = patch.lessonLimit;
      Store.setCfg(patch);
      if (k === 'retention') reschedule(patch.retention);
      markNav(currentPath());
      if (['lessonLimit', 'voice'].includes(k)) paintStudySettings();
      saved();
    });
  });
  document.getElementById('st-try').addEventListener('click', () => { Sound.ding(); Sound.say('你好', true); });
  document.getElementById('st-vac').addEventListener('click', () => {
    Store.vacation(!c.vacation);
    markNav(currentPath());
    paintStudySettings();
  });
}
