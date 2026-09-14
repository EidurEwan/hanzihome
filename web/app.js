/* HanziCraft (local) — client-side app.
   Routing, rendering, and the personal "learned characters" progress store. */

'use strict';

const app = document.getElementById('app');

/* ---------------- utilities ---------------- */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const api = async (path) => {
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  return r.json();
};

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function charLink(c, cls) {
  return `<a class="${cls || ''}" href="/character/${encodeURIComponent(c)}">${esc(c)}</a>`;
}

/* ---------------- learned-character store ---------------- */

const Learned = {
  key: 'hanzicraft.learned',
  get() {
    try { return new Set(JSON.parse(localStorage.getItem(this.key) || '[]')); }
    catch (e) { return new Set(); }
  },
  has(c) { return this.get().has(c); },
  toggle(c) {
    const s = this.get();
    s.has(c) ? s.delete(c) : s.add(c);
    try { localStorage.setItem(this.key, JSON.stringify([...s])); } catch (e) { }
    return s.has(c);
  },
  list() { return [...this.get()]; },
};

async function coverageOf(chars) {
  if (!chars.length) return { pct: 0, n: 0, n_ranked: 0 };
  const r = await fetch('/api/coverage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chars }),
  });
  return r.json();
}

/* ---------------- routing ---------------- */

function go(path, replace) {
  if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path);
  render();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || a.target === '_blank') return;
  e.preventDefault();
  go(href);
  window.scrollTo(0, 0);
});
window.addEventListener('popstate', render);

/* header search + menu */
document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (q) go('/search?q=' + encodeURIComponent(q));
});

const menuBtn = document.querySelector('.menu-btn');
const menuPop = document.querySelector('.menu-pop');
menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = menuPop.hidden;
  menuPop.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', () => {
  menuPop.hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
});

/* ---------------- pages ---------------- */

function pageHome() {
  app.innerHTML = `
  <section class="hero-home">
    <h1>Understand a character by taking it apart</h1>
    <p class="lede">Decomposition, phonetic clues, frequency data and example words
       for every Chinese character — served from your own machine.</p>
    <form class="bigsearch" id="bigsearch">
      <input id="bigq" type="search" placeholder="好 · hao3 · good" autocomplete="off" autofocus>
      <button type="submit">Look up</button>
    </form>
    <div class="samples">
      ${['好', '请', '想', '河', '雪', '爱'].map(c =>
        `<a class="chip" href="/character/${encodeURIComponent(c)}"><span class="g">${c}</span></a>`).join('')}
    </div>
  </section>
  <div class="grid" style="margin-top:26px">
    <div class="card"><h2>Character lists</h2>
      <p class="muted">Work through the most common characters, the 214 radicals,
         or the components that build the most other characters.</p>
      <p><a href="/lists">Browse the lists →</a></p></div>
    <div class="card"><h2>Phonetic sets</h2>
      <p class="muted">Groups of characters that share a component <em>and</em> its
         sound — the closest thing Chinese has to spelling rules.</p>
      <p><a href="/lists/phonetic-sets">See phonetic sets →</a></p></div>
    <div class="card"><h2>Your progress</h2>
      <p class="muted">Mark characters as learned and watch how much ordinary
         written Chinese you can already read.</p>
      <p><a href="/progress">Track progress →</a></p></div>
  </div>`;
  document.getElementById('bigsearch').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('bigq').value.trim();
    if (q) go('/search?q=' + encodeURIComponent(q));
  });
}

/* ---- character page ---- */

function renderTree(node, top) {
  const [c, kids] = node;
  const label = top ? `<span class="g">${esc(c)}</span>`
                    : `<a class="node" href="/character/${encodeURIComponent(c)}">
                         <span class="g">${esc(c)}</span></a>`;
  const inner = kids && kids.length
    ? `<ul>${kids.map(k => renderTree(k, false)).join('')}</ul>` : '';
  return `<li>${label}${inner}</li>`;
}

function wordChip(w) {
  const trad = w.trad && w.trad !== w.simp ? ` <span class="t">(${esc(w.trad)})</span>` : '';
  return `<a class="word" href="/search?q=${encodeURIComponent(w.simp)}"
             title="${esc(w.defs.join('; '))}">
            <span class="w">${esc(w.simp)}</span>${trad}
            <span class="p">${esc(w.toned)}</span></a>`;
}

function wordGroup(title, list, initial) {
  if (!list.length) return '';
  const id = 'wg' + Math.random().toString(36).slice(2, 8);
  const shown = list.slice(0, initial), rest = list.slice(initial);
  return `<div class="wordgroup">
    <h3>${title} <span class="muted">(${list.length})</span></h3>
    <div class="words" id="${id}">${shown.map(wordChip).join('')}</div>
    ${rest.length ? `<p style="margin-top:9px"><button class="more" data-target="${id}"
        data-json='${esc(JSON.stringify(rest))}'>Show ${rest.length} more</button></p>` : ''}
  </div>`;
}

async function pageCharacter(ch) {
  app.innerHTML = `<p class="muted">Loading ${esc(ch)}…</p>`;
  const d = await api('/api/char/' + encodeURIComponent(ch));
  if (d.error) {
    app.innerHTML = `<div class="card"><h1>${esc(ch)}</h1>
      <p class="empty">No data for this character.</p>
      <p><a href="/">Back to search</a></p></div>`;
    return;
  }

  const first = d.readings[0];
  const facts = [];
  if (d.rank) {
    facts.push(`<li><b>${ordinal(d.rank)}</b> most frequent character</li>`);
    facts.push(`<li>Adds <b>~${d.pct.toFixed(2)}%</b> to your reading coverage</li>`);
  } else {
    facts.push('<li>Not in the modern frequency list</li>');
  }
  if (d.trad === d.simp) facts.push('<li>Same in Simplified and Traditional</li>');
  else if (d.ch === d.simp) facts.push(`<li>Simplified character · Traditional: ${charLink(d.trad)}</li>`);
  else facts.push(`<li>Traditional character · Simplified: ${charLink(d.simp)}</li>`);
  facts.push(`<li><b>${d.readings.length}</b> dictionary ${d.readings.length === 1 ? 'entry' : 'entries'}</li>`);
  facts.push(`<li>Appears in <b>${d.n_words}</b> words</li>`);
  facts.push(`<li>Component in <b>${d.n_contains}</b> character${d.n_contains === 1 ? '' : 's'}</li>`);
  if (d.strokes) facts.push(`<li><b>${d.strokes}</b> strokes</li>`);
  if (d.kradical) {
    const rg = d.kradical_gloss ? ` <span class="muted">${esc(d.kradical_gloss)}</span>` : '';
    facts.push(`<li>Radical: ${charLink(d.kradical, 'han')}${rg}</li>`);
  }

  const learned = Learned.has(d.ch);
  const nb = [];
  if (d.prev) nb.push(`Previous (${charLink(d.prev.ch)})`);
  if (d.next) nb.push(`Next (${charLink(d.next.ch)})`);

  const comps = d.component_info.map(c => `
    <a class="gbox han" href="/character/${encodeURIComponent(c.c)}">${esc(c.c)}
       <small>${esc(c.gloss || 'N/A')}</small></a>`).join('');

  const phon = d.phonetic.length ? d.phonetic.map((p, i) => `
    <div class="clue">
      <p class="clue-head">${i + 1}. ${charLink(d.ch, 'han')} <b>${esc(first ? first.toned : '')}</b>
        has component ${charLink(p.comp, 'han')} <b>${esc(p.comp_toned[0] || '')}</b>.
        <span class="rel rel-${p.rel}">${esc(p.rel_name)}</span></p>
      ${p.members.length ? `<p class="muted" style="font-size:13px;margin:0 0 6px">
         ${esc(p.comp)} is also a clue in:</p>
       <div class="chips">${p.members.slice(0, 12).map(m =>
          `<a class="chip" href="/character/${encodeURIComponent(m.ch)}">
             <span class="g">${esc(m.ch)}</span><span class="p">${esc(m.toned || '')}</span>
             <span class="r">#${m.rank}</span></a>`).join('')}</div>
       ${p.members.length > 12 ? `<p style="margin-top:8px"><button class="more"
            data-chips='${esc(JSON.stringify(p.members.slice(12)))}'>Show ${p.members.length - 12} more</button></p>` : ''}`
      : ''}
    </div>`).join('')
    : '<p class="empty">There are no phonetic clues for this character.</p>';

  app.innerHTML = `
  <section class="card">
    <div class="hero">
      <div class="hero-glyph">${esc(d.ch)}</div>
      <div class="hero-main">
        <div class="hero-top">
          <span class="hero-pin">${esc(first ? first.toned : d.ch)}</span>
          <button class="learn-btn ${learned ? 'on' : ''}" id="learn">
            ${learned ? '✓ Learned' : 'Mark as learned'}</button>
          ${d.hsk ? `<span class="pill hsk">HSK ${d.hsk}</span>` : ''}
        </div>
        <p class="hero-gloss">${esc(first ? first.defs.slice(0, 6).join(' • ') : '')}</p>
        ${nb.length ? `<div class="neighbours">${nb.join('')}</div>` : ''}
        <ul class="facts">${facts.join('')}</ul>
      </div>
    </div>
  </section>

  <section class="card">
    <h2>Decomposition</h2>
    <div class="decomp-row">
      <div class="decomp-num">1</div>
      <div class="decomp-body"><h3>Breakdown</h3>
        <ul class="tree">${renderTree(d.breakdown, true)}</ul></div>
    </div>
    <div class="decomp-row">
      <div class="decomp-num">2</div>
      <div class="decomp-body"><h3>Components</h3>
        <div class="glyphs"><span class="gbox han">${esc(d.ch)}</span>
          <span class="arrow">→</span>${comps || '<span class="empty">Atomic — no components.</span>'}</div></div>
    </div>
    <div class="decomp-row">
      <div class="decomp-num">3</div>
      <div class="decomp-body"><h3>Graphical</h3>
        <div class="glyphs"><span class="gbox han">${esc(d.ch)}</span>
          <span class="arrow">→</span>
          ${d.graphical.map(g => `<span class="gbox han">${esc(g)}</span>`).join('')}</div></div>
    </div>
  </section>

  <section class="card">
    <h2>Pinyin &amp; Meaning</h2>
    ${d.readings.map((r, i) => `
      <div class="reading">
        <p class="r-head">${i + 1}. ${esc(r.toned)} <span>(${esc(r.pinyin)})</span></p>
        <p class="r-defs">${r.defs.map(esc).join(' • ')}</p>
      </div>`).join('') || '<p class="empty">No dictionary entry.</p>'}
  </section>

  <section class="card">
    <h2>Phonetic components</h2>
    <p class="muted" style="font-size:13px">A phonetic component hints at how the
       character is pronounced.</p>
    ${phon}
  </section>

  <section class="card" id="cov"></section>

  ${d.appears_in.length ? `<section class="card">
    <h2>Appears in</h2>
    <p class="muted" style="font-size:13px">${esc(d.ch)} is a component of these characters:</p>
    <div class="chips">${d.appears_in.slice(0, 40).map(m =>
      `<a class="chip" href="/character/${encodeURIComponent(m.ch)}">
         <span class="g">${esc(m.ch)}</span><span class="p">${esc(m.toned || '')}</span>
         ${m.rank ? `<span class="r">#${m.rank}</span>` : ''}</a>`).join('')}</div>
  </section>` : ''}

  <section class="card">
    <h2>Example words</h2>
    ${wordGroup('Common', d.words.common, 40) +
      wordGroup('Uncommon', d.words.uncommon, 40) +
      wordGroup('Rare', d.words.rare, 0)
      || '<p class="empty">No words recorded for this character.</p>'}
  </section>`;

  /* interactions */
  document.getElementById('learn').addEventListener('click', (e) => {
    const on = Learned.toggle(d.ch);
    e.target.classList.toggle('on', on);
    e.target.textContent = on ? '✓ Learned' : 'Mark as learned';
    drawCoverage(d.ch, d.pct);
  });
  app.querySelectorAll('button.more').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.json) {
        document.getElementById(b.dataset.target).insertAdjacentHTML(
          'beforeend', JSON.parse(b.dataset.json).map(wordChip).join(''));
      } else if (b.dataset.chips) {
        b.closest('div,p').previousElementSibling;
        const box = b.parentElement.previousElementSibling;
        box.insertAdjacentHTML('beforeend', JSON.parse(b.dataset.chips).map(m =>
          `<a class="chip" href="/character/${encodeURIComponent(m.ch)}">
             <span class="g">${esc(m.ch)}</span><span class="p">${esc(m.toned || '')}</span>
             <span class="r">#${m.rank}</span></a>`).join(''));
      }
      b.remove();
    });
  });
  drawCoverage(d.ch, d.pct);
}

async function drawCoverage(current, charPct) {
  const box = document.getElementById('cov');
  if (!box) return;
  const list = Learned.list();
  const cov = await coverageOf(list);
  const pct = cov.pct;
  const share = (charPct || 0).toFixed(2);
  box.innerHTML = `
    <h2>Your reading coverage</h2>
    <p class="muted" style="font-size:13px">Knowing your ${list.length}
       marked character${list.length === 1 ? '' : 's'} covers roughly
       <b>${pct.toFixed(2)}%</b> of running written Chinese.</p>
    <div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div>
    <p style="font-size:13px">
      ${Learned.has(current)
        ? `${esc(current)} is counted in that total, contributing ~${share}%.`
        : `Mark ${esc(current)} as learned to add its ~${share}%.`}
      <a href="/progress">See full progress →</a></p>`;
}

/* ---- search ---- */

async function pageSearch(q) {
  app.innerHTML = `<p class="muted">Searching “${esc(q)}”…</p>`;
  const d = await api('/api/search?q=' + encodeURIComponent(q));
  if (d.chars.length === 1 && !d.words.length && d.chars[0].ch === q) {
    return go('/character/' + encodeURIComponent(q), true);
  }
  const chars = d.chars.map(c => `
    <tr><td class="g">${charLink(c.ch)}</td>
        <td class="num">${c.rank ? '#' + c.rank : '—'}</td>
        <td><b>${esc(c.toned || '')}</b><br><span class="muted">${esc(c.defs.join(' • '))}</span></td>
    </tr>`).join('');
  const words = d.words.map(w => `
    <tr><td class="g">${[...w.simp].map(x => charLink(x)).join('')}</td>
        <td class="num">${w.trad !== w.simp ? esc(w.trad) : ''}</td>
        <td><b>${esc(w.toned)}</b><br><span class="muted">${esc(w.defs.join(' • '))}</span></td>
    </tr>`).join('');
  app.innerHTML = `
    <h1>Results for “${esc(q)}”</h1>
    ${chars ? `<section class="card"><h2>Characters</h2>
       <table><tbody>${chars}</tbody></table></section>` : ''}
    ${words ? `<section class="card"><h2>Words</h2>
       <table><tbody>${words}</tbody></table></section>` : ''}
    ${!chars && !words ? '<div class="card"><p class="empty">Nothing found.</p></div>' : ''}`;
}

/* ---- lists ---- */

function pager(base, page, total, per) {
  const last = Math.ceil(total / per);
  const sep = base.includes('?') ? '&' : '?';
  return `<div class="pager">
    ${page > 1 ? `<a href="${base}${sep}page=${page - 1}">← Previous</a>` : '<span>← Previous</span>'}
    <span>Page ${page} of ${last}</span>
    ${page < last ? `<a href="${base}${sep}page=${page + 1}">Next →</a>` : '<span>Next →</span>'}
  </div>`;
}

function pageListsIndex() {
  app.innerHTML = `
  <p class="crumb">Lists</p>
  <h1>Character lists</h1>
  <p class="lede">Different orders to work through the writing system.</p>
  <div class="grid" style="margin-top:20px">
    <div class="card"><h2>Most common characters</h2>
      <p class="muted">Ranked by how often they occur in modern written Chinese.</p>
      <a href="/lists/frequency">Open →</a></div>
    <div class="card"><h2>Chinese radicals</h2>
      <p class="muted">The 214 Kangxi radicals, their variant forms and meanings.</p>
      <a href="/lists/radicals">Open →</a></div>
    <div class="card"><h2>Phonetic sets</h2>
      <p class="muted">Components that reliably carry their sound into other characters.</p>
      <a href="/lists/phonetic-sets">Open →</a></div>
    <div class="card"><h2>Productive components</h2>
      <p class="muted">The building blocks that appear in the most common characters.</p>
      <a href="/lists/productive-components">Open →</a></div>
    <div class="card"><h2>Productive characters</h2>
      <p class="muted">Characters that go on to form the most other characters.</p>
      <a href="/lists/productive-characters">Open →</a></div>
    <div class="card"><h2>HSK vocabulary</h2>
      <p class="muted">Words by HSK level, ordered by corpus frequency.</p>
      <a href="/lists/hsk-1">Open →</a></div>
  </div>`;
}

async function pageFrequency(page) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const d = await api('/api/list/frequency?page=' + page);
  app.innerHTML = `
  <p class="crumb"><a href="/lists">Lists</a> › Most common characters</p>
  <h1>Most common characters</h1>
  <p class="lede">${d.total.toLocaleString()} characters ranked by frequency in modern
     written Chinese. The cumulative column shows how much of an ordinary text you
     could read knowing everything down to that row.</p>
  <section class="card">
  <table>
    <thead><tr><th>#</th><th>Char</th><th>Pinyin &amp; meaning</th><th>Share</th><th>Cumulative</th></tr></thead>
    <tbody>${d.rows.map(r => `
      <tr><td class="num">${r.rank}</td>
          <td class="g">${charLink(r.ch)}</td>
          <td><b>${esc(r.toned || '')}</b> <span class="muted">${esc(r.defs.join(' • '))}</span></td>
          <td class="num">${r.pct.toFixed(3)}%</td>
          <td class="num">${r.cumpct ? r.cumpct.toFixed(1) + '%' : ''}</td></tr>`).join('')}
    </tbody></table>
  ${pager('/lists/frequency', d.page, d.total, d.per)}
  </section>`;
}

async function pageRadicals() {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const d = await api('/api/list/radicals');
  app.innerHTML = `
  <p class="crumb"><a href="/lists">Lists</a> › Radicals</p>
  <h1>The 214 Kangxi radicals</h1>
  <p class="lede">Every character is filed under one of these. The count shows how many
     characters in this database contain the radical or one of its variant forms.</p>
  <section class="card">
  <table>
    <thead><tr><th>#</th><th>Radical</th><th>Variants</th><th>Meaning</th><th>Pinyin</th><th>Characters</th></tr></thead>
    <tbody>${d.rows.map(r => `
      <tr><td class="num">${r.num}</td>
          <td class="g">${charLink(r.canon)}</td>
          <td class="g" style="font-size:20px">${r.variants.map(v => charLink(v)).join(' ')}</td>
          <td>${esc(r.name)}</td>
          <td class="muted">${esc(r.toned || '')}</td>
          <td class="num">${r.n_chars}</td></tr>`).join('')}
    </tbody></table></section>`;
}

async function pagePhoneticSets(degree, page) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const d = await api(`/api/list/phonetic-sets?degree=${degree}&page=${page}`);
  app.innerHTML = `
  <p class="crumb"><a href="/lists">Lists</a> › Phonetic sets</p>
  <h1>Phonetic sets</h1>
  <p class="lede">A phonetic set is a component plus the characters whose pronunciation
     it predicts. Degree one is an exact match including tone; degree two also allows
     a different tone.</p>
  <div class="tabs">
    <a class="${degree === 1 ? 'on' : ''}" href="/lists/phonetic-sets?degree=1">Degree one — exact</a>
    <a class="${degree === 2 ? 'on' : ''}" href="/lists/phonetic-sets?degree=2">Degree two — tone may differ</a>
  </div>
  <section class="card">
  ${d.rows.map(r => `
    <div class="clue">
      <p class="clue-head"><a class="han" style="font-size:24px"
         href="/character/${encodeURIComponent(r.comp)}">${esc(r.comp)}</a>
         <b>${esc(r.toned || '')}</b> <span class="muted">— ${r.n} characters</span></p>
      <div class="chips">${r.members.map(m =>
        `<a class="chip" href="/character/${encodeURIComponent(m.ch)}">
           <span class="g">${esc(m.ch)}</span><span class="p">${esc(m.toned || '')}</span>
           <span class="r">#${m.rank}</span></a>`).join('')}</div>
    </div>`).join('') || '<p class="empty">Nothing here.</p>'}
  ${pager('/lists/phonetic-sets?degree=' + degree, d.page, d.total, d.per)}
  </section>`;
}

async function pageProductiveComponents(page) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const d = await api('/api/list/productive-components?page=' + page);
  app.innerHTML = `
  <p class="crumb"><a href="/lists">Lists</a> › Productive components</p>
  <h1>Productive components</h1>
  <p class="lede">Components ranked by how much they pay off. The score adds
     1 ÷ frequency-rank for every character a component appears in, so a component
     used in common characters scores higher than one buried in rare ones.</p>
  <section class="card">
  <table>
    <thead><tr><th>#</th><th>Component</th><th>Meaning</th><th>Pinyin</th>
      <th>In characters</th><th>Score</th></tr></thead>
    <tbody>${d.rows.map(r => `
      <tr><td class="num">${r.prank}</td>
          <td class="g">${charLink(r.comp)}</td>
          <td>${esc(r.gloss || '—')}</td>
          <td class="muted">${esc(r.toned || '')}</td>
          <td class="num">${r.n_chars}</td>
          <td class="num">${r.score.toFixed(4)}</td></tr>`).join('')}
    </tbody></table>
  ${pager('/lists/productive-components', d.page, d.total, d.per)}
  </section>`;
}

async function pageProductiveCharacters(page) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const d = await api('/api/list/productive-characters?page=' + page);
  app.innerHTML = `
  <p class="crumb"><a href="/lists">Lists</a> › Productive characters</p>
  <h1>Productive characters</h1>
  <p class="lede">Characters that are themselves used as building blocks inside the
     most other characters — learn one and several more become readable.</p>
  <section class="card">
  <table>
    <thead><tr><th>Char</th><th>Freq</th><th>Pinyin &amp; meaning</th><th>Builds</th></tr></thead>
    <tbody>${d.rows.map(r => `
      <tr><td class="g">${charLink(r.ch)}</td>
          <td class="num">#${r.rank}</td>
          <td><b>${esc(r.toned || '')}</b> <span class="muted">${esc(r.defs.join(' • '))}</span></td>
          <td class="num">${r.n_contains}</td></tr>`).join('')}
    </tbody></table>
  ${pager('/lists/productive-characters', d.page, d.total, d.per)}
  </section>`;
}

async function pageHsk(level) {
  app.innerHTML = '<p class="muted">Loading…</p>';
  const d = await api('/api/list/hsk/' + level);
  app.innerHTML = `
  <p class="crumb"><a href="/lists">Lists</a> › HSK</p>
  <h1>HSK level ${level}</h1>
  <p class="lede">${d.rows.length} words, ordered by how often they occur in a
     general corpus.</p>
  <div class="tabs">${[1, 2, 3, 4, 5, 6].map(n =>
    `<a class="${n === level ? 'on' : ''}" href="/lists/hsk-${n}">HSK ${n}</a>`).join('')}</div>
  <section class="card">
  <table>
    <thead><tr><th>Word</th><th>Pinyin</th><th>Meaning</th></tr></thead>
    <tbody>${d.rows.map(r => `
      <tr><td class="g">${[...r.word].map(c => charLink(c)).join('')}</td>
          <td><b>${esc(r.toned || '')}</b></td>
          <td class="muted">${esc(r.defs.join(' • '))}</td></tr>`).join('')}
    </tbody></table></section>`;
}

async function pageProgress() {
  const list = Learned.list();
  app.innerHTML = '<p class="muted">Loading…</p>';
  const cov = await coverageOf(list);
  const stats = await api('/api/stats');
  app.innerHTML = `
  <h1>My progress</h1>
  <p class="lede">Characters you have marked as learned are stored in this browser
     only — nothing leaves your machine.</p>
  <section class="card">
    <h2>Reading coverage</h2>
    <p><b style="font-size:26px">${cov.pct.toFixed(2)}%</b> of running written Chinese</p>
    <div class="bar"><i style="width:${Math.min(100, cov.pct)}%"></i></div>
    <p class="muted" style="font-size:13px">${list.length} character${list.length === 1 ? '' : 's'} marked,
       ${cov.n_ranked} of them found in a corpus of
       ${Number(stats.n_ranked || 0).toLocaleString()} ranked characters.</p>
  </section>
  <section class="card">
    <h2>Marked characters</h2>
    ${list.length ? `<div class="chips">${list.map(c =>
        `<a class="chip" href="/character/${encodeURIComponent(c)}">
           <span class="g">${esc(c)}</span></a>`).join('')}</div>
      <p style="margin-top:14px"><button class="more" id="clear">Clear all</button></p>`
      : '<p class="empty">Nothing marked yet — open a character and press “Mark as learned”.</p>'}
  </section>`;
  const clear = document.getElementById('clear');
  if (clear) clear.addEventListener('click', () => {
    if (confirm('Remove all ' + list.length + ' marked characters?')) {
      localStorage.removeItem(Learned.key);
      render();
    }
  });
}

/* ---------------- dispatcher ---------------- */

function render() {
  const u = new URL(location.href);
  const p = decodeURIComponent(u.pathname);
  const page = parseInt(u.searchParams.get('page') || '1', 10) || 1;

  if (p === '/' || p === '') return pageHome();
  if (p.startsWith('/character/')) return pageCharacter(p.slice('/character/'.length));
  if (p === '/search') return pageSearch(u.searchParams.get('q') || '');
  if (p === '/progress') return pageProgress();
  if (p === '/lists') return pageListsIndex();
  if (p === '/lists/frequency') return pageFrequency(page);
  if (p === '/lists/radicals') return pageRadicals();
  if (p === '/lists/phonetic-sets')
    return pagePhoneticSets(parseInt(u.searchParams.get('degree') || '1', 10), page);
  if (p === '/lists/productive-components') return pageProductiveComponents(page);
  if (p === '/lists/productive-characters') return pageProductiveCharacters(page);
  const hsk = p.match(/^\/lists\/hsk-(\d)$/);
  if (hsk) return pageHsk(parseInt(hsk[1], 10));

  app.innerHTML = `<div class="card"><h1>Not found</h1>
    <p class="empty">No page at ${esc(p)}.</p><p><a href="/">Go home</a></p></div>`;
}

render();
