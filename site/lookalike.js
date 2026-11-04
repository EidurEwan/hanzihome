/* lookalike.js — practice telling look-alike characters apart (#/lookalikes).
 *
 * The look-alikes come from data/lookalike.js (build/export_lookalikes.js): for each
 * common character, the common characters that look like it, 请 情 清 晴 睛, 未 末,
 * 己 已 巳. A round is twelve questions, using only characters you have learned
 * (Learn.knownChars), each set beside up to three of its look-alikes you have learned too:
 *   pick: "Which is qíng, feelings?", choosing among the characters;
 *   mean: a character, choosing its meaning among theirs.
 * After each answer the set is shown side by side, each with its pinyin, meaning and
 * parts, the parts that tell them apart marked.
 *
 * #/lookalikes/<characters> practises those characters and their look-alikes, the learned
 * ones again (the character page's "Looks like" links there). Practice doesn't touch the review
 * schedule; how often you mix each character up is kept on this device
 * (localStorage), so the ones you miss come up more. Needs app.js and study.js. */

'use strict';

const LA_STATS = 'hanzihome.lookalike';   // {char: [right, wrong, last time]}
const LA_ROUND = 12;
let laState = null;

const laNeed = () => Promise.all([
  HZ.lookalike ? null : loadScript('data/lookalike.js'),
  optional(need.comps()),
]);
const laStats = () => { try { return JSON.parse(localStorage.getItem(LA_STATS) || '{}'); } catch (e) { return {}; } };
function laLog(c, ok) {
  const s = laStats(), x = s[c] || [0, 0, 0];
  x[ok ? 0 : 1]++;
  x[2] = Date.now();
  s[c] = x;
  try { localStorage.setItem(LA_STATS, JSON.stringify(s)); } catch (e) { /* private mode */ }
}

const laPin = c => (HZ.index[c] || [])[2] || '';
const laMean = c => String((HZ.index[c] || [])[3] || '').split(/;\s*/)[0].replace(/\s*\(.*?\)\s*/g, ' ').trim();
const laLike = c => [...((HZ.lookalike || {})[c] || '')];

const laKnown = () => Learn.knownChars(Store.load());
/* the look-alikes of a character that you have learned */
const laKnownLike = (c, known) => laLike(c).filter(x => known.has(x));

/* a round: which characters to ask, the ones mixed up most (and not seen lately)
   first, then a little at random */
function laRound(only) {
  const known = laKnown(), stats = laStats(), now = Date.now();
  const pool = (only ? [...new Set([...only].flatMap(c => [c, ...laLike(c)]))] : [...known])
    .filter(c => known.has(c) && laKnownLike(c, known).length);
  const weight = c => {
    const [r, w, t] = stats[c] || [0, 0, 0];
    const fresh = Math.min(1, (now - t) / 864e5);              // seen today: less likely
    return (1 + 3 * w / (r + w + 1)) * (0.4 + 0.6 * fresh) * (0.5 + Math.random());
  };
  const picks = pool.map(c => [c, weight(c)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const qs = [];
  for (let i = 0; qs.length < LA_ROUND && picks.length; i++) {
    const t = picks[i % picks.length];
    const others = laKnownLike(t, known).slice(0, 3);   // the most alike first
    const opts = shuffle([t, ...others]);
    const means = new Set(opts.map(laMean));
    const kind = means.size === opts.length && Math.random() < 0.4 ? 'mean' : 'pick';
    qs.push({ t, opts, kind });
    if (i >= picks.length * 3) break;
  }
  return { qs, i: 0, right: 0, missed: [], answered: null, only };
}

async function pageLookalikes(only) {
  app.innerHTML = LOADING;
  await laNeed();
  if (!HZ.lookalike) { app.innerHTML = '<div class="card"><p class="empty">The look-alike list didn\'t load. Try again.</p></div>'; return; }
  laState = laRound(only);
  drawLookalike();
}

/* the parts each character has that the others in its set don't */
function laParts(opts) {
  const parts = c => (HZ.comps && HZ.comps[c]) || [];
  const out = opts.map(c => {
    const mine = parts(c);
    const elsewhere = opts.filter(o => o !== c).map(parts);
    return mine.map(p => ({ p, own: !elsewhere.every(o => o.includes(p)) }));
  });
  // nothing shared (买 卖 are split differently): no part to set the others against
  if (out.every(ps => ps.every(x => x.own))) out.forEach(ps => ps.forEach(x => { x.own = false; }));
  return out;
}

function drawLookalike() {
  const s = laState;
  if (!s || !s.qs.length) {
    app.innerHTML = '<h1 class="page-title">Look-alikes</h1>' + withRail(`<section class="card">
      <p class="empty">No look-alikes to practise yet: you need to have learned two characters that look alike, in lessons or marked Learning or Learned.</p><p><a class="btn quiet" href="#/study">Back to study</a></p></section>`, true);
    return;
  }
  if (s.i >= s.qs.length) return s.onDone ? s.onDone(s) : laDone();
  const q = s.qs[s.i], a = s.answered;
  const head = `<div class="la-top"><span>Look-alikes${s.only ? `: ${zhOne(s.only)}` : ''}</span>
    <span class="la-prog" style="--p:${(100 * s.i) / s.qs.length}%"><i></i></span>
    <span>${s.i + 1} / ${s.qs.length}</span></div>`;
  const state = c => !a ? '' : c === q.t ? ' right' : c === a.choice ? ' wrong' : ' dim';
  let ask;
  if (q.kind === 'pick') {
    ask = `<p class="la-ask">Which one is <b>${esc(laPin(q.t))}</b>, <i>${esc(laMean(q.t))}</i>?</p>
      <div class="la-opts">${q.opts.map((c, n) => `<button class="la-opt${state(c)}" data-c="${esc(c)}" ${a ? 'disabled' : ''}
        aria-label="Option ${n + 1}"><span class="han">${zhOne(c)}</span><small>${n + 1}</small></button>`).join('')}</div>`;
  } else {
    ask = `<p class="la-ask">What does this one mean?</p>
      <div class="la-glyph han">${zhOne(q.t)}</div>
      <div class="la-means">${q.opts.map((c, n) => `<button class="la-mean${state(c)}" data-c="${esc(c)}" ${a ? 'disabled' : ''}>
        <small>${n + 1}</small><b>${esc(laPin(c))}</b> ${esc(laMean(c))}</button>`).join('')}</div>`;
  }
  const parts = laParts(q.opts);
  const compare = a ? `<section class="card la-compare">
      <p class="la-verdict ${a.ok ? 'ok' : 'bad'}">${a.ok ? 'Right!' : `That was ${zhOne(a.choice)}. This one is ${zhOne(q.t)}.`}</p>
      <div class="la-set">${q.opts.map((c, n) => `<a class="la-card${c === q.t ? ' target' : ''}" href="#/character/${encodeURIComponent(c)}" target="_blank">
        <span class="han">${zhOne(c)}</span><b>${esc(laPin(c))}</b><span class="m">${esc(laMean(c))}</span>
        ${parts[n].length ? `<span class="la-parts">${parts[n].map(x => `<i class="${x.own ? 'own' : ''}">${esc(x.p)}</i>`).join('+')}</span>` : ''}</a>`).join('')}</div>
      ${parts.some(ps => ps.some(x => x.own)) ? '<p class="small muted">The highlighted parts are what tell them apart.</p>' : ''}
      <p class="row"><button class="btn" id="la-next">${s.i + 1 < s.qs.length ? 'Next' : 'See how you did'}</button>
        <span class="small muted">or press Enter</span></p></section>` : '';
  app.innerHTML = head + `<section class="card la-q">${ask}</section>` + compare;
  if (!a) Motion.play(app.querySelector('.la-q'), 'm-deal');
  else {
    const right = app.querySelector('.la-opt.right, .la-mean.right'), wrong = app.querySelector('.la-opt.wrong, .la-mean.wrong');
    Motion.play(right, 'm-pop');
    Motion.play(wrong, 'm-shake');
    Motion.play(app.querySelector('.la-compare'), 'm-rise');
    document.getElementById('la-next').focus();
  }
  app.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => laAnswer(b.dataset.c)));
  const next = document.getElementById('la-next');
  if (next) next.addEventListener('click', laNext);
}

function laAnswer(c) {
  const s = laState, q = s.qs[s.i];
  if (!q || s.answered) return;
  const ok = c === q.t;
  s.answered = { choice: c, ok };
  if (ok) { s.right++; Sound.ding(); } else s.missed.push([q.t, c]);
  laLog(q.t, ok);
  drawLookalike();
}

function laNext() {
  laState.i++;
  laState.answered = null;
  drawLookalike();
}

function laDone() {
  const s = laState, n = s.qs.length, pct = Math.round((100 * s.right) / n);
  const pairs = [...new Map(s.missed.map(([t, c]) => [[t, c].sort().join(''), [t, c]])).values()];
  app.innerHTML = '<h1 class="page-title">Look-alikes</h1>' + withRail(`
    <section class="card rs-head">
      <div class="rs-ring" style="--p:${pct}"><div><b>${pct}%</b><span>told apart</span></div></div>
      <div>
        <div class="rs-stats">
          <div><b>${n}</b><span>questions</span></div>
          <div class="ok"><b>${s.right}</b><span>right</span></div>
          <div class="bad"><b>${n - s.right}</b><span>mixed up</span></div>
        </div>
        <div class="rs-actions"><button class="btn" id="la-again">Another round</button>
          <a class="btn quiet" href="#/study">Back to study</a></div>
      </div>
    </section>
    ${pairs.length ? `<section class="card"><h2 class="caps">Mixed up</h2>
      <div class="la-pairs">${pairs.map(([t, c]) => `<div>${[t, c].map(x => `<a href="#/character/${encodeURIComponent(x)}">
        <span class="han">${zhOne(x)}</span><b>${esc(laPin(x))}</b><span>${esc(laMean(x))}</span></a>`).join('<em>≠</em>')}
        <button class="btn quiet" data-again="${esc(t + c)}">Practise these</button></div>`).join('')}</div></section>` : ''}`, true);
  Motion.countUp(app);
  if (pct >= 80) Motion.confetti(app.querySelector('.rs-ring'));
  document.getElementById('la-again').addEventListener('click', () => { laState = laRound(s.only); drawLookalike(); });
  app.querySelectorAll('[data-again]').forEach(b => b.addEventListener('click', () => {
    location.hash = '#/lookalikes/' + encodeURIComponent(b.dataset.again);
  }));
  laState = null;
}

/* keys: 1 to 4 answer, Enter goes on */
document.addEventListener('keydown', e => {
  const s = laState;
  if (!s || !/^\/(lookalikes|weak)/.test(currentPath()) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, textarea, select')) return;
  const q = s.qs[s.i];
  if (!q) return;
  if (!s.answered && /^[1-4]$/.test(e.key) && q.opts[+e.key - 1]) { e.preventDefault(); laAnswer(q.opts[+e.key - 1]); }
  else if (s.answered && e.key === 'Enter') { e.preventDefault(); laNext(); }
});

/* the character page's "Looks like": its look-alikes, and a way to practise them */
function lookalikeSection(ch) {
  const like = laLike(ch);
  if (!like.length) return '';
  return `<h3 class="sub-h">Looks like</h3>
    <div class="decomp-box pad">
      <p class="muted small">Characters easily mixed up with ${zhOne(ch)}:</p>
      <div class="chips">${like.map(c => chip(c)).join('')}</div>
      ${laKnownLike(ch, laKnown()).length && laKnown().has(ch)
        ? `<p style="margin-top:12px"><a class="btn quiet" href="#/lookalikes/${encodeURIComponent(ch)}">Practise telling them apart</a></p>`
        : '<p class="small muted" style="margin-top:12px">You can practise these once you have learned this character and one of them.</p>'}
    </div>`;
}
