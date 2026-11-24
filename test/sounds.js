/* Checks for the tone places in the character scenes and the service worker's audio.
 *
 *   node test/sounds.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.join(__dirname, '..', 'site');
global.self = global;
global.HZ = {};
for (const f of ['index.js', 'cmnem.js', 'sounds.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'data', f), 'utf8'));
}
const L = require('../site/learn.js');

let n = 0;
const check = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

/* sw.js in a sandbox, with caches and fetch to hand */
function serviceWorker(netFetch) {
  const store = new Map(), listeners = {};
  const cache = {
    match: async r => { const v = store.get(r.url || r); return v ? v.clone() : undefined; },
    put: async (r, res) => {
      if (res.status === 206) throw new TypeError('Partial response (status code 206) is unsupported');
      store.set(r.url || r, res);
    },
    keys: async () => [...store.keys()].map(url => ({ url })),
    delete: async r => store.delete(r.url),
    addAll: async () => {},
  };
  const sandbox = { URL, Request, Response, location: { origin: 'https://x.test' }, fetch: netFetch,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true } };
  sandbox.self = { addEventListener: (ev, fn) => { listeners[ev] = fn; }, skipWaiting() {}, clients: { claim() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8'), sandbox);
  return { store, fetch: (url, headers) => new Promise((resolve, reject) => {
    const request = new Request(url, { headers });
    listeners.fetch({ request, respondWith: p => Promise.resolve(p).then(resolve, reject) });
  }) };
}
const BYTES = Uint8Array.from({ length: 100 }, (_, i) => i);
/* a static host, as GitHub Pages: it honours Range with a 206 */
const host = async req => {
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
  if (!range) return new Response(BYTES, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  const from = +range[1], to = range[2] ? +range[2] : 99;
  return new Response(BYTES.slice(from, to + 1), { status: 206, headers: { 'Content-Range': `bytes ${from}-${to}/100`, 'Content-Type': 'audio/mpeg' } });
};

(async () => {
  await check('the tones are where at the building', () => {
    assert.deepStrictEqual([1, 2, 3, 4, 5].map(t => HZ.sounds.tones[t][0]), ['Front', 'Inside', 'Basement', 'Bathroom', 'Roof']);
  });

  await check('a glide belongs to the beginning; nothing left is the empty ending', () => {
    const got = ['bàn', 'biàn', 'guì', 'nǚ', 'shì', 'yī', 'wǔ', 'jiǔ', 'xióng', 'yuán', 'lún', 'jīng', 'ài']
      .map(p => { const s = L.soundOf(p); return s.initial + '|' + s.final; });
    assert.deepStrictEqual(got, ['b|an', 'bi|an', 'gu|ei', 'nv|', 'sh|', 'y|', 'w|', 'ji|ou', 'xi|ong', 'yu|an', 'lu|en', 'ji|eng', '|ai']);
    for (const x of got) { const [i, f] = x.split('|'); assert.ok(HZ.sounds.initials[i] && HZ.sounds.finals[f], x); }
  });

  await check('every scene has its reading\'s person, building and tone place', () => {
    const bad = [];
    for (const [c, e] of Object.entries(HZ.cmnem)) {
      const s = L.soundOf(e[2] || HZ.index[c][2]), S = HZ.sounds;
      const want = [S.initials[s.initial], S.finals[s.final], S.tones[s.tone]];
      if (want.some(x => !x) || !want.every(x => e[1].includes('{' + x[0] + '}'))) bad.push(c);
    }
    assert.deepStrictEqual(bad, []);
  });

  await check('the old places are gone from the scenes', () => {
    const old = Object.keys(HZ.cmnem).filter(c => /\{(Rooftop|Staircase|Trapdoor|Front Step)\}/.test(HZ.cmnem[c][1]));
    assert.deepStrictEqual(old, []);
  });

  await check('a tone\'s place isn\'t mentioned in another tone\'s scene', () => {
    const bad = [];
    for (const [c, e] of Object.entries(HZ.cmnem)) {
      const room = e[1].match(/\{(Front|Inside|Basement|Bathroom|Roof)\}/)[1];
      const text = e[1].replace(/\*\*[^*]+\*\*|\*[^*]+\*|\{[^}]+\}/g, '');
      if (room !== 'Roof' && /\b(roofs?|rooftops?)\b/i.test(text)) bad.push(c);
      if (/\btrapdoors?\b/i.test(text)) bad.push(c);
    }
    assert.deepStrictEqual(bad, []);
  });

  await check('items from the old casts take the names the lessons teach now', () => {
    const items = {};
    for (const [k, [was, now]] of Object.entries(L.OLD_CAST)) {
      assert.strictEqual(HZ.sounds.initials[k.slice(2)][0], now, k);
      items[k] = { kind: 'sound', mean: was[was.length - 1], syn: ['mine'] };
    }
    items['i:j'] = { kind: 'sound', mean: 'James Bond' };
    items['f:ian'] = { kind: 'sound', mean: 'Yen Exchange' };
    items['变'] = { kind: 'char', parts: ['c:亦', 'i:b', 'f:ian', 't:4'] };
    items['半'] = { kind: 'char', parts: ['c:半', 'i:b', 'f:an', 't:4'] };
    const n = Object.keys(L.OLD_CAST).filter(k => L.OLD_CAST[k][0].length).length;
    assert.strictEqual(L.recastSounds(items), n + 3);
    for (const [k, [, now]] of Object.entries(L.OLD_CAST)) assert.strictEqual(items[k].mean, now);
    assert.deepStrictEqual(items['i:y'].syn, ['mine']);
    assert(!items['i:j'] && !items['f:ian'], 'retired sounds go');
    assert(!items['变'].parts && items['半'].parts, 'only a character with a retired sound looks its parts up again');
    assert.strictEqual(L.recastSounds(items), 0, 'a second pass changes nothing');
    assert.strictEqual(L.recastSounds({ 'i:m': { kind: 'sound', mean: 'Magician' } }), 1, 'the jobs too');
    const other = { 'i:y': { kind: 'sound', mean: 'My own name' } };
    L.recastSounds(other);
    assert.strictEqual(other['i:y'].mean, 'My own name');
  });

  await check('every sound can be heard on a recording', () => {
    const have = new Set(fs.readdirSync(path.join(SITE, 'audio', 's')));
    const S = HZ.sounds;
    for (const v of Object.keys(S.initials)) assert(have.has(S.heard.initials[v] + '1.mp3'), 'beginning ' + v);
    for (const v of Object.keys(S.finals)) if (v) assert(have.has(S.heard.finals[v] + '1.mp3'), 'ending ' + v);
    assert.strictEqual(S.heard.finals[''], '', 'the empty ending (the Shed) has nothing to hear');
    for (const t of [1, 2, 3, 4]) assert(have.has(`ma${t}.mp3`), 'tone ' + t);
    assert(fs.readFileSync(path.join(SITE, 'data', 'audio.js'), 'utf8').includes('|吗|'), 'neutral tone word');
  });

  await check('a character with a clipped recording has a syllable to say instead', () => {
    vm.runInThisContext(fs.readFileSync(path.join(SITE, 'data', 'audio.js'), 'utf8'));
    const have = new Set(fs.readdirSync(path.join(SITE, 'audio', 's')));
    const words = new Set(HZ.audio.w.split('|'));
    for (const c of HZ.audio.c.split('|')) {
      assert(words.has(c), c + ' has no recording of its own');
      if ([...c].length > 1) {
        const sy = HZ.audio.p[c].split(' ').map(s => L.parsePinyin(s));
        assert.strictEqual(sy.length, [...c].length, c + ' needs a syllable for each character');
        for (const x of sy) assert(x.tones[0] && have.has(`${x.letters}${x.tones[0]}.mp3`), c + ' has no syllable recording');
        continue;
      }
      const cm = HZ.cmnem[c], p = L.parsePinyin((cm && cm[2]) || HZ.index[c][2]);
      assert(have.has(`${p.letters}${p.tones[0]}.mp3`), c + ' has no syllable recording');
    }
  });

  await check('audio asked for in ranges gets 206s, and the whole file is kept', async () => {
    const sw = serviceWorker(host);
    const res = await sw.fetch('https://x.test/audio/s/ma1.mp3?v=1', { Range: 'bytes=0-1' });
    assert.strictEqual(res.status, 206);
    assert.strictEqual(res.headers.get('Content-Range'), 'bytes 0-1/100');
    assert.deepStrictEqual([...new Uint8Array(await res.arrayBuffer())], [0, 1]);
    assert.strictEqual(sw.store.size, 1);
    const kept = sw.store.get('https://x.test/audio/s/ma1.mp3?v=1');
    assert.strictEqual(kept.status, 200);
  });

  await check('an open-ended range and a range from the cache', async () => {
    const calls = [];
    const sw = serviceWorker(async r => { calls.push(r.url); return host(r); });
    const first = await sw.fetch('https://x.test/audio/s/ma1.mp3?v=1', { Range: 'bytes=90-' });
    assert.strictEqual(first.headers.get('Content-Range'), 'bytes 90-99/100');
    assert.strictEqual(+first.headers.get('Content-Length'), 10);
    const again = await sw.fetch('https://x.test/audio/s/ma1.mp3?v=1', { Range: 'bytes=0-' });
    assert.strictEqual(again.status, 206);
    assert.strictEqual(calls.length, 1, 'the second comes from the cache');
  });

  await check('a range past the end is refused', async () => {
    const res = await serviceWorker(host).fetch('https://x.test/a.mp3', { Range: 'bytes=500-' });
    assert.strictEqual(res.status, 416);
  });

  console.log(`\n${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
