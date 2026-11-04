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
  const cfg = { lessonLimit: 4, wordLimit: 2, wordWait: false, lessonOrder: 'words' };
  const env = world(items);
  // words first, but a word's characters, waiting too, come just before it
  assert.deepStrictEqual(L.plan(items, cfg, t0, env).lessons, ['一', '二', '一二', '三']);
  // characters first, as they are unless asked: words with what is left
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 4, wordWait: false }, t0, env).lessons, ['一', '二', '三', '一二']);
  assert.deepStrictEqual(L.plan(items, { ...cfg, lessonOrder: 'mix', lessonLimit: 0 }, t0, env).lessons,
    ['一', '二', '一二', '三', '二三', '一三']);
  // two lessons done today: two left, and one of them may be a word
  L.finishLesson(items['一二'], t0);
  L.finishLesson(items['一'], t0);
  assert.deepStrictEqual(L.plan(items, cfg, t0 + 1000, env).lessons, ['二', '三']);
  // tomorrow the limits start again
  assert.strictEqual(L.plan(items, cfg, t0 + DAY, env).lessons.length, 4);
});

check('the daily limit: characters and their new components first, then words', () => {
  const char = (k, added, comps = []) => queued('char', added, { parts: comps });
  const items = {
    一: char('一', 1, ['c:甲', 'c:乙', 'i:y']), 'c:甲': queued('comp', 2), 'c:乙': queued('comp', 3), 'i:y': queued('sound', 4),
    二: char('二', 5, ['c:甲', 'c:丙']), 'c:丙': queued('comp', 6),      // 甲 shared: counted once
    三: char('三', 7),
    大人: queued('word', 8), 小人: queued('word', 9), 好人: queued('word', 10),
  };
  const env = world(items), go = (limit, extra = {}) => L.plan(items, { lessonLimit: limit, wordWait: false, ...extra }, t0, env).lessons;
  const words = l => l.filter(k => k.length === 2 && !k.includes(':'));
  const chars = l => l.filter(k => k.length === 1);
  // 一 + 甲 乙 = 3, 二 + 丙 = 2, 三 = 1: six for the characters, the sound free, two left for words
  let l = go(8);
  assert.deepStrictEqual(chars(l), ['一', '二', '三']);
  assert(l.includes('i:y'), 'its sound comes with it');
  assert.deepStrictEqual(words(l), ['大人', '小人']);
  // the components use up the limit: no words
  assert.deepStrictEqual(words(go(6)), []);
  assert.deepStrictEqual(chars(go(6)), ['一', '二', '三']);
  // 二 doesn't fit in 4 (3 + 2): the characters stop there, and what is left goes to words
  l = go(4);
  assert.deepStrictEqual(chars(l), ['一']);
  assert.deepStrictEqual(words(l), ['大人']);
  // the first character always fits, however many components it brings, or nothing could ever start
  l = go(2);
  assert.deepStrictEqual(chars(l), ['一']);
  assert.deepStrictEqual(words(l), []);
  // with no characters at all, the limit is all words
  assert.deepStrictEqual(L.plan({ 大人: items.大人, 小人: items.小人 }, { lessonLimit: 1, wordWait: false }, t0, env).lessons, ['大人']);
  // the path's daily number holds back characters, and words get the room
  const path = { 一: { ...items.一, parts: [], path: 'mix' }, 二: { ...items.二, parts: [], path: 'mix' }, 大人: items.大人, 小人: items.小人 };
  assert.deepStrictEqual(L.plan(path, { lessonLimit: 3, path: 'mix', pathDaily: 1, wordWait: false }, t0, world(path)).lessons, ['大人', '小人', '一']);
  // what was done today counts: components, yes; sounds, no
  const done = { ...items, 'c:甲': L.finishLesson(queued('comp', 2), t0), 'i:y': L.finishLesson(queued('sound', 4), t0) };
  const p = L.plan(done, { lessonLimit: 8, wordWait: false }, t0 + 1000, world(done));
  assert.strictEqual(p.lessonsToday, 1);
  assert.deepStrictEqual(words(p.lessons), ['大人', '小人'], '甲 was paid for, and costs nothing again');
});

check('the lessons come: prioritised, then words, then characters, parts with their own', () => {
  const char = (added, extra) => queued('char', added, extra);
  const items = {
    一: char(1, { parts: ['c:甲', 'i:y'] }), 'c:甲': queued('comp', 2, { prio: true }), 'i:y': queued('sound', 3, { prio: true }),
    二: char(4), 三: char(5, { prio: true, parts: ['c:乙'] }), 'c:乙': queued('comp', 6, { prio: true }),
    大人: queued('word', 7), 小人: queued('word', 8), 好人: queued('word', 9, { prio: true }),
  };
  const env = world(items);
  const p = L.plan(items, { lessonLimit: 20, wordWait: false }, t0, env);
  assert.deepStrictEqual(p.lessons, ['c:乙', '三', '好人', '大人', '小人', 'c:甲', 'i:y', '一', '二']);
  // the room is still shared out characters first: 三 + 乙, 好人, 一 + 甲, 二 fill six, so no other word
  const q = L.plan(items, { lessonLimit: 6, wordWait: false }, t0, env);
  assert.deepStrictEqual(q.lessons.filter(k => /^[大小好]人$/.test(k)), ['好人']);
  assert.strictEqual(q.lessons[q.lessons.length - 1], '二');
  // a word can't go ahead of its own characters
  const own = { 一: char(1), 二: char(2), 一二: queued('word', 3) };
  assert.deepStrictEqual(L.plan(own, { lessonLimit: 0, wordWait: false }, t0, world(own)).lessons, ['一', '二', '一二']);
});

check('a word waits until all its characters have had their lessons', () => {
  const items = { 认识: queued('word', 1), 认: queued('char', 2), 识: queued('char', 3) };
  const env = world(items);
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0 }, t0, env).locked, { 认识: ['认', '识'] });
  L.finishLesson(items['认'], t0);
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0 }, t0 + L.DAY, env).locked, { 认识: ['识'] });
  L.finishLesson(items['识'], t0);                          // discovered: no review needed
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0 }, t0 + L.DAY, env).locked, {});
});

check('a word waits for the day after its characters have had their lessons', () => {
  const items = { 认识: queued('word', 1), 认: queued('char', 2), 识: queued('char', 3), 认真: queued('word', 4), 真: { kind: 'char', stage: 1, learnt: t0 - L.DAY },
    好人: queued('word', 5), 好: { kind: 'char', stage: 1, learnt: t0 - L.DAY }, 人: { kind: 'char', stage: 1, learnt: t0 - 2 * L.DAY } };
  const env = world(items);
  L.finishLesson(items['认'], t0);
  L.finishLesson(items['识'], t0);
  const p = L.plan(items, { lessonLimit: 0 }, t0, env);
  assert.deepStrictEqual(p.locked, { 认识: ['认', '识'], 认真: ['认'] });       // one new character is enough to wait
  assert.deepStrictEqual(p.tomorrow.sort(), ['认识', '认真'].sort());
  assert.deepStrictEqual(p.lessons, ['好人']);                                // nothing new in it: ready now
  const next = L.plan(items, { lessonLimit: 0 }, t0 + L.DAY, env);
  assert.deepStrictEqual(next.locked, {});
  assert.deepStrictEqual(next.tomorrow, []);
  assert.deepStrictEqual(next.lessons.sort(), ['好人', '认识', '认真'].sort());
  // a word held back by a character still to come isn't promised for tomorrow
  const later = { 认识: queued('word', 1), 认: queued('char', 2), 识: queued('char', 3) };
  L.finishLesson(later['认'], t0);
  const q = L.plan(later, { lessonLimit: 0 }, t0, world(later));
  assert.deepStrictEqual(q.tomorrow, []);
  assert.deepStrictEqual(q.locked, { 认识: ['识', '认'] });
});

check('plan: components come just before their character', () => {
  const items = { 好: queued('char', 1, { parts: ['c:女', 'c:子', 'i:h', 'f:ao', 't:3'] }),
    'c:女': queued('comp', 2), 'c:子': queued('comp', 3), 'i:h': queued('sound', 4), 'f:ao': queued('sound', 5),
    你: queued('char', 6, { parts: ['c:亻', 'c:尔'] }), 'c:亻': queued('comp', 7), 你好: queued('word', 8) };
  const env = world(items);
  const p = L.plan(items, { lessonLimit: 0, wordWait: false, lessonOrder: 'words' }, t0, env);
  assert.deepStrictEqual(p.lessons, ['c:亻', '你', 'c:女', 'c:子', 'i:h', 'f:ao', '好', '你好']);
  // a limit of 1: the first character still comes, with its parts; 你's 亻 waits with 你 for another day
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
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0, lessonOrder: 'words' }, t0 + L.DAY, env).lessons, ['认识', '吃']);
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0, wordUnlock: 'familiar' }, t0 + L.DAY, env).locked, { 认识: ['认'] });
  items['认'].stage = L.FAMILIAR;
  assert.deepStrictEqual(L.plan(items, { lessonLimit: 0 }, t0 + L.DAY, env).locked, {});
  // characters: waiting for components you haven't marked known or learned
  p = L.plan(items, { lessonLimit: 0, charUnlock: 'learned' }, t0 + L.DAY, world(items, { 识: 'learned' }, { 口: 1 }));
  assert.deepStrictEqual(p.locked, { 吃: ['乞'] });
});

check('plan: the priority queue, with and without the limits', () => {
  const items = { 一: queued('char', 1), 二: queued('char', 2), 三: queued('char', 3, { prio: true }),
    四四: queued('word', 4) };
  const env = world(items);
  const cfg = { lessonLimit: 2, wordLimit: 2, wordWait: false };
  assert.deepStrictEqual(L.plan(items, cfg, t0, env).lessons, ['三', '一']);            // 三 first, then the characters
  assert.deepStrictEqual(L.plan(items, { ...cfg, prioRespect: false }, t0, env).lessons, ['三', '一', '二']);
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

check('the review log: every rating, with the chance of recall FSRS gave it', () => {
  const it = L.finishLesson(L.newItem('char', {}, t0), t0, 3);
  L.review(it, 3, t0 + 3 * DAY, null);
  L.review(it, 1, t0 + 14 * DAY, null);
  const min = t => Math.round(t / 6e4);
  assert.deepStrictEqual(it.log, [[min(t0), 3, 'l'], [min(t0 + 3 * DAY), 3, 90], [min(t0 + 14 * DAY), 1, 90]]);
  // a known character, said known, calibrated: tagged, no R
  const k = L.known('char', {}, t0, 0);
  L.calibrate(k, 2, t0 + DAY);
  assert.deepStrictEqual(k.log.map(e => e[2]), ['k', 'c']);
  const s = L.sayKnown(L.finishLesson(L.newItem('char', {}, t0), t0, 3), t0 + DAY, 30 * DAY);
  assert.deepStrictEqual([s.S, L.stageName(s.stage), s.log.map(e => e[2])], [30, 'Journeyman I', ['l', 'k']]);
  // learnt again: the old lines stay, a new lesson follows
  Object.assign(it, { stage: 0 });
  L.finishLesson(it, t0 + 20 * DAY, 2);
  assert.deepStrictEqual(it.log.map(e => e[2]), ['l', 90, 90, 'l']);
});

check('the prediction check groups reviews by R and counts what was recalled', () => {
  const at = (R, g) => [1, g, R];
  const items = { a: { log: [[1, 3, 'l'], at(92, 3), at(91, 1), at(93, 2), at(75, 1)] }, b: { log: [[1, 0, 'k'], at(96, 4), [2, 3, 'c']] } };
  const p = L.predictionCheck(items);
  assert.strictEqual(p.n, 5);
  near(p.predicted, (92 + 91 + 93 + 75 + 96) / 500, 'predicted');
  near(p.actual, 3 / 5, 'actual');
  assert.deepStrictEqual(p.groups.map(x => [x.from, x.to, x.n, x.actual]), [[0.7, 0.8, 1, 0], [0.9, 0.95, 3, 2 / 3], [0.95, 1, 1, 1]]);
  assert.strictEqual(L.predictionCheck(items, 10 * 6e4).n, 0);              // since: none that new
});

check('the optimizer CSV: from the last lesson, a relearning good after an again', () => {
  const it = L.finishLesson(L.newItem('char', {}, t0), t0, 3);
  L.review(it, 1, t0 + 3 * DAY, null);
  const k = L.known('char', {}, t0, 0);
  L.review(k, 3, t0 + 30 * DAY, null);                                       // never had a lesson: left out
  const m = Math.round(t0 / 6e4) * 6e4, m3 = Math.round((t0 + 3 * DAY) / 6e4) * 6e4;
  const out = L.reviewLogCsv({ 好: it, 是: k });
  assert.deepStrictEqual(out.items, ['好']);
  assert.strictEqual(out.csv, `card_id,review_time,review_rating\n1,${m},3\n1,${m3},1\n1,${m3 + 6e4},3\n`);
  // learnt again: only the new run counts
  Object.assign(it, { stage: 0 });
  L.finishLesson(it, t0 + 5 * DAY, 2);
  assert.strictEqual(L.reviewLogCsv({ 好: it }).csv.trim().split('\n').length, 2);
});

check('items learned by day: running totals by kind, from the first lesson', () => {
  const day0 = L.dayStart(t0);
  const lesson = (kind, t) => L.finishLesson(L.newItem(kind, {}, t), t, 3);
  const a = lesson('char', day0 + 10 * 3600e3), b = lesson('word', day0 + DAY + 3600e3), c = lesson('sound', day0 + 2 * DAY + 3600e3);
  Object.assign(b, { stage: 0 });                                          // learnt again later: still counts from its first lesson
  L.finishLesson(b, day0 + 2 * DAY + 7200e3, 3);
  const k = L.known('char', {}, day0 + DAY + 600e3, 0);
  const waiting = L.newItem('char', {}, day0);                               // no lesson yet: not counted
  const r = L.learnedByDay({ a, b, c, k, waiting }, day0 + 2 * DAY + 3 * 3600e3);
  assert.strictEqual(r.days.length, 3);
  assert.deepStrictEqual([r.series.char, r.series.word, r.series.sound, r.series.known, r.series.comp],
    [[1, 1, 1], [0, 1, 1], [0, 0, 1], [0, 1, 1], [0, 0, 0]]);
  assert.strictEqual(L.learnedByDay({ a }, day0 + 400 * DAY, 30).days.length, 30);   // at most `most` days
  assert.strictEqual(L.learnedByDay({ a }, day0 + 400 * DAY, 30).series.char[0], 1);
});

check('the balanced path: each of the four things moves a character up', () => {
  const pick = (rows, known = []) => L.pickChars(rows, 1, c => known.includes(c))[0];
  const row = (rank, hsk, strokes, comps) => [rank, hsk, strokes, comps || ''];
  assert.strictEqual(pick({ a: row(100, 3, 8), b: row(2000, 3, 8) }), 'a', 'commoner');
  assert.strictEqual(pick({ a: row(500, 5, 8), b: row(500, 1, 8) }), 'b', 'earlier in the HSK');
  assert.strictEqual(pick({ a: row(500, 3, 18), b: row(500, 3, 4) }), 'b', 'fewer strokes');
  assert.strictEqual(pick({ a: row(500, 3, 8, '甲乙'), b: row(500, 3, 8, '丙丁') }, ['丙', '丁']), 'b', 'components known');
  assert.strictEqual(pick({ a: row(500, 3, 8, '甲乙'), b: row(500, 3, 8) }), 'b', 'nothing to learn first');
});

check('the balanced path: a choice counts as known for the next, and skips are skipped', () => {
  const rows = { 女: [100, 1, 3, ''], 好: [90, 1, 6, '女子'], 子: [120, 1, 3, ''], 难: [80, 3, 10, '又隹'] };
  const got = L.pickChars(rows, 3, () => false);
  assert(got.indexOf('好') > got.indexOf('女'), 'its parts come first');
  assert.deepStrictEqual(got.slice().sort(), ['女', '好', '子'].sort(), 'parts just chosen lift 好 past 难');
  assert(!L.pickChars(rows, 4, () => false, c => c === '女').includes('女'));
  assert.strictEqual(L.pickChars(rows, 9, () => false).length, 4, 'runs out without trouble');
  assert.deepStrictEqual(L.pickChars({}, 3, () => false), []);
  // a component learnt with one character can still be taught as a character itself
  const again = { 好: [1, 1, 6, '女'], 女: [9000, 0, 3, ''] };
  assert.deepStrictEqual(L.pickChars(again, 2, () => false), ['好', '女']);
});

check('the balanced path on the real data: basics early, nothing obscure', () => {
  global.self = global; global.HZ = {};
  require('../site/data/charorder.js');
  const seq = L.pickChars(HZ.charorder, 200, () => false);
  for (const c of '一不人是') assert(seq.indexOf(c) >= 0 && seq.indexOf(c) < 20, c + ' early');
  assert(seq.every(c => HZ.charorder[c][1] && HZ.charorder[c][0] <= 3000), 'all HSK and common');
  assert.strictEqual(new Set(seq).size, 200, 'no repeats');
  const first400 = new Set(L.pickChars(HZ.charorder, 400, () => false));
  assert(Object.keys(HZ.charorder).filter(c => HZ.charorder[c][1] === 1).every(c => first400.has(c)), 'HSK 1 done within 400');
  require('../site/data/hskchars.js');
  for (const lv of Object.keys(HZ.hskChars)) {
    assert.deepStrictEqual(HZ.hskChars[lv].filter(c => !HZ.charorder[c]), [], 'every HSK ' + lv + ' character can be chosen');
  }
});

check('the queue follows the path settings, and leaves alone what is yours', () => {
  const q = (o = {}) => ({ stage: 0, added: 1, kind: 'char', ...o });
  const items = {
    mine: q(),                                  // added by hand
    star: q({ path: 'common', prio: true }),    // the path's, then starred
    push: q({ prio: true, hskPush: 'added' }),  // to finish an HSK level
    again: q({ path: 'common', learnt: 5 }),    // a lesson being taken again
    done: { stage: 3, kind: 'char', path: 'common', learnt: 5 },
    a: q({ path: 'common', added: 1 }), b: q({ path: 'common', added: 2 }), c: q({ path: 'common', added: 3 }),
  };
  // another path: the old path's go, and the new one fills up (star and push count towards it)
  let r = L.pathSync(items, { path: 'mix', pathDaily: 5 });
  assert.deepStrictEqual(r.drop.sort(), ['a', 'b', 'c']);
  assert.strictEqual(r.want, 3);
  // path off: only the path's go
  r = L.pathSync(items, { path: 'off', pathDaily: 5 });
  assert.deepStrictEqual(r.drop.sort(), ['a', 'b', 'c']);
  assert.strictEqual(r.want, 0);
  // the same path: a bigger number adds, a smaller one takes off the last added
  assert.deepStrictEqual(L.pathSync(items, { path: 'common', pathDaily: 8 }), { drop: [], want: 3 });
  assert.deepStrictEqual(L.pathSync(items, { path: 'common', pathDaily: 3 }).drop.sort(), ['b', 'c']);
  assert.deepStrictEqual(L.pathSync(items, { path: 'common', pathDaily: 5 }), { drop: [], want: 0 });
  // however small the number, what is yours stays
  r = L.pathSync(items, { path: 'common', pathDaily: 1 });
  assert.deepStrictEqual(r.drop.sort(), ['a', 'b', 'c']);
  assert.strictEqual(r.want, 0);
  assert.deepStrictEqual(L.pathSync({}, { path: 'mix', pathDaily: 5 }), { drop: [], want: 5 });
});

check('the path keeps the queue full, but only the day\'s number is ready', () => {
  const now = Date.UTC(2026, 5, 1, 12), today = L.dayStart(now);
  const env = { level: () => null, comps: () => [], compOk: () => true };
  const q = o => ({ stage: 0, added: 1, kind: 'char', ...o });
  const cfg = { path: 'mix', pathDaily: 2, lessonLimit: 20, wordLimit: 20, charUnlock: 'now' };
  const items = { a: q({ path: 'mix', added: 1 }), b: q({ path: 'mix', added: 2 }), c: q({ path: 'mix', added: 3 }) };
  assert.deepStrictEqual(L.plan(items, cfg, now, env).lessons, ['a', 'b']);
  // two done today: the rest wait for tomorrow, and stay in the queue
  const done = { x: { stage: 1, kind: 'char', path: 'mix', learnt: today + 1, added: 0 }, y: { stage: 1, kind: 'char', path: 'mix', learnt: today + 2, added: 0 } };
  const after = L.plan({ ...items, ...done }, cfg, now, env);
  assert.deepStrictEqual(after.lessons, []);
  assert.deepStrictEqual(after.waiting, ['a', 'b', 'c']);
  // your own, and a star, aren't held back
  const yours = L.plan({ ...items, ...done, mine: q({ added: 4 }), a: q({ path: 'mix', prio: true }) }, cfg, now, env);
  assert.deepStrictEqual(yours.lessons.sort(), ['a', 'mine']);
});

check('prioritised items come before the rest, whichever the lesson order puts first', () => {
  const now = Date.UTC(2026, 5, 1, 12);
  const env = { level: () => null, comps: () => [], compOk: () => true };
  const q = o => ({ stage: 0, added: 1, ...o });
  const items = { 一二: q({ kind: 'word', added: 1 }), 三: q({ kind: 'char', added: 2 }), 四: q({ kind: 'char', added: 3, prio: true }) };
  assert.deepStrictEqual(L.plan(items, { lessonOrder: 'words', lessonLimit: 20, wordLimit: 20, charUnlock: 'now' }, now, env).waiting, ['四', '一二', '三']);
});

check('the path\'s daily number is for characters; words have what the limit leaves', () => {
  const now = Date.UTC(2026, 5, 1, 12), today = L.dayStart(now);
  const env = { level: () => null, comps: () => [], compOk: () => true };
  const q = o => ({ stage: 0, added: 1, ...o });
  const items = { 一: q({ kind: 'char', path: 'mix' }), 二三: q({ kind: 'word', path: 'mix' }), 四五: q({ kind: 'word', path: 'mix', added: 2 }),
    六: { stage: 1, kind: 'char', path: 'mix', learnt: today + 1 } };
  const lessons = L.plan(items, { path: 'mix', pathDaily: 1, lessonLimit: 20, wordLimit: 20, charUnlock: 'now', wordWait: false }, now, env).lessons;
  assert.deepStrictEqual(lessons, ['二三', '四五'], 'the day\'s character is done; words fill the limit');
  // the queue's words follow the settings apart from its characters
  assert.deepStrictEqual(L.pathSync(items, { path: 'mix', pathDaily: 1 }, 'word').drop, ['四五']);
  assert.deepStrictEqual(L.pathSync(items, { path: 'mix', pathDaily: 1, pathWords: false }, 'word').drop.sort(), ['二三', '四五']);
  assert.deepStrictEqual(L.pathSync(items, { path: 'mix', pathDaily: 1, pathWords: false }, 'char').drop, []);
});

check('the word order: each word just after the last of its characters', () => {
  const rows = { 大学: [50, 2], 学生: [20, 1], 生日: [300, 1], 日本: [100, 3], 猫狗: [9000, 0], 跳舞: [800, 2] };
  const pos = { 学: 0, 大: 2, 生: 1, 日: 3, 本: 3 };
  const order = L.wordOrder(rows, c => pos[c]);
  assert.strictEqual(order[0], '学生', 'its characters come first');
  assert.strictEqual(order[1], '大学');
  assert(!order.includes('猫狗'), 'a character that never comes rules it out');
  assert.strictEqual(order.indexOf('生日'), 2, 'among those on the same character, the earlier in the HSK');
  assert(!L.wordOrder(rows, c => pos[c], w => w === '大学').includes('大学'), 'a skipped word');
});

check('how far through each HSK level, and which is nearly done', () => {
  const list = n => Array.from({ length: n }, (_, i) => 'c' + n + '-' + i);
  const lists = { 2: list(100), 1: list(10) };
  const done = new Set([...lists[1].slice(0, 9), ...lists[2].slice(0, 80)]);
  const p = L.hskProgress(lists, c => done.has(c));
  assert.deepStrictEqual(p.map(x => [x.level, x.total, x.done, x.left.length]), [[1, 10, 9, 1], [2, 100, 80, 20]]);
  assert.strictEqual(L.hskNearlyDone(p).level, 1, 'the first level close');
  const near = (total, left) => L.hskIsNear({ total, done: total - left, left: Array(left).fill('x') });
  assert(near(100, 25), 'at 75%');
  assert(!near(100, 26), 'under 75%');
  assert(!near(1000, 51), 'over 50 left, however far along');
  assert(near(1000, 50));
  assert(!near(100, 0), 'nothing left');
  assert.strictEqual(L.hskNearlyDone([]), null);
});

check('the paths\' facts in Settings are what the paths do', () => {
  require('../site/data/index.js');            // (to the HZ the checks above have filled)
  const H = HZ.hskChars, I = HZ.index, levels = Object.keys(H).sort((a, b) => a - b);
  const facts = seq => {
    const pos = new Map(seq.map((c, i) => [c, i + 1]));
    const cover = m => +seq.slice(0, m).reduce((s, c) => s + (I[c][1] || 0), 0).toFixed(1);
    return { hsk: levels.map(l => Math.max(...H[l].map(c => pos.get(c) || Infinity))), cover: { 500: cover(500), 1000: cover(1000) } };
  };
  const same = (id, seq) => {
    const f = facts(seq), want = L.PATH_FACTS[id];
    assert.deepStrictEqual(f.hsk, want.hsk, id + ' HSK levels');
    assert.deepStrictEqual(f.cover, want.cover, id + ' coverage');
  };
  same('mix', L.pickChars(HZ.charorder, 3400, () => false));
  same('common', Object.keys(I).filter(c => I[c][0]).sort((a, b) => I[a][0] - I[b][0]));
  same('hsk', levels.flatMap(l => H[l]));
});

check('extra practice only knows what you have learned', () => {
  const known = L.knownChars({
    items: {
      学: { kind: 'char', stage: 1 }, 习: { kind: 'char', stage: 0 }, 老: { stage: 3 },
      电脑: { kind: 'word', stage: 2 }, 手机: { kind: 'word', stage: 0 },
      口: { kind: 'comp', stage: 2 }, 'i:b': { kind: 'sound', stage: 2 },
    },
    status: { 好: 'learning', 人: 'learned', 大: '' },
    wstatus: { 朋友: 'learning', 今天: 'learned', 明天: '' },
  });
  assert.deepStrictEqual([...known].sort(), [...'学老电脑好人朋友今天'].sort());
  assert.strictEqual(L.knownChars({}).size, 0);
});

check('weak spots: what you keep missing, worst first, stepping back once practised', () => {
  const now = t0 + 40 * L.DAY, item = (hist, extra) => Object.assign({ kind: 'char', stage: 2, hist, last: now - L.DAY }, extra || {});
  const items = {
    leech: item([true, false, false, true, false, false], { lapses: 4 }),
    lastWrong: item([true, true, true, true, false]),
    twoMisses: item([false, true, false, true, true]),
    oneOldMiss: item([false, true, true, true, true]),
    fine: item([true, true, true]),
    fresh: item([]),
    resting: item([false, false, false, false], { rest: now + L.DAY }),
    waitingLesson: item([false, false], { stage: 0 }),
  };
  assert.deepStrictEqual(L.weakItems(items, now), ['leech', 'lastWrong', 'twoMisses']);
  // right in a round: it steps back behind the others for a few days, then returns
  assert.deepStrictEqual(L.weakItems(items, now, { leech: now - L.DAY }), ['lastWrong', 'twoMisses', 'leech']);
  assert.deepStrictEqual(L.weakItems(items, now, { leech: now - L.WEAK_REST - 1 }), ['leech', 'lastWrong', 'twoMisses']);
  assert.deepStrictEqual(L.weakItems({}, now), []);
});

check('learned today: by kind, in order, and only what has had its lesson today', () => {
  const now = new Date(2026, 10, 4, 15).getTime(), today = new Date(2026, 10, 4, 9).getTime(), yesterday = new Date(2026, 10, 3, 22).getTime();
  const out = L.learnedOn({
    好: { kind: 'char', stage: 1, learnt: today + 2000 },
    女: { kind: 'char', stage: 1, learnt: today + 1000 },
    你好: { kind: 'word', stage: 1, learnt: today },
    'c:女': { kind: 'comp', stage: 1, learnt: today },
    'i:h': { kind: 'sound', stage: 1, learnt: today },
    人: { kind: 'char', stage: 2, learnt: yesterday },
    学: { kind: 'char', stage: 0 },
    老: { kind: 'char', stage: 0, learnt: today },
    了: { kind: 'char', stage: 5 },
  }, now);
  assert.deepStrictEqual(out, { char: ['女', '好'], word: ['你好'], comp: ['c:女'], sound: ['i:h'] });
  assert.deepStrictEqual(L.learnedOn({}, now), { char: [], word: [], comp: [], sound: [] });
});

console.log(`\n${n} checks passed`);
