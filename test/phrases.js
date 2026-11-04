/* Checks for the phrases (site/data/phrases.js).
 *
 *   node test/phrases.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.HZ = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'site', 'data', 'phrases.js'), 'utf8'));

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const isHan = s => /[一-鿿]/.test(s);
const units = HZ.phrases.flatMap(c => c.units);
const sentences = units.flatMap(u => [u.ex, ...(u.answers || [])]);

check('the categories are all there', () => {
  assert.strictEqual(new Set(HZ.phrases.map(c => c.id)).size, HZ.phrases.length);
  for (const want of ['work', 'food', 'entertainment', 'humour']) assert(HZ.phrases.some(c => c.id === want), want);
  for (const c of HZ.phrases) {
    assert(c.title && c.blurb && [...c.glyph].length === 1, c.id);
    assert(c.units.filter(u => !u.answers).length >= 5, `${c.id}: phrases`);
    assert(c.units.filter(u => u.answers).length >= 3, `${c.id}: questions`);
    assert.notStrictEqual(c.id, 'all', 'that name is taken');
  }
});

check('each phrase is one of a kind, as it is what your progress is kept under', () => {
  const ids = units.map(u => u.id);
  assert.deepStrictEqual(ids.filter((x, i) => ids.indexOf(x) !== i), []);
  assert(!ids.some(x => x.startsWith('#')));
});

check('a question ends in a question mark and has answers', () => {
  for (const u of units) if (u.answers) {
    assert(u.id.endsWith('？'), u.id);
    assert(u.answers.length >= 2, u.id);
    assert.strictEqual(new Set(u.answers.map(a => a[0])).size, u.answers.length, u.id);
  }
});

check('each sentence has its pinyin and English, and comes back whole', () => {
  for (const ex of sentences) {
    const zs = ex[0].split('|'), ps = ex[1].split('|');
    assert.strictEqual(zs.length, ps.length, ex[0]);
    zs.forEach((z, i) => { if (isHan(z)) assert(ps[i], `no pinyin for ${z} in ${ex[0]}`); });
    assert(/[a-z]/i.test(ex[2]), ex[0]);
    assert(/[。！？]$/.test(ex[0]), `${ex[0]} doesn't end in punctuation`);
  }
});

console.log(`\n${n} checks passed`);
