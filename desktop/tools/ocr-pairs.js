/* Write desktop/data/ocrpairs.json: which character two side-by-side parts make.
 *
 * Windows OCR sometimes reads one character as its two halves: 你 as 亻 尔,
 * 洗 as 氵 先. The character pages' breakdowns (site/data/c, "bd") say what a
 * character is built from; every ranked character made of exactly two parts
 * gives an entry "亻尔" -> "你". When two characters share parts, the more
 * common one wins.
 *
 *   node desktop/tools/ocr-pairs.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const CHUNKS = path.join(ROOT, 'site', 'data', 'c');
const OUT = path.join(__dirname, '..', 'data', 'ocrpairs.json');

const ctx = { HZ: { chunk: {} } };
vm.createContext(ctx);
for (const f of fs.readdirSync(CHUNKS)) vm.runInContext(fs.readFileSync(path.join(CHUNKS, f), 'utf8'), ctx);

const best = {};
for (const bucket of Object.values(ctx.HZ.chunk)) {
  for (const [ch, e] of Object.entries(bucket)) {
    const parts = e.bd && e.bd[1];
    if (!e.r || !parts || parts.length !== 2) continue;
    const key = parts[0][0] + parts[1][0];
    if (!best[key] || e.r < best[key][1]) best[key] = [ch, e.r];
  }
}
const pairs = {};
for (const key of Object.keys(best).sort()) pairs[key] = best[key][0];

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(pairs));
console.log(`wrote ${path.relative(ROOT, OUT)}: ${Object.keys(pairs).length} pairs`);
