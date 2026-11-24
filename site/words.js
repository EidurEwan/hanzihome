/* words.js — words as things to learn, as characters are.
 *
 * Every word has a status of its own (Unknown or Known: Store.wstatus, synced like
 * the characters'), Known once its lesson is done or when you say so, and a
 * card (#/word/电脑): its readings and meanings, part of speech, measure word, HSK
 * level and frequency, a mnemonic, example sentences with pinyin and English, where
 * it comes in the stories, the characters it is made of and the words related to it.
 * #/words lists words by frequency or HSK level, filtered by status, to mark them.
 *
 * The mnemonics, the components' picture names and the example sentences were written
 * for HanziHome (build/mnemonics/, BRIEF.md says how), commonest characters and words
 * first: data/cnames.js, data/cmnem.js and data/winfo.js, loaded when a page needs them.
 * Also here: mnHtml(), which draws a mnemonic, and compName(), a component's picture name.
 */

'use strict';

// --------------------------------------------------------------- the word list

let _wordIx = null;
/* simplified or traditional spelling -> the entries in HZ.words (one per reading) */
function wordIx() {
  if (!_wordIx && HZ.words) {
    _wordIx = new Map();
    HZ.words.forEach((w, i) => {
      for (const k of [w[0], w[1]]) {
        if (!k) continue;
        if (!_wordIx.has(k)) _wordIx.set(k, []);
        _wordIx.get(k).push(i);
      }
    });
  }
  return _wordIx;
}
const wordEntries = w => ((wordIx() && wordIx().get(w)) || []).map(i => HZ.words[i]);
/* a word's place in the frequency list (1 the commonest), or 0 */
const wordRank = w => { const ix = wordIx() && wordIx().get(w); return ix ? ix[0] + 1 : 0; };

/* a meaning without the dictionary's measure-word note */
const plainMeaning = d => String(d || '').split(/;\s*/).filter(x => !/^CL:/.test(x)).join('; ');
/* measure words, from CL:臺|台[tai2],個|个[ge4] -> [['台', 'tái'], ['个', 'gè']] */
function measureWords(d) {
  const m = String(d || '').match(/CL:([^;]+)/);
  if (!m) return [];
  return m[1].split(',').map(x => {
    const mm = x.trim().match(/^(?:[^|[]+\|)?([^[]+)\[([^\]]+)\]/);
    return mm ? [mm[1], (HZ.index[mm[1]] || [])[2] || mm[2]] : null;
  }).filter(Boolean);
}

/* what a lesson needs to know about a word: its reading and meanings */
function wordInfo(w) {
  const es = wordEntries(w);
  if (!es.length) return { pin: '', mean: '' };
  const means = es.map(e => plainMeaning(e[3])).join('; ');
  return { pin: es[0][2], mean: means.split(/;\s*/).slice(0, 2).join('; '),
    alts: means.split(/;\s*/).filter(x => x && !/…$/.test(x)).slice(0, 8) };
}

/* the HSK level of each word (2.0, levels 1–6) */
let _hskOf = null;
function hskOf(w) {
  if (!_hskOf && HZ.hsk) {
    _hskOf = new Map();
    for (const [lv, list] of Object.entries(HZ.hsk)) for (const x of list) if (!_hskOf.has(x[0])) _hskOf.set(x[0], +lv);
  }
  return _hskOf ? _hskOf.get(w) || 0 : 0;
}

// ---------------------------------------------------- mnemonics and picture names

/* A mnemonic, drawn: **meanings** in bold, *component names* and {sound names} as
   chips with the glyph or the sound they stand for, when ctx says which ({comps:
   [[glyph, name]], sounds: [[label, name]]}): 半 half, b- Batman. A name matches as
   written or with an ending (halves, Batmans). */
function mnHtml(m, ctx) {
  ctx = ctx || {};
  const keyChip = keyChipper(ctx.self, m || '');
  const find = (list, said) => {
    const w = said.toLowerCase();
    return (list || []).find(([, n]) => {
      const name = String(n || '').toLowerCase();
      return name && (w === name || w.startsWith(name) || name.startsWith(w) || w.startsWith(name.replace(/(f|fe|y|e)$/, '')));
    });
  };
  return esc(m || '')
    .replace(/\*\*([^*]+)\*\*/g, (all, said, at) => keyChip(said, at))
    .replace(/\*([^*]+)\*/g, (all, said) => {
      const hit = find(ctx.comps, said);
      return hit ? `<span class="mn-chip comp"><span class="han">${esc(hit[0])}</span>${said}</span>` : `<span class="mn-part">${said}</span>`;
    })
    .replace(/\{([^}]+)\}/g, (all, said) => {
      const hit = find(ctx.sounds, said), key = hit ? hit[0] : soundKeyOf(said);
      return `<span class="mn-chip snd">${key ? `<span class="snd-key">${esc(key)}</span>` : ''}${said}</span>`;
    });
}
/* A **meaning** in the mnemonic of `self` (a character or a word), as a chip with
   the glyph it is the meaning of: a character's meaning in red with the character,
   a word's in purple with the whole word. A word's mnemonic joins its characters'
   meanings into its own, after a colon (电脑: "**electric** **brain**: a
   **computer**"), so what follows the last colon is the word's (purple, 电脑) and
   what comes before it its characters' (red: 电 electric, 脑 brain): each matched to
   the character with that meaning, or else to the next character not yet named.
   Without a colon, the last meaning is the word's. Without a self, plain bold.
   `m` is the mnemonic as written, `at` where in it (escaped) the meaning stands. */
function keyChipper(self, m) {
  const plain = said => `<b class="mn-key">${said}</b>`;
  if (!self) return plain;
  const chip = (kind, glyph, said) =>
    `<span class="mn-chip ${kind}"><span class="han">${esc(glyph)}</span><b class="mn-key">${said}</b></span>`;
  const chars = [...self];
  if (chars.length === 1) return said => chip('ch', self, said);
  const stem = w => w.toLowerCase().replace(/[^a-z' -]/g, '').trim().replace(/(ies|es|s|ing|ed)$/, '');
  const terms = c => {
    const e = HZ.index && HZ.index[c], cm = HZ.cmnem && HZ.cmnem[c];
    return [cm ? cm[0] : '', e ? e[3] : ''].join(';').split(/[;,/()…]+/)
      .map(t => stem(t.replace(/^(to|a|an|the) /i, ''))).filter(t => t.length > 1);
  };
  const lists = chars.map(c => [c, terms(c)]);
  const near = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
  const text = esc(m), colon = text.lastIndexOf(':');
  const keys = [...text.matchAll(/\*\*([^*]+)\*\*/g)];
  const lastAt = keys.length ? keys[keys.length - 1].index : -1;
  const used = new Set();
  return (said, at) => {
    if (colon >= 0 ? at > colon : at === lastAt && keys.length > 1) return chip('wd', self, said);
    const w = stem(said.replace(/^(to|a|an|the) /i, ''));
    let hit = w && lists.find(([, ts]) => ts.some(t => near(t, w) || (w.length > 2 && t.split(' ').some(x => near(x, w)))));
    if (!hit) hit = lists.find(([c]) => !used.has(c));
    if (!hit) return chip('wd', self, said);
    used.add(hit[0]);
    return chip('ch', hit[0], said);
  };
}
/* the sound a picture name stands for, wherever a mnemonic is drawn without its
   character to hand: Hangar -> -ang, Bathroom -> 4 */
let _soundKeys = null;
function soundKeyOf(said) {
  if (!HZ.sounds) return '';
  if (!_soundKeys) {
    _soundKeys = {};
    for (const [pre, set] of [['i:', HZ.sounds.initials], ['f:', HZ.sounds.finals], ['t:', HZ.sounds.tones]]) {
      for (const [v, row] of Object.entries(set)) _soundKeys[row[0].toLowerCase()] = itemText(pre + v);
    }
  }
  return _soundKeys[String(said).toLowerCase()] || '';
}
/* the chips' context for a character: its components and sounds */
function mnContext(c, cd) {
  const parts = typeof compParts === 'function' && cd ? compParts(c, cd) : [];
  const pin = (HZ.cmnem && HZ.cmnem[c] && HZ.cmnem[c][2]) || (HZ.index[c] || [])[2];
  const sounds = HZ.sounds ? soundParts(pin) : [];
  return { self: c, comps: parts.map(p => [glyphOf(p), partName(p)]), sounds: sounds.map(p => [itemText(p), partName(p)]) };
}
/* a component's picture name (data/cnames.js), or failing that its meaning */
const compName = c => (HZ.cnames && HZ.cnames[c] && HZ.cnames[c][0]) || glossOf(c) || String((HZ.index[c] || [])[3] || '').split(/;|…/)[0].trim();
/* HanziHome's mnemonic for a character or word, if it has one */
function builtinMnemonic(k) {
  if ([...k].length > 1) return HZ.winfo && HZ.winfo[k] ? HZ.winfo[k][1] : '';
  return HZ.cmnem && HZ.cmnem[k] ? HZ.cmnem[k][1] : '';
}

// ---------------------------------------------------------------- status

/* the Unknown / Known switch for a word */
function wordSeg(w) {
  const st = Store.wstatus(w) || '';
  const b = (v, label, cls) => `<button type="button" data-ws="${v}" data-w="${esc(w)}"${st === v ? ` class="on ${cls}"` : ''}>${label}</button>`;
  return `<span class="seg3">${b('', 'Unknown', 'none')}${b('learned', 'Known', 'learned')}</span>`;
}
/* clicks on any word switch inside root; then() redraws what needs it */
function wireWordSegs(root, then) {
  root.querySelectorAll('button[data-ws]').forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    Store.setWStatus(b.dataset.w, b.dataset.ws || null);
    markNav(currentPath());
    if (then) then(b.dataset.w); else b.closest('.seg3').outerHTML = wordSeg(b.dataset.w);
  }));
}

// ------------------------------------------------------------ example sentences

/* a sentence split into words, each with its pinyin under it; the word itself marked,
   or a character (w) inside the word it is part of.
   ex: ['我|的|电脑|太|慢|了|。', 'wǒ|de|diàn nǎo|tài|màn|le|', 'My computer is too slow.'] */
function exampleHtml(ex, w) {
  const zs = ex[0].split('|'), ps = ex[1].split('|');
  return `<div class="ex-zh">${zs.map((z, i) => {
    const han = [...z].some(isHan);
    // (punctuation as a ruby too, with an empty reading, so it sits on the characters' line)
    if (!han) return `<span class="ex-p"><ruby>${zh(z)}<rt aria-hidden="true">&nbsp;</rt></ruby></span>`;
    // (the words are not links: a sentence is read where it is, not left for another page)
    const tag = z === w ? 'mark' : 'span';
    let shown = zh(z);
    if (z !== w && [...w].length === 1 && z.includes(w)) {
      for (const x of new Set([w, toTrad(w)])) shown = shown.split(x).join(`<b class="ex-c">${x}</b>`);
    }
    return `<${tag} class="ex-w"><ruby>${shown}<rt>${esc(ps[i] || '')}</rt></ruby></${tag}>`;
  }).join('')}</div><p class="ex-en">${esc(ex[2])}</p>`;
}

/* sentences from the graded stories that use the word: [{id, title, zh}] */
function storyUses(w, max) {
  const out = [];
  for (const st of HZ.stories || []) {
    for (const par of st.seg) {
      let sent = [], has = false;
      const flush = () => {
        if (has && out.length < max) out.push({ id: st.id, title: st.zh, tokens: sent });
        sent = []; has = false;
      };
      for (const tk of par) {
        if (tk.br) continue;
        if (typeof tk !== 'string') { sent.push(tk.s); if (/[。！？!?]/.test(tk.s)) flush(); continue; }
        const g = st.g[tk];
        sent.push(g[0]);
        if (g[0] === w) has = true;
      }
      flush();
      if (out.length >= max) return out;
    }
  }
  return out;
}

// ------------------------------------------------------------------ the card

async function pageWord(w) {
  app.innerHTML = LOADING;
  await Promise.all([need.words(), optional(need.hsk()), optional(need.winfo()), optional(need.cmnem()), optional(need.sounds()), optional(need.stories())]);
  const k = learnKey(w);
  const es = wordEntries(k).length ? wordEntries(k) : wordEntries(w);
  if (!es.length) {
    // not a word in the dictionary: a single character has a page of its own
    if ([...w].length === 1 && HZ.index[w]) return go('/character/' + encodeURIComponent(w));
    app.innerHTML = withRail(`<div class="card"><h1 class="han">${esc(w)}</h1><p class="empty">This isn't in the word list.</p></div>`);
    paintRail();
    return;
  }
  const simp = es[0][0], trad = es[0][1];
  const info = HZ.winfo && HZ.winfo[simp];
  const status = Store.wstatus(simp);
  const rank = wordRank(simp), level = hskOf(simp);
  const mw = es.flatMap(e => measureWords(e[3]));
  const chars = [...simp].filter(isHan);
  const knownChars = chars.filter(c => Store.status(c) === 'learned').length;

  const facts = [];
  const fact = (ic, html) => facts.push(`<li>${icon(ic)}<span>${html}</span></li>`);
  fact('rank', rank ? `<b>${ordinal(rank)}</b> most common word` : 'Not in the frequency list');
  if (level) fact('hsk', `<b>HSK ${level}</b> vocabulary`);
  if (info && info[0]) fact('book', `<b>${esc(info[0][0].toUpperCase() + info[0].slice(1))}</b>`);
  if (trad && trad !== simp) fact('swap', scriptMode() === 'trad' ? `Simplified: <b class="han">${esc(simp)}</b>` : `Traditional: <b class="han">${esc(trad)}</b>`);
  if (mw.length) fact('piece', `Measure word: ${mw.map(([c, p]) => `${charLink(c, 'han')} <span class="muted">${esc(p)}</span>`).join(', ')}`);
  fact('chat', `You know <b>${knownChars}</b> of its <b>${chars.length}</b> characters`);

  // related: the longer words it is in, and other words with its characters
  const longer = [], withChar = Object.fromEntries(chars.map(c => [c, []]));
  for (const e of HZ.words) {
    if (e[0] === simp) continue;
    if (longer.length < 8 && e[0].includes(simp)) longer.push(e);
    for (const c of chars) if (withChar[c].length < 6 && e[0].includes(c) && !e[0].includes(simp)) withChar[c].push(e);
    if (longer.length >= 8 && chars.every(c => withChar[c].length >= 6)) break;
  }
  const relChip = e => `<a class="word" href="#/word/${encodeURIComponent(e[0])}"><span class="w">${zh(e[0])}</span>
    <span class="p">${esc(e[2])}</span> <span class="muted small">${esc(plainMeaning(e[3]).split(';')[0])}</span></a>`;
  const uses = storyUses(simp, 4);
  const mn = info ? info[1] : '';
  const note = Store.load().notes[simp] || '';
  const gloss = plainMeaning(es[0][3]).split(/;\s*/).slice(0, 3).join('; ');
  const sound = soundStrip(es[0] && es[0][2], true);
  const hasRelated = longer.length || chars.some(c => withChar[c].length);

  app.innerHTML = `<p class="crumb"><a href="#/words">Words</a> / <span class="han">${zh(simp)}</span></p>` + withRail(`
    <section class="card pg-hero">
      <div class="pg-id">
        <div class="hero-glyph word-glyph ${status || ''}">${zh(simp)}</div>
        <div class="pg-title">
          <p class="pg-pin">${esc(es.map(e => e[2]).filter((p, i, a) => a.indexOf(p) === i).join(' / '))}
            <button class="btn quiet pg-say" id="w-say" aria-label="Hear it">▶</button></p>
          ${gloss ? `<p class="pg-gloss">${esc(gloss)}</p>` : ''}
        </div>
      </div>
      <div class="hero-actions pg-actions">
        <div class="dd">
          <button class="btn status-btn ${status || 'none'}" id="wstatusbtn">
            Status: ${status ? 'Known' : 'Unknown'} ▾</button>
          <div class="dd-pop" id="wstatuspop" hidden>
            <button data-s="">Unknown</button>
            <button data-s="learned">Known</button>
          </div>
        </div>
        ${learnButton(simp)}
      </div>
      <ul class="facts">${facts.join('')}</ul>
    </section>

    ${pageJump([['sec-meaning', 'Meaning'], ['sec-mnemonic', 'Mnemonic'], ['sec-examples', 'Examples'], ['sec-chars', 'Characters'],
      hasRelated ? ['sec-related', 'Related'] : null])}

    <section class="pg-sec" id="sec-meaning" tabindex="-1">
      <h2 class="sec-h">Meaning</h2>
      <div class="decomp-box pad">
        ${es.map((e, n) => `<div class="reading">
          <p class="r-head">${es.length > 1 ? (n + 1) + '. ' : ''}${esc(e[2])}</p>
          <p class="r-defs">${plainMeaning(e[3]).split(/;\s*/).map(esc).join(' • ')}</p></div>`).join('')}
        ${info && info[3] ? `<p class="word-use"><b>Good to know:</b> ${esc(info[3])}</p>` : ''}
      </div>
    </section>

    <section class="pg-sec" id="sec-mnemonic" tabindex="-1">
      <h2 class="sec-h">Mnemonic</h2>
      <div class="decomp-box pad pg-stack">
        <div>${mn ? `<p class="mn">${mnHtml(mn, { self: simp })}</p>` : '<p class="muted">No mnemonic for this word yet.</p>'}</div>
        ${sound ? `<div><h3 class="sub-h">Sound</h3>${sound}</div>` : ''}
        <div><h3 class="sub-h"><label for="note">Your note</label></h3>
          <textarea id="note" rows="2" class="note-box"
            placeholder="Your own mnemonic or note…">${esc(note)}</textarea>
          <p class="small muted" id="note-state">Saved automatically.</p></div>
      </div>
    </section>

    <section class="pg-sec" id="sec-examples" tabindex="-1">
      <h2 class="sec-h">Examples</h2>
      <div class="decomp-box pad">
        ${info && info[2].length ? info[2].map(ex => `<div class="example">${exampleHtml(ex, simp)}</div>`).join('') : ''}
        ${uses.length ? `<p class="muted small" style="margin-top:12px">In the stories:</p>
          ${uses.map(u => `<p class="story-use han">${u.tokens.map(t => t === simp ? `<mark>${zh(t)}</mark>` : zh(t)).join('')}
            <a class="small" href="#/reader/${encodeURIComponent(u.id)}">${zhOne(u.title)} →</a></p>`).join('')}` : ''}
        ${!(info && info[2].length) && !uses.length ? '<p class="empty">No examples yet.</p>' : ''}
      </div>
    </section>

    <section class="pg-sec" id="sec-chars" tabindex="-1">
      <h2 class="sec-h">Characters</h2>
      <div class="decomp-box pad word-chars">
        ${chars.map(c => {
          const e = HZ.index[c] || [], cm = HZ.cmnem && HZ.cmnem[c];
          return `<div class="word-char">${tile(c)}<div><b>${esc(e[2] || '')}</b>
            <span class="muted">${esc(cm ? cm[0] : String(e[3] || '').split(';')[0])}</span>
            ${cm ? `<p class="small mn">${mnHtml(cm[1], { self: c })}</p>` : ''}</div></div>`;
        }).join('')}
      </div>
    </section>

    ${hasRelated ? `<section class="pg-sec" id="sec-related" tabindex="-1">
      <h2 class="sec-h">Related words</h2>
      <div class="decomp-box pad">
        ${longer.length ? `<div class="wordgroup"><h3>Longer words with ${zh(simp)}</h3><div class="words">${longer.map(relChip).join('')}</div></div>` : ''}
        ${chars.filter((c, i) => chars.indexOf(c) === i && withChar[c].length).map(c => `<div class="wordgroup"><h3>Other words with ${zh(c)}</h3>
          <div class="words">${withChar[c].map(relChip).join('')}</div></div>`).join('')}
      </div>
    </section>` : ''}`, true);

  document.getElementById('w-say').addEventListener('click', () => Sound.say(simp, true));
  const btn = document.getElementById('wstatusbtn'), pop = document.getElementById('wstatuspop');
  btn.addEventListener('click', e => { e.stopPropagation(); pop.hidden = !pop.hidden; });
  pop.addEventListener('click', e => {
    const b = e.target.closest('button[data-s]');
    if (!b) return;
    Store.setWStatus(simp, b.dataset.s || null, wordInfo(simp));
    markNav(currentPath());
    render(true);
  });
  wireLearnButton(simp, () => Object.assign(wordInfo(simp), { mean: wordInfo(simp).mean }));
  const ta = document.getElementById('note');
  let timer;
  ta.addEventListener('input', () => {
    clearTimeout(timer);
    document.getElementById('note-state').textContent = 'Saving…';
    timer = setTimeout(() => { Store.note(simp, ta.value); document.getElementById('note-state').textContent = 'Saved.'; }, 500);
  });
  wirePageJump();
  paintRail();
}

// ------------------------------------------------------------------ the list

const WORD_SOURCES = [['common', 'Most common'], ['hsk1', 'HSK 1'], ['hsk2', 'HSK 2'], ['hsk3', 'HSK 3'],
  ['hsk4', 'HSK 4'], ['hsk5', 'HSK 5'], ['hsk6', 'HSK 6'], ['mine', 'Yours']];
const COMMON_WORDS = 10000, WORDS_PER_PAGE = 200;
/* what is typed in the list's filter box: kept while you page, switch lists and come back */
let wdQuery = '';

/* #/words/<source>/<filter>/<page> */
/* a word as a card, as the character lists' are (green once Known, blue in your lessons),
   its pinyin and meaning on one line, its status as one button, and a way into lessons.
   fb: [word, trad, pinyin, meaning] for when the dictionary doesn't have it (an HSK list's own) */
const WD_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13"/></svg>';
function wordRowHtml(w, known = Store.wstatus(w) === 'learned', fb = null, extra = '') {
  const e = wordEntries(w)[0] || fb || [w, '', '', ''], it = Store.item(w);
  const mean = plainMeaning(e[3]).split(/;s*/).slice(0, 3).join('; ');
  return `<div class="wd-row"${extra}><a class="tile wd-tile${known ? ' learned' : it ? ' learning' : ''}" href="#/word/${encodeURIComponent(w)}"><span class="g">${zh(w)}</span><span class="n">${wordRank(w) || ''}</span></a>
    <a class="wd-text" href="#/word/${encodeURIComponent(w)}" title="${esc(e[2])} · ${esc(mean)}"><b>${esc(e[2])}</b> · ${esc(mean)}</a>
    <button type="button" class="wd-st${known ? ' on' : ''}" data-wt="${esc(w)}" aria-pressed="${known}" title="${known ? 'Known. Switch to Unknown' : 'Unknown. Switch to Known'}">${known ? 'Known' : 'Unknown'}</button>
    ${known ? '<span class="wd-add-gap"></span>' : it ? `<a class="wd-add on" href="#/study" title="In your lessons${it.stage ? ` · ${esc(Learn.stageName(it.stage))}` : ''}" aria-label="In your lessons">${WD_BOOK}</a>`
      : `<button type="button" class="wd-add" data-addw="${esc(w)}" title="Add to lessons" aria-label="Add ${esc(w)} to lessons">+</button>`}</div>`;
}
/* the rows' buttons: Known/Unknown, and into the lessons; redraw after each */
function wireWordRows(root, redraw) {
  root.querySelectorAll('[data-wt]').forEach(b => b.addEventListener('click', () => {
    Store.setWStatus(b.dataset.wt, Store.wstatus(b.dataset.wt) === 'learned' ? null : 'learned');
    markNav(currentPath());
    redraw();
  }));
  root.querySelectorAll('[data-addw]').forEach(b => b.addEventListener('click', () => {
    Store.learnAdd(b.dataset.addw, 'word', wordInfo(b.dataset.addw));
    markNav(currentPath());
    redraw();
  }));
}
/* the list's column heads, once per column */
const WD_HEAD = '<div class="wd-head"><span>Word · pinyin · meaning</span><span class="wd-head-st">Status</span><span class="wd-head-add" title="Add to lessons">+</span></div>';
const wdHeads = n => WD_HEAD + (n > 1 ? WD_HEAD.replace('class="wd-head"', 'class="wd-head wd-head2"') : '');

async function pageWords(src, filter, page) {
  src = WORD_SOURCES.some(x => x[0] === src) ? src : 'common';
  if (filter === 'learning') filter = 'learned';       // (Learning and Learned are one now: Known)
  filter = ['all', 'unknown', 'learned'].includes(filter) ? filter : 'all';
  page = page || 1;
  app.innerHTML = LOADING;
  await Promise.all([need.words(), optional(need.hsk())]);
  let list;
  if (src === 'common') list = HZ.words.slice(0, COMMON_WORDS).map(e => e[0]).filter(w => [...w].length > 1);
  else if (src === 'mine') {
    const d = Store.load();
    list = [...new Set([...Object.keys(d.wstatus), ...Object.keys(d.items).filter(k => d.items[k].kind === 'word')])];
    list.sort((a, b) => (wordRank(a) || 1e9) - (wordRank(b) || 1e9));
  } else list = ((HZ.hsk || {})[src.slice(3)] || []).map(x => x[0]);
  list = list.filter((w, i) => list.indexOf(w) === i);
  const st = w => Store.wstatus(w) || 'unknown';
  const counts = { all: list.length, unknown: 0, learned: 0 };
  list.forEach(w => { counts[st(w)]++; });
  const byStatus = filter === 'all' ? list : list.filter(w => st(w) === filter);
  const base = `/words/${src}/${filter}`;
  const learned = Store.words('learned').length;
  const row = w => wordRowHtml(w, st(w) === 'learned');
  const match = q => {
    q = q.trim().toLowerCase();
    if (!q) return () => true;
    const bare = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');
    const qb = bare(q);
    return w => {
      if (w.includes(q)) return true;
      const e = wordEntries(w)[0];
      return !!e && (bare(e[2].toLowerCase()).includes(qb) || plainMeaning(e[3]).toLowerCase().includes(q));
    };
  };
  const body = () => {
    const shown = byStatus.filter(match(wdQuery));
    const pages = Math.max(1, Math.ceil(shown.length / WORDS_PER_PAGE));
    page = Math.min(page, pages);
    const rows = shown.slice((page - 1) * WORDS_PER_PAGE, page * WORDS_PER_PAGE);
    // (two to a line, in order across: 1 2, 3 4, …)
    return rows.length ? `<div class="wd-cols">${wdHeads(rows.length)}${rows.map(row).join('')}</div>
      <div class="wd-foot">${pager(base, page, shown.length, WORDS_PER_PAGE) || `<span class="muted small">${num(shown.length)} word${shown.length === 1 ? '' : 's'}</span>`}</div>`
      : `<p class="empty wd-empty">${wdQuery ? 'Nothing here matches that.' : 'No words here.'}</p>`;
  };

  app.innerHTML = '<h1 class="page-title">Words</h1>' + withRail(`
    <p class="lede">Mark the words you know, or add them to your lessons. A word becomes Known once
       you have had its lesson. You know <b>${num(learned)}</b> words.</p>
    <section class="wd-list">
      <div class="wd-bar">
        <nav class="wd-src" aria-label="Which words">${WORD_SOURCES.map(([k, n]) => `<a class="${k === src ? 'on' : ''}" href="#/words/${k}/${filter}">${n}</a>`).join('')}</nav>
        <div class="wd-filters">${[['all', 'All'], ['unknown', 'Unknown'], ['learned', 'Known']].map(([k, n]) =>
          `<a href="#/words/${src}/${k}" class="${k === filter ? 'on' : ''}">${n} ${num(counts[k])}</a>`).join('')}
          <label class="wd-q"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
            <input type="search" id="wd-q" placeholder="Filter this list" aria-label="Filter this list by word, pinyin or meaning" value="${esc(wdQuery)}" autocomplete="off"></label></div>
      </div>
      <div id="wd-body">${body()}</div>
    </section>`, true);
  const wire = () => wireWordRows(app, () => { const y = window.scrollY; render(true); window.scrollTo(0, y); });
  wire();
  const q = document.getElementById('wd-q');
  q.addEventListener('input', () => {
    wdQuery = q.value;
    page = 1;
    document.getElementById('wd-body').innerHTML = body();
    wire();
  });
  paintRail();
}
