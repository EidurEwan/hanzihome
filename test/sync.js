/* Checks for sync/Code.gs, run against the in-memory sheet of sync/mock-server.js:
 * saving and reading copies of any size, refusing a push based on an old revision,
 * never answering with an empty copy when the sheet can't give it whole (the
 * cause of data vanishing until the next sync, with the earlier scripts), and the
 * passphrase lock.
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
  assert.strictEqual(call({ action: 'push', baseRev: 1, data: small, reset: true }).rev, 2);   // (on purpose)
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
  assert.strictEqual(cut.call({ action: 'push', baseRev: 1, data: store(1400) }).rev, 2);
  assert.deepStrictEqual(cut.call({ action: 'pull' }).data, store(1400));
});

check('a push that would lose most of the copy is refused, unless it is a reset', () => {
  const { call } = script();
  call({ action: 'push', baseRev: 0, data: store(150) });
  // what an emptied device used to send: only a character or two left
  const r = call({ action: 'push', baseRev: 1, data: store(1, 'x') });
  assert.deepStrictEqual([r.ok, r.error, r.have, r.got], [false, 'shrink', 300, 2]);
  assert.deepStrictEqual(call({ action: 'pull' }).data, store(150), 'the copy is untouched');
  // smaller, but not by half: fine (characters un-marked, a list cleared)
  assert.strictEqual(call({ action: 'push', baseRev: 1, data: store(100) }).rev, 2);
  // Reset everything says so
  assert.strictEqual(call({ action: 'push', baseRev: 2, data: store(0), reset: true }).rev, 3);
});

check('earlier copies are kept, and one can be put back', () => {
  const { call } = script();
  call({ action: 'push', baseRev: 0, data: store(150) });
  call({ action: 'push', baseRev: 1, data: store(151) });           // keeps revision 1's copy
  call({ action: 'push', baseRev: 2, data: store(152) });           // (not again within half an hour)
  call({ action: 'push', baseRev: 3, data: store(10), reset: true });  // a big drop: keeps revision 3's
  const list = call({ action: 'backups' }).backups;
  assert.deepStrictEqual(list.map(b => [b.rev, b.heft]).sort(), [[1, 300], [3, 304]]);
  const r = call({ action: 'restore', rev: 3 });
  assert.strictEqual(r.rev, 5);
  assert.deepStrictEqual(call({ action: 'pull' }).data, store(152));
  assert.strictEqual(call({ action: 'restore', rev: 99 }).error, 'no-backup');
});

check('a passphrase locks every request until it is given, and can be changed or removed', () => {
  const { call } = script();
  call({ action: 'push', baseRev: 0, data: store(5) });
  assert.strictEqual(call({ action: 'rev' }).locked, false);
  assert.strictEqual(call({ action: 'lock', newKey: 'abc' }).error, 'short-passphrase');
  assert.deepStrictEqual(call({ action: 'lock', newKey: 'river stone' }), { ok: true, locked: true });
  for (const action of ['rev', 'pull', 'backups', 'lock']) assert.strictEqual(call({ action }).error, 'locked', action);
  assert.strictEqual(call({ action: 'push', baseRev: 1, data: store(6) }).error, 'locked');
  assert.strictEqual(call({ action: 'pull', key: 'river' }).error, 'wrong-passphrase');
  const p = call({ action: 'pull', key: 'river stone' });
  assert.deepStrictEqual([p.ok, p.locked, p.data], [true, true, store(5)]);
  assert.strictEqual(call({ action: 'push', baseRev: 1, data: store(6), key: 'river stone' }).rev, 2);
  // change it: the old one stops working
  assert.ok(call({ action: 'lock', newKey: 'mountain path', key: 'river stone' }).ok);
  assert.strictEqual(call({ action: 'rev', key: 'river stone' }).error, 'wrong-passphrase');
  assert.strictEqual(call({ action: 'rev', key: 'mountain path' }).rev, 2);
  // remove it
  assert.deepStrictEqual(call({ action: 'lock', newKey: '', key: 'mountain path' }), { ok: true, locked: false });
  assert.strictEqual(call({ action: 'rev' }).rev, 2);
});

check('guessing is cut short after 10 wrong passphrases', () => {
  const { call } = script();
  call({ action: 'lock', newKey: 'river stone' });
  for (let i = 0; i < 10; i++) assert.strictEqual(call({ action: 'rev', key: 'guess' + i }).error, 'wrong-passphrase');
  assert.strictEqual(call({ action: 'rev', key: 'river stone' }).error, 'slow-down');
});

console.log(`\n${n} checks passed`);
