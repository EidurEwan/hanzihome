/* Makes site/data/tones.js for the tone trainer (site/tones.js):
 *   syl      syllables to ask about one at a time: real ones, whose four recordings came out clear
 *   pairs    {'14': [word, …]}: two-syllable words without a tone change, by pattern, commonest first
 *   changes  [word, …]: two-syllable words that are said differently from how they're written
 * A word is [characters, pinyin as written, tones as said, English, rule, recordings if not its own].
 *
 * Only recordings whose measured pitch agrees with the answer get in: build/tones/checked.json,
 * from build/tones/classify.js, and none that sound cut off: build/tones/cutoffs.json, from
 * build/tones/cutoffs.js. Usage: node build/tones/build.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'site', 'data');
global.HZ = {}; global.window = global;
for (const f of ['hsk.js', 'audio.js']) require(path.join(D, f));
const Learn = require(path.join(ROOT, 'site', 'learn.js'));
const { said } = require('./rules.js');
const checked = JSON.parse(fs.readFileSync(path.join(__dirname, 'checked.json'), 'utf8'));
const extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'extra.json'), 'utf8'));
const cutoffs = JSON.parse(fs.readFileSync(path.join(__dirname, 'cutoffs.json'), 'utf8')), cutS = new Set(cutoffs.s), cutW = new Set(cutoffs.w);
const ok = new Set(checked.words), rec = new Set(HZ.audio.w.split('|'));
const PER_PATTERN = 60, MAX_LEVEL = 5;

/* the first sense, as a short gloss */
const gloss = en => en.split(';')[0].trim();
const seen = new Set(), all = [];
for (const w of Object.keys(extra)) { seen.add(w); all.push([w, extra[w][0], extra[w][1], 0]); }
for (const l of Object.keys(HZ.hsk).sort()) for (const [w, p, en] of HZ.hsk[l]) {
  if (seen.has(w)) continue;
  seen.add(w);
  all.push([w, p, gloss(en), +l]);
}

const pairs = {}, changes = [];
for (const [w, p, en, level] of all) {
  if (!ok.has(w) || !rec.has(w) || cutW.has(w) || level > MAX_LEVEL) continue;
  const s = said(w, p, Learn);
  if (!s) continue;
  const row = [w, p.trim().toLowerCase(), s.tones.join(''), en];
  if (s.rule) { row.push(s.rule); changes.push(row); } else {
    const k = s.tones.join('');
    (pairs[k] = pairs[k] || []).push(row);
  }
}
for (const k of Object.keys(pairs)) pairs[k] = pairs[k].slice(0, PER_PATTERN);
// 你好 is the example everyone meets first, and has no recording of its own: its syllables, as said
changes.unshift(['你好', 'nǐ hǎo', '23', 'hello', '33', 's/ni2 s/hao3']);

// real syllables only: the collection has every sound in every tone, whether Mandarin uses it or not
const inHsk = new Set();
for (const l of Object.values(HZ.hsk)) for (const [, p] of l) for (const s of String(p).trim().split(/\s+/)) inHsk.add(Learn.parsePinyin(s).letters);
const syl = checked.syl.filter(s => inHsk.has(s) && [1, 2, 3, 4].every(t => !cutS.has(s + t))).sort();

const out = { syl, pairs, changes };
fs.writeFileSync(path.join(D, 'tones.js'), `HZ.tones=${JSON.stringify(out)};\n`);
const byRule = {}; for (const c of changes) byRule[c[4]] = (byRule[c[4]] || 0) + 1;
console.log(`site/data/tones.js: ${syl.length} syllables, ${Object.keys(pairs).length} patterns (${Object.values(pairs).flat().length} words), ${changes.length} changes ${JSON.stringify(byRule)}, ${(fs.statSync(path.join(D, 'tones.js')).size / 1024).toFixed(0)} KB`);
console.log(Object.entries(pairs).sort().map(([k, v]) => k + ':' + v.length).join(' '));
