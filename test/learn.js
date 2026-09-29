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

check('a lesson leads to Novice I, due a day later', () => {
  const it = L.finishLesson(L.newItem('word', { pin: 'rèn shi', mean: 'to know' }, t0), t0);
  assert.strictEqual(it.stage, 1);
  assert.strictEqual(it.due, t0 + DAY);
});

check('right answers climb the stages on HanziHero\'s intervals', () => {
  const it = L.finishLesson(L.newItem('char', { pin: 'chī', mean: 'to eat' }, t0), t0);
  const days = [];
  for (let i = 0; i < 9; i++) {
    L.review(it, true, t0, still);
    days.push(it.stage === L.MASTER ? 'master' : Math.round((it.due - t0) / DAY));
  }
  assert.deepStrictEqual(days, [4, 7, 14, 30, 60, 120, 240, 365, 'master']);
  assert.strictEqual(L.statusFor(it), 'learned');
});

check('a wrong answer halves the interval, more after recent misses', () => {
  const it = L.finishLesson(L.newItem('char', { pin: 'chī', mean: 'to eat' }, t0), t0);
  for (let i = 0; i < 4; i++) L.review(it, true, t0, still);     // Journeyman I: 30 days
  assert.strictEqual(it.stage, 5);
  L.review(it, false, t0, still);                                // 15 days -> Apprentice II
  assert.strictEqual(Math.round((it.due - t0) / DAY), 15);
  assert.strictEqual(it.stage, 4);
  L.review(it, false, t0, still);                                // 14 / 2 / 2 = 3.5 days
  assert.strictEqual((it.due - t0) / DAY, 3.5);
  assert.strictEqual(it.stage, 1);
  assert.strictEqual(L.statusFor(it), 'learning');
});

check('forecast counts reviews per day', () => {
  const a = L.finishLesson(L.newItem('char', {}, t0), t0);       // due tomorrow
  const b = L.finishLesson(L.newItem('char', {}, t0), t0 - DAY);  // due now
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
  assert.deepStrictEqual(L.plan(items, cfg, t0, env).lessons, ['一二', '二三', '一', '二']);
  assert.deepStrictEqual(L.plan(items, { ...cfg, lessonOrder: 'chars' }, t0, env).lessons, ['一', '二', '三', '一二']);
  assert.deepStrictEqual(L.plan(items, { ...cfg, lessonOrder: 'mix', lessonLimit: 0 }, t0, env).lessons,
    ['一', '一二', '二', '二三', '三', '一三']);
  // two lessons done today: two left, and one of them may be a word
  L.finishLesson(items['一二'], t0);
  L.finishLesson(items['一'], t0);
  assert.deepStrictEqual(L.plan(items, cfg, t0 + 1000, env).lessons, ['二三', '二']);
  // tomorrow the limits start again
  assert.strictEqual(L.plan(items, cfg, t0 + DAY, env).lessons.length, 4);
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
  const v = L.plan(items, { vacation: t0 }, t0, env);
  assert.deepStrictEqual([v.lessons.length, v.reviews.length, v.vacation], [0, 0, true]);
  L.resume(items, t0 - 5 * DAY, t0);
  assert.strictEqual(items['三'].due, t0 - 2000 + 5 * DAY);
});

check('a learned character joins at Journeyman I without using a lesson', () => {
  const it = L.known('char', { pin: 'hǎo', mean: 'good' }, t0, 3 * DAY);
  assert.deepStrictEqual([it.stage, L.stageName(it.stage), it.due, L.statusFor(it)], [5, 'Journeyman I', t0 + 3 * DAY, 'learned']);
  assert.strictEqual(L.plan({ 好: it }, {}, t0, world({ 好: it })).lessonsToday, 0);
});

console.log(`\n${n} checks passed`);
