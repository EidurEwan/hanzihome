/* Checks for site/grammar.js: which patterns it finds in a sentence, and the words it
 * points at. Sentences are given as their words, as textstory.js cuts them.
 *
 *   node test/grammar.js
 */

'use strict';

const assert = require('assert');
const G = require('../site/grammar.js');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const ids = s => G.explain(s.split(' ')).map(g => g.id);
const find = (s, id) => G.explain(s.split(' ')).find(g => g.id === id);

check('了 after the verb and at the end are told apart', () => {
  assert.deepStrictEqual(find('我 买 了 三 本 书 。', 'le-verb').words, ['买', '了']);
  assert.ok(ids('下雨 了 。').includes('le-end'));
  assert.ok(!ids('下雨 了 。').includes('le-verb'));
});

check('太 … 了 is one pattern, not past tense', () => {
  assert.deepStrictEqual(ids('太 好 了 ！'), ['pair:太了']);
});

check('measure words, with the noun only when one follows', () => {
  assert.deepStrictEqual(find('我 买 了 三 本 书 。', 'measure').words, ['三', '本', '书']);
  assert.deepStrictEqual(find('这 个 比 那 个 贵 。', 'measure').words, ['这', '个']);
  assert.ok(ids('这 个 比 那 个 贵 。').includes('bi'));
});

check('把, 被 and 是 … 的', () => {
  assert.ok(ids('他 把 门 关上 了 。').includes('ba'));
  assert.ok(!ids('一 把 椅子 。').includes('ba'), '一把 is a measure word');
  assert.ok(ids('我 的 车 被 偷 了 。').includes('bei'));
  assert.deepStrictEqual(ids('我 是 坐 飞机 来 的 。'), ['shi-de']);
});

check('the three de', () => {
  assert.ok(ids('我 的 书').includes('de'));
  assert.ok(G.explain([{ w: '他' }, { w: '说' }, { w: '得' , pin: 'de' }, { w: '很' }, { w: '好' }]).some(g => g.id === 'de-comp'));
  assert.ok(G.explain([{ w: '我' }, { w: '得', pin: 'děi' }, { w: '走' }]).some(g => g.id === 'dei'));
  assert.ok(G.explain([{ w: '慢慢' }, { w: '地', pin: 'de' }, { w: '走' }]).some(g => g.id === 'di'));
});

check('questions: 吗, question words, 还是', () => {
  assert.ok(ids('你 吃 过 北京烤鸭 吗 ？').includes('ma'));
  assert.ok(ids('你 吃 过 北京烤鸭 吗 ？').includes('guo'));
  assert.ok(ids('你 去 哪儿 ？').includes('qword'));
  assert.strictEqual(find('你 想 喝茶 还是 咖啡 ？', 'haishi').title, '还是: "or" in a question');
  assert.strictEqual(find('他 还是 没 来 。', 'haishi').title, '还是: still, or "had better"');
});

check('pairs that span the sentence', () => {
  assert.ok(ids('因为 下雨 ， 所以 我们 没 去 公园 。').includes('pair:因为所以'));
  assert.ok(ids('如果 你 去 ， 我 就 去 。').includes('pair:如果就'));
  assert.ok(!ids('所以 我 去 。').some(x => x.startsWith('pair:')), 'one half alone is not the pair');
});

check('time and place come before the verb', () => {
  const g = ids('我 昨天 在 商店 买 了 三 本 书 。');
  assert.deepStrictEqual(g, ['time', 'zai', 'le-verb', 'measure']);
});

check('each pattern once, in the order it first comes', () => {
  const g = ids('我 的 书 和 你 的 书');
  assert.strictEqual(g.filter(x => x === 'de').length, 1);
  assert.deepStrictEqual(G.explain([]), []);
  assert.deepStrictEqual(G.explain(['。']), []);
});

console.log(`\n${n} checks passed`);
