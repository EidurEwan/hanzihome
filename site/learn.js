/* learn.js — lessons and spaced repetition, the way HanziHero does them.
 *
 * You add characters and words you meet to a lesson queue. A lesson shows the
 * item's parts, your mnemonic and an example, then checks you can type its
 * pinyin and its meaning; from then on it comes back for review on HanziHero's
 * schedule (https://hanzihero.com/docs/srs-stages): ten stages from Novice I
 * (a day) to Expert III (a year), then Master. A wrong answer halves the
 * interval, and halves it again for each of the item's last five reviews that
 * was also wrong.
 *
 * An item, kept in the store under its characters (Store.data.items):
 *   {kind: 'char' | 'word', pin: 'rèn shi', mean: 'to know', alts: [...meanings],
 *    syn: [your synonyms], mnemonic, ex: {text, t} (where you met it),
 *    added, stage (0 = waiting for its lesson, 1-9 reviewing, 10 master), due, hist}
 *
 * Pure functions, no DOM: site/app.js draws the pages, test/learn.js checks this.
 * Works in the browser (window.Learn) and in Node (require). */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Learn = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 864e5;
  // [name, days until the next review once an item reaches this stage]
  const STAGES = [
    ['Lesson', 0],
    ['Novice I', 1], ['Novice II', 4],
    ['Apprentice I', 7], ['Apprentice II', 14],
    ['Journeyman I', 30], ['Journeyman II', 60],
    ['Expert I', 120], ['Expert II', 240], ['Expert III', 365],
    ['Master', Infinity],
  ];
  const MASTER = STAGES.length - 1;
  const LEARNED_FROM = 5;      // Journeyman and up count as learned on the rest of the site
  const GROUPS = ['Lesson', 'Novice', 'Novice', 'Apprentice', 'Apprentice', 'Journeyman', 'Journeyman',
    'Expert', 'Expert', 'Expert', 'Master'];

  const stageName = s => (STAGES[s] || STAGES[0])[0];
  const group = s => GROUPS[s] || 'Lesson';

  /* a little spread, so a day's lessons don't all come back in one lump (HanziHero
     adds ±1 to ±4 days depending on the interval) */
  function fuzz(days, rnd) {
    const span = days >= 120 ? 4 : days >= 30 ? 2 : days >= 7 ? 1 : 0;
    return span ? Math.round((rnd() * 2 - 1) * span) : 0;
  }

  function newItem(kind, info, now) {
    return {
      kind, pin: info.pin || '', mean: info.mean || '', alts: info.alts || [], syn: [],
      mnemonic: '', ex: info.ex || null, added: now, stage: 0, due: 0, hist: [],
    };
  }

  function finishLesson(item, now) {
    item.stage = 1;
    item.due = now + STAGES[1][1] * DAY;
    item.learnt = now;
    return item;
  }

  /* a review's result: right = both questions right first time */
  function review(item, right, now, rnd = Math.random) {
    const wrongBefore = (item.hist || []).slice(-5).filter(r => !r).length;
    item.hist = (item.hist || []).concat(right).slice(-10);
    if (right) {
      item.stage = Math.min(MASTER, Math.max(1, item.stage) + 1);
      const days = STAGES[item.stage][1];
      item.due = days === Infinity ? 0 : now + (days + fuzz(days, rnd)) * DAY;
      return item;
    }
    const days = STAGES[Math.max(1, Math.min(item.stage, MASTER - 1))][1] / Math.pow(2, 1 + wrongBefore);
    let stage = 1;
    for (let s = 1; s < MASTER; s++) if (STAGES[s][1] <= days) stage = s;
    item.stage = stage;
    item.due = now + days * DAY;
    return item;
  }

  const isDue = (item, now) => item.stage >= 1 && item.stage < MASTER && item.due <= now;
  const waiting = item => item.stage === 0;

  /* how many reviews fall due on each of the next `days` days (index 0 = today, from now) */
  function forecast(items, now, days = 7) {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const out = new Array(days).fill(0);
    for (const it of items) {
      if (it.stage < 1 || it.stage >= MASTER) continue;
      const k = Math.max(0, Math.floor((it.due - start) / DAY));
      if (k < days) out[k]++;
    }
    return out;
  }

  /* what a character's review stage means for the rest of the site */
  const statusFor = item => item.stage >= LEARNED_FROM ? 'learned' : item.stage >= 1 ? 'learning' : null;

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

  return {
    STAGES, MASTER, LEARNED_FROM, DAY, stageName, group, newItem, finishLesson, review,
    isDue, waiting, forecast, statusFor, checkPinyin, checkMeaning, meanings, parsePinyin,
  };
});
