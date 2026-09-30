/* Checks for sync/Code.gs, run against the in-memory sheet of sync/mock-server.js:
 * saving and reading copies of any size, refusing a push based on an old revision,
 * and never answering with an empty copy when the sheet can't give it whole (the
 * cause of data vanishing until the next sync, with the earlier scripts).
 *
 *   node test/sync.js
 */

'use strict';

const assert = require('assert');
const { load } = require('../sync/mock-server.js');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

function script() {
  const { context, sheets } = load('ok');
  const call = body => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return { call, sheet: () => sheets['HanziHome sync'] };
}

/* a store with n characters, big enough to need several cells */
function store(count, tag = '') {
  const status = {}, items = {};
  for (let i = 0; i < count; i++) {
    const c = String.fromCodePoint(0x4e00 + i);
    status[c] = 'learned';
    items[c] = { kind: 'char', pin: 'x', mean: 'meaning ' + tag + i, stage: 5, S: 30 + i / 7, D: 5.28, due: 1e12 + i };
  }
  return { status, items };
}

check('an empty sheet: revision 0, no data', () => {
  const { call } = script();
  assert.deepStrictEqual(call({ action: 'rev' }).rev, 0);
  const p = call({ action: 'pull' });
  assert.strictEqual(p.rev, 0);
  assert.strictEqual(p.data, null);
});

check('a large copy is saved and read back whole, then a smaller one over it', () => {
  const { call, sheet } = script();
  const big = store(1500);
  assert.ok(JSON.stringify(big).length > 3 * 45000, 'spans several cells');
  assert.strictEqual(call({ action: 'push', baseRev: 0, data: big }).rev, 1);
  assert.deepStrictEqual(call({ action: 'pull' }).data, big);
  const small = store(10, 'b');
  assert.strictEqual(call({ action: 'push', baseRev: 1, data: small }).rev, 2);
  assert.deepStrictEqual(call({ action: 'pull' }).data, small);
  assert.strictEqual(sheet().getLastRow(), 2, 'the rows left over are cleared');
  assert.strictEqual(call({ action: 'rev' }).rev, 2);
});

check('a push based on an old revision is refused, with the newer copy', () => {
  const { call } = script();
  call({ action: 'push', baseRev: 0, data: store(3) });
  call({ action: 'push', baseRev: 1, data: store(4) });
  const r = call({ action: 'push', baseRev: 1, data: store(5) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.conflict, true);
  assert.strictEqual(r.rev, 2);
  assert.deepStrictEqual(r.data, store(4));
});

check('a copy caught half-way through a save is "unreadable", never empty', () => {
  const { call, sheet } = script();
  call({ action: 'push', baseRev: 0, data: store(200) });
  // the moment the first scripts could be read at: data rows cleared, revision unchanged
  sheet().getRange(2, 1, sheet().getLastRow() - 1, 1).clearContent();
  const p = call({ action: 'pull' });
  assert.deepStrictEqual([p.ok, p.error, p.data], [false, 'unreadable', undefined]);
  // or cut short: some cells missing
  const cut = script();
  cut.call({ action: 'push', baseRev: 0, data: store(1500) });
  cut.sheet().getRange(3, 1, 1, 1).clearContent();
  assert.strictEqual(cut.call({ action: 'pull' }).error, 'unreadable');
  // a push on top of it still works (it needs only the revision) and mends the copy
  assert.strictEqual(cut.call({ action: 'push', baseRev: 1, data: store(20) }).rev, 2);
  assert.deepStrictEqual(cut.call({ action: 'pull' }).data, store(20));
});

console.log(`\n${n} checks passed`);
