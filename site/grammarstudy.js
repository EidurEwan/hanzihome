/* grammarstudy.js — the Grammar page (#/grammar): short explanations of the patterns a
 * beginner needs, and practice at putting sentences together. It is extra study, to dip
 * into whenever you like: nothing here is scheduled, or counts towards the day's lessons,
 * reviews, limits or streak. What you did is only noted beside each point
 * (Store.data.grammar = {point id: {read, runs, best, of, last}, _daily: {day, newDay}}).
 *
 * Practice only uses what you have learned (Learn.knownChars): a sentence with any other
 * character is left out, and so is a gap's option. The explanations show their examples anyway.
 *
 *   #/grammar            the points
 *   #/grammar/ID         one point, with its pattern, why, examples and the common mistake
 *   #/grammar/ID/practice   a round of exercises
 *   #/grammar/daily      Today's daily practice: a round from a few points, teaching
 *                        first any it brings in that you haven't read, one new point a day
 *
 * Content: data/gpoints.js, from build/grammar/points.json (build/grammar/build.js).
 * site/grammar.js is another thing: it finds patterns in a sentence for the translator. */

const GR_ROUND = 6;                 // exercises in a round

const grHan = s => [...s].filter(isHan);
const grZh = x => x.full[0].split('|').join('');
const grTotal = p => p.gap.length + p.order.length + p.spot.length;
/* the exercises you can do: every character in them learned. A gap keeps the wrong options
   you know, and needs one at least. */
function grReady(p) {
  const known = Learn.knownChars(Store.load());
  const can = s => grHan(s).every(c => known.has(c));
  return [
    ...p.gap.filter(x => can(grZh(x))).map(x => ({ kind: 'gap', point: p, ...x, wrong: x.wrong.filter(can) })).filter(x => x.wrong.length),
    ...p.order.filter(x => can(grZh(x))).map(x => ({ kind: 'order', point: p, ...x })),
    ...p.spot.filter(x => can(x.right) && can(x.wrong)).map(x => ({ kind: 'spot', point: p, ...x })),
  ];
}
/* the word to highlight in an example */
const grMarked = (p, ex) => p.mark.find(m => ex[0].includes(m)) || p.mark[0];

/* a round: some of what you can do, in a new order each time */
const grRound = p => shuffle(grReady(p)).slice(0, GR_ROUND);
const GR_NOT_YET = 'Practice opens once you have learned the characters in its sentences.';

/* a point in the list: only what is its own (read, practised, ready), not what every
   point would say */
function grPointCard(p, can) {
  const i = HZ.gpoints.indexOf(p);
  const did = Store.load().grammar[p.id] || {};
  const times = n => `${n} ${n === 1 ? 'time' : 'times'}`;
  const note = did.runs ? `Practised ${times(did.runs)}${did.of ? ` · best ${did.best} of ${did.of}` : ''}`
    : can ? `${can} ${can === 1 ? 'sentence' : 'sentences'} ready to practise` : '';
  const tag = did.runs ? '' : did.read ? '<span class="gr-tag read">Read</span>' : can ? '<span class="gr-tag new">New</span>' : '';
  return `<a class="card gr-card${did.read || did.runs ? ' seen' : ''}" href="#/grammar/${p.id}">
    <span class="gr-num">${did.read || did.runs ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span class="sr-only">Read. </span>' : i + 1}</span>
    <span class="gr-card-text"><b class="han">${esc(p.title)}</b>
      <span class="gr-pattern han">${esc(p.pattern)}</span>
      ${note ? `<span class="gr-note">${note}</span>` : ''}
    </span>${tag}</a>`;
}

/* where to carry on: a point you can practise and haven't read, then the first you haven't
   read, then the one you have left longest */
function grNextPoint(ready) {
  const g = Store.load().grammar, seen = p => g[p.id] && (g[p.id].read || g[p.id].runs);
  const unread = HZ.gpoints.filter(p => !seen(p));
  const fresh = unread.find(p => ready.get(p)) || unread[0];
  if (fresh) return { p: fresh, eyebrow: HZ.gpoints.some(seen) ? 'Up next' : 'Start here', go: 'Read' };
  const practisable = HZ.gpoints.filter(p => ready.get(p));
  if (!practisable.length) return null;
  const last = p => (g[p.id] && g[p.id].last) || 0;
  const p = practisable.slice().sort((a, b) => last(a) - last(b))[0];
  return { p, eyebrow: 'Left longest', go: 'Practise', href: `#/grammar/${p.id}/practice` };
}

/* a point's pattern, as a few chips for its card: the short parts of its first way of saying it
   (A + 是 + B), or just its number when the parts are long */
function grChips(p, n) {
  const parts = p.pattern.split('·')[0].split('+').map(x => x.trim().replace(/[？?。]$/, '')).filter(Boolean);
  if (parts.length < 2 || parts.length > 4 || parts.some(x => [...x].length > 4)) return [String(n)];
  return parts.flatMap((x, i) => [...(i ? ['+'] : []), /[㐀-鿿]/.test(x) ? `<span class="han">${esc(x)}</span>` : esc(x)]);
}

function grList() {
  const g = Store.load().grammar, pts = HZ.gpoints;
  const ready = new Map(pts.map(p => [p, grReady(p).length]));
  const seen = p => !!(g[p.id] && (g[p.id].read || g[p.id].runs));
  const nRead = pts.filter(seen).length, nReady = pts.filter(p => ready.get(p)).length;
  const next = grNextPoint(ready);
  const levels = [...new Set(pts.map(p => p.level))];
  app.innerHTML = `<h1 class="page-title">Grammar</h1>
    <p class="lede">Short explanations, and practice at building sentences. Never scheduled, never counted.</p>
    ${next ? heroCard({ kind: 'grammar', eyebrow: `${next.eyebrow} · point ${pts.indexOf(next.p) + 1}`, chips: grChips(next.p, pts.indexOf(next.p) + 1),
      title: `<span class="han">${esc(next.p.title)}</span>`, sub: `<span class="han">${esc(next.p.pattern)}</span> · ${next.go === 'Read' ? 'a short read, then practice' : 'a round of practice'}`,
      go: next.go, href: next.href || `#/grammar/${next.p.id}` }) : ''}
    <div class="pt-grid three">
      ${ptTile('Read', `<b class="pt-big">${nRead} <small>of ${pts.length}</small></b>${ptBar(nRead / pts.length, 'grammar')}`)}
      ${ptTile('Ready to practise', `<b class="pt-big">${nReady}</b><span class="pt-note">Each opens once you know the characters in its sentences</span>`)}
      ${ptTile('Daily round', `<a class="pt-link" href="#/grammar/daily">Six sentences →</a><span class="pt-note">from the points you have read</span>`)}
    </div>
    ${levels.map(l => {
      const here = pts.filter(p => p.level === l), done = here.filter(seen).length;
      return `<div class="pt-label"><h2>Around HSK ${l}</h2><span>${done} / ${here.length} read</span></div>
      <div class="gr-list">${here.map(p => grPointCard(p, ready.get(p))).join('')}</div>`;
    }).join('')}`;
}

/* you have read a point's explanation */
function grMarkRead(p) {
  const d = Store.load();
  if (d.grammar[p.id] && d.grammar[p.id].read) return;
  d.grammar[p.id] = { ...d.grammar[p.id], read: Date.now() };
  Store.save();
}

/* the pattern as its parts: the grammar's own words in the colour they are marked in the
   examples, the slots you fill in as quieter chips, the + between them. "A · B" is two
   ways of saying it, one under the other. */
function grFormula(pattern) {
  const hanRun = /([㐀-鿿]+(?:\/[㐀-鿿]+)*)/g;
  const pureHan = s => /^[㐀-鿿？/]+$/.test(s);
  const part = s => {
    s = s.trim();
    if (!s) return '';
    if (pureHan(s)) return `<span class="gr-chip key">${esc(s)}</span>`;
    const inner = esc(s).replace(hanRun, '<b class="gr-k">$1</b>');
    return `<span class="gr-chip slot">${inner}</span>`;
  };
  const way = w => {
    const bits = w.split(/(\s*\+\s*|，)/);
    // (one without a + is a sentence about where things go, not a formula)
    if (bits.length === 1 && !/[㐀-鿿]/.test(w)) return `<span class="gr-say">${esc(w)}</span>`;
    return bits.map(b => /^\s*\+\s*$/.test(b) ? '<span class="gr-plus" aria-hidden="true">+</span>'
      : b === '，' ? '<span class="gr-comma">，</span>' : part(b)).join('');
  };
  return `<div class="gr-formula han" aria-label="${esc(pattern)}">${pattern.split(/\s+·\s+/)
    .map(w => `<div class="gr-way">${way(w)}</div>`).join('')}</div>`;
}

/* an example's sentence, said: on the recordings, syllable by syllable, or the browser's voice */
const grSayBtn = ex => Sound.canSay()
  ? `<button type="button" class="btn quiet gr-say" data-gr-say="${esc(ex[0].split('|').join(''))}" data-pin="${esc(ex[1].split('|').join(' ').trim())}" aria-label="Hear it">▶</button>` : '';
function grWireSay(root = app) {
  root.querySelectorAll('[data-gr-say]').forEach(b => b.addEventListener('click', () => {
    const text = b.dataset.grSay, han = [...text].filter(isHan).join('');
    if (Store.cfg().audio === 'browser') Sound.speak(text, Store.cfg());
    else Sound.say(han, true, b.dataset.pin);
  }));
}

/* the explanation: its pattern, why, examples and the common mistake */
function grExplain(p) {
  return `<section class="card">
      <h1 class="han">${esc(p.title)}</h1>
      ${grFormula(p.pattern)}
      <p>${esc(p.why)}</p>
    </section>
    <h2 class="sec-h">Examples</h2>
    <div class="decomp-box pad">${p.ex.map(ex => `<div class="example gr-example"><div>${exampleHtml(ex, grMarked(p, ex))}</div>${grSayBtn(ex)}</div>`).join('')}</div>
    <h2 class="sec-h">The common mistake</h2>
    <div class="decomp-box pad gr-mistake">
      <p class="gr-wrong han"><span aria-hidden="true">✗</span> <span class="sr-only">Wrong:</span> ${zh(p.mistake[0])}</p>
      <p class="gr-right han"><span aria-hidden="true">✓</span> <span class="sr-only">Right:</span> ${zh(p.mistake[1])}</p>
      <p class="muted">${esc(p.mistake[2])}</p>
    </div>`;
}

/* what practice on a point is waiting for: the fewest characters that would open a
   sentence, and how many sentences there are. {chars: [...], opens: n} or null */
function grLocked(p) {
  const known = Learn.knownChars(Store.load());
  const missing = s => [...new Set(grHan(s).filter(c => !known.has(c)))];
  const needs = [
    ...p.gap.map(x => missing(grZh(x))), ...p.order.map(x => missing(grZh(x))),
    ...p.spot.map(x => missing(x.right + x.wrong)),
  ].filter(m => m.length).sort((a, b) => a.length - b.length);
  if (!needs.length) return null;
  const chars = needs[0];
  // (every sentence those characters would open, not just the one)
  const opens = needs.filter(m => m.every(c => chars.includes(c))).length;
  return { chars, opens };
}

function grPoint(p) {
  const i = HZ.gpoints.indexOf(p), prev = HZ.gpoints[i - 1], next = HZ.gpoints[i + 1];
  grMarkRead(p);
  const ready = grReady(p).length, lock = ready ? null : grLocked(p);
  const charLinks = cs => cs.map(c => `<a class="gr-need-c han" href="#/character/${encodeURIComponent(c)}">${esc(c)}</a>`).join('');
  app.innerHTML = `<p class="crumb"><a href="#/grammar">Grammar</a> / <span class="han">${esc(p.title)}</span></p>
    ${grExplain(p)}
    ${ready ? `<p class="gr-actions"><a class="btn" href="#/grammar/${p.id}/practice">Practise</a>
        <span class="small muted gr-ready">${ready} of ${grTotal(p)} sentences ready</span></p>`
      : lock ? `<div class="gr-need"><span class="gr-need-lock" aria-hidden="true">🔒</span>
        <p><b>Practice is waiting on ${lock.chars.length === 1 ? 'one character' : `${lock.chars.length} characters`}</b>
        <span class="small muted">Learn ${lock.chars.length === 1 ? 'it' : 'them'} in lessons, or mark ${lock.chars.length === 1 ? 'it' : 'them'} Known, to open ${lock.opens === 1 ? 'the first practice sentence' : `${lock.opens} practice sentences`}.</span></p>
        <div class="gr-need-cs">${charLinks(lock.chars)}</div></div>`
      : `<p class="muted small">${GR_NOT_YET}</p>`}
    <nav class="gr-pager" aria-label="Grammar points">
      ${prev ? `<a class="gr-page prev" href="#/grammar/${prev.id}"><small>← Previous</small><b class="han">${esc(prev.title)}</b></a>` : '<span></span>'}
      ${next ? `<a class="gr-page next" href="#/grammar/${next.id}"><small>Next →</small><b class="han">${esc(next.title)}</b></a>` : ''}
    </nav>`;
  grWireSay();
}

/* a round on one point */
function grPractice(p) {
  const round = grRound(p);
  if (!round.length) return grPoint(p);
  const crumb = `<a href="#/grammar">Grammar</a> / <a class="han" href="#/grammar/${p.id}">${esc(p.title)}</a>`;
  grRun(round, crumb, (right, missed) => {
    const d = Store.load(), was = { runs: 0, best: 0, ...d.grammar[p.id] };
    const better = !was.of || right / round.length >= was.best / was.of;
    d.grammar[p.id] = { ...was, runs: was.runs + 1, best: better ? right : was.best, of: better ? round.length : was.of, last: Date.now() };
    Store.save();
    app.innerHTML = `<p class="crumb">${crumb}</p>
      <section class="card gr-done"><h1>${right} of ${round.length}</h1>
        <p class="muted">${right === round.length ? 'All of them right.' : 'Go again whenever you like, or look over the explanation.'}</p>
        ${grMissesHtml(missed)}
        <p class="gr-actions"><button type="button" class="btn${missed.length ? ' quiet' : ''}" id="gr-again">Practise again</button>
          <a class="btn quiet" href="#/grammar/${p.id}">The explanation</a>
          <a class="btn quiet" href="#/grammar">All grammar</a></p></section>`;
    document.getElementById('gr-again').addEventListener('click', () => grPractice(p));
    const just = document.getElementById('gr-misses');
    if (just) just.addEventListener('click', () => grRetry(missed, crumb,
      `<a class="btn" href="#/grammar/${p.id}/practice">A new round</a> <a class="btn quiet" href="#/grammar/${p.id}">The explanation</a>`));
    window.scrollTo(0, 0);
  });
}

/* the daily practice's points: at most one new a day, the first you can practise and haven't
   read, then the ones you have left longest. {fresh: the new one or null, points: all of them} */
function grDailyPick() {
  const g = Store.load().grammar, ready = HZ.gpoints.filter(p => grReady(p).length);
  const read = ready.filter(p => g[p.id] && g[p.id].read);
  const newAllowed = !(g._daily && g._daily.newDay === today());
  const fresh = newAllowed ? ready.find(p => !read.includes(p)) || null : null;
  const lastOf = p => (g[p.id] && g[p.id].last) || 0;
  const old = read.map((p, i) => [p, i]).sort((a, b) => lastOf(a[0]) - lastOf(b[0]) || a[1] - b[1]).map(x => x[0]);
  return { fresh, points: [...(fresh ? [fresh] : []), ...old.slice(0, fresh ? 2 : 3)] };
}
/* a round shared out among the points, in a new order each time */
function grDailyRound(points) {
  const pools = points.map(p => shuffle(grReady(p))), round = [];
  for (let i = 0; round.length < GR_ROUND && pools.some(q => q.length); i++) {
    const q = pools[i % pools.length];
    if (q.length) round.push(q.pop());
  }
  return shuffle(round);
}
function grDailyRun(points) {
  const round = grDailyRound(points), crumb = '<a href="#/study">Today</a> / Daily grammar practice';
  grRun(round, crumb, (right, missed) => {
    const d = Store.load(), now = Date.now();
    for (const p of points) d.grammar[p.id] = { ...d.grammar[p.id], runs: ((d.grammar[p.id] || {}).runs || 0) + 1, last: now };
    d.grammar._daily = { ...d.grammar._daily, day: today() };
    Store.save();
    app.innerHTML = `<p class="crumb">${crumb}</p>
      <section class="card gr-done"><h1>${right} of ${round.length}</h1>
        <p class="muted">${right === round.length ? 'All of them right.' : 'Look over any that tripped you up:'}</p>
        ${grMissesHtml(missed)}
        <p class="small muted gr-today-pts">Today's points</p>
        <div class="gr-actions">${points.map(p => `<a class="btn quiet han" href="#/grammar/${p.id}">${esc(p.title)}</a>`).join('')}</div>
        <p class="gr-actions"><a class="btn${missed.length ? ' quiet' : ''}" href="#/study">Back to Today</a>
          <button type="button" class="btn quiet" id="gr-again">Another round</button></p></section>`;
    document.getElementById('gr-again').addEventListener('click', grDaily);
    const just = document.getElementById('gr-misses');
    if (just) just.addEventListener('click', () => grRetry(missed, crumb, '<a class="btn" href="#/study">Back to Today</a>'));
    window.scrollTo(0, 0);
  });
}
function grDaily() {
  const { fresh, points } = grDailyPick();
  if (!points.length) {
    app.innerHTML = `<p class="crumb"><a href="#/study">Today</a> / Daily grammar practice</p>
      <section class="card"><h1>Daily grammar practice</h1>
        <p class="empty">Nothing to practise yet. It opens once you have learned the characters in a grammar point's sentences, in lessons or marked Known.</p>
        <p class="gr-actions"><a class="btn" href="#/study">Back to Today</a>
          <a class="btn quiet" href="#/grammar">Read the grammar</a></p></section>`;
    return;
  }
  if (!fresh) return grDailyRun(points);
  /* a point you haven't read: taught first */
  app.innerHTML = `<p class="crumb"><a href="#/study">Today</a> / Daily grammar practice / New</p>
    <p class="gr-new">New today. Read this, then you'll practise it.</p>
    ${grExplain(fresh)}
    <p class="gr-actions"><button type="button" class="btn" id="gr-start">Start practice</button></p>`;
  grWireSay();
  window.scrollTo(0, 0);
  document.getElementById('gr-start').addEventListener('click', () => {
    grMarkRead(fresh);
    const d = Store.load();
    d.grammar._daily = { ...d.grammar._daily, newDay: today() };
    Store.save();
    grDailyRun(points);
  });
}

/* a round: for each exercise the English, its own part, and what happens once it is answered.
   crumb: the trail above it; finish(number right, the ones missed) draws what comes after.
   Keys: 1–9 pick an answer (a word, in the order the tiles are in), Backspace takes the last
   word back, Enter checks and goes on. */
function grRun(round, crumb, finish) {
  let at = 0, right = 0;
  const missed = [];
  const reduced = () => typeof Motion !== 'undefined' && Motion.reduced();

  /* the keys, while a round is on screen; gone once it isn't */
  if (grRun.keys) document.removeEventListener('keydown', grRun.keys);
  grRun.keys = e => {
    if (!app.querySelector('.gr-ex')) { document.removeEventListener('keydown', grRun.keys); grRun.keys = null; return; }
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    const next = document.getElementById('gr-next');
    if (e.key === 'Enter') {
      const check = document.getElementById('gr-check');
      const go = next || (check && !check.disabled ? check : null);
      if (go && e.target !== go) { e.preventDefault(); go.click(); }
      return;
    }
    if (next) return;
    if (e.key === 'Backspace') {
      const last = app.querySelectorAll('#gr-line .gr-tile:not(:disabled)');
      if (last.length) { e.preventDefault(); last[last.length - 1].click(); }
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      const hear = document.getElementById('gr-listen');
      if (hear) { e.preventDefault(); hear.click(); }
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const b = app.querySelectorAll('#gr-opts > button:not(:disabled), #gr-pool > button:not(:disabled)')[+e.key - 1];
      if (b) { e.preventDefault(); b.click(); }
    }
  };
  document.addEventListener('keydown', grRun.keys);

  const show = () => {
    const x = round[at];
    if (!x) return finish(right, missed);
    const p = x.point;
    const head = `<p class="crumb">${crumb}</p>
      <div class="gr-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${round.length}" aria-valuenow="${at}" aria-label="Question ${at + 1} of ${round.length}">
        <span class="gr-prog-bar"><i style="--w:${(100 * at) / round.length}%"></i></span><span class="gr-prog-n">${at + 1} / ${round.length}</span></div>`;
    const key = i => `<kbd class="gr-key" aria-hidden="true">${i + 1}</kbd>`;
    const tile = (w, pin, attrs, k = '') => `<button type="button" class="gr-tile han" ${attrs}>${k}<span>${zhOne(w)}</span>${pin ? `<small>${esc(pin)}</small>` : ''}</button>`;
    /* it is answered: say so, show the sentence in full, on to the next */
    const answered = ok => {
      if (ok) right++; else missed.push(x);
      const bar = app.querySelector('.gr-prog-bar i');
      if (bar) bar.style.setProperty('--w', `${(100 * (at + 1)) / round.length}%`);
      const box = document.getElementById('gr-result');
      box.hidden = false;
      box.className = 'gr-result ' + (ok ? 'ok' : 'no');
      box.innerHTML = `<p class="gr-verdict">${ok ? 'Right' : 'Not quite. It goes:'}</p>
        ${x.full ? `<div class="example">${exampleHtml(x.full, grMarked(p, x.full))}</div>` : ''}
        <p><button type="button" class="btn" id="gr-next">${at + 1 < round.length ? 'Next' : 'Finish'} <kbd class="gr-key in-btn" aria-hidden="true">Enter</kbd></button></p>`;
      const nextBtn = document.getElementById('gr-next');
      nextBtn.addEventListener('click', () => { at++; show(); });
      nextBtn.focus({ preventScroll: true });
    };

    if (x.kind === 'choose') {
      /* a question with its options: x.big and bigPin above them if it has them */
      const opts = shuffle(x.options.slice());
      app.innerHTML = `${head}<section class="card gr-ex">
        <p class="gr-en">${esc(x.en)}</p>
        ${x.play ? `<div class="gr-listen-row"><button type="button" class="gr-listen" id="gr-listen" aria-label="Play it again">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg></button>
            <span class="small muted">Listen${x.ask ? '' : ', then choose'}. <span class="ph-keys"><kbd class="gr-key">R</kbd> plays it again</span></span></div>`
          : x.big ? `<p class="gr-sentence han ph-prompt">${zhOne(x.big)}${x.bigPin ? `<small>${esc(x.bigPin)}</small>` : ''}</p>` : ''}
        ${x.ask ? `<p class="muted">${esc(x.ask)}</p>` : ''}
        <div class="gr-spots" id="gr-opts">${opts.map((o, i) => `<button type="button" class="gr-spot${x.han ? ' han' : ' ph-en'}" data-i="${i}">${key(i)}${x.han ? zhOne(o.text) : esc(o.text)}</button>`).join('')}</div>
        <div id="gr-result" hidden aria-live="polite"></div></section>`;
      const box = document.getElementById('gr-opts');
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(o => { o.disabled = true; o.classList.add(opts[+o.dataset.i].ok ? 'ok' : 'no'); });
        answered(!!opts[+b.dataset.i].ok);
      }));
      /* a listening question: said as it comes up, and again on a press */
      const hear = document.getElementById('gr-listen');
      if (hear) {
        const say = () => { hear.classList.remove('playing'); void hear.offsetWidth; hear.classList.add('playing'); x.play(); };
        hear.addEventListener('click', say);
        setTimeout(() => { if (hear.isConnected) say(); }, 250);
      }
    } else if (x.kind === 'spot') {
      const opts = shuffle([x.right, x.wrong]);
      app.innerHTML = `${head}<section class="card gr-ex">
        <p class="gr-en">${esc(x.en)}</p>
        <p class="muted">Which one is correct?</p>
        <div class="gr-spots" id="gr-opts">${opts.map((s, i) => `<button type="button" class="gr-spot han" data-s="${esc(s)}">${key(i)}${zhOne(s)}</button>`).join('')}</div>
        <div id="gr-result" hidden aria-live="polite"></div></section>`;
      const box = document.getElementById('gr-opts');
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(o => { o.disabled = true; o.classList.add(o.dataset.s === x.right ? 'ok' : 'no'); });
        answered(b.dataset.s === x.right);
      }));
    } else if (x.kind === 'gap') {
      const opts = shuffle([x.a, ...x.wrong]);
      app.innerHTML = `${head}<section class="card gr-ex">
        <p class="gr-en">${esc(x.en)}</p>
        <p class="gr-sentence han">${zhOne(x.before)}<span class="gr-blank" id="gr-blank">&nbsp;</span>${zhOne(x.after)}</p>
        <div class="gr-tiles" id="gr-opts">${opts.map((w, i) => tile(w, x.pins[w], `data-w="${esc(w)}"`, key(i))).join('')}</div>
        <div id="gr-result" hidden aria-live="polite"></div></section>`;
      const box = document.getElementById('gr-opts');
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(o => { o.disabled = true; });
        const ok = b.dataset.w === x.a;
        b.classList.add(ok ? 'ok' : 'no');
        const blank = document.getElementById('gr-blank');
        blank.innerHTML = zhOne(x.a);
        blank.classList.add('filled', ok ? 'ok' : 'no');
        answered(ok);
      }));
    } else {
      /* the tiles: all but the closing punctuation, which drops in once it is right (a comma is a tile) */
      const parts = x.a.split('|'), pins = x.full[1].split('|');
      const isWord = w => grHan(w).length > 0;
      const noEnd = s => { const w = s.split('|'); return isWord(w[w.length - 1]) ? w : w.slice(0, -1); };
      const end = isWord(parts[parts.length - 1]) ? '' : parts[parts.length - 1];
      const tiles = noEnd(x.a).map((w, i) => ({ w, pin: pins[i], i }));
      const answers = [x.a, ...x.alt].map(s => noEnd(s).join('|'));
      let pool;
      do { pool = shuffle(tiles.slice()); } while (answers.includes(pool.map(t => t.w).join('|')) && tiles.length > 1);
      const placed = [];
      app.innerHTML = `${head}<section class="card gr-ex">
        <p class="gr-en">${esc(x.en)}</p>
        <div class="gr-line han" id="gr-line"></div>
        <div class="gr-tiles" id="gr-pool"></div>
        <p class="gr-actions"><button type="button" class="btn" id="gr-check" disabled>Check <kbd class="gr-key in-btn" aria-hidden="true">Enter</kbd></button></p>
        <div id="gr-result" hidden aria-live="polite"></div></section>`;
      const line = document.getElementById('gr-line'), box = document.getElementById('gr-pool'), check = document.getElementById('gr-check');
      let locked = false, dragged = false;

      /* where every tile was, so that after drawing each one glides from there (FLIP) */
      const where = () => new Map([...app.querySelectorAll('.gr-ex .gr-tile[data-i]')].map(b => [b.dataset.i, b.getBoundingClientRect()]));
      const glide = was => {
        if (reduced() || !was) return;
        app.querySelectorAll('.gr-ex .gr-tile[data-i]').forEach(b => {
          const a = was.get(b.dataset.i), n = b.getBoundingClientRect();
          if (!a) return;
          const dx = a.left - n.left, dy = a.top - n.top;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
          b.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
            { duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)' });
        });
      };

      const draw = (animate = true) => {
        const was = animate ? where() : null;
        line.innerHTML = placed.length ? placed.map(t => tile(t.w, t.pin, `data-i="${t.i}" aria-label="Take back ${esc(t.w)}"`)).join('')
          : '<span class="muted small gr-hint">Tap the words in order</span>';
        box.innerHTML = pool.map((t, n) => tile(t.w, t.pin, `data-i="${t.i}"`, key(n))).join('');
        check.disabled = placed.length !== tiles.length || locked;
        glide(was);
        if (locked) { app.querySelectorAll('.gr-ex .gr-tile').forEach(b => { b.disabled = true; }); return; }
        line.querySelectorAll('button').forEach(b => {
          b.addEventListener('click', () => {
            if (dragged) { dragged = false; return; }
            const n = placed.findIndex(t => t.i === +b.dataset.i);
            pool.push(placed.splice(n, 1)[0]); draw();
          });
          b.addEventListener('pointerdown', e => drag(e, b));
        });
        box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
          const n = pool.findIndex(t => t.i === +b.dataset.i);
          placed.push(pool.splice(n, 1)[0]); draw();
        }));
      };

      /* dragging a placed word to another place in the line */
      const drag = (e, b) => {
        if (e.button !== 0 || locked) return;
        const x0 = e.clientX, y0 = e.clientY, me = placed.find(t => t.i === +b.dataset.i);
        let on = false;
        const others = () => [...line.querySelectorAll('.gr-tile')].filter(o => o !== b);
        const move = ev => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (!on && Math.hypot(dx, dy) < 6) return;
          if (!on) { on = true; b.classList.add('dragging'); try { b.setPointerCapture(e.pointerId); } catch (er) { /* fine */ } }
          b.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
          // where it would go: before the first tile whose middle it hasn't passed (in reading order)
          const rest = others();
          let to = rest.length;
          for (let k = 0; k < rest.length; k++) {
            const r = rest[k].getBoundingClientRect();
            if (ev.clientY < r.top || (ev.clientY <= r.bottom && ev.clientX < r.left + r.width / 2)) { to = k; break; }
          }
          line.querySelectorAll('.gr-tile').forEach(o => o.classList.remove('drop-before', 'drop-after'));
          if (rest[to]) rest[to].classList.add('drop-before'); else if (rest.length) rest[rest.length - 1].classList.add('drop-after');
          b.dataset.to = to;
        };
        const up = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
          if (!on) return;
          dragged = true;
          setTimeout(() => { dragged = false; }, 0);
          const to = +b.dataset.to;
          const was = where();
          placed.splice(placed.indexOf(me), 1);
          placed.splice(to, 0, me);
          b.style.transform = '';
          draw(false);
          glide(was);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      };

      check.addEventListener('click', () => {
        if (check.disabled) return;
        const ok = answers.includes(placed.map(t => t.w).join('|'));
        locked = true; draw(false);
        line.classList.add(ok ? 'ok' : 'no');
        if (ok && end) line.insertAdjacentHTML('beforeend', `<span class="gr-end">${zhOne(end)}</span>`);
        answered(ok);
      });
      draw(false);
    }
    window.scrollTo(0, 0);
  };
  show();
}

/* what you missed in a round, each with how it goes, and a way to go over just those */
function grMissesHtml(missed) {
  const withFull = missed.filter(x => x.full);
  if (!withFull.length) return '';
  return `<div class="gr-misses"><h2 class="sec-h">${withFull.length === 1 ? 'The one you missed' : `The ${withFull.length} you missed`}</h2>
    ${withFull.map(x => `<div class="example gr-miss">${exampleHtml(x.full, grMarked(x.point, x.full))}</div>`).join('')}
    <p class="gr-actions"><button type="button" class="btn" id="gr-misses">Practise just ${withFull.length === 1 ? 'that one' : 'these'}</button></p></div>`;
}
/* going over the missed ones again: not counted, as many times as you like */
function grRetry(missed, crumb, back) {
  grRun(shuffle(missed.slice()), `${crumb} / Again`, (right, still) => {
    app.innerHTML = `<p class="crumb">${crumb} / Again</p>
      <section class="card gr-done"><h1>${right} of ${missed.length}</h1>
        <p class="muted">${still.length ? 'Nearly there.' : missed.length === 1 ? 'Right this time.' : 'All of them right this time.'}</p>
        ${grMissesHtml(still)}
        <p class="gr-actions">${back}</p></section>`;
    const again = document.getElementById('gr-misses');
    if (again) again.addEventListener('click', () => grRetry(still, crumb, back));
    window.scrollTo(0, 0);
  });
}

async function pageGrammar(id, sub) {
  app.innerHTML = LOADING;
  await need.gpoints();
  if (!id) return grList();
  if (id === 'daily') return grDaily();
  const p = HZ.gpoints.find(x => x.id === id);
  if (!p) {
    app.innerHTML = `<div class="card"><h1>Not found</h1><p class="empty">No such grammar point.</p><p><a href="#/grammar">All grammar</a></p></div>`;
    return;
  }
  return sub === 'practice' ? grPractice(p) : grPoint(p);
}
