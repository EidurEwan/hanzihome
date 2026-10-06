/* learn.js — lessons, and spaced repetition with FSRS.
 *
 * You add characters and words you meet to a lesson queue. A lesson shows the
 * item's parts, your mnemonic and an example, then checks you can type its
 * pinyin and its meaning. From then on it comes back for review when FSRS, the
 * Free Spaced Repetition Scheduler (version 5, github.com/open-spaced-repetition),
 * expects you to be about to forget it.
 *
 * FSRS keeps three numbers for each item's memory:
 *   D  difficulty, 1 to 10: how hard the item is for you
 *   S  stability, in days: how long until the chance of recalling it falls to 90%
 *   R  retrievability: the chance of recalling it now, from S and the days since
 *      the last review (retrievability())
 * A review rates the recall 1 to 4 (again, hard, good, easy) and FSRS moves D and S
 * by the rating. The rating is never asked for: gradeFrom() works it out from the
 * answers (right or wrong, a slip of tone, how long before you started to type).
 * The next review is due when R will have fallen to the retention you want (90%
 * unless set otherwise).
 *
 * The stages (Novice I … Master, HanziHero's names) are bands of stability, so they
 * say how long you would remember an item; Journeyman, a month and more, counts as
 * learned on the rest of the site.
 *
 * An item, kept in the store under its characters (Store.data.items):
 *   {kind: 'char' | 'word', pin: 'rèn shi', mean: 'to know', alts: [...meanings],
 *    syn: [your synonyms], mnemonic, ex: {text, t} (where you met it), added,
 *    stage (0: waiting for its lesson), D, S, last (the last review), due,
 *    hist (right or not, lately), grades (the ratings, lately), reps, lapses}
 *
 * Pure functions, no DOM: site/study.js draws the pages, test/learn.js checks this
 * (the FSRS numbers against the reference implementation's). Works in the browser
 * (window.Learn) and in Node (require). */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Learn = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 864e5;
  // [name, the stability in days at which an item reaches this stage]
  const STAGES = [
    ['Lesson', 0],
    ['Novice I', 0], ['Novice II', 4],
    ['Apprentice I', 7], ['Apprentice II', 14],
    ['Journeyman I', 30], ['Journeyman II', 60],
    ['Expert I', 120], ['Expert II', 240], ['Expert III', 365],
    ['Master', 730],
  ];
  const MASTER = STAGES.length - 1;
  const LEARNED_FROM = 5;      // Journeyman and up count as learned on the rest of the site
  const GROUPS = ['Lesson', 'Novice', 'Novice', 'Apprentice', 'Apprentice', 'Journeyman', 'Journeyman',
    'Expert', 'Expert', 'Expert', 'Master'];

  const stageName = s => (STAGES[s] || STAGES[0])[0];
  const group = s => GROUPS[s] || 'Lesson';

  // ---------------------------------------------------------------- FSRS-5

  // the default weights, fitted by FSRS on a great many reviews
  const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
    1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
  const DECAY = -0.5, FACTOR = 19 / 81;       // R(S days later) = 90%
  const S_MIN = 0.01, MAX_DAYS = 36500, RETENTION = 0.9;
  const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;

  const clampG = g => Math.max(1, Math.min(4, Math.round(g) || 1));
  const clampD = d => Math.min(10, Math.max(1, d));
  const clampS = s => Math.min(MAX_DAYS, Math.max(S_MIN, s));
  const initD = g => clampD(W[4] - Math.exp((g - 1) * W[5]) + 1);
  const initS = g => Math.max(W[g - 1], 0.1);

  /* the chance of recalling it t days after the last review */
  const retrievability = (t, S) => Math.pow(1 + FACTOR * t / S, DECAY);

  function nextD(D, g) {
    const d = D + (-W[6] * (g - 3)) * (10 - D) / 9;      // a move, damped near 10
    return clampD(W[7] * initD(EASY) + (1 - W[7]) * d);  // and a pull back to the mean
  }
  // recalled: stability grows, the more the less likely recall had become
  const recallS = (D, S, R, g) => clampS(S * (1 + Math.exp(W[8]) * (11 - D) * Math.pow(S, -W[9])
    * (Math.exp((1 - R) * W[10]) - 1) * (g === HARD ? W[15] : 1) * (g === EASY ? W[16] : 1)));
  // forgotten: stability falls (never above what it was, less the short-term boost)
  const forgetS = (D, S, R) => Math.min(
    clampS(W[11] * Math.pow(D, -W[12]) * (Math.pow(S + 1, W[13]) - 1) * Math.exp((1 - R) * W[14])),
    Math.max(S_MIN, S / Math.exp(W[17] * W[18])));
  // reviewed again the same day
  const shortS = (S, g) => clampS(S * Math.exp(W[17] * (g - 3 + W[18])));

  /* whole days between two times, by the calendar (as FSRS counts them) */
  const days = (from, to) => Math.max(0, Math.round((dayStart(to) - dayStart(from)) / DAY));
  const dayStart = now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return +d; };

  /* days until R falls to the retention wanted, a little spread (FSRS's fuzz ranges)
     so a day's reviews don't all come back on one day */
  function intervalFor(S, retention, rnd, elapsed = 0) {
    const r = Math.min(0.99, Math.max(0.7, retention || RETENTION));
    const ivl = Math.min(Math.max(1, Math.round(S * (Math.pow(r, 1 / DECAY) - 1) / FACTOR)), MAX_DAYS);
    if (!rnd || ivl < 2.5) return ivl;
    let delta = 1;
    for (const [start, end, factor] of [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]]) {
      delta += factor * Math.max(Math.min(ivl, end) - start, 0);
    }
    const hi = Math.min(Math.round(ivl + delta), MAX_DAYS);
    let lo = Math.max(2, Math.round(ivl - delta));
    if (ivl > elapsed) lo = Math.max(lo, elapsed + 1);
    lo = Math.min(lo, hi);
    return Math.floor(rnd() * (hi - lo + 1) + lo);
  }

  /* the stage an item's stability puts it at */
  function stageFor(S) {
    let s = 1;
    for (let k = 2; k <= MASTER; k++) if (S >= STAGES[k][1]) s = k;
    return s;
  }

  /* schedule the next review from the item's stability, and set its stage */
  function schedule(item, now, retention, rnd, elapsed = 0) {
    item.stage = stageFor(item.S);
    item.due = now + intervalFor(item.S, retention, rnd, elapsed) * DAY;
    return item;
  }

  /* An item from before FSRS: its stability from the stage it had reached (the wait
     that stage gave), its difficulty higher for each recent miss */
  function adopt(item) {
    if (item.S != null || !(item.stage >= 1)) return item;
    item.S = Math.max(1, STAGES[Math.min(item.stage, MASTER)][1]) || 1;
    if (item.stage === 1) item.S = 1;
    const misses = (item.hist || []).slice(-5).filter(r => !r).length;
    item.D = clampD(initD(GOOD) + misses);
    return item;
  }

  /* R now, and the rest of an item's memory, for showing */
  function memory(item, now) {
    adopt(item);
    if (item.S == null) return null;
    const since = item.last || item.learnt || item.joined || item.added || now;
    return { D: item.D, S: item.S, R: retrievability(Math.max(0, (now - since) / DAY), item.S) };
  }

  function newItem(kind, info, now) {
    return {
      kind, pin: info.pin || '', mean: info.mean || '', alts: info.alts || [], syn: [],
      mnemonic: '', ex: info.ex || null, added: now, stage: 0, due: 0, hist: [],
    };
  }

  /* A lesson done: its quiz is the item's first rating (good when both answers were
     right first time), which sets its first difficulty and stability. */
  function finishLesson(item, now, grade = GOOD, opts = {}) {
    const g = clampG(grade);
    item.D = initD(g);
    item.S = initS(g);
    item.learnt = now;
    item.last = now;
    item.reps = 1;
    item.lapses = 0;
    item.grades = [g];
    return schedule(item, now, opts.retention, opts.rnd);
  }

  /* A review. grade: 1 again (forgotten), 2 hard, 3 good, 4 easy (true and false stand
     for good and again). A lapse is relearned before the session ends (the question
     comes back until it is right), which FSRS counts as a same-day review.
     opts: retention; rnd (spreads the next due date); assumeDue: rate it as if it
     were reviewed right when due (a calibration test: how long it has really been is
     unknown). */
  function review(item, grade, now, rnd, opts = {}) {
    const g = clampG(grade === true ? GOOD : grade === false ? AGAIN : grade);
    adopt(item);
    if (item.S == null) { item.D = initD(g); item.S = initS(g); }
    const since = item.last || item.learnt || item.joined || item.added || now;
    const t = opts.assumeDue ? intervalFor(item.S, opts.retention) : days(since, now);
    const R = retrievability(t, item.S);
    let S, D = item.D;
    if (t === 0 && !opts.assumeDue) S = shortS(item.S, g);
    else if (g === AGAIN) S = forgetS(D, item.S, R);
    else S = recallS(D, item.S, R, g);
    D = nextD(D, g);
    if (g === AGAIN) {                      // relearned in the session: a same-day good
      S = shortS(S, GOOD);
      D = nextD(D, GOOD);
      item.lapses = (item.lapses || 0) + 1;
    }
    item.S = S;
    item.D = D;
    item.last = now;
    item.reps = (item.reps || 0) + 1;
    item.hist = (item.hist || []).concat(g > AGAIN).slice(-10);
    item.grades = (item.grades || []).concat(g).slice(-10);
    return schedule(item, now, opts.retention, rnd, t);
  }

  /* The rating a review earned, worked out from the answers: one per question, each
     {ok, near (a slip: the right syllables with a wrong tone), ms (from the question
     showing to the first key typed)}. Wrong: again. A slip, or a long think: hard.
     Right at once on every question: easy. Otherwise good. */
  const QUICK = 3000, SLOW = 15000;
  function gradeFrom(answers) {
    if (!answers.length) return GOOD;
    if (answers.some(a => !a.ok && !a.near)) return AGAIN;
    if (answers.some(a => a.near || a.ms > SLOW)) return HARD;
    if (answers.every(a => a.ms <= QUICK)) return EASY;
    return GOOD;
  }
  const GRADE_NAMES = [null, 'Again', 'Hard', 'Good', 'Easy'];

  const isDue = (item, now) => item.stage >= 1 && item.due <= now;
  const waiting = item => item.stage === 0;

  /* how many reviews fall due on each of the next `days` days (index 0 = today, from now) */
  function forecast(items, now, n = 7) {
    const start = dayStart(now);
    const out = new Array(n).fill(0);
    for (const it of items) {
      if (it.stage < 1) continue;
      const k = Math.max(0, Math.floor((it.due - start) / DAY));
      if (k < n) out[k]++;
    }
    return out;
  }

  /* what a character's stage means for the rest of the site */
  const statusFor = item => item.stage >= LEARNED_FROM ? 'learned' : item.stage >= 1 ? 'learning' : null;

  /* A character you already know (marked Learned on the rest of the site) joins the
     reviews at Journeyman I without a lesson: stability a month, difficulty average;
     its first review comes `wait` ms from now. It has no `learnt` time, so it doesn't
     count against the day's lessons. */
  function known(kind, info, now, wait) {
    const item = newItem(kind, info, now);
    item.S = STAGES[LEARNED_FROM][1];
    item.D = initD(GOOD);
    item.stage = stageFor(item.S);
    item.joined = now;
    item.due = now + wait;
    return item;
  }

  /* A calibration test sorts items (above all the characters marked learned, which
     joined at Journeyman I unchecked) by how well you really know them: a review,
     rated from the answers like any other, taken as if it came right when due. */
  function calibrate(item, grade, now, rnd, opts = {}) {
    review(item, grade, now, rnd, Object.assign({}, opts, { assumeDue: true }));
    item.cal = now;
    return item;
  }

  /* joined as a known character and never checked since: what calibration is for */
  const uncalibrated = item => !!item.joined && !item.cal && !(item.hist || []).length && item.stage >= 1;

  /* back from vacation: every review waits as long again as you were away */
  function resume(items, since, now) {
    const away = Math.max(0, now - since);
    for (const it of Object.values(items)) if (it.stage >= 1) it.due += away;
  }

  // ------------------------------------------------------------ settings

  const FAMILIAR = 3;          // HanziHero: familiar = reached the third stage (Apprentice I)

  /* HanziHero's application settings, as far as they apply here (every item here is
     one you added yourself, so there is no course, dictionary queue or skipping) */
  const DEFAULTS = {
    batch: 5,                  // lessons per batch
    lessonLimit: 10,           // lessons a day (0: no limit)
    wordLimit: 7,              // how many of those may be words
    reviewLimit: 0,            // a soft limit on reviews a day (0: none)
    retention: 0.9,            // FSRS: review when the chance of recall has fallen to this
    charUnlock: 'now',         // a character waits for its components: 'now' | 'learned' | 'familiar'
    wordWait: true,            // a word waits for its characters...
    wordUnlock: 'familiar',    // ...until they are 'familiar' or 'learned' (lesson done)
    autoChars: true,           // adding a word adds its characters too, prioritized
    autoComps: true,           // adding a character adds its new components too, learnt first
    questionOrder: 'pinyin',   // 'pinyin': pronunciation then meaning, in pairs; 'random': shuffled
    lessonOrder: 'words',      // 'words' first | 'chars' first | 'mix'
    prioRespect: true,         // prioritized items keep to the limits and the lesson order
    reviewOrder: 'random',     // 'random' | 'type' | 'oldest' | 'newest' | 'easiest' | 'lowest'
    showPct: true, showCount: true,
    validate: false,           // shake at answers that aren't pinyin, instead of marking them wrong
    sentences: false,          // word reviews show the word in a sentence
    script: 'simp',            // characters shown 'simp' | 'trad' | 'both' (app.js zh)
    listen: false,             // also ask an item's meaning from its sound alone, first
    write: false,              // also ask to write a character, last (hanzi-writer)
    voice: 'female', speed: 'normal', muteSfx: false, muteVoice: false,
    vacation: 0,               // when vacation mode began (0: not on vacation)
  };
  const settings = s => Object.assign({}, DEFAULTS, s || {});

  const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };

  function shuffle(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* what an item is learnt from, to be learnt before it: a word's characters; a
     character's components and sounds (kept on its item once looked up: it.parts) */
  const partsOf = (k, item) => item.kind === 'word' ? [...new Set([...k].filter(isHan))] : item.parts || [];

  /* due reviews in the order the settings ask for */
  function reviewOrder(keys, items, how, now, rnd = Math.random) {
    const ks = keys.slice(), it = k => items[k];
    const since = x => x.learnt || x.joined || x.added || 0;
    switch (how) {
      case 'type': return ks.sort((a, b) => (it(a).kind === 'word') - (it(b).kind === 'word') || it(a).due - it(b).due);
      case 'oldest': return ks.sort((a, b) => since(it(a)) - since(it(b)));
      case 'newest': return ks.sort((a, b) => since(it(b)) - since(it(a)));
      case 'lowest': return ks.sort((a, b) => it(a).stage - it(b).stage || (it(a).S || 0) - (it(b).S || 0));
      case 'easiest': {
        // most likely still remembered: the highest retrievability now
        const R = x => { const m = memory(x, now); return m ? m.R : 0; };
        return ks.sort((a, b) => R(it(b)) - R(it(a)));
      }
      default: return shuffle(ks, rnd);
    }
  }

  /* What there is to study now.
     env.level(c): how far along a character is, as a stage (null: nothing to wait for);
     env.comps(k): a character's components (null: not known yet);
     env.compOk(c, stage): whether a component counts as known at that stage.
     -> {lessons: ready now in order, waiting: every queued key in order, locked: {key:
        [what it waits for]}, lessonsToday, wordsToday, due, reviews (due, in order),
        reviewsToday, reviewsLeft (under the soft limit), vacation} */
  function plan(items, cfg, now, env, rnd = Math.random) {
    cfg = settings(cfg);
    const start = dayStart(now), keys = Object.keys(items), it = k => items[k];
    const today = keys.filter(k => it(k).learnt >= start);
    const out = {
      lessons: [], waiting: [], locked: {},
      lessonsToday: today.length, wordsToday: today.filter(k => it(k).kind === 'word').length,
      due: [], reviews: [], reviewsToday: keys.filter(k => it(k).last >= start).length, reviewsLeft: 0,
      vacation: !!cfg.vacation,
    };

    const need = { learned: 1, familiar: FAMILIAR };
    const queued = keys.filter(k => it(k).stage === 0);
    for (const k of queued) {
      let wait = [];
      if (it(k).kind === 'word' && cfg.wordWait) {
        wait = [...new Set([...k].filter(isHan))].filter(c => {
          const l = env.level(c);
          return l != null && l < need[cfg.wordUnlock];
        });
      } else if (it(k).kind !== 'word' && need[cfg.charUnlock]) {
        wait = (env.comps(k) || []).filter(c => !env.compOk(c, need[cfg.charUnlock]));
      }
      if (wait.length) out.locked[k] = wait;
    }

    const first = (a, b) => (it(b).prio ? 1 : 0) - (it(a).prio ? 1 : 0) || it(a).added - it(b).added;
    const order = ks => {
      const w = ks.filter(k => it(k).kind === 'word').sort(first);
      const c = ks.filter(k => it(k).kind !== 'word').sort(first);
      if (cfg.lessonOrder === 'words') return w.concat(c);
      if (cfg.lessonOrder === 'chars') return c.concat(w);
      const mixed = [];                            // 'mix': each kind in proportion
      let i = 0, j = 0;
      while (i < w.length || j < c.length) {
        if (j < c.length && (i >= w.length || j / c.length <= i / w.length)) mixed.push(c[j++]);
        else mixed.push(w[i++]);
      }
      return mixed;
    };
    // with the priority queue absolute, prioritized items go before everything
    out.waiting = cfg.prioRespect ? order(queued)
      : order(queued.filter(k => it(k).prio)).concat(order(queued.filter(k => !it(k).prio)));
    // then in a sensible order: what an item is made of (a character's components, a
    // word's characters) comes just before it when that is waiting for its lesson too
    const inQueue = new Set(queued), placed = new Set(), seq = [];
    const put = (k, depth) => {
      if (placed.has(k)) return;
      placed.add(k);
      if (depth < 4) for (const p of partsOf(k, it(k))) if (p !== k && inQueue.has(p)) put(p, depth + 1);
      seq.push(k);
    };
    out.waiting.forEach(k => put(k, 0));
    out.waiting = seq;

    let left = cfg.lessonLimit ? Math.max(0, cfg.lessonLimit - out.lessonsToday) : Infinity;
    let words = cfg.lessonLimit ? Math.max(0, Math.min(cfg.wordLimit, cfg.lessonLimit) - out.wordsToday) : Infinity;
    for (const k of out.waiting) {
      if (out.locked[k]) continue;
      const word = it(k).kind === 'word';
      // a component or a sound is a small lesson on the way to a character: it doesn't count
      if (it(k).kind === 'comp' || it(k).kind === 'sound') { out.lessons.push(k); continue; }
      if (it(k).prio && !cfg.prioRespect) { out.lessons.push(k); continue; }
      if (left <= 0 || (word && words <= 0)) continue;
      out.lessons.push(k);
      left--;
      if (word) words--;
    }

    out.due = keys.filter(k => isDue(it(k), now));
    out.reviews = reviewOrder(out.due, items, cfg.reviewOrder, now, rnd);
    out.reviewsLeft = cfg.reviewLimit ? Math.min(out.due.length, Math.max(0, cfg.reviewLimit - out.reviewsToday))
      : out.due.length;
    if (out.vacation) { out.lessons = []; out.reviews = []; out.reviewsLeft = 0; }
    return out;
  }

  // ------------------------------------------------------------ answers

  const MARKS = { '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 };

  /* pinyin -> {letters, tones}: tones are the syllables' tone numbers in order, 5 for
     none. Takes tone marks (rèn shi), tone numbers (ren4shi5, ren4 shi) or both */
  function parsePinyin(s) {
    // ü, u: and v are all the same letter: v
    const t = String(s || '').toLowerCase().replace(/u:/g, 'v').normalize('NFD').replace(/u\u0308/g, 'v');
    let letters = '';
    const tones = [];
    for (const ch of t) {
      if (MARKS[ch]) tones.push(MARKS[ch]);
      else if (/[1-5]/.test(ch)) tones.push(+ch);
      else if (/[a-z]/.test(ch)) letters += ch === 'ü' ? 'v' : ch;
    }
    return { letters: letters.replace(/ü/g, 'v'), tones };
  }

  /* A syllable's sound as HanziHome teaches it (site/data/sounds.js): {initial, final,
     tone}. y and w count as initials (ya: y + a; yu: y + ü), ü is v (nǚ: n + v), and
     the buzzing -i after zh ch sh r z c s is "ih". The first syllable only. */
  const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
  function soundOf(pin) {
    const p = parsePinyin(String(pin || '').trim().split(/\s+/)[0]);
    const initial = INITIALS.find(i => p.letters.startsWith(i) && p.letters.length > i.length) || '';
    let final = p.letters.slice(initial.length);
    if (/^[jqxy]$/.test(initial) && final[0] === 'u') final = 'v' + final.slice(1);
    if (/^(zh|ch|sh|r|z|c|s)$/.test(initial) && final === 'i') final = 'ih';
    return { initial, final, tone: p.tones[0] || 5 };
  }

  /* the expected pinyin's syllables, each with its tone (5 = neutral) */
  function syllableTones(pin) {
    return String(pin || '').toLowerCase().split(/\s+/).filter(Boolean).map(syl => {
      const p = parsePinyin(syl);
      return p.tones.length ? p.tones[0] : 5;
    });
  }

  /* Right when the letters match and the tones typed match the syllables' tones in
     order. A neutral syllable may be typed with any tone or none (认识 ren4shi,
     ren4shi5 and ren4shi4 all pass): that is a matter of style, not of knowing it. */
  function checkPinyin(answer, expected) {
    const a = parsePinyin(answer), e = parsePinyin(expected);
    if (!a.letters || a.letters !== e.letters) return false;
    const want = syllableTones(expected), got = a.tones.filter(t => t !== 5);
    const fit = (i, j) => {
      if (j === want.length) return i === got.length;
      if (want[j] === 5) return fit(i, j + 1) || (i < got.length && fit(i + 1, j + 1));
      return i < got.length && got[i] === want[j] && fit(i + 1, j + 1);
    };
    return fit(0, 0);
  }

  const norm = s => String(s || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/\b(sb|sth|someone|something|one's)\b/g, ' ')
    .replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(to|a|an|the) /, '').trim();

  /* typing distance: a letter added, dropped or wrong, or two neighbours swapped (knwo) */
  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  /* every meaning an item accepts, one sense each */
  function meanings(item) {
    const out = [];
    for (const m of [item.mean].concat(item.alts || [], item.syn || [])) {
      for (const part of String(m || '').split(/;|\//)) {
        const n = norm(part);
        if (n && !out.includes(n)) out.push(n);
      }
    }
    return out;
  }

  /* Right when the answer is one of the item's meanings, give or take "to", "a",
     brackets and a typo (one letter wrong from 4 letters, two from 8) */
  function checkMeaning(answer, item) {
    const a = norm(answer);
    if (!a) return false;
    return meanings(item).some(m => m === a
      || (a.length >= 4 && distance(a, m) <= (a.length >= 8 ? 2 : 1)));
  }

  /* Pinyin answer validation: is this pinyin at all? Every syllable has to be a real one
     (an erhua r allowed), and a tone number has to follow a syllable (not "yi22" or
     "jeu4"). A typo that lands on another real syllable (yi as yu) can't be caught. */
  const SYLLABLES = new Set(('a ai an ang ao ba bai ban bang bao bei ben beng bi bia bian biang biao bie bin bing bo bu ca '
    + ' cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua '
    + ' chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei '
    + ' den deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan '
    + ' fang fei fen feng fiao fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai '
    + ' guan guang gui gun guo ha hai han hang hao he hei hen heng hm hng hong hou hu hua huai huan '
    + ' huang hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan '
    + ' kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le '
    + ' lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lv lve m ma mai '
    + ' man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu n na nai nan nang nao '
    + ' ne nei nen neng ng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nv nve o ou '
    + ' pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao '
    + ' qie qin qing qiong qiu qu quan que qun r ran rang rao re ren reng ri rong rou ru rua ruan '
    + ' rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi '
    + ' shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan '
    + ' tang tao te tei teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei '
    + ' wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao '
    + ' ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan '
    + ' zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi '
    + ' zong zou zu zuan zui zun zuo').split(/\s+/));

  function syllables(x) {                          // can x be cut into syllables?
    const ok = [true];
    for (let i = 1; i <= x.length; i++) {
      ok[i] = false;
      for (let j = Math.max(0, i - 7); j < i && !ok[i]; j++) {
        const s = x.slice(j, i);
        if (ok[j] && (SYLLABLES.has(s) || (s.length > 1 && s.endsWith('r') && SYLLABLES.has(s.slice(0, -1))))) ok[i] = true;
      }
    }
    return ok[x.length];
  }

  function validPinyin(answer) {
    const s = String(answer || '').toLowerCase().replace(/u:/g, 'v').normalize('NFD')
      .replace(/u\u0308/g, 'v').replace(/[\u0300-\u036f]/g, '').trim();
    if (!/[a-z]/.test(s) || /[^a-z1-5\s'’-]/.test(s)) return false;
    if (/\d\d/.test(s) || /(^|[\s'’-])\d/.test(s)) return false;
    return s.split(/[\s'’-]+|(?<=\d)/).filter(Boolean).every(chunk => syllables(chunk.replace(/\d$/, '')));
  }

  return {
    STAGES, MASTER, LEARNED_FROM, FAMILIAR, DAY, DEFAULTS, stageName, group, newItem, finishLesson, partsOf,
    review, known, resume, isDue, waiting, forecast, statusFor, settings, dayStart, plan, reviewOrder,
    calibrate, uncalibrated, adopt, memory, retrievability, stageFor, gradeFrom, GRADE_NAMES, QUICK, SLOW,
    W, initD, initS, intervalFor,
    checkPinyin, checkMeaning, validPinyin, meanings, parsePinyin, soundOf,
  };
});
