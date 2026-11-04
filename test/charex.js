/* Checks for the characters' example sentences (site/data/charex.js).
 *
 *   node test/charex.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.join(__dirname, '..', 'site');
global.HZ = {};
for (const f of ['index.js', 'cmnem.js', 'charex.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'data', f), 'utf8'));
}

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const each = fn => { for (const [c, list] of Object.entries(HZ.charex)) for (const ex of list) fn(c, ex); };

check('every character with a mnemonic has a sentence', () => {
  assert.deepStrictEqual(Object.keys(HZ.cmnem).filter(c => !(HZ.charex[c] || []).length), []);
});

check('no character has more than three, or the same one twice', () => {
  for (const [c, list] of Object.entries(HZ.charex)) {
    assert(list.length <= 3, c);
    assert.strictEqual(new Set(list.map(e => e[0])).size, list.length, c);
  }
});

check('each sentence contains its character and has English', () => {
  each((c, ex) => {
    assert(ex[0].includes(c), `${c}: ${ex[0]}`);
    assert(ex[2] && /[a-z]/i.test(ex[2]), `${c}: no English`);
  });
});

check('each word in a sentence has its pinyin', () => {
  each((c, ex) => {
    const zs = ex[0].split('|'), ps = ex[1].split('|');
    assert.strictEqual(zs.length, ps.length, ex[0]);
    zs.forEach((z, i) => {
      if (/[一-鿿]/.test(z)) assert(ps[i], `${c}: no pinyin for ${z} in ${ex[0]}`);
    });
  });
});

check('a character alone in a sentence reads as it is taught', () => {
  const flat = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let alone = 0;
  each((c, ex) => {
    const zs = ex[0].split('|'), ps = ex[1].split('|');
    const taught = HZ.cmnem[c][2] || HZ.index[c][2];
    zs.forEach((z, i) => {
      if (z !== c) return;
      alone++;
      // only its first use need be the taught one: 好 can come twice, read two ways
      if (i === zs.indexOf(c)) assert.strictEqual(flat(ps[i]), flat(taught), `${c}: ${ex[0]} ${ex[1]}`);
    });
  });
  assert(alone > 1000, 'characters should often stand alone');
});

console.log(`\n${n} checks passed`);
