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
function phSay(text) {
  if (Sound.voices().length) Sound.speak(text, Store.cfg()); else Sound.say(text, true);
}
const phSayBtn = text => (Sound.canSay() ? `<button type="button" class="btn quiet ph-say" data-say-text="${esc(text)}" aria-label="Hear ${esc(text)}">▶</button>` : '');
function phWireSay() {
  app.querySelectorAll('[data-say-text]').forEach(b => b.addEventListener('click', () => phSay(b.dataset.sayText)));
}

function phList() {
  const total = phUnits().length, have = phUnits().filter(phLearned).length;
  app.innerHTML = `<div class="card"><h1>Phrases</h1>
      <p class="muted">Common phrases, questions and answers to learn whole. ${have ? `You have learned ${have} of ${total}.` : 'Pick a category to start.'} Nothing here is scheduled, and it doesn't count towards your lessons or reviews.</p>
      ${have >= 3 ? '<p class="gr-actions"><a class="btn" href="#/phrases/all/practice">Practise everything you have learned</a></p>' : ''}</div>
    <div class="ph-cats">${HZ.phrases.map(c => {
      const n = c.units.filter(phLearned).length;
      return `<a class="xs-tile ph-cat" href="#/phrases/${c.id}"><span class="ico ${c.colour} han" aria-hidden="true">${esc(c.glyph)}</span>
        <span class="xs-text"><b>${esc(c.title)}</b><small>${n ? `${n} of ${c.units.length} learned` : esc(c.blurb)}</small></span></a>`;
    }).join('')}</div>`;
}

function phRow(u) {
  const on = phLearned(u);
  return `<div class="ph-row">
    <div class="ph-main"><div class="example">${exampleHtml(u.ex, '')}</div>
      ${u.note ? `<p class="small muted ph-note">${esc(u.note)}</p>` : ''}
      ${u.answers ? `<div class="ph-answers"><p class="small muted">You might hear:</p>${u.answers.map(a => `<div class="ph-answer"><div class="example">${exampleHtml(a, '')}</div>${phSayBtn(phZh(a))}</div>`).join('')}</div>` : ''}</div>
    <div class="ph-acts">${phSayBtn(phZh(u.ex))}
      <button type="button" class="btn quiet ph-toggle${on ? ' on' : ''}" data-unit="${esc(u.id)}" aria-pressed="${on}">${on ? '✓ Learned' : 'Mark learned'}</button></div>
  </div>`;
}

function phCat(c) {
  const left = c.units.filter(u => !phLearned(u)), have = c.units.length - left.length;
  const canPractise = have >= 1 && phUnits().filter(phLearned).length >= 3;
  const phrases = c.units.filter(u => !u.answers), qa = c.units.filter(u => u.answers);
  app.innerHTML = `<p class="crumb"><a href="#/phrases">Phrases</a> / ${esc(c.title)}</p>
    <section class="card"><h1>${esc(c.title)}</h1>
      <p class="muted">${esc(c.blurb)} You have learned ${have} of ${c.units.length}.</p>
      <p class="gr-actions">${left.length ? `<a class="btn" href="#/phrases/${c.id}/learn">Learn ${Math.min(PH_BATCH, left.length)} new</a>` : ''}
        ${canPractise ? `<a class="btn${left.length ? ' quiet' : ''}" href="#/phrases/${c.id}/practice">Practise</a>` : ''}</p>
      ${canPractise ? '' : '<p class="small muted">Practice opens once you have learned three phrases.</p>'}</section>
    <h2 class="sec-h">Phrases</h2><div class="decomp-box pad">${phrases.map(phRow).join('')}</div>
    <h2 class="sec-h">Questions and answers</h2><div class="decomp-box pad">${qa.map(phRow).join('')}</div>`;
  phWireSay();
  app.querySelectorAll('.ph-toggle').forEach(b => b.addEventListener('click', () => {
    const y = window.scrollY, u = c.units.find(x => x.id === b.dataset.unit);
    phMark(u, !phLearned(u));
    phCat(c);
    window.scrollTo(0, y);
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
  const show = () => {
    const u = batch[at];
    if (!u) return done();
    app.innerHTML = `<p class="crumb">${crumb} / ${at + 1} of ${batch.length}</p>
      <section class="card ph-learn">
        <div class="ph-answer"><div class="example ph-big">${exampleHtml(u.ex, '')}</div>${phSayBtn(phZh(u.ex))}</div>
        ${u.note ? `<p class="muted">${esc(u.note)}</p>` : ''}
        ${u.answers ? `<div class="ph-answers"><p class="small muted">You might hear:</p>${u.answers.map(a => `<div class="ph-answer"><div class="example">${exampleHtml(a, '')}</div>${phSayBtn(phZh(a))}</div>`).join('')}</div>` : ''}
        <p class="gr-actions"><button type="button" class="btn" id="ph-next">${at + 1 < batch.length ? 'Got it, next' : 'Got it'}</button></p>
      </section>`;
    phWireSay();
    const next = document.getElementById('ph-next');
    next.addEventListener('click', () => { phMark(u, true); at++; show(); });
    next.focus();
    window.scrollTo(0, 0);
  };
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
  grRun(round, crumb, right => {
    const d = Store.load(), was = { runs: 0, best: 0, ...d.phrases[key] };
    const better = !was.of || right / round.length >= was.best / was.of;
    d.phrases[key] = { ...was, runs: was.runs + 1, best: better ? right : was.best, of: better ? round.length : was.of, last: Date.now() };
    Store.save();
    app.innerHTML = `<p class="crumb">${crumb}</p>
      <section class="card gr-done"><h1>${right} of ${round.length}</h1>
        <p class="muted">${right === round.length ? 'All of them right.' : 'Go again whenever you like.'}</p>
        <p class="gr-actions"><button type="button" class="btn" id="gr-again">Practise again</button>
          <a class="btn quiet" href="#/phrases${c ? '/' + c.id : ''}">${c ? esc(c.title) : 'All phrases'}</a></p></section>`;
    document.getElementById('gr-again').addEventListener('click', () => phPractice(c));
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
