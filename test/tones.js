/* Checks for the tone trainer (site/tones.js, site/data/tones.js).
 *
 *   node test/tones.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.join(__dirname, '..', 'site');
global.HZ = {};
global.window = global;
global.document = { addEventListener() {} };
global.Learn = require(path.join(SITE, 'learn.js'));
global.shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'data', 'tones.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'tones.js'), 'utf8'));
const run = code => vm.runInThisContext(code);
const tnMark = run('tnMark'), tnWrite = run('tnWrite'), tnWordQ = run('tnWordQ'), tnSylFiles = run('tnSylFiles');
const tnRoundSingle = run('tnRoundSingle'), tnRoundPairs = run('tnRoundPairs'), tnRoundChanges = run('tnRoundChanges'), tnToneMix = run('tnToneMix');
const RULES = run('TN_RULES');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const T = HZ.tones, words = Object.values(T.pairs).flat();
const have = f => fs.existsSync(path.join(SITE, 'audio', f + '.mp3'));
const count = (a, f) => a.filter(f).length;

check('nothing in the trainer sounds cut off', () => {
  const cut = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'tones', 'cutoffs.json'), 'utf8'));
  const s = new Set(cut.s), w = new Set(cut.w);
  for (const l of T.syl) for (const t of [1, 2, 3, 4]) assert(!s.has(l + t), `${l}${t}`);
  for (const x of [...words, ...T.changes]) assert(!w.has(x[0]), x[0]);
  for (const f of ['ni2', 'hao3', 'ma1', 'ma2', 'ma3', 'ma4']) assert(!s.has(f), f);
});

check('tone marks go on the right letter', () => {
  const cases = [['ma', 3, 'mǎ'], ['hao', 4, 'hào'], ['xie', 2, 'xié'], ['gou', 1, 'gōu'], ['gui', 4, 'guì'], ['liu', 2, 'liú'],
    ['guo', 3, 'guǒ'], ['lv', 4, 'lǜ'], ['nv', 3, 'nǚ'], ['qv', 1, 'qū'], ['lve', 4, 'lüè'], ['er', 2, 'ér'], ['ma', 5, 'ma'], ['zhuang', 1, 'zhuāng']];
  for (const [l, t, want] of cases) assert.strictEqual(tnMark(l, t), want);
});

check('every syllable has all four recordings, and common ones are among them', () => {
  assert(T.syl.length >= 150, `only ${T.syl.length}`);
  for (const s of T.syl) for (const t of [1, 2, 3, 4]) assert(have(`s/${s}${t}`), `${s}${t}`);
  assert(T.syl.includes('ma'), 'ma is what the tones are introduced with');
});

check('every tone pattern a word can have is there, with enough words to go round', () => {
  const want = [1, 2, 3, 4].flatMap(a => [1, 2, 3, 4, 5].map(b => `${a}${b}`)).filter(k => k !== '33');
  for (const k of want) assert(T.pairs[k] && T.pairs[k].length >= 5, `${k}: ${(T.pairs[k] || []).length}`);
  assert(!T.pairs['33'], 'a third tone before a third tone is said as a second: not a plain pair');
});

check('a plain word is said as written: its answer and its pinyin agree, and it has a recording', () => {
  for (const [k, list] of Object.entries(T.pairs)) for (const w of list) {
    assert.strictEqual(w[2], k, w[0]);
    assert.strictEqual([...w[0]].length, 2, w[0]);
    assert(have(`w/${w[0]}`), `no recording: ${w[0]}`);
    assert(w[3], `no English: ${w[0]}`);
    const q = tnWordQ(w, 'pairs');
    assert.strictEqual(tnWrite(q.lets, q.tones), w[1].replace(/'/g, ''), w[0]);
  }
  assert.strictEqual(new Set(words.map(w => w[0])).size, words.length, 'a word twice');
});

check('no plain word hides a tone change', () => {
  for (const w of words) {
    assert(!/^[不一]/.test(w[0]), `${w[0]} changes`);
    assert.notStrictEqual(w[2], '33', w[0]);
    assert(!w[4], w[0]);
  }
});

check('each tone change is right by its rule', () => {
  const firstOf = w => tnWordQ(w, 'changes');
  for (const w of T.changes) {
    const written = w[1].split(' ').map(s => Learn.parsePinyin(s).tones[0] || 5), said = w[2].split('').map(Number);
    assert(RULES[w[4]], `${w[0]}: rule ${w[4]}`);
    assert.strictEqual(said[1], written[1], `${w[0]}: only the first syllable changes`);
    if (w[4] === '33') { assert.deepStrictEqual(written, [3, 3], w[0]); assert.strictEqual(said[0], 2, w[0]); }
    if (w[4] === 'bu') { assert(w[0].startsWith('不') && written[1] === 4 && said[0] === 2, w[0]); }
    if (w[4] === 'yi2') { assert(w[0].startsWith('一') && written[1] === 4 && said[0] === 2, w[0]); }
    if (w[4] === 'yi4') { assert(w[0].startsWith('一') && [1, 2, 3].includes(written[1]) && said[0] === 4, w[0]); }
    assert(firstOf(w).files.every(have), `no recording: ${w[0]}`);
    assert(w[3], `no English: ${w[0]}`);
  }
  for (const r of Object.keys(RULES)) assert(count(T.changes, w => w[4] === r) >= 4, `rule ${r} is short of words`);
});

check('the words on the explanation page are ones that passed the pitch check', () => {
  for (const w of ['你好', '可以', '水果', '不是', '不要', '一定', '一起']) assert(T.changes.some(x => x[0] === w), w);
});

check('a single-syllable round asks each tone about as often, and more of what you get wrong', () => {
  for (let i = 0; i < 50; i++) {
    const r = tnRoundSingle(10, {}, T.syl);
    assert.strictEqual(r.length, 10);
    for (const t of [1, 2, 3, 4]) assert(count(r, q => q.tones[0] === t) >= 2, 'a tone left out');
    for (const q of r) assert(q.files.every(have), q.files[0]);
  }
  const mix = tnToneMix(10, { 1: [50, 50], 2: [10, 50], 3: [5, 50], 4: [50, 50] });
  assert.strictEqual(count(mix, t => t === 3), 3);
  assert.strictEqual(count(mix, t => t === 2), 3);
});

check('a pairs round has no word twice and many patterns', () => {
  for (let i = 0; i < 50; i++) {
    const r = tnRoundPairs(10, T.pairs);
    assert.strictEqual(r.length, 10);
    assert.strictEqual(new Set(r.map(q => q.w)).size, 10);
    assert.strictEqual(new Set(r.map(q => q.tones.join(''))).size, 10);
  }
});

check('a changes round has no word twice and every rule', () => {
  for (let i = 0; i < 50; i++) {
    const r = tnRoundChanges(10, T.changes);
    assert.strictEqual(r.length, 10);
    assert.strictEqual(new Set(r.map(q => q.w)).size, 10);
    for (const rule of Object.keys(RULES)) assert(r.some(q => q.rule === rule), rule);
  }
});

check('weak spots: the worst tone and the one it is mixed up with, once there is enough to go on', () => {
  const tnWeak = run('tnWeak'), tnRoundFocus = run('tnRoundFocus');
  assert.strictEqual(tnWeak({}), null);
  assert.strictEqual(tnWeak({ 'ear:3': [0, 5] }), null, 'too few answers to say');
  assert.strictEqual(tnWeak({ 'ear:3': [9, 10], 'ear:1': [10, 10] }), null, 'nothing below 85%');
  assert.deepStrictEqual(tnWeak({ 'ear:3': [3, 10], 'ear:2': [6, 10], 'mix:3>2': 1, 'mix:1>3': 5 }).tones, [3, 1]);
  assert.deepStrictEqual(tnWeak({ 'ear:2': [3, 10], 'mix:2>3': 4 }).tones, [2, 3]);
  const r = tnRoundFocus(6, [2, 3], T.syl);
  assert.strictEqual(r.length, 6);
  assert.strictEqual(count(r, q => q.tones[0] === 2), 3);
  assert.strictEqual(count(r, q => q.tones[0] === 3), 3);
  for (const q of r) assert(q.files.every(have), q.files[0]);
});

check('hearing your own answer finds a recording, ju4 included', () => {
  for (const w of words) {
    const q = tnWordQ(w, 'pairs');
    for (const t of [1, 2, 3, 4]) {
      const miss = tnSylFiles(q.lets, [t, t]).filter(f => !fs.existsSync(path.join(SITE, f)));
      assert.deepStrictEqual(miss.filter(f => !/yo1/.test(f)), [], w[0]);
    }
  }
});

console.log(`\n${n} checks passed`);
