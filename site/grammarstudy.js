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
 *   #/grammar/daily      the Study page's daily practice: a round from a few points, teaching
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

function grPointCard(p) {
  const i = HZ.gpoints.indexOf(p);
  const did = Store.load().grammar[p.id];
  const can = grReady(p).length;
  return `<a class="card gr-card" href="#/grammar/${p.id}">
    <span class="gr-num">${i + 1}</span>
    <span class="gr-card-text"><b class="han">${esc(p.title)}</b>
      <span class="gr-pattern han">${esc(p.pattern)}</span>
      <span class="small muted">${can ? `${can} of ${grTotal(p)} practice sentences ready` : GR_NOT_YET}${did && did.runs ? ` · practised ${did.runs} ${did.runs === 1 ? 'time' : 'times'}${did.of ? `, best ${did.best} of ${did.of}` : ''}` : ''}</span>
    </span></a>`;
}

function grList() {
  app.innerHTML = `<div class="card"><h1>Grammar</h1>
      <p class="muted">Short explanations and sentence-building practice, whenever you feel like it. Practice only uses characters you have learned in lessons or marked Learning or Learned. Nothing here is scheduled, and it doesn't count towards your lessons or reviews.</p></div>
    ${[...new Set(HZ.gpoints.map(p => p.level))].map(l => `<h2 class="sec-h">Around HSK ${l}</h2>
      <div class="gr-list">${HZ.gpoints.filter(p => p.level === l).map(grPointCard).join('')}</div>`).join('')}`;
}

/* you have read a point's explanation */
function grMarkRead(p) {
  const d = Store.load();
  if (d.grammar[p.id] && d.grammar[p.id].read) return;
  d.grammar[p.id] = { ...d.grammar[p.id], read: Date.now() };
  Store.save();
}

/* the explanation: its pattern, why, examples and the common mistake */
function grExplain(p) {
  return `<section class="card">
      <h1 class="han">${esc(p.title)}</h1>
      <p class="gr-formula han">${esc(p.pattern)}</p>
      <p>${esc(p.why)}</p>
    </section>
    <h2 class="sec-h">Examples</h2>
    <div class="decomp-box pad">${p.ex.map(ex => `<div class="example">${exampleHtml(ex, grMarked(p, ex))}</div>`).join('')}</div>
    <h2 class="sec-h">The common mistake</h2>
    <div class="decomp-box pad gr-mistake">
      <p class="gr-wrong han"><span aria-hidden="true">✗</span> <span class="sr-only">Wrong:</span> ${zh(p.mistake[0])}</p>
      <p class="gr-right han"><span aria-hidden="true">✓</span> <span class="sr-only">Right:</span> ${zh(p.mistake[1])}</p>
      <p class="muted">${esc(p.mistake[2])}</p>
    </div>`;
}

function grPoint(p) {
  const i = HZ.gpoints.indexOf(p), next = HZ.gpoints[i + 1];
  grMarkRead(p);
  app.innerHTML = `<p class="crumb"><a href="#/grammar">Grammar</a> / <span class="han">${esc(p.title)}</span></p>
    ${grExplain(p)}
    ${grReady(p).length ? '' : `<p class="muted small">${GR_NOT_YET}</p>`}
    <p class="gr-actions">${grReady(p).length ? `<a class="btn" href="#/grammar/${p.id}/practice">Practise</a>` : ''}
      ${next ? `<a class="btn quiet" href="#/grammar/${next.id}">Next: <span class="han">${esc(next.title)}</span></a>` : ''}</p>`;
}

/* a round on one point */
function grPractice(p) {
  const round = grRound(p);
  if (!round.length) return grPoint(p);
  const crumb = `<a href="#/grammar">Grammar</a> / <a class="han" href="#/grammar/${p.id}">${esc(p.title)}</a>`;
  grRun(round, crumb, right => {
    const d = Store.load(), was = { runs: 0, best: 0, ...d.grammar[p.id] };
    const better = !was.of || right / round.length >= was.best / was.of;
    d.grammar[p.id] = { ...was, runs: was.runs + 1, best: better ? right : was.best, of: better ? round.length : was.of, last: Date.now() };
    Store.save();
    app.innerHTML = `<p class="crumb">${crumb}</p>
      <section class="card gr-done"><h1>${right} of ${round.length}</h1>
        <p class="muted">${right === round.length ? 'All of them right.' : 'Go again whenever you like, or look over the explanation.'}</p>
        <p class="gr-actions"><button type="button" class="btn" id="gr-again">Practise again</button>
          <a class="btn quiet" href="#/grammar/${p.id}">The explanation</a>
          <a class="btn quiet" href="#/grammar">All grammar</a></p></section>`;
    document.getElementById('gr-again').addEventListener('click', () => grPractice(p));
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
  const round = grDailyRound(points), crumb = '<a href="#/study">Study</a> / Daily grammar practice';
  grRun(round, crumb, right => {
    const d = Store.load(), now = Date.now();
    for (const p of points) d.grammar[p.id] = { ...d.grammar[p.id], runs: ((d.grammar[p.id] || {}).runs || 0) + 1, last: now };
    d.grammar._daily = { ...d.grammar._daily, day: today() };
    Store.save();
    app.innerHTML = `<p class="crumb">${crumb}</p>
      <section class="card gr-done"><h1>${right} of ${round.length}</h1>
        <p class="muted">${right === round.length ? 'All of them right.' : 'Look over any that tripped you up:'}</p>
        <div class="gr-actions">${points.map(p => `<a class="btn quiet han" href="#/grammar/${p.id}">${esc(p.title)}</a>`).join('')}</div>
        <p class="gr-actions"><a class="btn" href="#/study">Back to study</a>
          <button type="button" class="btn quiet" id="gr-again">Another round</button></p></section>`;
    document.getElementById('gr-again').addEventListener('click', grDaily);
    window.scrollTo(0, 0);
  });
}
function grDaily() {
  const { fresh, points } = grDailyPick();
  if (!points.length) {
    app.innerHTML = `<p class="crumb"><a href="#/study">Study</a> / Daily grammar practice</p>
      <section class="card"><h1>Daily grammar practice</h1>
        <p class="empty">Nothing to practise yet. It opens once you have learned the characters in a grammar point's sentences, in lessons or marked Learning or Learned.</p>
        <p class="gr-actions"><a class="btn" href="#/study">Back to study</a>
          <a class="btn quiet" href="#/grammar">Read the grammar</a></p></section>`;
    return;
  }
  if (!fresh) return grDailyRun(points);
  /* a point you haven't read: taught first */
  app.innerHTML = `<p class="crumb"><a href="#/study">Study</a> / Daily grammar practice / New</p>
    <p class="gr-new">New today. Read this, then you'll practise it.</p>
    ${grExplain(fresh)}
    <p class="gr-actions"><button type="button" class="btn" id="gr-start">Start practice</button></p>`;
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
   crumb: the trail above it; finish(number right) draws what comes after. */
function grRun(round, crumb, finish) {
  let at = 0, right = 0;

  const show = () => {
    const x = round[at];
    if (!x) return finish(right);
    const p = x.point;
    const head = `<p class="crumb">${crumb} / ${at + 1} of ${round.length}</p>`;
    const tile = (w, pin, attrs) => `<button type="button" class="gr-tile han" ${attrs}><span>${zhOne(w)}</span>${pin ? `<small>${esc(pin)}</small>` : ''}</button>`;
    /* it is answered: say so, show the sentence in full, on to the next */
    const answered = ok => {
      if (ok) right++;
      const box = document.getElementById('gr-result');
      box.hidden = false;
      box.className = 'gr-result ' + (ok ? 'ok' : 'no');
      box.innerHTML = `<p class="gr-verdict">${ok ? 'Right' : 'Not quite. It goes:'}</p>
        <div class="example">${exampleHtml(x.full, grMarked(p, x.full))}</div>
        <p><button type="button" class="btn" id="gr-next">${at + 1 < round.length ? 'Next' : 'Finish'}</button></p>`;
      const nextBtn = document.getElementById('gr-next');
      nextBtn.addEventListener('click', () => { at++; show(); });
      nextBtn.focus();
    };

    if (x.kind === 'choose') {
      /* a question with its options: x.big and bigPin above them if it has them */
      const opts = shuffle(x.options.slice());
      app.innerHTML = `${head}<section class="card gr-ex">
        <p class="gr-en">${esc(x.en)}</p>
        ${x.big ? `<p class="gr-sentence han ph-prompt">${zhOne(x.big)}${x.bigPin ? `<small>${esc(x.bigPin)}</small>` : ''}</p>` : ''}
        ${x.ask ? `<p class="muted">${esc(x.ask)}</p>` : ''}
        <div class="gr-spots" id="gr-opts">${opts.map((o, i) => `<button type="button" class="gr-spot${x.han ? ' han' : ' ph-en'}" data-i="${i}">${x.han ? zhOne(o.text) : esc(o.text)}</button>`).join('')}</div>
        <div id="gr-result" hidden aria-live="polite"></div></section>`;
      const box = document.getElementById('gr-opts');
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(o => { o.disabled = true; o.classList.add(opts[+o.dataset.i].ok ? 'ok' : 'no'); });
        answered(!!opts[+b.dataset.i].ok);
      }));
    } else if (x.kind === 'spot') {
      const opts = shuffle([x.right, x.wrong]);
      app.innerHTML = `${head}<section class="card gr-ex">
        <p class="gr-en">${esc(x.en)}</p>
        <p class="muted">Which one is correct?</p>
        <div class="gr-spots" id="gr-opts">${opts.map(s => `<button type="button" class="gr-spot han" data-s="${esc(s)}">${zhOne(s)}</button>`).join('')}</div>
        <div id="gr-result" hidden aria-live="polite"></div></section>`;
      const box = document.getElementById('gr-opts');
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(o => { o.disabled = true; o.classList.add(o.dataset.s === x.right ? 'ok' : 'no'); });
        answered(b.dataset.s === x.right);
      }));
    } else if (x.kind === 'gap') {
      const opts = [x.a, ...x.wrong].sort(() => Math.random() - 0.5);
      app.innerHTML = `${head}<section class="card gr-ex">
        <p class="gr-en">${esc(x.en)}</p>
        <p class="gr-sentence han">${zhOne(x.before)}<span class="gr-blank" id="gr-blank">&nbsp;</span>${zhOne(x.after)}</p>
        <div class="gr-tiles" id="gr-opts">${opts.map(w => tile(w, x.pins[w], `data-w="${esc(w)}"`)).join('')}</div>
        <div id="gr-result" hidden aria-live="polite"></div></section>`;
      const box = document.getElementById('gr-opts');
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        box.querySelectorAll('button').forEach(o => { o.disabled = true; });
        const ok = b.dataset.w === x.a;
        b.classList.add(ok ? 'ok' : 'no');
        document.getElementById('gr-blank').innerHTML = zhOne(x.a);
        answered(ok);
      }));
    } else {
      /* the tiles: all but the closing punctuation, which is already there (a comma is a tile) */
      const parts = x.a.split('|'), pins = x.full[1].split('|');
      const isWord = w => grHan(w).length > 0;
      const noEnd = s => { const w = s.split('|'); return isWord(w[w.length - 1]) ? w : w.slice(0, -1); };
      const end = isWord(parts[parts.length - 1]) ? '' : parts[parts.length - 1];
      const tiles = noEnd(x.a).map((w, i) => ({ w, pin: pins[i], i }));
      const answers = [x.a, ...x.alt].map(s => noEnd(s).join('|'));
      let pool;
      do { pool = tiles.slice().sort(() => Math.random() - 0.5); } while (answers.includes(pool.map(t => t.w).join('|')) && tiles.length > 1);
      const placed = [];
      app.innerHTML = `${head}<section class="card gr-ex">
        <p class="gr-en">${esc(x.en)}</p>
        <div class="gr-line han" id="gr-line"></div>
        <div class="gr-tiles" id="gr-pool"></div>
        <p class="gr-actions"><button type="button" class="btn" id="gr-check" disabled>Check</button></p>
        <div id="gr-result" hidden aria-live="polite"></div></section>`;
      const line = document.getElementById('gr-line'), box = document.getElementById('gr-pool'), check = document.getElementById('gr-check');
      let locked = false;
      const draw = () => {
        line.innerHTML = (placed.length ? placed.map(t => tile(t.w, t.pin, `data-i="${t.i}" aria-label="Take back ${esc(t.w)}"`)).join('') : '<span class="muted small">Tap the words in order</span>')
          + (end && placed.length === tiles.length ? `<span class="gr-end">${zhOne(end)}</span>` : '');
        box.innerHTML = pool.map(t => tile(t.w, t.pin, `data-i="${t.i}"`)).join('');
        check.disabled = placed.length !== tiles.length || locked;
        if (locked) { line.querySelectorAll('button').forEach(b => { b.disabled = true; }); return; }
        line.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
          const n = placed.findIndex(t => t.i === +b.dataset.i);
          pool.push(placed.splice(n, 1)[0]); draw();
        }));
        box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
          const n = pool.findIndex(t => t.i === +b.dataset.i);
          placed.push(pool.splice(n, 1)[0]); draw();
        }));
      };
      check.addEventListener('click', () => {
        if (check.disabled) return;
        const ok = answers.includes(placed.map(t => t.w).join('|'));
        locked = true; draw();
        line.classList.add(ok ? 'ok' : 'no');
        answered(ok);
      });
      draw();
    }
    window.scrollTo(0, 0);
  };
  show();
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
