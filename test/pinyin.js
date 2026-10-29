/* Checks for site/pinyin.js: characters from pinyin with tone numbers, tone marks or
 * none, the context it uses, and the other choices it keeps. Also Learn.splitPinyin.
 *
 *   node test/pinyin.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

global.self = global;
global.HZ = {};
for (const f of ['index.js', 'readings.js', 'readerwords.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'site', 'data', f), 'utf8'));
}
const L = require('../site/learn.js');
const P = require('../site/pinyin.js');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const hz = s => P.toHanzi(s, HZ, L).text;

check('splitPinyin: the fewest syllables that fit', () => {
  assert.deepStrictEqual(L.splitPinyin('tushuguan'), ['tu', 'shu', 'guan']);
  assert.deepStrictEqual(L.splitPinyin('xian'), ['xian']);
  assert.deepStrictEqual(L.splitPinyin('nver'), ['nv', 'er']);
  assert.strictEqual(L.splitPinyin('hello'), null);
});

check('tone numbers and tone marks, ü written any way', () => {
  assert.strictEqual(hz('ni3 hao3, wo3 shi4 xue2sheng1'), '你好，我是学生');
  assert.strictEqual(hz('Nǐ hǎo!'), '你好！');
  assert.strictEqual(hz('lǜsè'), '绿色');
  assert.strictEqual(hz('nv3er2'), '女儿');
  assert.strictEqual(hz('nu:3er2'), '女儿');
});

check('a typed tone has to match', () => {
  assert.strictEqual(hz('ta1'), '他');
  assert.strictEqual(hz('ta3'), '塔');
});

check('without tones: words before characters, common before rare', () => {
  assert.strictEqual(hz('ta shi wo de pengyou'), '他是我的朋友');
  assert.strictEqual(hz('jintian tianqi hen hao'), '今天天气很好');
  assert.strictEqual(hz('ni jiao shenme mingzi?'), '你叫什么名字？');
  assert.strictEqual(hz('wo bu zhidao'), '我不知道');
  assert.strictEqual(hz('qing wen, cesuo zai nar?'), '请问，厕所在哪儿？');
  assert.strictEqual(hz("xi'an"), '西安');
});

check('context: a particle at the end, adjectives after 很, nouns after a measure word, verbs after 我', () => {
  assert.strictEqual(hz('wo men yi qi qu chi fan ba'), '我们一起去吃饭吧');
  assert.strictEqual(hz('xi an hen yuan'), '西安很远');
  assert.strictEqual(hz('wo zuotian mai le san ben shu'), '我昨天买了三本书');
  assert.ok(hz('wo xiang qu tushuguan').startsWith('我想去图书馆'));
});

check('each word keeps the others it could be; what is not pinyin is said', () => {
  const r = P.toHanzi('ta hen gui', HZ, L);
  const gui = r.words.find(w => w.pin.startsWith('gu'));
  assert.ok(gui.alts.some(a => a.w === '贵' || a.w === '归'), 'the other gui is a choice');
  assert.ok(gui.alts.every(a => a.w !== gui.w));
  const x = P.toHanzi('xyz ni hao', HZ, L);
  assert.deepStrictEqual(x.unknown, ['xyz']);
  assert.ok(x.text.endsWith('你好'));
});

console.log(`\n${n} checks passed`);
