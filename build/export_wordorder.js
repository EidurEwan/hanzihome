/* Write site/data/wordorder.js: what the word order (#/queue, Learn.wordOrder) and the
 * learning path need of each word they could teach, so that they needn't load the 7 MB
 * dictionary to choose one or add it to the lessons.
 *
 *   HZ.wordorder = {word: [frequency rank, HSK level or 0, pinyin, meaning]}
 *
 * For the 7,000 commonest words of two or more characters and every HSK word.
 *
 *   node build/export_wordorder.js
 */

'use strict';
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, '..', 'site', 'data');
global.HZ = {};
for (const f of ['words.js', 'hsk.js']) require(path.join(D, f));

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const whole = w => [...w].length > 1 && [...w].every(isHan);
const short = m => String(m || '').split(/;\s*/).filter(x => x && !/^CL:/.test(x) && !/…$/.test(x)).slice(0, 3).join('; ');

const rows = {};
const entry = new Map();
HZ.words.forEach((e, i) => { if (!entry.has(e[0])) entry.set(e[0], [e, i + 1]); });
let taken = 0;
for (const [w, [e, rank]] of entry) {
  if (!whole(w)) continue;
  if (++taken > 7000) break;
  rows[w] = [rank, 0, e[2], short(e[3])];
}
for (const lv of Object.keys(HZ.hsk)) for (const [w, pin, mean] of HZ.hsk[lv]) {
  if (!whole(w)) continue;
  const known = entry.get(w);
  if (rows[w]) { if (!rows[w][1]) rows[w][1] = +lv; continue; }
  rows[w] = [known ? known[1] : 0, +lv, pin, short(mean)];
}
const out = path.join(D, 'wordorder.js');
fs.writeFileSync(out, `HZ.wordorder=${JSON.stringify(rows)};\n`);
console.log(`site/data/wordorder.js: ${Object.keys(rows).length} words, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
