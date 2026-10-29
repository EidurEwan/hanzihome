/* Checks for site/learn.js: the review schedule and how answers are marked.
 *
 *   node test/learn.js
 */

'use strict';

const assert = require('assert');
const L = require('../site/learn.js');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const DAY = L.DAY, t0 = Date.UTC(2026, 8, 29, 12);
const still = () => 0.5;                         // no fuzz

/* FSRS-5, as the reference implementation (ts-fsrs 4.7.1, default weights) computes it:
   [grade, days since the last review, stability after, difficulty after], from the
   memory a lesson rated good leaves (S 3.173, D 5.2824). An again is followed by the
   same-day relearning good that a review session gives it. */
const REFERENCE = [
  [1, 3, 1.4860, 6.7805], [2, 3, 4.9245, 6.0350], [3, 3, 10.7389, 5.2730], [4, 3, 25.7936, 4.5110],
  [1, 11, 2.1467, 6.7805], [2, 11, 8.3228, 6.0350], [3, 11, 25.4185, 5.2730], [4, 11, 69.6827, 4.5110],
  [1, 35, 3.1730, 6.7805], [2, 35, 13.7819, 6.0350], [3, 35, 49.0000, 5.2730], [4, 35, 140.1864, 4.5110],
  [3, 0, 4.4669, 5.2730],
];
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 5e-4, `${what}: ${a} against ${b}`);

check('a lesson sets the first memory by FSRS\'s first rating', () => {
  const firsts = [[1, 0.4026, 7.1949], [2, 1.1839, 6.4883], [3, 3.1730, 5.2824], [4, 15.6911, 3.2245]];
  for (const [g, S, D] of firsts) {
    const it = L.finishLesson(L.newItem('word', { pin: 'rèn shi', mean: 'to know' }, t0), t0, g);
    near(it.S, S, 'S after first rating ' + g);
    near(it.D, D, 'D after first rating ' + g);
  }
  const good = L.finishLesson(L.newItem('char', {}, t0), t0, 3);
  assert.strictEqual(L.stageName(good.stage), 'Novice I');
  assert.strictEqual(good.due, t0 + 3 * DAY);                   // R is 90% after S days
});

check('reviews move difficulty and stability as the reference FSRS does', () => {
  for (const [g, t, S, D] of REFERENCE) {
    const it = { stage: 1, S: 3.173, D: 5.28243557, last: t0 - t * DAY };
    L.review(it, g, t0);
    near(it.S, S, `S after grade ${g} at ${t} days`);
    near(it.D, D, `D after grade ${g} at ${t} days`);
  }
});

check('good reviews carry an item up the stages; a lapse brings it down', () => {
  const it = L.finishLesson(L.newItem('char', { pin: 'chī', mean: 'to eat' }, t0), t0);
  let now = t0;
  const stages = [];
  for (let i = 0; i < 4; i++) {
    now = it.due;                                                 // reviewed when due
    L.review(it, 3, now);
    stages.push(L.stageName(it.stage));
  }
  assert.deepStrictEqual(stages, ['Apprentice I', 'Journeyman I', 'Journeyman II', 'Expert II']);
  assert.strictEqual(L.statusFor(it), 'learned');
  const before = it.S;
  now = it.due;
  L.review(it, 1, now);
  assert.ok(it.S < before / 10, 'a lapse cuts stability');
  assert.strictEqual(it.lapses, 1);
  assert.deepStrictEqual(it.hist.slice(-2), [true, false]);
  assert.strictEqual(L.statusFor(it), 'learning');
});

check('the retention wanted sets the interval', () => {
  assert.deepStrictEqual([0.5, 3.173, 11.13, 87.6, 400].map(s => L.intervalFor(s, 0.9)), [1, 3, 11, 88, 400]);
  assert.deepStrictEqual([3.173, 30].map(s => L.intervalFor(s, 0.85)), [5, 49]);
  near(L.retrievability(30, 30), 0.9, 'R after S days');
});

check('the rating comes from the answers, not from asking', () => {
  const a = (ok, ms, nearly) => ({ ok, ms, near: !!nearly });
  assert.strictEqual(L.gradeFrom([a(true, 1200), a(true, 2500)]), 4);        // right, at once
  assert.strictEqual(L.gradeFrom([a(true, 1200), a(true, 6000)]), 3);        // right
  assert.strictEqual(L.gradeFrom([a(true, 20000), a(true, 1000)]), 2);       // right after a long think
  assert.strictEqual(L.gradeFrom([a(false, 1000, true), a(true, 1000)]), 2); // a slip of tone
  assert.strictEqual(L.gradeFrom([a(false, 1000), a(true, 1000)]), 1);       // wrong
});

check('easy needs a month of memory and no trouble last time', () => {
  const a = (ok, ms) => ({ ok, ms, near: false }), quick = [a(true, 1200), a(true, 2500)];
  const lesson = L.newItem('char', {}, t0);
  assert.strictEqual(L.gradeFrom(quick, lesson), 3);                          // a lesson's quiz: good at best
  const young = L.finishLesson(L.newItem('char', {}, t0), t0, 3);
  assert.strictEqual(L.gradeFrom(quick, young), 3);                           // S 3 days: quick is just recent
  const month = { stage: 5, S: 30, D: 5, grades: [3, 3, 3] };
  assert.strictEqual(L.gradeFrom(quick, month), 4);
  assert.strictEqual(L.gradeFrom(quick, { ...month, grades: [3, 2] }), 3);   // hard last time
  assert.strictEqual(L.gradeFrom(quick, { ...month, grades: [3, 1] }), 3);   // forgotten last time
  assert.strictEqual(L.gradeFrom([a(false, 1000), a(true, 1000)], month), 1);
  // a joined (calibration) item starts at a month: quick there still says easy
  assert.strictEqual(L.gradeFrom(quick, L.known('char', {}, t0, 0)), 4);
  // quick answers every time no longer reach years after three reviews
  const it = L.finishLesson(L.newItem('char', {}, t0), t0, 3), waits = [];
  for (let i = 0; i < 4; i++) { const now = it.due; L.review(it, L.gradeFrom(quick, it), now, null); waits.push(Math.round((it.due - now) / DAY)); }
  assert.deepStrictEqual(waits, [11, 35, 232, 1420]);
});

check('an item from before FSRS keeps its place', () => {
  const it = { stage: 5, due: t0 + 10 * DAY, hist: [true, false, true] };
  L.adopt(it);
  assert.strictEqual(it.S, 30);
  assert.strictEqual(L.stageFor(it.S), 5);
  near(it.D, 6.2824, 'D a little higher for a recent miss');
});

check('forecast counts reviews per day', () => {
  const a = L.finishLesson(L.newItem('char', {}, t0), t0, 2);     // S 1.18: due tomorrow
  const b = L.finishLesson(L.newItem('char', {}, t0), t0 - DAY, 2); // due now
  const f = L.forecast([a, b, L.newItem('char', {}, t0)], t0, 3);
  assert.deepStrictEqual(f, [1, 1, 0]);
});

check('pinyin: tone numbers, tone marks, spaces, neutral tones', () => {
  const yes = [['ren4shi', 'rèn shi'], ['ren4shi5', 'rèn shi'], ['ren4 shi4', 'rèn shi'], ['rènshi', 'rèn shi'],
    ['xia4yu3', 'xià yǔ'], ['XIA4 YU3', 'xià yǔ'], ['lv4', 'lǜ'], ['lu:4', 'lǜ'], ['lü4', 'lǜ'], ['chi1', 'chī']];
  const no = [['xia4wu3', 'xià yǔ'], ['renshi', 'rèn shi'], ['ren2shi', 'rèn shi'], ['chi', 'chī'],
    ['chi4', 'chī'], ['lu4', 'lǜ'], ['', 'chī']];
  for (const [a, e] of yes) assert.ok(L.checkPinyin(a, e), `${a} should be right for ${e}`);
  for (const [a, e] of no) assert.ok(!L.checkPinyin(a, e), `${a} should be wrong for ${e}`);
});

check('meaning: alternatives, "to", brackets, typos, synonyms', () => {
  const it = L.newItem('word', { pin: 'rèn shi', mean: 'to know', alts: ['to recognize; to be familiar with'] }, t0);
  for (const a of ['know', 'to know', 'recognise', 'Recognize', 'be familiar with', 'to knwo']) {
    assert.ok(L.checkMeaning(a, it), `${a} should be right`);
  }
  for (const a of ['', 'eat', 'no', 'familiar']) assert.ok(!L.checkMeaning(a, it), `${a} should be wrong`);
  it.syn.push('meet');
  assert.ok(L.checkMeaning('meet', it));
});

check('meaning: a real word is no typo; British spellings are no typo either', () => {
  const words = new Set(['tell', 'sell', 'month', 'mouth', 'colour', 'grey', 'center']), isWord = w => words.has(w);
  const of = (mean, alts) => L.newItem('char', { mean, alts }, t0);
  assert.ok(!L.checkMeaning('tell', of('to sell'), isWord));
  assert.ok(L.checkMeaning('tell', of('to sell')));                          // (without a word list: a typo)
  assert.ok(!L.checkMeaning('month', of('mouth'), isWord));
  assert.ok(L.checkMeaning('to selll', of('to sell'), isWord));                 // a typo still is one
  assert.ok(L.checkMeaning('to knwo', of('to know'), isWord));
  assert.ok(L.checkMeaning('to sell', of('to sell'), isWord));
  for (const [ans, mean] of [['colour', 'color'], ['grey', 'gray'], ['centre', 'center'], ['to recognise', 'to recognize'],
    ['travelling', 'traveling'], ['theatre', 'theater'], ['to analyse', 'to analyze'], ['favourite', 'favorite']]) {
    assert.ok(L.checkMeaning(ans, of(mean), isWord), `${ans} for ${mean}`);
    assert.ok(L.checkMeaning(mean, of(ans), isWord), `${mean} for ${ans}`);
  }
  assert.ok(!L.checkMeaning('four', of('for'), w => w === 'four'));          // (-our is only British past 5 letters)
});

check('pinyin validation: real syllables, tones after syllables', () => {
  for (const a of ['ren4shi', 'ni3hao3', 'xiǎo', 'yi1dianr3', 'mingzi', 'lü4', 'lv4', "xi1'an1", 'ren4 shi5']) {
    assert.ok(L.validPinyin(a), `${a} is pinyin`);
  }
  for (const a of ['jeu4', 'yi22', 'shx4', '4ren', 'hello', 'ch1', '', '好']) assert.ok(!L.validPinyin(a), `${a} is not`);
});

/* a small world for plan(): items, and what the rest of the site knows */
function world(items, status = {}, comps = {}) {
  const level = c => {
    if (!/[一-鿿]/.test(c)) return null;
    const it = items[c], st = status[c];
    return Math.max(it ? it.stage : 0, st === 'learned' ? L.LEARNED_FROM : st === 'learning' ? 1 : 0);
  };
  return { level, comps: k => (items[k] && items[k].cm) || null, compOk: (c, need) => !!comps[c] || level(c) >= need };
}
const queued = (kind, added, extra) => Object.assign(L.newItem(kind, { pin: 'x', mean: 'x' }, t0 + added), extra || {});

check('plan: lesson order, word limit and daily limit', () => {
  const items = { 一: queued('char', 1), 二: queued('char', 2), 三: queued('char', 3),
    一二: queued('word', 4), 二三: queued('word', 5), 一三: queued('word', 6) };
  const cfg = { lessonLimit: 4, wordLimit: 2, wordWait: false };
  const env = world(items);
  // words first, but a word's characters, waiting too, come just before it
  assert.deepStrictEqual(L.plan(items, cfg, t0, env).lessons, ['一', '二', '一二', '三']);
  assert.deepStrictEqual(L.plan(items, { ...cfg, lessonOrder: 'chars' }, t0, env).lessons, ['一', '二', '三', '一二']);
  assert.deepStrictEqual(L.plan(items, { ...cfg, lessonOrder: 'mix', lessonLimit: 0 }, t0, env).lessons,
    ['一', '二', '一二', '三', '二三', '一三']);
  // two lessons done today: two left, and one of them may be a word
  L.finishLesson(items['一二'], t0);
  L.finishLesson(items['一'], t0);
  assert.deepStrictEqual(L.plan(items, cfg, t0 + 1000, env).lessons, ['二', '三']);
  // tomorrow the limits start again
  assert.strictEqual(L.plan(items, cfg, t0 + DAY, env).lessons.length, 4);
});

check('plan: components come just before their character, and are not counted', () => {
  const items = { 好: queued('char', 1, { parts: ['c:女', 'c:子', 'i:h', 'f:ao', 't:3'] }),
    'c:女': queued('comp', 2), 'c:子': queued('comp', 3), 'i:h': queued('sound', 4), 'f:ao': queued('sound', 5),
    你: queued('char', 6, { parts: ['c:亻', 'c:尔'] }), 'c:亻': queued('comp', 7), 你好: queued('word', 8) };
  const env = world(items);
  const p = L.plan(items, { lessonLimit: 0, wordWait: false }, t0, env);
  assert.deepStrictEqual(p.lessons, ['c:亻', '你', 'c:女', 'c:子', 'i:h', 'f:ao', '好', '你好']);
  // a limit of 1: components and sounds don't count, but 你's 亻 waits with 你 for another day
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 1, wordWait: false, lessonOrder: 'chars' }, t0, env).lessons,
    ['c:女', 'c:子', 'i:h', 'f:ao', '好']);
});

check('plan: prioritized parts still come just before their own character', () => {
  const items = { 的: queued('char', 1, { parts: ['c:白', 'i:d'] }), 是: queued('char', 2, { parts: ['c:日', 'i:sh', 'i:d'] }),
    'c:白': queued('comp', 3, { prio: true }), 'i:d': queued('sound', 4, { prio: true }),
    'c:日': queued('comp', 5, { prio: true }), 'i:sh': queued('sound', 6, { prio: true }) };
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0 }, t0, world(items)).lessons,
    ['c:白', 'i:d', '的', 'c:日', 'i:sh', '是']);
});

check('soundOf: initial, final and tone, as the sound cast has them', () => {
  const so = s => { const x = L.soundOf(s); return [x.initial, x.final, x.tone].join(' '); };
  assert.strictEqual(so('bàn'), 'b an 4');
  assert.strictEqual(so('yuè'), 'y ve 4');
  assert.strictEqual(so('zhī'), 'zh ih 1');
  assert.strictEqual(so('nǚ'), 'n v 3');
  assert.strictEqual(so('qù'), 'q v 4');
  assert.strictEqual(so('ér'), ' er 2');
  assert.strictEqual(so('de'), 'd e 5');
  assert.strictEqual(so('xiǎo jiě'), 'x iao 3');
});

check('plan: words wait for their characters, characters for their components', () => {
  const items = { 认识: queued('word', 1), 认: queued('char', 2), 吃: queued('char', 3, { cm: ['口', '乞'] }) };
  const env = world(items, { 识: 'learned' });
  let p = L.plan(items, { lessonLimit: 0 }, t0, env);
  assert.deepStrictEqual(p.locked, { 认识: ['认'] });
  assert.deepStrictEqual(p.lessons, ['认', '吃']);
  L.finishLesson(items['认'], t0);                                  // learned, not yet familiar
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0, wordUnlock: 'learned' }, t0, env).lessons, ['认识', '吃']);
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0 }, t0, env).locked, { 认识: ['认'] });
  items['认'].stage = L.FAMILIAR;
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0 }, t0, env).locked, {});
  // characters: waiting for components you haven't marked known or learned
  p = L.plan(items, { lessonLimit: 0, charUnlock: 'learned' }, t0, world(items, { 识: 'learned' }, { 口: 1 }));
  assert.deepStrictEqual(p.locked, { 吃: ['乞'] });
});

check('plan: the priority queue, with and without the limits', () => {
  const items = { 一: queued('char', 1), 二: queued('char', 2), 三: queued('char', 3, { prio: true }),
    四四: queued('word', 4) };
  const env = world(items);
  const cfg = { lessonLimit: 2, wordLimit: 2, wordWait: false };
  assert.deepStrictEqual(L.plan(items, cfg, t0, env).lessons, ['四四', '三']);          // words first, then 三
  assert.deepStrictEqual(L.plan(items, { ...cfg, prioRespect: false }, t0, env).lessons, ['三', '四四', '一']);
});

check('plan: reviews in order, under a soft daily limit; vacation stops everything', () => {
  const items = {};
  ['一', '二', '三', '四'].forEach((c, i) => {
    items[c] = L.finishLesson(queued('char', i), t0 - 10 * DAY + i * DAY);
    items[c].stage = 4 - i;
    items[c].due = t0 - i * 1000;
  });
  const env = world(items);
  assert.deepStrictEqual(L.plan(items, { reviewOrder: 'lowest' }, t0, env).reviews, ['四', '三', '二', '一']);
  assert.deepStrictEqual(L.plan(items, { reviewOrder: 'oldest' }, t0, env).reviews, ['一', '二', '三', '四']);
  assert.deepStrictEqual(L.plan(items, { reviewOrder: 'newest' }, t0, env).reviews, ['四', '三', '二', '一']);
  assert.strictEqual(L.plan(items, { reviewLimit: 3 }, t0, env).reviewsLeft, 3);
  L.review(items['一'], true, t0);
  L.review(items['二'], true, t0);
  const p = L.plan(items, { reviewLimit: 3 }, t0 + 1000, env);
  assert.strictEqual(p.reviewsToday, 2);
  assert.strictEqual(p.reviewsLeft, 1);
  // a lesson today is not a review today
  items['五'] = L.finishLesson(queued('char', 9), t0 + 500);
  assert.strictEqual(L.plan(items, { reviewLimit: 3 }, t0 + 1000, env).reviewsToday, 2);
  const v = L.plan(items, { vacation: t0 }, t0, env);
  assert.deepStrictEqual([v.lessons.length, v.reviews.length, v.vacation], [0, 0, true]);
  L.resume(items, t0 - 5 * DAY, t0);
  assert.strictEqual(items['三'].due, t0 - 2000 + 5 * DAY);
});

check('a leech learnt again is no longer a leech', () => {
  const it = L.finishLesson(L.newItem('char', {}, t0), t0 - 60 * DAY);
  for (let i = 0; i < 4; i++) L.review(it, 1, t0 - (50 - 5 * i) * DAY);
  assert.ok(L.isLeech(it));
  Object.assign(it, { stage: 0, due: 0, prio: true });                         // Learn again
  delete it.learnt;
  L.finishLesson(it, t0, 3);
  assert.ok(!L.isLeech(it));
  assert.deepStrictEqual([it.lapses, it.hist], [0, []]);
});

check('a learned character joins at Journeyman I without using a lesson', () => {
  const it = L.known('char', { pin: 'hǎo', mean: 'good' }, t0, 3 * DAY);
  assert.deepStrictEqual([it.stage, L.stageName(it.stage), it.due, L.statusFor(it)], [5, 'Journeyman I', t0 + 3 * DAY, 'learned']);
  assert.strictEqual(L.plan({ 好: it }, {}, t0, world({ 好: it })).lessonsToday, 0);
});

check('calibration: rated from the answers, as if reviewed when due', () => {
  // a character marked learned joins at Journeyman I (S 30 days, D average) unchecked
  const joined = () => L.known('char', { pin: 'hǎo', mean: 'good' }, t0, 3 * DAY);
  assert.ok(L.uncalibrated(joined()));
  // FSRS from S 30 at R 90% (the reference gives S 5.03, 43.3, 87.6, 202.1)
  const got = [1, 2, 3, 4].map(g => {
    const it = L.calibrate(joined(), g, t0);
    return [L.stageName(it.stage), Math.round((it.due - t0) / DAY), L.statusFor(it), L.uncalibrated(it)];
  });
  assert.deepStrictEqual(got, [
    ['Novice II', 5, 'learning', false],
    ['Journeyman I', 43, 'learned', false],
    ['Journeyman II', 88, 'learned', false],
    ['Expert I', 202, 'learned', false],
  ]);
  // something learned in a lesson isn't "unsorted"
  assert.ok(!L.uncalibrated(L.finishLesson(L.newItem('char', {}, t0), t0)));
});

console.log(`\n${n} checks passed`);
