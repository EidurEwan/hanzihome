/* weak.js — Weak spots (#/weak): one short round on what you keep missing, whatever kind of
 * thing it is. Extra study: nothing here changes when reviews come back, or counts towards the
 * day's lessons, reviews, limits or streak.
 *
 * It finds, and asks in this order, each only if there is something to ask:
 *   items   characters, words, components and sounds you keep missing (Learn.weakItems), in the
 *           reviews' own practice mode
 *   looks   characters you mix up with their look-alikes (lookalike.js), both of them learned
 *   tones   the tone your ear is worst at, with the one it hears it as (tones.js)
 *
 * An item you get right here steps back for a few days, so the next round isn't the same one
 * (Store.data.weak = {key: when}); a look-alike or a tone improves as its own record does.
 *
 *   #/weak        what is weak, and the button to start
 *   #/weak/next   carries on after the part played on the reviews' page */

'use strict';

const WK_ITEMS = 5, WK_LOOKS = 5, WK_TONES = 6;
const WK_LABEL = { items: 'Characters', looks: 'Look-alikes', tones: 'Tones' };
let wkState = null;

/* look-alikes you mix up at least one time in three (the record is kept on this device) */
function wkLooks() {
  const stats = laStats(), known = laKnown();
  return Object.keys(stats).filter(c => {
    const [r, w] = stats[c];
    return w >= 1 && w / (r + w) >= 1 / 3 && known.has(c) && (!HZ.lookalike || laKnownLike(c, known).length);
  }).sort((a, b) => stats[b][1] - stats[a][1]).slice(0, 3);
}
const wkItems = () => {
  const d = Store.load();
  return Learn.weakItems(d.items, Date.now(), d.weak);
};
const wkTones = () => tnWeak(Store.load().tones);
/* how much there is to work on, for the tile on the Study page */
const wkCount = () => wkItems().length + wkLooks().length + (wkTones() ? 1 : 0);

const wkTile = (k, kind) => `<a class="ls-tile ${kind} han" href="${itemHref(k)}" target="_blank" rel="noopener" aria-label="${esc(itemText(k))}, opens in a new tab">${itemHtml(k)}</a>`;

function wkOverview() {
  const d = Store.load(), items = wkItems().slice(0, WK_ITEMS), looks = wkLooks(), tones = wkTones();
  const parts = (items.length ? 1 : 0) + (looks.length ? 1 : 0) + (tones ? 1 : 0);
  app.innerHTML = '<h1 class="page-title">Weak spots</h1>' + withRail(!parts ? `<section class="card">
      <p class="empty">Nothing to work on yet.</p>
      <p class="small muted">What you keep missing in reviews, look-alikes and tones will show up here.</p>
      <p><a class="btn quiet" href="#/study">Back to study</a></p></section>` : `
    <p class="row ls-actions"><button class="btn" id="wk-start">Start</button>
      <a class="btn quiet" href="#/study">Back to study</a></p>
    <p class="small muted wk-note">A short round. It doesn't change when your reviews come back.</p>
    ${items.length ? `<section class="ls-group"><h2 class="sec-h">Keep missing</h2>
      <div class="ls-tiles">${items.map(k => wkTile(k, d.items[k].kind || 'char')).join('')}</div></section>` : ''}
    ${looks.length ? `<section class="ls-group"><h2 class="sec-h">Mix up</h2>
      <div class="ls-tiles">${looks.map(c => `<a class="ls-tile char han" href="#/character/${encodeURIComponent(c)}" target="_blank" rel="noopener" aria-label="${esc(c)}, opens in a new tab">${zhOne(c)}</a>`).join('')}</div></section>` : ''}
    ${tones ? `<section class="ls-group"><h2 class="sec-h">Tones</h2>
      <div class="ls-tiles">${tones.tones.map(t => `<a class="ls-tile wk-tone" href="#/tones" target="_blank" rel="noopener" aria-label="Tone ${t}, opens in a new tab">${tnShape(t)}</a>`).join('')}</div></section>` : ''}`, true);
  const start = document.getElementById('wk-start');
  if (start) start.addEventListener('click', wkStart);
  paintRail();
}

function wkStart() {
  const items = wkItems().slice(0, WK_ITEMS), looks = wkLooks(), tones = wkTones();
  const queue = [items.length ? 'items' : null, looks.length ? 'looks' : null, tones ? 'tones' : null].filter(Boolean);
  wkState = { queue, at: 0, items, looks, tones, score: {} };
  wkNext();
}

/* one part done: on to the next */
function wkScored(part, right, of) {
  wkState.score[part] = [right, of];
  wkState.at++;
}

function wkNext() {
  const s = wkState;
  if (!s) return wkOverview();
  const part = s.queue[s.at];
  if (!part) return wkDone();
  if (part === 'items') {
    reviewState = newSession(shuffle(s.items.slice()), 'practice');
    reviewState.onDone = r => {
      // right: it steps back for a few days. Missed: it stays at the front
      const d = Store.load(), now = Date.now();
      for (const k of r.right) d.weak[k] = now;
      for (const k of r.wrong) delete d.weak[k];
      for (const k of Object.keys(d.weak)) if (now - d.weak[k] > Learn.WEAK_REST) delete d.weak[k];
      Store.save();
      wkScored('items', r.right.length, r.right.length + r.wrong.length);
      go('/weak/next');
    };
    return go('/reviews');
  }
  if (part === 'looks') return wkLookPart();
  return wkTonePart();
}

async function wkLookPart() {
  const s = wkState;
  app.innerHTML = LOADING;
  await laNeed();
  const round = HZ.lookalike ? laRound(s.looks.join('')) : null;
  if (!round || !round.qs.length) { s.at++; return wkNext(); }
  round.qs = round.qs.slice(0, WK_LOOKS);
  round.onDone = r => {
    laState = null;
    wkScored('looks', r.right, r.qs.length);
    wkNext();
  };
  laState = round;
  drawLookalike();
}

async function wkTonePart() {
  const s = wkState;
  app.innerHTML = LOADING;
  await need.tones();
  const round = tnRoundFocus(WK_TONES, s.tones.tones, HZ.tones.syl);
  tnRun('single', round, '<a href="#/weak">Weak spots</a> / Tones', right => {
    wkScored('tones', right, round.length);
    wkNext();
  });
}

function wkDone() {
  const s = wkState;
  wkState = null;
  app.innerHTML = '<h1 class="page-title">Weak spots</h1>' + withRail(`
    <section class="card wk-done">
      <div class="rs-stats">${s.queue.map(p => `<div><b>${s.score[p] ? s.score[p][0] : 0} / ${s.score[p] ? s.score[p][1] : 0}</b><span>${WK_LABEL[p]}</span></div>`).join('')}</div>
      <div class="rs-actions"><a class="btn" href="#/study">Back to study</a>
        <button class="btn quiet" id="wk-again">Another round</button></div>
    </section>`, true);
  document.getElementById('wk-again').addEventListener('click', () => { wkOverview(); window.scrollTo(0, 0); });
  window.scrollTo(0, 0);
  paintRail();
}

async function pageWeak(sub) {
  app.innerHTML = LOADING;
  await Promise.all([optional(laNeed()), optional(need.tones())]);
  if (sub === 'next' && wkState) return wkNext();
  wkState = null;
  wkOverview();
}
