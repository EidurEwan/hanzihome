/* library.js — the sound library (#/sounds): every tone, every beginning of a syllable
 * (m-, zh-) and every ending (-ang, -ao), and the syllables they make. Each can be
 * played, with its picture from data/sounds.js and the characters that use it.
 *
 *   #/sounds/tones | beginnings | endings | syllables     the lists
 *   #/sounds/tone/4, beginning/m, ending/ang, syllable/ma  one sound, /N for its page N
 *
 * The readings counted are the ones lessons teach: a character's reviewed reading when it
 * has one (data/cmnem.js), else the dictionary's first.
 */

'use strict';

const LIB_TABS = [['tones', 'Tones'], ['beginnings', 'Beginnings'], ['endings', 'Endings'], ['syllables', 'Syllables']];
const LIB_PER = 120;
const TONE_WORDS = { 1: 'high and level', 2: 'rising', 3: 'dipping low', 4: 'falling sharply', 5: 'light and short' };
/* 妈 mā, 麻 má, 马 mǎ, 骂 mà, 吗 ma */
const TONE_MA = { 1: ['mā', '妈'], 2: ['má', '麻'], 3: ['mǎ', '马'], 4: ['mà', '骂'], 5: ['ma', '吗'] };

/* every ranked character by sound: [{c, pin, initial, final, tone, syl}], commonest first */
let _libRows = null;
function libRows() {
  if (_libRows) return _libRows;
  _libRows = [];
  for (const c of byRank()) {
    const pin = (HZ.cmnem && HZ.cmnem[c] && HZ.cmnem[c][2]) || HZ.index[c][2];
    if (!pin || /\s/.test(String(pin).trim())) continue;
    const s = Learn.soundOf(pin);
    if (!HZ.sounds.initials[s.initial] || !HZ.sounds.finals[s.final]) continue;
    _libRows.push({ c, pin, initial: s.initial, final: s.final, tone: s.tone, syl: Learn.parsePinyin(pin).letters });
  }
  return _libRows;
}
const countBy = field => {
  const n = {};
  for (const r of libRows()) n[r[field]] = (n[r[field]] || 0) + 1;
  return n;
};
const plural = (n, one) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;
/* ü for v; the buzzing -i of zhi chi shi is told apart from the -i of bi */
const endingText = v => v === 'ih' ? '-i (buzz)' : '-' + finalText(v);
const beginningText = v => v ? v + '-' : 'none';
const sylText = s => s.replace(/v/g, 'ü');

const playBtn = (attrs, label) => `<button type="button" class="snd-play" ${attrs} aria-label="${esc(label)}">▶</button>`;

/* a card in a list: its sound, its picture, how much it is used, a play button */
function libCard(k, key, name, why, count, href) {
  return `<div class="snd-card">
    ${playBtn(`data-part="${esc(k)}"`, 'Play ' + key)}
    <a class="snd-card-body" href="${href}">
      <span class="snd-card-key">${esc(key)}</span>
      <span class="snd-card-name">${esc(name)}</span>
      <span class="snd-card-why">${esc(why)}</span>
      <span class="snd-card-n">${plural(count, 'character')}</span>
    </a></div>`;
}

function libHead(tab) {
  return `<h1 class="page-title">Sound library</h1>
    <p class="lede">Every Mandarin syllable is a beginning, an ending and a tone. In a mnemonic the beginning is
      a person, the ending is a building, and the tone is where at that building it happens.</p>
    <div class="tabs">${LIB_TABS.map(([id, label]) => `<a class="${id === tab ? 'on' : ''}" href="#/sounds/${id}">${label}</a>`).join('')}</div>`;
}

function libList(tab) {
  const S = HZ.sounds;
  if (tab === 'tones') {
    const n = countBy('tone');
    return `<div class="snd-grid">${[1, 2, 3, 4, 5].map(t => libCard('t:' + t, `Tone ${t}`, S.tones[t][0], S.tones[t][1], n[t] || 0, `#/sounds/tone/${t}`)).join('')}</div>`;
  }
  if (tab === 'beginnings') {
    const n = countBy('initial');
    return `<div class="snd-grid">${Object.keys(S.initials).map(v => libCard('i:' + v, beginningText(v), S.initials[v][0], S.initials[v][1], n[v] || 0, soundHref('i:' + v))).join('')}</div>`;
  }
  if (tab === 'endings') {
    const n = countBy('final');
    return `<div class="snd-grid">${Object.keys(S.finals).map(v => libCard('f:' + v, endingText(v), S.finals[v][0], S.finals[v][1], n[v] || 0, soundHref('f:' + v))).join('')}</div>`;
  }
  // syllables, under the beginning they start with
  const groups = new Map(Object.keys(S.initials).map(v => [v, new Map()]));
  for (const r of libRows()) {
    const g = groups.get(r.initial);
    g.set(r.syl, (g.get(r.syl) || 0) + 1);
  }
  return [...groups].filter(([, g]) => g.size).map(([v, g]) => `<h2 class="sec-h snd-group"><a href="${soundHref('i:' + v)}">${esc(beginningText(v))}</a>
      <span class="muted small">${esc(S.initials[v][0])}</span></h2>
    <div class="snd-syls">${[...g.keys()].sort().map(syl => sylChip(syl)).join('')}</div>`).join('');
}

const sylChip = syl => `<a class="snd-syl-chip" href="#/sounds/syllable/${encodeURIComponent(syl)}">${esc(sylText(syl))}</a>`;

/* the characters that use a sound, on pages */
function libChars(rows, base, page) {
  const shown = rows.slice((page - 1) * LIB_PER, page * LIB_PER);
  return `<div class="tilegrid">${shown.map(r => tile(r.c, r.pin)).join('')}</div>
    ${pager(base, page, rows.length, LIB_PER)}`;
}

function libDetail(type, v, page) {
  const S = HZ.sounds, all = libRows();
  const back = id => `<p class="small"><a href="#/sounds/${id}">← ${LIB_TABS.find(t => t[0] === id)[1]}</a></p>`;
  const head = (key, title, why, play) => `<div class="snd-head">${play}
    <div><p class="snd-head-key">${esc(key)}</p><h1 class="page-title">${esc(title)}</h1><p class="lede">${esc(why)}</p></div></div>`;
  const syllables = rows => {
    const seen = [...new Set(rows.map(r => r.syl))].sort();
    return seen.length ? `<h2 class="sec-h">Syllables (${seen.length})</h2><div class="snd-syls">${seen.map(sylChip).join('')}</div>` : '';
  };
  const used = (rows, base) => `<h2 class="sec-h">Characters that use it (${rows.length.toLocaleString()})</h2>
    ${rows.length ? libChars(rows, base, page) : '<p class="empty">None.</p>'}`;

  if (type === 'tone' && S.tones[v]) {
    const rows = all.filter(r => String(r.tone) === v);
    return back('tones') + head(`Tone ${v}`, S.tones[v][0], `${S.tones[v][1]} It sounds ${TONE_WORDS[v]}.`, playBtn(`data-part="t:${v}"`, 'Play tone ' + v))
      + `<h2 class="sec-h">Hear the five tones</h2><div class="snd-tones">${[1, 2, 3, 4, 5].map(t => `<button type="button"
          class="snd-tone ${String(t) === v ? 'on' : ''}" data-part="t:${t}"><span class="han">${TONE_MA[t][1]}</span>${TONE_MA[t][0]}<small>${t} ${esc(S.tones[t][0])}</small></button>`).join('')}</div>`
      + used(rows, `/sounds/tone/${v}`);
  }
  if (type === 'beginning') {
    const key = v === 'none' ? '' : v;
    if (S.initials[key]) {
      const rows = all.filter(r => r.initial === key);
      return back('beginnings') + head(beginningText(key), S.initials[key][0], S.initials[key][1], playBtn(`data-part="i:${key}"`, 'Play ' + beginningText(key)))
        + syllables(rows) + used(rows, `/sounds/beginning/${v}`);
    }
  }
  if (type === 'ending' && S.finals[v]) {
    const rows = all.filter(r => r.final === v);
    return back('endings') + head(endingText(v), S.finals[v][0], S.finals[v][1], playBtn(`data-part="f:${v}"`, 'Play ' + endingText(v)))
      + syllables(rows) + used(rows, `/sounds/ending/${v}`);
  }
  if (type === 'syllable') {
    const rows = all.filter(r => r.syl === v);
    if (rows.length) {
      const { initial, final } = rows[0];
      const tones = [1, 2, 3, 4, 5].map(t => [t, rows.filter(r => r.tone === t)]).filter(([, r]) => r.length);
      return back('syllables') + `<div class="snd-head"><div><h1 class="page-title">${esc(sylText(v))}</h1>
          <p class="snd-strip"><a class="mn-chip snd" href="${soundHref('i:' + initial)}"><span class="snd-key">${esc(itemText('i:' + initial))}</span>${esc(S.initials[initial][0])}</a>
            <a class="mn-chip snd" href="${soundHref('f:' + final)}"><span class="snd-key">${esc(itemText('f:' + final))}</span>${esc(S.finals[final][0])}</a></p></div></div>
        <h2 class="sec-h">Its tones</h2>
        <div class="snd-tones">${tones.map(([t, r]) => `<button type="button" class="snd-tone" data-syl="${esc(v)}" data-tone="${t}" data-char="${esc(r[0].c)}">
          <span class="han">${esc(r[0].c)}</span>${esc(r[0].pin)}<small>${t} ${esc(S.tones[t][0])}</small></button>`).join('')}</div>
        <h2 class="sec-h">Characters that use it (${rows.length.toLocaleString()})</h2>
        ${libChars(rows, `/sounds/syllable/${encodeURIComponent(v)}`, page)}`;
    }
  }
  return null;
}

async function pageSounds(type, v, page) {
  app.innerHTML = LOADING;
  await Promise.all([need.sounds(), optional(need.cmnem())]);
  _libRows = null;              // (the reviewed readings may have arrived since)
  const tab = LIB_TABS.some(t => t[0] === type) ? type : !type ? 'tones' : null;
  const html = tab ? libHead(tab) + libList(tab) : libDetail(type, decodeURIComponent(v || ''), page);
  app.innerHTML = html || `<div class="card"><h1>Not found</h1><p class="empty">No such sound.</p>
    <p><a href="#/sounds">Go to the sound library</a></p></div>`;
  app.querySelectorAll('[data-part]').forEach(b => b.addEventListener('click', () => Sound.part(b.dataset.part)));
  app.querySelectorAll('[data-syl]').forEach(b => b.addEventListener('click', () => {
    // the character's own recording, for a neutral tone most of all, with the syllable behind it
    if (b.dataset.tone === '5') Sound.say(b.dataset.char, true, sylText(b.dataset.syl));
    else Sound.syllable(b.dataset.syl, +b.dataset.tone, b.dataset.char);
  }));
}

if (typeof module !== 'undefined') module.exports = { pageSounds };
