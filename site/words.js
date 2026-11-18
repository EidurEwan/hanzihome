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
    if (!han) return `<span class="ex-p">${zh(z)}</span>`;
    const tag = z === w ? 'mark' : 'a';
    let shown = zh(z);
    if (z !== w && [...w].length === 1 && z.includes(w)) {
      for (const x of new Set([w, toTrad(w)])) shown = shown.split(x).join(`<b class="ex-c">${x}</b>`);
    }
    const href = z === w ? '' : ` href="#/${[...z].length > 1 ? 'word' : 'character'}/${encodeURIComponent(z)}"`;
    return `<${tag} class="ex-w"${href}><ruby>${shown}<rt>${esc(ps[i] || '')}</rt></ruby></${tag}>`;
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
const COMMON_WORDS = 10000, WORDS_PER_PAGE = 100;

/* #/words/<source>/<filter>/<page> */
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
  const shown = filter === 'all' ? list : list.filter(w => st(w) === filter);
  const pages = Math.max(1, Math.ceil(shown.length / WORDS_PER_PAGE));
  page = Math.min(page, pages);
  const rows = shown.slice((page - 1) * WORDS_PER_PAGE, page * WORDS_PER_PAGE);
  const base = `/words/${src}/${filter}`;
  const learned = Store.words('learned').length;

  app.innerHTML = '<h1 class="page-title">Words</h1>' + withRail(`
    <p class="lede">Words have a status of their own: mark the ones you know, or add them to your
       lessons. A word becomes Known once you have had its lesson.
       You know <b>${num(learned)}</b> words.</p>
    <div class="tabs">${WORD_SOURCES.map(([k, n]) => `<a class="${k === src ? 'on' : ''}" href="#/words/${k}/${filter}">${n}</a>`).join('')}</div>
    <section class="card">
      <div class="filters">${[['all', 'All'], ['unknown', 'Unknown'], ['learned', 'Known']].map(([k, n]) =>
        `<a href="#/words/${src}/${k}" class="${k === filter ? 'on' : ''} ${k}">${n} (${num(counts[k])})</a>`).join('')}</div>
      ${rows.length ? `<table class="wordtable"><thead><tr><th>#</th><th>Word</th><th>Pinyin</th><th>Meaning</th><th>Status</th><th></th></tr></thead><tbody>
        ${rows.map(w => {
          const e = wordEntries(w)[0] || [w, '', '', ''], it = Store.item(w);
          return `<tr><td class="num muted">${wordRank(w) || ''}</td>
            <td class="g"><a class="han" href="#/word/${encodeURIComponent(w)}">${zh(w)}</a></td>
            <td><b>${esc(e[2])}</b></td><td class="muted">${esc(plainMeaning(e[3]).split(/;\s*/).slice(0, 3).join('; '))}</td>
            <td>${wordSeg(w)}</td>
            <td>${it ? `<a class="small" href="#/study">${it.stage ? esc(Learn.stageName(it.stage)) : 'In lessons'}</a>`
              : `<button class="btn quiet small" data-addw="${esc(w)}" title="Add to lessons">＋</button>`}</td></tr>`;
        }).join('')}</tbody></table>`
        : '<p class="empty">No words here.</p>'}
      ${pager(base, page, shown.length, WORDS_PER_PAGE)}
    </section>`, true);
  wireWordSegs(app, () => render(true));
  app.querySelectorAll('[data-addw]').forEach(b => b.addEventListener('click', () => {
    Store.learnAdd(b.dataset.addw, 'word', wordInfo(b.dataset.addw));
    markNav(currentPath());
    render(true);
  }));
  paintRail();
}
