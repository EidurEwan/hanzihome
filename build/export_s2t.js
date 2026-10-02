/* Write site/data/s2t.js: simplified to traditional, for Settings → Appearance →
 * Characters (app.js toTrad).
 *
 *   HZ.s2t      = {simplified char: its usual traditional form}   only where they differ
 *   HZ.s2tWords = {simplified word: traditional word}             only where converting it
 *                 character by character would come out wrong: 头发 頭髮 (not 頭發),
 *                 皇后 皇后 (not 皇後), 干净 乾淨
 *
 * From the site's own data: CC-CEDICT's traditional spelling of each word
 * (site/data/words.js) and, for characters in no word, each character page's
 * traditional form (site/data/c/*.js).
 *
 *   node build/export_s2t.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DATA = path.join(__dirname, '..', 'site', 'data');
const ctx = { HZ: { chunk: {} } };
vm.createContext(ctx);
for (const f of fs.readdirSync(path.join(DATA, 'c'))) vm.runInContext(fs.readFileSync(path.join(DATA, 'c', f), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(DATA, 'words.js'), 'utf8'), ctx);

// each character as words write it in traditional: counted over CC-CEDICT's spellings
// of the words it is in, the more frequent words counting more (words.js is in order
// of frequency). A character page's own "traditional form" can be an old variant
// (以 has 㕥, 法 has 灋), which no everyday word uses.
const votes = {};
ctx.HZ.words.forEach(([simp, trad], rank) => {
  const s = [...simp], t = [...(trad || simp)];
  if (s.length !== t.length) return;
  const weight = 1 / (1 + rank / 1000);
  s.forEach((c, i) => {
    const v = votes[c] = votes[c] || {};
    v[t[i]] = (v[t[i]] || 0) + weight;
  });
});
const s2t = {};
for (const [c, v] of Object.entries(votes)) {
  const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0];
  if (best !== c) s2t[c] = best;
}
// characters in no word: the character page's form, unless that is an old variant
const isExtA = c => c.codePointAt(0) >= 0x3400 && c.codePointAt(0) <= 0x4dbf;
for (const bucket of Object.values(ctx.HZ.chunk)) {
  for (const [c, d] of Object.entries(bucket)) {
    if (!(c in votes) && d.s === c && d.t && d.t !== c && !isExtA(d.t)) s2t[c] = d.t;
  }
}
const byChar = w => [...w].map(c => s2t[c] || c).join('');

// words: the first spelling CC-CEDICT gives each simplified word (words.js is most frequent first)
const words = {}, seen = new Set();
for (const [simp, trad] of ctx.HZ.words) {
  if (seen.has(simp) || [...simp].length < 2) continue;
  seen.add(simp);
  const t = trad || simp;
  if (byChar(simp) !== t) words[simp] = t;
}
fs.writeFileSync(path.join(DATA, 's2t.js'),
  `HZ.s2t=${JSON.stringify(s2t)};\nHZ.s2tWords=${JSON.stringify(words)};\n`);
console.log(`site/data/s2t.js: ${Object.keys(s2t).length} characters, ${Object.keys(words).length} words, ` +
  `${(fs.statSync(path.join(DATA, 's2t.js')).size / 1024).toFixed(0)} KB`);
