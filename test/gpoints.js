/* Checks for the grammar points (site/data/gpoints.js).
 *
 *   node test/gpoints.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.HZ = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'site', 'data', 'gpoints.js'), 'utf8'));

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const sorted = s => s.split('|').slice().sort().join('|');
const isHan = s => /[一-鿿]/.test(s);
const fulls = p => [...p.ex, ...p.gap.map(x => x.full), ...p.order.map(x => x.full), ...p.spot.map(x => x.full)];

check('every point has its parts', () => {
  assert(HZ.gpoints.length >= 10);
  assert.strictEqual(new Set(HZ.gpoints.map(p => p.id)).size, HZ.gpoints.length);
  assert(!HZ.gpoints.some(p => p.id === 'daily' || p.id === '_daily'), 'those names are taken');
  for (const p of HZ.gpoints) {
    for (const k of ['title', 'pattern', 'why']) assert(p[k], `${p.id}: ${k}`);
    assert.strictEqual(p.ex.length, 3, p.id);
    assert.strictEqual(p.mistake.length, 3, p.id);
    assert.notStrictEqual(p.mistake[0], p.mistake[1], p.id);
    assert(p.gap.length + p.order.length >= 6, `${p.id}: enough for a round`);
    assert(p.spot.length >= 2, `${p.id}: spot`);
    assert([1, 2, 3].includes(p.level), `${p.id}: level`);
  }
});

check('every other right order uses exactly the same tiles', () => {
  for (const p of HZ.gpoints) for (const x of p.order) for (const alt of x.alt) {
    assert.strictEqual(sorted(alt), sorted(x.a), `${p.id}: ${alt}`);
    assert.notStrictEqual(alt, x.a, `${p.id}: ${alt}`);
  }
});

check('an order has at least two tiles, and no two answers alike', () => {
  for (const p of HZ.gpoints) for (const x of p.order) {
    assert(x.a.split('|').filter(isHan).length >= 2, `${p.id}: ${x.a}`);
    assert.strictEqual(new Set([x.a, ...x.alt]).size, x.alt.length + 1, `${p.id}: ${x.a}`);
  }
});

check('a gap has one answer among different options, each with pinyin', () => {
  for (const p of HZ.gpoints) for (const x of p.gap) {
    const opts = [x.a, ...x.wrong];
    assert.strictEqual(new Set(opts).size, opts.length, `${p.id}: ${x.before}___${x.after}`);
    assert(opts.length >= 3, `${p.id}: ${x.before}`);
    for (const o of opts) assert(x.pins[o], `${p.id}: no pinyin for ${o}`);
    assert(x.before.length + x.after.length > 0, p.id);
  }
});

check('a spot has two different sentences', () => {
  for (const p of HZ.gpoints) for (const x of p.spot) {
    assert.notStrictEqual(x.right, x.wrong, p.id);
    assert.strictEqual(x.full[0].split('|').join(''), x.right, `${p.id}: ${x.right}`);
  }
});

check('the levels run in order, and the wrong sentence in a mistake differs from every right one', () => {
  HZ.gpoints.reduce((was, p) => { assert(p.level >= was, `${p.id} is out of order`); return p.level; }, 1);
  for (const p of HZ.gpoints) {
    const right = new Set(fulls(p).map(ex => ex[0].split('|').join('')));
    assert(!right.has(p.mistake[0]), `${p.id}: ${p.mistake[0]}`);
    for (const x of p.spot) assert(!right.has(x.wrong), `${p.id}: ${x.wrong} is taught as right too`);
  }
});

check('each sentence has its pinyin and English, and shows its pattern', () => {
  for (const p of HZ.gpoints) {
    for (const ex of fulls(p)) {
      const zs = ex[0].split('|'), ps = ex[1].split('|');
      assert.strictEqual(zs.length, ps.length, ex[0]);
      zs.forEach((z, i) => { if (isHan(z)) assert(ps[i], `${p.id}: no pinyin for ${z} in ${ex[0]}`); });
      assert(/[a-z]/i.test(ex[2]), `${p.id}: ${ex[0]}`);
    }
    for (const ex of p.ex) assert(p.mark.some(m => ex[0].split('|').join('').includes(m)), `${p.id}: ${ex[0]} doesn't show the pattern`);
  }
});

console.log(`\n${n} checks passed`);
