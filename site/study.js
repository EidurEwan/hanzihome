/* study.js — lessons and reviews, drawn the way HanziHero draws them.
 *
 * Characters and words go into a lesson queue from a character's page or the
 * reader's word popup (Store.learnAdd), each remembering the sentence it was met
 * in. A lesson shows the item's parts, your mnemonic and examples, then asks for
 * its pinyin and meaning; after that it comes back in reviews on learn.js's
 * schedule, which asks both again. Everything lives in the store, so it syncs.
 *
 * Loaded before app.js, whose helpers (app, esc, withRail, charData, Store, …)
 * these functions use when they run. */

'use strict';

const LESSON_BATCH = 5;
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

const kindName = it => it.kind === 'word' ? 'Word' : 'Character';

/* a part's meaning: its radical name (口 mouth), or else its own first sense (乞 to beg) */
const partGloss = c => glossOf(c) || String((HZ.index[c] || [])[3] || '').split(/;|…/)[0].trim();

/* the item's main meaning, and the rest */
const primary = it => String(it.mean || '').split(';')[0].trim();
const others = it => Learn.meanings(it).filter(m => m !== primary(it).toLowerCase().replace(/^to /, ''));

/* what a page needs about an item beyond what is stored: its parts, the words it is
   in, and (for items added before they were known) its meanings */
async function itemFacts(k, it) {
  const f = { parts: [], comps: [], words: [], sound: null };
  if (it.kind === 'char') {
    const d = await charData(k);
    if (d) {
      f.comps = (d.cm || []).map(c => [c, partGloss(c)]);
      f.words = (d.w || []).slice(0, 6).map(w => [w[0], w[2]]);
      const ph = (d.ph || []).find(p => p.r <= 2);
      if (ph) f.sound = [ph.c, ph.t];
      const r = d.rd && d.rd[0];
      if (r) {
        if (!it.pin) it.pin = r[1];
        if (!it.alts.length) it.alts = r[2].slice(0, 6);
        if (!it.mean) it.mean = r[2].slice(0, 2).join('; ');
      }
    }
  } else {
    f.parts = [...k].filter(isHan).map(c => [c, partGloss(c)]);
  }
  return f;
}

/* the coloured band at the top: the item, and optionally its reading and meaning */
function band(k, it, show) {
  return `<div class="lx-band ${it.kind}">
    ${show ? `<div class="lx-pin">${esc(it.pin)}</div>` : '<div class="lx-pin">&nbsp;</div>'}
    <div class="lx-glyph han">${esc(k)}</div>
    ${show ? `<div class="lx-mean">${esc((it.mean || '').split(';')[0])}</div>` : ''}
    <span class="lx-kind">${kindName(it)}</span>
  </div>`;
}

/* the sentence the item was met in, with the item marked */
function foundIn(k, it) {
  if (!it.ex || !it.ex.text) return '';
  const w = it.ex.w || k;                          // as it was written there (maybe traditional)
  const parts = it.ex.text.split(w);
  return `<blockquote class="lx-ex han">${parts.map(esc).join(`<mark>${esc(w)}</mark>`)}</blockquote>`;
}

function chip(c, gloss, href) {
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

// ---------------------------------------------------------------------- hub

function pageStudy() {
  const d = Store.load(), items = Object.entries(d.items), now = Date.now();
  const lessons = Store.lessons(), due = Store.due();
  const fc = Learn.forecast(items.map(e => e[1]), now, 7);
  const max = Math.max(1, ...fc);
  const dayName = i => i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
    : new Date(now + i * Learn.DAY).toLocaleDateString(undefined, { weekday: 'long' });
  const groups = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
  const inGroup = g => items.filter(([, it]) => Learn.group(it.stage) === g).length;

  app.innerHTML = '<h1 class="page-title">Study</h1>' + withRail(`
    <div class="lx-hub">
      <a class="lx-tile lessons" href="#/lessons"><b>Lessons</b><span>${lessons.length}</span></a>
      <a class="lx-tile reviews" href="#/reviews"><b>Reviews</b><span>${due.length}</span></a>
    </div>
    <section class="card">
      <h2 class="caps">Upcoming reviews</h2>
      <div class="lx-fc">${fc.map((n, i) => `<div><span>${dayName(i)}</span>
        <i style="width:${Math.round(100 * n / max)}%"></i><b>${n ? '+' + n : ''}</b></div>`).join('')}</div>
    </section>
    <section class="card">
      <h2 class="caps">Waiting for lessons (${lessons.length})</h2>
      ${lessons.length ? `<div class="lx-queue">${lessons.map(k => {
        const it = d.items[k];
        return `<span class="lx-q ${it.kind}" title="${esc(it.ex && it.ex.text ? 'Found in: ' + it.ex.text : '')}">
          <a class="han" href="#/character/${encodeURIComponent([...k][0])}">${esc(k)}</a>
          <button data-rm="${esc(k)}" aria-label="Remove ${esc(k)}">×</button></span>`;
      }).join('')}</div>` : `<p class="empty small">Nothing yet. Use <b>Add to lessons</b> on a character's page,
        or in the reader when you point at a word.</p>`}
    </section>
    <section class="card">
      <h2 class="caps">Stages</h2>
      <div class="lx-stages">${groups.map(g =>
        `<div class="${g.toLowerCase()}"><b>${inGroup(g)}</b><span>${g}</span></div>`).join('')}</div>
      <p class="small muted">Reviews come back after a day, 4 days, a week, 2 weeks, a month,
        2, 4 and 8 months and a year, then the item is mastered. A miss halves the wait.
        Characters at Journeyman or beyond count as learned on the rest of the site.</p>
    </section>`, true);
  app.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
    Store.learnRemove(b.dataset.rm);
    pageStudy();
    markNav(currentPath());
  }));
  paintRail();
}

// ------------------------------------------------------------------ lessons

async function pageLessons() {
  if (!lessonState) {
    const batch = Store.lessons().slice(0, LESSON_BATCH);
    if (!batch.length) {
      app.innerHTML = '<h1 class="page-title">Lessons</h1>' + withRail(`<div class="card">
        <p class="empty">No lessons waiting.</p>
        <p class="small muted">Add characters and words with <b>Add to lessons</b> on a character's page
          or in the reader's word popup.</p>
        <p><a class="btn" href="#/study">Back to study</a></p></div>`, true);
      paintRail();
      return;
    }
    lessonState = { batch, i: 0, tab: 0, done: [] };
  }
  const s = lessonState;
  if (s.i >= s.batch.length) return lessonsDone();
  const k = s.batch[s.i], it = Store.item(k);
  if (!it) { s.i++; return pageLessons(); }
  const f = await itemFacts(k, it);
  const tabs = [it.kind === 'word' ? 'Characters' : 'Composition', 'Mnemonic', 'Examples', 'Confirmation'];
  const quiz = s.tab === 3;

  let body = '';
  if (s.tab === 0) {
    body = it.kind === 'word'
      ? `<h3>Characters</h3><p class="muted">This word is made of these characters. Can you see how they
          make its meaning and its sound?</p><div class="lx-chips">${f.parts.map(([c, g]) => chip(c, g)).join('')}</div>`
      : `<h3>Composition</h3><p class="muted">This character is made of these parts. Can you see where they are?</p>
         <div class="lx-chips">${f.comps.map(([c, g]) => chip(c, g)).join('') || '<span class="muted small">It is a part of its own.</span>'}</div>
         ${f.sound ? `<h3>Sound</h3><p class="muted"><span class="han">${esc(f.sound[0])}</span> ${esc(f.sound[1])}
           gives the sound: <b>${esc(it.pin)}</b>.</p>` : ''}`;
  } else if (s.tab === 1) {
    const scaffold = it.kind === 'word'
      ? f.parts.map(([c, g]) => `<b class="han">${esc(c)}</b> ${esc(g)}`).join(' + ')
      : f.comps.map(([c, g]) => `<b class="han">${esc(c)}</b> ${esc(g || '?')}`).join(' + ');
    body = `<h3>Mnemonic</h3>
      <p class="muted">${scaffold ? scaffold + ' → ' : ''}<b class="han">${esc(k)}</b> ${esc(primary(it))}
        · sounds <b>${esc(it.pin)}</b></p>
      <textarea id="lx-mn" rows="4" placeholder="Make up a little story that joins the parts, the meaning and the sound…">${esc(it.mnemonic || '')}</textarea>
      <p class="small muted" id="lx-mn-state">Saved as you type.</p>
      <h3>Meaning</h3>
      <dl class="lx-dl"><dt>Primary</dt><dd><b>${esc(primary(it))}</b></dd>
        <dt>Alternatives</dt><dd>${others(it).length ? esc(others(it).join(', ')) : '<span class="muted">none</span>'}</dd></dl>
      <h3>Pronunciation</h3>
      <dl class="lx-dl"><dt>Primary</dt><dd><b>${esc(numbered(it.pin))}</b> · ${esc(it.pin)}</dd></dl>`;
  } else if (s.tab === 2) {
    body = `<h3>Examples</h3>
      ${it.ex && it.ex.text ? `<p class="muted">Where you found it:</p>${foundIn(k, it)}` : ''}
      ${f.words.length ? `<p class="muted">Words it is in:</p>
        <div class="lx-chips">${f.words.map(([w, p]) => chip(w, p, '#/search/' + encodeURIComponent(w))).join('')}</div>` : ''}
      ${!(it.ex && it.ex.text) && !f.words.length ? '<p class="muted">No examples yet.</p>' : ''}`;
  } else {
    body = `<h3>Confirmation</h3>
      <p class="muted">Type its <b>pronunciation</b> (tone numbers, like ${esc(numbered(it.pin) || 'pin1yin1')}) and its <b>meaning</b>.</p>
      <form id="lx-quiz" autocomplete="off">
        <input id="lx-pin" class="lx-input" placeholder="Pronunciation…" spellcheck="false" autocapitalize="off" lang="en">
        <input id="lx-mean" class="lx-input" placeholder="Meaning…" spellcheck="false" autocapitalize="off" lang="en">
        <div id="lx-verdict"></div>
        <button class="btn" type="submit">Check</button>
      </form>`;
  }

  app.innerHTML = band(k, it, !quiz) + `
    <nav class="lx-tabs">${tabs.map((t, i) => `<button data-t="${i}" class="${i === s.tab ? 'on' : ''}">${t}</button>`).join('')}</nav>
    <div class="lx-body">
      <button class="lx-arrow prev" ${s.tab === 0 ? 'disabled' : ''} aria-label="Back">‹</button>
      <div class="lx-main">${body}</div>
      <button class="lx-arrow next" ${quiz ? 'disabled' : ''} aria-label="Next">›</button>
    </div>
    <div class="lx-batch">${s.batch.map((b, i) => `<span class="${Store.item(b) ? Store.item(b).kind : ''}
      ${i === s.i ? 'on' : ''} ${s.done.includes(b) ? 'done' : ''}">${esc(b)}</span>`).join('')}</div>`;

  const go2 = t => { s.tab = Math.max(0, Math.min(3, t)); pageLessons(); };
  app.querySelectorAll('.lx-tabs button').forEach(b => b.addEventListener('click', () => go2(+b.dataset.t)));
  app.querySelector('.lx-arrow.prev').addEventListener('click', () => go2(s.tab - 1));
  app.querySelector('.lx-arrow.next').addEventListener('click', () => go2(s.tab + 1));

  const mn = document.getElementById('lx-mn');
  if (mn) {
    let timer;
    mn.addEventListener('input', () => {
      clearTimeout(timer);
      document.getElementById('lx-mn-state').textContent = 'Saving…';
      timer = setTimeout(() => {
        it.mnemonic = mn.value.trim();
        Store.save();
        document.getElementById('lx-mn-state').textContent = 'Saved.';
      }, 500);
    });
  }

  const form = document.getElementById('lx-quiz');
  if (form) {
    document.getElementById('lx-pin').focus();
    form.addEventListener('submit', e => {
      e.preventDefault();
      const pa = document.getElementById('lx-pin').value, ma = document.getElementById('lx-mean').value;
      const pinOk = Learn.checkPinyin(pa, it.pin), meanOk = Learn.checkMeaning(ma, it);
      if (pinOk && meanOk) {
        Learn.finishLesson(it, Date.now());
        Store.learnSaved(k);
        s.done.push(k);
        s.i++; s.tab = 0;
        markNav(currentPath());
        return pageLessons();
      }
      document.getElementById('lx-verdict').innerHTML = `<p class="lx-wrong">
        ${pinOk ? '' : `Pronunciation: <b>${esc(numbered(it.pin))}</b> (${esc(it.pin)}). `}
        ${meanOk ? '' : `Meaning: <b>${esc(primary(it))}</b>. `}Try again.</p>`;
    });
  }
  paintRail();
}

function lessonsDone() {
  const s = lessonState, more = Store.lessons().length;
  lessonState = null;
  app.innerHTML = '<h1 class="page-title">Lessons</h1>' + withRail(`<div class="card">
    <h2>${s.done.length} lesson${s.done.length === 1 ? '' : 's'} done</h2>
    <p class="muted">They come back for their first review tomorrow.</p>
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

async function pageReviews() {
  if (!reviewState) {
    const keys = shuffle(Store.due());
    if (!keys.length) {
      const next = Object.values(Store.load().items).filter(it => it.stage >= 1 && it.stage < Learn.MASTER)
        .map(it => it.due).sort((a, b) => a - b)[0];
      app.innerHTML = '<h1 class="page-title">Reviews</h1>' + withRail(`<div class="card">
        <p class="empty">No reviews due.</p>
        ${next ? `<p class="small muted">The next one is due ${esc(new Date(next).toLocaleString())}.</p>` : ''}
        <p><a class="btn" href="#/study">Back to study</a></p></div>`, true);
      paintRail();
      return;
    }
    const queue = [];
    keys.forEach(k => shuffle(['meaning', 'pinyin']).forEach(q => queue.push({ k, q })));
    reviewState = { queue, i: 0, answered: {}, misses: {}, right: [], wrong: [], shown: null, info: false };
  }
  const s = reviewState;
  if (s.i >= s.queue.length) return reviewsDone();
  const { k, q } = s.queue[s.i], it = Store.item(k);
  if (!it) { s.i++; return pageReviews(); }
  if (!it.alts.length || !it.pin) await itemFacts(k, it);
  const total = new Set(s.queue.map(x => x.k)).size, finished = s.right.length + s.wrong.length;
  const pct = finished ? Math.round(100 * s.right.length / finished) : 100;
  const shown = s.shown;

  app.innerHTML = `
    <div class="rv-top"><span>${pct}% right</span><span>${finished} done</span><span>${total - finished} left</span></div>
    ${band(k, it, false)}
    <div class="rv-prompt">${kindName(it)} <b>${q === 'pinyin' ? 'Pronunciation' : 'Meaning'}?</b></div>
    <form id="rv-form" autocomplete="off">
      <input id="rv-in" class="rv-input ${shown ? (shown.ok ? 'ok' : 'bad') : ''}"
        placeholder="${q === 'pinyin' ? 'pin1yin1' : 'Meaning…'}" spellcheck="false" autocapitalize="off" lang="en"
        ${shown ? 'readonly' : ''} value="${shown ? esc(shown.answer) : ''}">
    </form>
    ${shown ? `<div class="rv-after">
      ${shown.ok ? '' : `<p class="lx-wrong">${q === 'pinyin'
        ? `It is <b>${esc(numbered(it.pin))}</b> (${esc(it.pin)}).` : `It means <b>${esc(primary(it))}</b>.`}</p>`}
      <p class="row">
        <button class="btn quiet" id="rv-info">${s.info ? 'Hide' : 'Show'} ${kindName(it).toLowerCase()}</button>
        ${!shown.ok && q === 'meaning' && shown.answer.trim() ? '<button class="btn quiet" id="rv-syn">My answer was right</button>' : ''}
        <span class="small muted">Enter for the next one</span></p>
      ${s.info ? `<div class="card rv-info">
        <p><b class="han">${esc(k)}</b> · <b>${esc(it.pin)}</b> (${esc(numbered(it.pin))}) · ${esc(Learn.meanings(it).join(', '))}</p>
        <p class="small muted">${esc(Learn.stageName(it.stage))}${it.mnemonic ? '' : ' · no mnemonic yet'}</p>
        ${it.mnemonic ? `<p>${esc(it.mnemonic)}</p>` : ''}
        ${foundIn(k, it)}
        <p class="small"><a href="#/character/${encodeURIComponent([...k][0])}">Open ${esc([...k][0])} →</a></p></div>` : ''}
    </div>` : ''}`;

  const input = document.getElementById('rv-in');
  input.focus();
  document.getElementById('rv-form').addEventListener('submit', e => {
    e.preventDefault();
    if (s.shown) return nextQuestion();
    const answer = input.value;
    if (!answer.trim()) return;
    const ok = q === 'pinyin' ? Learn.checkPinyin(answer, it.pin) : Learn.checkMeaning(answer, it);
    s.shown = { ok, answer };
    if (!ok) {
      s.misses[k] = (s.misses[k] || 0) + 1;
      s.queue.push({ k, q });                      // asked again before the session ends
    }
    pageReviews();
  });
  if (shown) {
    document.getElementById('rv-info').addEventListener('click', () => { s.info = !s.info; pageReviews(); });
    const syn = document.getElementById('rv-syn');
    if (syn) syn.addEventListener('click', () => {
      // accept it: remember the wording, and take back the miss and the repeat
      it.syn = (it.syn || []).concat(shown.answer.trim());
      s.misses[k]--;
      for (let j = s.queue.length - 1; j > s.i; j--) {
        if (s.queue[j].k === k && s.queue[j].q === q) { s.queue.splice(j, 1); break; }
      }
      s.shown = { ok: true, answer: shown.answer };
      Store.save();
      pageReviews();
    });
  }
  paintRail();
}

function nextQuestion() {
  const s = reviewState, { k, q } = s.queue[s.i];
  if (s.shown.ok) {
    const a = s.answered[k] = s.answered[k] || {};
    a[q] = true;
    if (a.meaning && a.pinyin) {
      const it = Store.item(k), right = !s.misses[k];
      Learn.review(it, right, Date.now());
      Store.learnSaved(k);
      (right ? s.right : s.wrong).push(k);
      markNav(currentPath());
    }
  }
  s.i++;
  s.shown = null;
  s.info = false;
  pageReviews();
}

function reviewsDone() {
  const s = reviewState;
  reviewState = null;
  const list = ks => ks.map(k => `<a class="lx-q ${(Store.item(k) || {}).kind || ''}" href="#/character/${encodeURIComponent([...k][0])}">
    <span class="han">${esc(k)}</span></a>`).join('');
  const done = s.right.length + s.wrong.length;
  app.innerHTML = '<h1 class="page-title">Review summary</h1>' + withRail(`<div class="card">
    <h2>${done ? Math.round(100 * s.right.length / done) : 100}% right</h2>
    <p class="muted">${s.right.length} of ${done} right first time.</p>
    ${s.wrong.length ? `<h3>Missed</h3><div class="lx-queue">${list(s.wrong)}</div>` : ''}
    ${s.right.length ? `<h3>Right</h3><div class="lx-queue">${list(s.right)}</div>` : ''}
    <p><a class="btn" href="#/study">Back to study</a></p></div>`, true);
  paintRail();
}
