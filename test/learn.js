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

console.log(`\n${n} checks passed`);
