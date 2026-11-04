/* tones.js — the tone trainer (#/tones). Ear training: hear it, say which tones you heard.
 * Extra study: nothing here is scheduled, or counts towards the day's lessons, reviews, limits
 * or streak. Nor does it wait for what you have learned: it asks about sounds, not characters,
 * so it opens from day one, and the characters only come with the answer.
 *
 *   #/tones            the four tones and the neutral one, and the three kinds of practice
 *   #/tones/single     one syllable: which of the four tones?
 *   #/tones/pairs      a two-syllable word, without a tone change: which two?
 *   #/tones/changes    the tone changes, explained
 *   #/tones/changes/go a two-syllable word that changes: which two do you actually hear?
 *
 * It always plays the people's recordings (site/audio/), whatever Settings says about the
 * voice: a browser's voice can't be relied on for the tones, which here are the whole point.
 *
 * (Store.data.tones: {single|pairs|changes: {runs, best, of, last},
 *   'ear:2': [right, asked], 'mix:2>3': times a second tone was heard as a third})
 * Content: data/tones.js, from build/tones/build.js. */

const TN_ROUND = 10;
const TN_NAMES = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'neutral' };
const TN_KINDS = {
  single: { title: 'One syllable', note: 'Hear a syllable and pick its tone.', colour: 'pink', glyph: '<path d="M5 12h3l2-6 4 12 2-6h3"/>' },
  pairs: { title: 'Two syllables', note: 'Hear a word and pick both tones, the neutral one included.', colour: 'mint', glyph: '<path d="M4 15c2-6 4-6 6 0M14 9c2 6 4 6 6 0"/>' },
  changes: { title: 'Tone changes', note: 'Words that aren\'t said as they\'re written, like 你好 and 不是.', colour: 'sky', glyph: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>' },
};
/* the shape of each tone's pitch: high and level, rising, dipping, falling; neutral is a light dot */
const TN_SHAPE = {
  1: '<path d="M5 7h30"/>',
  2: '<path d="M6 20 34 6"/>',
  3: '<path d="M5 11c5 8 9 11 14 11s11-7 16-15"/>',
  4: '<path d="M6 5l28 18"/>',
  5: '<circle cx="20" cy="14" r="3.2" fill="currentColor" stroke="none"/>',
};
const tnShape = t => `<svg class="tn-shape" viewBox="0 0 40 28" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TN_SHAPE[t]}</svg>`;

/* ma + 3 = mǎ: the mark goes on a or e, on the o of ou, otherwise on the last vowel. v is ü,
   written u after j, q, x and y. */
function tnMark(letters, tone) {
  const s = letters.replace(/^([jqxy])v/, '$1u').replace(/v/g, 'ü');
  if (!tone || tone === 5) return s;
  const at = /[ae]/.test(s) ? s.search(/[ae]/) : s.includes('ou') ? s.indexOf('o') : Math.max(...['i', 'o', 'u', 'ü'].map(v => s.lastIndexOf(v)));
  if (at < 0) return s;
  const marked = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' }[s[at]][tone - 1];
  return s.slice(0, at) + marked + s.slice(at + 1);
}
const tnWrite = (lets, tones) => lets.map((l, i) => tnMark(l, tones[i])).join(' ');
const tnLetters = l => l.replace(/^([jqxy])v/, '$1u').replace(/v/g, 'ü');

function tnPlay(files) {
  const say = document.getElementById('tn-fail');
  if (say) say.hidden = true;
  Sound.playFiles(files, '', Store.cfg());
}
/* a recording that doesn't come (offline, and not kept yet) would otherwise just be silence */
let tnWatching = false;
function tnWatch() {
  if (tnWatching) return;
  tnWatching = true;
  Sound.player().addEventListener('error', () => {
    const say = document.getElementById('tn-fail');
    if (say && /audio\/[sw]\//.test(decodeURI(Sound.player().src))) say.hidden = false;
  });
}
const tnFiles = q => q.files.map(f => `audio/${f}.mp3`);
// (ju4's recording is filed as jv4)
const tnSylFiles = (lets, tones) => lets.map((l, i) => `audio/s/${l === 'ju' && tones[i] === 4 ? 'jv' : l}${tones[i]}.mp3`);

/* Ask each tone about as often, or the odd one out gives itself away. What's left over goes to
   the tones you get wrong most. ear: {tone: [right, asked]} */
function tnToneMix(n, ear) {
  const score = t => { const e = ear[t] || [0, 0]; return (e[0] + 1) / (e[1] + 2); };
  const each = Math.floor(n / 4), out = [1, 2, 3, 4].flatMap(t => Array(each).fill(t));
  const weakest = [1, 2, 3, 4].sort((a, b) => score(a) - score(b) || Math.random() - 0.5);
  for (let i = 0; out.length < n; i++) out.push(weakest[i % 4]);
  return out;
}
const tnEar = () => {
  const d = Store.load().tones, ear = {};
  for (const t of [1, 2, 3, 4, 5]) if (d['ear:' + t]) ear[t] = d['ear:' + t];
  return ear;
};

function tnRoundSingle(n, ear, syl) {
  const lets = shuffle(syl.slice());
  return shuffle(tnToneMix(n, ear)).map((t, i) => {
    const l = lets[i % lets.length];
    return { kind: 'single', lets: [l], tones: [t], files: [`s/${l}${t}`] };
  });
}
/* The tone your ear is worst at, and the one it most hears that as, for Weak spots: {tones: [worst,
   partner]}, or null when none is below 85% over at least six answers. (The neutral tone isn't
   asked alone, so it isn't counted.) d: Store.data.tones */
function tnWeak(d) {
  const rate = t => { const e = d['ear:' + t]; return e && e[1] >= 6 ? e[0] / e[1] : null; };
  const weak = [1, 2, 3, 4].filter(t => rate(t) !== null && rate(t) < 0.85).sort((a, b) => rate(a) - rate(b));
  if (!weak.length) return null;
  const worst = weak[0], others = [1, 2, 3, 4].filter(t => t !== worst);
  const mixes = t => (d[`mix:${worst}>${t}`] || 0) + (d[`mix:${t}>${worst}`] || 0);
  return { tones: [worst, others.sort((a, b) => mixes(b) - mixes(a) || (rate(a) || 1) - (rate(b) || 1))[0]] };
}
/* n single syllables on only these tones, about equally */
function tnRoundFocus(n, tones, syl) {
  const lets = shuffle(syl.slice());
  return shuffle(Array.from({ length: n }, (_, i) => tones[i % tones.length])).map((t, i) => {
    const l = lets[i % lets.length];
    return { kind: 'single', lets: [l], tones: [t], files: [`s/${l}${t}`] };
  });
}
/* A different pattern each time, for as long as they last, and a common word for it more often
   than not (each list starts with the commonest). */
function tnPick(list) { return list[Math.floor(Math.random() * Math.random() * list.length)]; }
function tnWordQ(w, kind) {
  return { kind, w: w[0], written: w[1], lets: w[1].split(' ').map(s => Learn.parsePinyin(s).letters), tones: w[2].split('').map(Number),
    en: w[3], rule: w[4] || '', files: w[5] ? w[5].split(' ') : [`w/${w[0]}`] };
}
function tnRoundPairs(n, pairs) {
  const shapes = Object.keys(pairs), out = [], seen = new Set();
  let pool = [];
  while (out.length < n) {
    if (!pool.length) pool = shuffle(shapes.slice());
    const list = pairs[pool.pop()].filter(w => !seen.has(w[0]));
    if (!list.length) continue;
    const w = tnPick(list);
    seen.add(w[0]);
    out.push(tnWordQ(w, 'pairs'));
  }
  return shuffle(out);
}
/* the three rules take turns */
function tnRoundChanges(n, changes) {
  const rules = {}, out = [];
  for (const w of shuffle(changes.slice())) (rules[w[4]] = rules[w[4]] || []).push(w);
  const names = shuffle(Object.keys(rules));
  for (let i = 0; out.length < n && names.some(r => rules[r].length); i++) {
    const list = rules[names[i % names.length]];
    if (list.length) out.push(tnWordQ(list.pop(), 'changes'));
  }
  return shuffle(out);
}

const TN_RULES = {
  33: 'Two third tones in a row: the first one rises, as a second tone does.',
  bu: '不 is fourth tone, but before another fourth tone it rises to second.',
  yi2: '一 is first tone alone, but before a fourth tone it rises to second.',
  yi4: '一 is first tone alone, but before a first, second or third tone it falls, as a fourth tone does.',
};

/* the tiles for the tones. first: the first syllable can't be neutral */
function tnButtons(neutral) {
  return `<div class="tn-tones${neutral ? ' five' : ''}" id="tn-tones">${[1, 2, 3, 4, ...(neutral ? [5] : [])].map(t =>
    `<button type="button" class="tn-tone" data-t="${t}" aria-label="${t === 5 ? 'Neutral tone' : `Tone ${t}, ${TN_NAMES[t]}`}">${tnShape(t)}<b>${t === 5 ? 'Neutral' : t}</b></button>`).join('')}</div>`;
}

function tnRun(kind, round, crumb, finish) {
  let at = 0, right = 0;
  tnWatch();
  const show = () => {
    const q = round[at];
    if (!q) return finish(right);
    const two = q.lets.length === 2, got = [];
    let over = false;
    app.innerHTML = `<p class="crumb">${crumb} / ${at + 1} of ${round.length}</p>
      <section class="card tn-q">
        <button type="button" class="tn-play" id="tn-play" aria-label="Listen again"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg></button>
        <p class="small muted tn-again">Listen again <kbd>R</kbd></p>
        <p class="small tn-fail" id="tn-fail" hidden>That recording didn't load. If you run HanziHome from your computer, check start-hanzihome.bat is still open; otherwise check your connection.</p>
        <div class="tn-slots" id="tn-slots"></div>
        <div id="tn-buttons">${tnButtons(two)}</div>
        <div id="gr-result" hidden aria-live="polite"></div>
      </section>`;
    const slots = document.getElementById('tn-slots'), buttons = document.getElementById('tn-tones');
    const drawSlots = () => {
      slots.innerHTML = q.lets.map((l, i) => {
        const t = got[i], next = i === got.length && !over;
        const label = over ? tnMark(l, q.tones[i]) : tnLetters(l);
        return `<button type="button" class="tn-slot${next ? ' next' : ''}${over ? (t === q.tones[i] ? ' ok' : ' no') : ''}" data-i="${i}"${t && !over ? '' : ' disabled'} aria-label="${esc(tnLetters(l))}${t && !over ? `: tone ${t}. Change it` : ''}">
          <span class="tn-slot-pin">${esc(label)}</span>${t ? tnShape(over ? q.tones[i] : t) : '<span class="tn-q-mark">?</span>'}</button>`;
      }).join('');
      slots.querySelectorAll('button:not(:disabled)').forEach(b => b.addEventListener('click', () => {
        got.length = +b.dataset.i;              // this one again, and anything after it
        drawSlots(); disableNeutral();
      }));
    };
    /* neutral can't come first */
    const disableNeutral = () => {
      const n = buttons.querySelector('[data-t="5"]');
      if (n) n.disabled = got.length === 0;
    };
    const answered = () => {
      over = true;
      const ok = q.tones.every((t, i) => got[i] === t);
      if (ok) right++;
      tnNote(q, got);
      buttons.querySelectorAll('button').forEach(b => {
        b.disabled = true;
        const t = +b.dataset.t;
        // (a pair's buttons stand for both syllables, so only one syllable's are marked)
        if (!two) b.classList.add(t === q.tones[0] ? 'ok' : t === got[0] ? 'no' : 'off');
      });
      if (two) document.getElementById('tn-buttons').hidden = true;
      drawSlots();
      const box = document.getElementById('gr-result');
      box.hidden = false;
      box.className = 'gr-result ' + (ok ? 'ok' : 'no');
      const said = tnWrite(q.lets, q.tones), picked = tnWrite(q.lets, got);
      const heard = !two ? `<p class="tn-answer"><b>${esc(said)}</b> <span class="muted">${TN_NAMES[q.tones[0]]} tone</span></p>`
        : `<div class="tn-answer-word"><span class="han tn-word">${zhOne(q.w)}</span><div><b>${esc(said)}</b>${q.written !== said && q.kind === 'changes' ? ` <span class="muted small">written ${esc(q.written)}</span>` : ''}<p class="small muted">${esc(q.en)}</p></div></div>`;
      // what you picked, on the syllables' recordings, to hear the difference (neutral has few)
      const canCompare = !ok && got.every(t => t !== 5);
      box.innerHTML = `<p class="gr-verdict">${ok ? 'Right' : `Not quite. You picked ${esc(picked)}.`}</p>${heard}
        ${q.rule ? `<p class="small muted">${esc(TN_RULES[q.rule])}</p>` : ''}
        ${ok ? '' : `<p class="tn-compare"><button type="button" class="btn quiet" id="tn-hear-it">▶ ${esc(said)}</button>
          ${canCompare ? `<button type="button" class="btn quiet" id="tn-hear-you">▶ ${esc(picked)} (yours)</button>` : ''}</p>`}
        <p><button type="button" class="btn" id="gr-next">${at + 1 < round.length ? 'Next' : 'Finish'}</button></p>`;
      const it = document.getElementById('tn-hear-it'), you = document.getElementById('tn-hear-you');
      if (it) it.addEventListener('click', () => tnPlay(tnFiles(q)));
      if (you) you.addEventListener('click', () => tnPlay(tnSylFiles(q.lets, got)));
      const next = document.getElementById('gr-next');
      next.addEventListener('click', () => { at++; show(); });
      next.focus();
    };
    const choose = t => {
      if (over || (t === 5 && got.length === 0)) return;
      got.push(t);
      if (got.length === q.lets.length) answered();
      else { drawSlots(); disableNeutral(); }
    };
    buttons.querySelectorAll('button').forEach(b => b.addEventListener('click', () => choose(+b.dataset.t)));
    document.getElementById('tn-play').addEventListener('click', () => tnPlay(tnFiles(q)));
    tnKey = e => {
      if (e.key === 'r' || e.key === 'R') { tnPlay(tnFiles(q)); return true; }
      if (/^[1-5]$/.test(e.key) && (e.key !== '5' || two)) { choose(+e.key); return true; }
      if (e.key === 'Backspace' && got.length && !over) { got.pop(); drawSlots(); disableNeutral(); return true; }
      return false;
    };
    drawSlots(); disableNeutral();
    window.scrollTo(0, 0);
    tnPlay(tnFiles(q));
  };
  show();
}
/* the keys of the question on screen. Page-wide, as Look-alikes' are, so it checks it's still there */
let tnKey = null;
document.addEventListener('keydown', e => {
  if (!tnKey || !document.getElementById('tn-play')) return;
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
  if (tnKey(e)) e.preventDefault();
});

/* each syllable answered, for how well your ear does with each tone. Changes count as what is
   heard, so the same tone-telling is being measured */
function tnNote(q, got) {
  const d = Store.load().tones;
  q.tones.forEach((t, i) => {
    const e = d['ear:' + t] || [0, 0];
    d['ear:' + t] = [e[0] + (got[i] === t ? 1 : 0), e[1] + 1];
    if (got[i] !== t) d[`mix:${t}>${got[i]}`] = (d[`mix:${t}>${got[i]}`] || 0) + 1;
  });
  Store.save();
}

function tnPractice(kind) {
  const ear = tnEar(), T = HZ.tones;
  const round = kind === 'single' ? tnRoundSingle(TN_ROUND, ear, T.syl) : kind === 'pairs' ? tnRoundPairs(TN_ROUND, T.pairs) : tnRoundChanges(TN_ROUND, T.changes);
  const K = TN_KINDS[kind], crumb = `<a href="#/tones">Tones</a> / ${kind === 'changes' ? `<a href="#/tones/changes">${K.title}</a>` : K.title}`;
  tnRun(kind, round, crumb, right => {
    const d = Store.load(), was = { runs: 0, best: 0, ...d.tones[kind] };
    const better = !was.of || right / round.length >= was.best / was.of;
    d.tones[kind] = { ...was, runs: was.runs + 1, best: better ? right : was.best, of: better ? round.length : was.of, last: Date.now() };
    Store.save();
    app.innerHTML = `<p class="crumb">${crumb}</p>
      <section class="card gr-done"><h1>${right} of ${round.length}</h1>
        <p class="muted">${right === round.length ? 'All of them right.' : 'Go again whenever you like.'}</p>
        <p class="gr-actions"><button type="button" class="btn" id="gr-again">Practise again</button>
          <a class="btn quiet" href="#/tones">All tone practice</a></p></section>`;
    document.getElementById('gr-again').addEventListener('click', () => tnPractice(kind));
    document.getElementById('gr-again').focus();
    window.scrollTo(0, 0);
  });
}

/* how your ear is doing, once there is enough to say */
function tnEarCard() {
  const d = Store.load().tones, ear = tnEar();
  const asked = Object.values(ear).reduce((s, e) => s + e[1], 0);
  if (asked < 15) return '';
  const rows = [1, 2, 3, 4, 5].filter(t => ear[t] && ear[t][1]).map(t => {
    const p = Math.round(ear[t][0] / ear[t][1] * 100);
    return `<div class="tn-ear-row"><span class="tn-ear-name">${tnShape(t)}<span>${t === 5 ? 'Neutral' : `Tone ${t}`}</span></span><span class="bar"><i style="width:${p}%"></i></span><b>${p}%</b></div>`;
  }).join('');
  const mixes = Object.entries(d).filter(([k, v]) => k.startsWith('mix:') && v >= 3).sort((a, b) => b[1] - a[1]);
  let mix = '';
  if (mixes.length) {
    const [, a, b] = /^mix:(\d)>(\d)$/.exec(mixes[0][0]);
    mix = `<p class="small muted">Your most common mix-up: hearing a ${TN_NAMES[a]} tone as a ${TN_NAMES[b]} tone.</p>`;
  }
  return `<h2 class="sec-h">Your ear</h2><section class="card tn-ear">${rows}${mix}</section>`;
}

function tnHome() {
  const S = (HZ.sounds && HZ.sounds.tones) || {};
  const syl = { 1: 'mā', 2: 'má', 3: 'mǎ', 4: 'mà', 5: 'ma' };
  const how = { 1: 'high and level', 2: 'rises, as in “what?”', 3: 'dips low', 4: 'falls sharply', 5: 'short and light' };
  const did = k => {
    const r = Store.load().tones[k];
    return r && r.runs ? `Best ${r.best} of ${r.of}` : TN_KINDS[k].note;
  };
  app.innerHTML = `<section class="card"><h1>Tones</h1>
      <p class="muted">Train your ear to tell the tones apart. It asks about sounds, not characters, so you can start any time. Nothing here is scheduled, and it doesn't count towards your lessons or reviews.</p>
      <div class="tn-meet">${[1, 2, 3, 4, 5].map(t => `<button type="button" class="tn-tone" data-t="${t}" aria-label="Hear ${syl[t]}, ${t === 5 ? 'the neutral tone' : `tone ${t}`}">${tnShape(t)}<b>${syl[t]}</b>
        <small>${how[t]}</small>${S[t] ? `<small class="tn-place">${esc(S[t][0])}, in your mnemonics</small>` : ''}</button>`).join('')}</div>
    </section>
    <div class="xs-grid tn-kinds">${Object.entries(TN_KINDS).map(([k, K]) => `<a class="xs-tile" href="#/tones/${k}"><span class="ico ${K.colour}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${K.glyph}</svg></span>
      <span class="xs-text"><b>${K.title}</b><small>${esc(did(k))}</small></span></a>`).join('')}</div>
    ${tnEarCard()}`;
  tnWatch();
  app.querySelectorAll('.tn-meet .tn-tone').forEach(b => b.addEventListener('click', () => {
    const t = +b.dataset.t;
    // no recording of "ma" in the neutral tone: the word 吗 is one
    tnPlay([t === 5 ? 'audio/w/吗.mp3' : `audio/s/ma${t}.mp3`]);
  }));
}

/* the changes are explained first, each with a few to hear */
function tnChanges() {
  const heard = (w, written, said, files) => `<button type="button" class="btn quiet tn-eg" data-files="${esc(files || `w/${w}`)}"><span class="han">${zhOne(w)}</span> ▶ <s>${esc(written)}</s> <b>${esc(said)}</b></button>`;
  app.innerHTML = `<p class="crumb"><a href="#/tones">Tones</a> / Tone changes</p>
    <section class="card tn-rules"><h1>Tone changes</h1>
      <p class="muted">Some tones change when another comes after them, and pinyin usually keeps the original spelling. Three rules cover nearly all of it. Here you say what you actually hear.</p>
      <h3>Third tone, then third tone</h3>
      <p>The first one rises, as a second tone does. Two low dips in a row are hard to say.</p>
      <p class="tn-egs">${heard('你好', 'nǐ hǎo', 'ní hǎo', 's/ni2 s/hao3')}${heard('可以', 'kě yǐ', 'ké yǐ')}${heard('水果', 'shuǐ guǒ', 'shuí guǒ')}</p>
      <h3>不, then fourth tone</h3>
      <p>不 is fourth tone, but rises to second before another fourth tone.</p>
      <p class="tn-egs">${heard('不是', 'bù shì', 'bú shì')}${heard('不要', 'bù yào', 'bú yào')}</p>
      <h3>一, before anything</h3>
      <p>Alone, or counting, 一 is first tone. Before a fourth tone it rises to second; before the others it falls to fourth.</p>
      <p class="tn-egs">${heard('一定', 'yī dìng', 'yí dìng')}${heard('一起', 'yī qǐ', 'yì qǐ')}</p>
      <p class="gr-actions"><a class="btn" href="#/tones/changes/go">Practise</a></p>
    </section>`;
  tnWatch();
  app.querySelectorAll('.tn-eg').forEach(b => b.addEventListener('click', () => tnPlay(b.dataset.files.split(' ').map(f => `audio/${f}.mp3`))));
}

async function pageTones(kind, sub) {
  app.innerHTML = LOADING;
  await Promise.all([need.tones(), optional(need.sounds())]);
  if (!kind) return tnHome();
  if (kind === 'changes' && sub !== 'go') return tnChanges();
  if (TN_KINDS[kind]) return tnPractice(kind);
  app.innerHTML = `<div class="card"><h1>Not found</h1><p class="empty">No such practice.</p><p><a href="#/tones">Tones</a></p></div>`;
}
