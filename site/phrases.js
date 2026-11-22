/* phrases.js — common phrases, questions and answers, by category (#/phrases). Extra study:
 * nothing here is scheduled, or counts towards the day's lessons, reviews, limits or streak.
 * A phrase is taught first, and practice only uses the ones you have learned, whatever
 * characters are in them: a phrase is learned whole.
 * (Store.data.phrases = {phrase: {learned}, '#category': {runs, best, of, last}})
 *
 *   #/phrases              the categories
 *   #/phrases/ID           one category: everything in it
 *   #/phrases/ID/learn     the next few, one at a time
 *   #/phrases/ID/practice  a round on what you have learned in it
 *   #/phrases/all/practice a round on everything you have learned
 *
 * Content: data/phrases.js, from build/phrases/phrases.json (build/phrases/build.js).
 * The rounds are drawn by grRun in grammarstudy.js. */

const PH_BATCH = 5, PH_ROUND = 8;
const PH_POINT = { mark: [''] };             // a round's sentences have nothing to highlight
const phStore = () => Store.load().phrases;
const phLearned = u => !!(phStore()[u.id] && phStore()[u.id].learned);
const phUnits = () => HZ.phrases.flatMap(c => c.units.map(u => ({ ...u, cat: c.id })));
const phZh = ex => ex[0].split('|').join('');
function phMark(u, on) {
  const d = Store.load();
  if (on) d.phrases[u.id] = { learned: Date.now() }; else delete d.phrases[u.id];
  Store.save();
}
/* the speed phrases are said at here: normal, or slow (this device only) */
const PH_SPEED = 'hanzihome.phraseSpeed';
const phSpeed = () => { try { return localStorage.getItem(PH_SPEED) === 'slow' ? 'slow' : ''; } catch (e) { return ''; } };
function phSay(text) {
  const cfg = { ...Store.cfg(), ...(phSpeed() ? { speed: 'slow' } : {}) };
  if (Sound.voices().length || cfg.audio === 'browser') return Sound.speak(text, cfg);
  need.audio().then(() => Sound.recorded(text, null, cfg) || Sound.speak(text, cfg), () => Sound.speak(text, cfg));
}
/* is anything still being said: the browser's voice, or a recording */
const phSpeaking = () => !!((window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending))
  || (Sound.el && !Sound.el.paused && !Sound.el.ended));
const phSayBtn = text => (Sound.canSay() ? `<button type="button" class="btn quiet ph-say" data-say-text="${esc(text)}" aria-label="Hear ${esc(text)}">▶</button>` : '');
function phWireSay() {
  app.querySelectorAll('[data-say-text]').forEach(b => b.addEventListener('click', () => { phStopAll(); phSay(b.dataset.sayText); }));
}

/* Play all: every phrase in the category, and each question's replies, one after another,
   the one being said lit up and kept in view */
let phPlaying = null;
function phStopAll() {
  if (!phPlaying) return;
  phPlaying.stop = true;
  phPlaying = null;
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (Sound.el) Sound.el.pause();
  document.querySelectorAll('.ph-playing').forEach(el => el.classList.remove('ph-playing'));
  phPaintPlay();
}
function phPaintPlay() {
  document.querySelectorAll('[data-play-all]').forEach(b => {
    b.classList.toggle('on', !!phPlaying);
    b.setAttribute('aria-pressed', String(!!phPlaying));
    b.innerHTML = phPlaying ? '<span aria-hidden="true">■</span> Stop' : '<span aria-hidden="true">▶</span> Play all';
  });
}
async function phPlayAll() {
  if (phPlaying) return phStopAll();
  const run = phPlaying = { stop: false };
  phPaintPlay();
  const items = [...app.querySelectorAll('.ph-row [data-say-text]')].map(b => ({ text: b.dataset.sayText, el: b.closest('.ph-bub, .ph-row') }));
  const wait = ms => new Promise(ok => setTimeout(ok, ms));
  const alive = () => !run.stop && items.length && items[0].el.isConnected;
  for (const it of items) {
    if (!alive()) break;
    document.querySelectorAll('.ph-playing').forEach(el => el.classList.remove('ph-playing'));
    it.el.classList.add('ph-playing');
    it.el.scrollIntoView({ block: 'center', behavior: Motion.reduced() ? 'auto' : 'smooth' });
    phSay(it.text);
    // (a moment for it to start, then until it has finished, at most 12 s)
    await wait(350);
    for (let t = 0; t < 100 && alive() && phSpeaking(); t++) await wait(120);
    await wait(phSpeed() ? 900 : 600);
  }
  if (phPlaying === run) phStopAll();
}
const phSpeedHtml = () => `<span class="ph-speed" role="group" aria-label="Speed">
  <button type="button" data-speed="" aria-pressed="${!phSpeed()}">Normal</button><button type="button" data-speed="slow" aria-pressed="${!!phSpeed()}">Slow</button></span>`;
function phWirePlay() {
  app.querySelectorAll('[data-play-all]').forEach(b => b.addEventListener('click', phPlayAll));
  app.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => {
    try { if (b.dataset.speed) localStorage.setItem(PH_SPEED, 'slow'); else localStorage.removeItem(PH_SPEED); } catch (e) { /* private mode */ }
    app.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.speed === phSpeed())));
  }));
  phPaintPlay();
}

/* the done screen's missed sentences can be heard too */
function phWireMissSay() {
  if (!Sound.canSay()) return;
  app.querySelectorAll('.gr-miss').forEach(m => {
    const zh = m.querySelector('.ex-zh');
    if (!zh) return;
    const bare = zh.cloneNode(true);
    bare.querySelectorAll('rt').forEach(r => r.remove());
    m.classList.add('ph-miss');
    m.insertAdjacentHTML('beforeend', phSayBtn(bare.textContent.replace(/\s+/g, '')));
  });
  phWireSay();
}

/* a question and its replies, as a short chat: you ask (on the right), they answer */
function phChatHtml(u, big = false) {
  return `<div class="ph-chat${big ? ' big' : ''}">
    <div class="ph-bub me"><div class="example${big ? ' ph-big' : ''}">${exampleHtml(u.ex, '')}</div>${phSayBtn(phZh(u.ex))}</div>
    ${u.note ? `<p class="small muted ph-note me">${esc(u.note)}</p>` : ''}
    <p class="ph-chat-lbl">You might hear</p>
    ${u.answers.map(a => `<div class="ph-bub them"><div class="example">${exampleHtml(a, '')}</div>${phSayBtn(phZh(a))}</div>`).join('')}
  </div>`;
}

/* where to carry on: a category you have started and not finished, then the first you
   haven't started; with everything learned, a round on all of it */
function phNext() {
  const left = c => c.units.filter(u => !phLearned(u)).length;
  const started = HZ.phrases.find(c => left(c) && left(c) < c.units.length);
  const c = started || HZ.phrases.find(c => left(c));
  if (!c) return { href: '#/phrases/all/practice', colour: 'mint', glyph: '练', eyebrow: 'All learned', title: 'Practise everything',
    why: 'Every phrase is learned. A mixed round keeps them fresh.', go: 'Practise' };
  const n = Math.min(PH_BATCH, left(c));
  return { href: `#/phrases/${c.id}/learn`, colour: c.colour, glyph: c.glyph, eyebrow: started ? 'Carry on' : 'Start here',
    title: c.title, why: `${n} new ${n === 1 ? 'phrase' : 'phrases'}, one at a time. ${esc(c.blurb)}`, go: `Learn ${n}` };
}

function phList() {
  const total = phUnits().length, have = phUnits().filter(phLearned).length, next = phNext();
  app.innerHTML = `<h1 class="page-title">Phrases</h1>
    <p class="lede">Everyday phrases, questions and answers, learned whole.</p>
    <a class="pr-next ph-next" href="${next.href}">
      <span class="ico ${next.colour} han" aria-hidden="true">${esc(next.glyph)}</span>
      <span class="pr-next-text"><small class="pr-eyebrow">${next.eyebrow}</small><b>${esc(next.title)}</b><span>${next.why}</span></span>
      <span class="pr-go" aria-hidden="true">${next.go} <span>→</span></span></a>
    <div class="ph-sum">
      <p><b>${have}</b> of ${total} learned</p>
      ${have >= 3 && next.href !== '#/phrases/all/practice' ? '<a class="btn quiet" href="#/phrases/all/practice">Practise everything</a>' : ''}
    </div>
    <div class="ph-cats">${HZ.phrases.map(c => {
      const n = c.units.filter(phLearned).length, all = n === c.units.length;
      return `<a class="xs-tile ph-cat${all ? ' all' : ''}" href="#/phrases/${c.id}"><span class="ico ${c.colour} han" aria-hidden="true">${esc(c.glyph)}</span>
        <span class="xs-text"><b>${esc(c.title)}</b><small>${all ? 'All learned ✓' : n ? `${n} of ${c.units.length} learned` : esc(c.blurb)}</small>
        ${n ? `<span class="xs-bar" aria-hidden="true"><i style="--w:${Math.round(100 * n / c.units.length)}%"></i></span>` : ''}</span></a>`;
    }).join('')}</div>`;
}

/* a phrase: learned ones get a tick and a tint; the toggle is a small round button */
const PH_TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
function phRow(u) {
  const on = phLearned(u);
  return `<div class="ph-row${on ? ' learned' : ''}" data-row="${esc(u.id)}">
    <div class="ph-main">${u.answers ? phChatHtml(u) : `<div class="example">${exampleHtml(u.ex, '')}</div>
      ${u.note ? `<p class="small muted ph-note">${esc(u.note)}</p>` : ''}`}</div>
    <div class="ph-acts">${u.answers ? '' : phSayBtn(phZh(u.ex))}
      <button type="button" class="ph-toggle${on ? ' on' : ''}" data-unit="${esc(u.id)}" aria-pressed="${on}"
        aria-label="${on ? 'Learned. Unmark it' : 'Mark learned'}" data-tip="${on ? 'Learned · unmark' : 'Mark learned'}">${PH_TICK}</button></div>
  </div>`;
}

function phCat(c) {
  phStopAll();
  const left = c.units.filter(u => !phLearned(u)), have = c.units.length - left.length;
  const canPractise = have >= 1 && phUnits().filter(phLearned).length >= 3;
  const phrases = c.units.filter(u => !u.answers), qa = c.units.filter(u => u.answers);
  const acts = (cls = '') => `${left.length ? `<a class="btn${cls}" href="#/phrases/${c.id}/learn">Learn ${Math.min(PH_BATCH, left.length)} new</a>` : ''}
    ${canPractise ? `<a class="btn${left.length ? ' quiet' : ''}${cls}" href="#/phrases/${c.id}/practice">Practise</a>` : ''}`;
  app.innerHTML = `<p class="crumb"><a href="#/phrases">Phrases</a> / ${esc(c.title)}</p>
    <section class="card ph-head" id="ph-head"><h1>${esc(c.title)}</h1>
      <p class="muted">${esc(c.blurb)}</p>
      <div class="ph-head-n"><span><b>${have}</b> of ${c.units.length} learned</span>
        <span class="xs-bar" aria-hidden="true"><i style="--w:${Math.round(100 * have / c.units.length)}%"></i></span></div>
      <p class="gr-actions">${acts()}</p>
      ${canPractise ? '' : '<p class="small muted">Practice opens once you have learned three phrases.</p>'}
      ${Sound.canSay() ? `<div class="ph-listen"><button type="button" class="btn quiet ph-play" data-play-all aria-pressed="false">▶ Play all</button>${phSpeedHtml()}
        <span class="small muted">Every phrase and reply, one after another</span></div>` : ''}</section>
    ${left.length || canPractise ? `<div class="ph-bar-wrap"><div class="ph-bar" id="ph-bar" aria-hidden="true">
      <span class="ph-bar-t"><span class="ico ${c.colour} han">${esc(c.glyph)}</span><b>${esc(c.title)}</b><small>${have} / ${c.units.length}</small></span>
      <span class="ph-bar-acts">${Sound.canSay() ? '<button type="button" class="btn quiet small ph-play" data-play-all aria-pressed="false">▶ Play all</button>' : ''}${acts(' small')}</span></div></div>` : ''}
    <h2 class="sec-h">Phrases</h2><div class="decomp-box pad">${phrases.map(phRow).join('')}</div>
    <h2 class="sec-h">Questions and answers</h2><div class="decomp-box pad">${qa.map(phRow).join('')}</div>`;
  phWireSay();
  phWirePlay();
  /* the buttons stay at hand once the card with them has scrolled away */
  const bar = document.getElementById('ph-bar'), head = document.getElementById('ph-head');
  if (bar) {
    const acts = head.querySelector('.gr-actions');
    const top = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'), 10) || 60;
    let queued = false, shown = null;
    const check = () => {
      queued = false;
      if (!bar.isConnected) return window.removeEventListener('scroll', onScroll);
      const show = acts.getBoundingClientRect().bottom < top;
      if (show === shown) return;
      shown = show;
      bar.classList.toggle('on', show);
      bar.setAttribute('aria-hidden', String(!show));
      bar.querySelectorAll('a, button').forEach(a => { a.tabIndex = show ? 0 : -1; });
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(check); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    check();
  }
  app.querySelectorAll('.ph-toggle').forEach(b => b.addEventListener('click', () => {
    const y = window.scrollY, u = c.units.find(x => x.id === b.dataset.unit);
    phMark(u, !phLearned(u));
    phCat(c);
    window.scrollTo(0, y);
    const row = app.querySelector(`.ph-row[data-row="${CSS.escape(u.id)}"]`);
    if (row && phLearned(u) && typeof Motion !== 'undefined') Motion.play(row, 'just-learned', 900);
    const again = row && row.querySelector('.ph-toggle');
    if (again) again.focus({ preventScroll: true });
  }));
}

/* the next few, one at a time; each is learned when you go on from it */
function phLearn(c) {
  const batch = c.units.filter(u => !phLearned(u)).slice(0, PH_BATCH);
  if (!batch.length) return phCat(c);
  let at = 0;
  const crumb = `<a href="#/phrases">Phrases</a> / <a href="#/phrases/${c.id}">${esc(c.title)}</a>`;
  const done = () => {
    const can = phUnits().filter(phLearned).length >= 3;
    app.innerHTML = `<p class="crumb">${crumb}</p>
      <section class="card gr-done"><h1>${batch.length} learned</h1>
        <p class="muted">${can ? 'Try them out now, or come back whenever you like.' : 'Learn a few more and practice opens.'}</p>
        <p class="gr-actions">${can ? `<a class="btn" href="#/phrases/${c.id}/practice">Practise</a>` : `<a class="btn" href="#/phrases/${c.id}/learn">Learn more</a>`}
          <a class="btn quiet" href="#/phrases/${c.id}">${esc(c.title)}</a></p></section>`;
    window.scrollTo(0, 0);
  };
  let shown = false;
  const show = () => {
    const u = batch[at];
    if (!u) return done();
    shown = false;
    app.innerHTML = `<p class="crumb">${crumb} / ${at + 1} of ${batch.length}</p>
      <section class="card ph-learn hide-en" id="ph-card">
        <p class="ph-recall small muted" id="ph-recall">What do you think it means? Then see.</p>
        ${u.answers ? phChatHtml(u, true) : `<div class="ph-answer"><div class="example ph-big">${exampleHtml(u.ex, '')}</div>${phSayBtn(phZh(u.ex))}</div>
        ${u.note ? `<p class="muted">${esc(u.note)}</p>` : ''}`}
        <p class="gr-actions"><button type="button" class="btn" id="ph-next">Show the meaning <kbd class="gr-key in-btn" aria-hidden="true">Enter</kbd></button>
          ${Sound.canSay() ? '<span class="ph-keys small muted"><kbd class="gr-key">Space</kbd> hear it again</span>' : ''}</p>
      </section>`;
    phWireSay();
    const next = document.getElementById('ph-next'), card = document.getElementById('ph-card');
    /* first the meaning (recalled, then seen), then on */
    const reveal = () => {
      if (shown) return;
      shown = true;
      card.classList.remove('hide-en');
      card.classList.add('shown-en');
      document.getElementById('ph-recall').hidden = true;
      next.firstChild.textContent = (at + 1 < batch.length ? 'Got it, next' : 'Got it') + ' ';
    };
    card.querySelectorAll('.ex-en, .ph-note, .ph-learn > p.muted').forEach(el => el.addEventListener('click', reveal));
    next.addEventListener('click', () => {
      if (!shown) return reveal();
      phMark(u, true); at++; show();
    });
    next.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    // (said as it comes up, unless the voice is muted in Settings)
    if (Sound.canSay() && !Store.cfg().muteVoice) setTimeout(() => { if (next.isConnected) phSay(phZh(u.ex)); }, 250);
  };
  /* Space says it again, Enter goes on; gone once you have left */
  const keys = e => {
    if (!document.getElementById('ph-next')) return document.removeEventListener('keydown', keys);
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      const u = batch[at];
      if (u) phSay(phZh(u.ex));
    } else if (e.key === 'Enter' && e.target.id !== 'ph-next') {
      e.preventDefault();
      document.getElementById('ph-next').click();
    }
  };
  document.addEventListener('keydown', keys);
  show();
}

/* n different things from the list that aren't the same as the answer, the list's own order
   kept: it is shuffled, with the better sources first */
function phOthers(list, not, n) {
  const seen = new Set([not]), out = [];
  for (const x of list) if (!seen.has(x) && out.length < n) { seen.add(x); out.push(x); }
  return out;
}
/* what can be asked of a phrase, using only what you have learned */
function phExercises(u, learned) {
  const out = [], others = shuffle(learned.filter(x => x.id !== u.id));
  const same = others.filter(x => x.cat === u.cat), away = others.filter(x => x.cat !== u.cat);
  // what it means: choosing among the meanings of others you have learned, its own category's first
  const wrong = phOthers([...same, ...away].map(x => x.ex[2]), u.ex[2], 3);
  if (wrong.length >= 2) {
    out.push({ kind: 'choose', point: PH_POINT, full: u.ex, en: 'What does this mean?', big: phZh(u.ex), bigPin: u.ex[1].split('|').filter(Boolean).join(' '),
      options: [{ text: u.ex[2], ok: true }, ...wrong.map(text => ({ text }))] });
  }
  // listening: hear it (not see it) and choose what it means
  if (Sound.canSay() && wrong.length >= 2) {
    out.push({ kind: 'choose', point: PH_POINT, full: u.ex, en: 'What did you hear?', play: () => phSay(phZh(u.ex)),
      options: [{ text: u.ex[2], ok: true }, ...shuffle(wrong.slice()).map(text => ({ text }))] });
  }
  // put it together, from the English
  const noEnd = u.ex[0].split('|');
  if (noEnd.filter(w => [...w].some(isHan)).length >= 2) out.push({ kind: 'order', point: PH_POINT, en: u.ex[2], a: u.ex[0], alt: [], full: u.ex });
  // the reply to a question: others' answers, from other categories first, so they don't fit too
  if (u.answers) {
    const a = shuffle(u.answers)[0], mine = new Set(u.answers.map(phZh));
    const askers = [...away, ...same].filter(x => x.answers).flatMap(x => shuffle(x.answers)).filter(x => !mine.has(phZh(x)));
    const not = phOthers(askers.map(phZh), phZh(a), 2);
    if (not.length) {
      out.push({ kind: 'choose', point: PH_POINT, full: a, en: u.ex[2], big: phZh(u.ex), bigPin: u.ex[1].split('|').filter(Boolean).join(' '), ask: 'Which is the best reply?', han: true,
        options: [{ text: phZh(a), ok: true }, ...not.map(text => ({ text }))] });
      // and by ear: the question said, the replies written
      if (Sound.canSay()) {
        out.push({ kind: 'choose', point: PH_POINT, full: a, en: 'Someone asks you this.', play: () => phSay(phZh(u.ex)), ask: 'Which is the best reply?', han: true,
          options: [{ text: phZh(a), ok: true }, ...not.map(text => ({ text }))] });
      }
    }
  }
  return out;
}
/* a round: a turn for each phrase in a new order, then round again with what it hasn't been asked */
function phRound(units, learned) {
  const pools = shuffle(units).map(u => shuffle(phExercises(u, learned))), round = [];
  for (let i = 0; round.length < PH_ROUND && pools.some(q => q.length); i++) {
    const q = pools[i % pools.length];
    if (q.length) round.push(q.pop());
  }
  return round;
}
function phPractice(c) {
  const learned = phUnits().filter(phLearned), units = c ? learned.filter(u => u.cat === c.id) : learned;
  const round = learned.length >= 3 ? phRound(units, learned) : [];
  if (!round.length) return c ? phCat(c) : phList();
  const key = '#' + (c ? c.id : 'all');
  const crumb = `<a href="#/phrases">Phrases</a> / ${c ? `<a href="#/phrases/${c.id}">${esc(c.title)}</a>` : 'Everything you have learned'}`;
  grRun(round, crumb, (right, missed) => {
    const d = Store.load(), was = { runs: 0, best: 0, ...d.phrases[key] };
    const better = !was.of || right / round.length >= was.best / was.of;
    d.phrases[key] = { ...was, runs: was.runs + 1, best: better ? right : was.best, of: better ? round.length : was.of, last: Date.now() };
    Store.save();
    app.innerHTML = `<p class="crumb">${crumb}</p>
      <section class="card gr-done"><h1>${right} of ${round.length}</h1>
        <p class="muted">${right === round.length ? 'All of them right.' : 'Go again whenever you like.'}</p>
        ${grMissesHtml(missed)}
        <p class="gr-actions"><button type="button" class="btn${missed.length ? ' quiet' : ''}" id="gr-again">Practise again</button>
          <a class="btn quiet" href="#/phrases${c ? '/' + c.id : ''}">${c ? esc(c.title) : 'All phrases'}</a></p></section>`;
    document.getElementById('gr-again').addEventListener('click', () => phPractice(c));
    phWireMissSay();
    const just = document.getElementById('gr-misses');
    if (just) just.addEventListener('click', () => grRetry(missed, crumb,
      `<a class="btn" href="#/phrases/${c ? c.id : 'all'}/practice">A new round</a> <a class="btn quiet" href="#/phrases${c ? '/' + c.id : ''}">${c ? esc(c.title) : 'All phrases'}</a>`));
    window.scrollTo(0, 0);
  });
}

async function pagePhrases(id, sub) {
  app.innerHTML = LOADING;
  await need.phrases();
  if (!id) return phList();
  if (id === 'all') return phPractice(null);
  const c = HZ.phrases.find(x => x.id === id);
  if (!c) {
    app.innerHTML = `<div class="card"><h1>Not found</h1><p class="empty">No such category.</p><p><a href="#/phrases">All phrases</a></p></div>`;
    return;
  }
  return sub === 'practice' ? phPractice(c) : sub === 'learn' ? phLearn(c) : phCat(c);
}
