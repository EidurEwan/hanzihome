/* Writes the batches the mnemonic agents work through (build/mnemonics/in/):
 *   components.json         the components of the commonest characters, to name
 *   chars-NN.json           characters, commonest first, CHARS_PER a batch
 *   words-NN.json           words, commonest first (and every HSK word), WORDS_PER a batch
 * Usage: node build/mnemonics/make_inputs.js [chars] [words]   (default 3000 5000)
 * The agents write out/<same name>; build/mnemonics/merge.js makes site/data/mnem*.js. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'site', 'data');
global.HZ = { chunk: {} };
for (const f of ['index.js', 'components.js', 'radicalmap.js', 'words.js', 'hsk.js']) require(path.join(D, f));
for (const f of fs.readdirSync(path.join(D, 'c'))) require(path.join(D, 'c', f));
const chunk = c => { for (const b of Object.values(HZ.chunk)) if (b[c]) return b[c]; return null; };

const NC = +process.argv[2] || 3000, NW = +process.argv[3] || 5000, CHARS_PER = 150, WORDS_PER = 200;
const out = path.join(__dirname, 'in');
fs.mkdirSync(out, { recursive: true });
const ranked = Object.keys(HZ.index).filter(c => HZ.index[c][0]).sort((a, b) => HZ.index[a][0] - HZ.index[b][0]);
const short = s => String(s || '').split(/;\s*/).filter(x => !/…$/.test(x)).slice(0, 3).join('; ') || String(s || '');

// components: those of the top characters, and the most productive ones
const prod = new Map(HZ.productiveComponents.map(r => [r[1], r]));
const comps = new Map();
const addComp = (p, inChar) => {
  if (!comps.has(p)) {
    const e = HZ.index[p], r = prod.get(p);
    comps.set(p, { c: p, meaning: (r && r[2]) || HZ.radicalMap[p] || (e ? short(e[3]) : ''), pin: (r && r[3]) || (e ? e[2] : ''), examples: [] });
  }
  const x = comps.get(p);
  if (inChar && x.examples.length < 6 && !x.examples.includes(inChar)) x.examples.push(inChar);
};
const chars = ranked.slice(0, NC).map(c => {
  const d = chunk(c), cm = (d && d.cm) || [];
  cm.forEach(p => addComp(p, c));
  const e = HZ.index[c];
  return { c, rank: e[0], pin: e[2], meaning: short(e[3]), parts: cm };
});
HZ.productiveComponents.slice(0, 400).forEach(r => addComp(r[1]));
fs.writeFileSync(path.join(out, 'components.json'), JSON.stringify([...comps.values()], null, 0).replace(/},{/g, '},\n{'));

for (let i = 0; i * CHARS_PER < chars.length; i++)
  fs.writeFileSync(path.join(out, `chars-${String(i).padStart(2, '0')}.json`),
    JSON.stringify(chars.slice(i * CHARS_PER, (i + 1) * CHARS_PER)).replace(/},{/g, '},\n{'));

// words: commonest first; every HSK word is in, wherever it ranks
const hsk = new Set();
for (const lv of Object.values(HZ.hsk || {})) for (const w of lv) hsk.add(Array.isArray(w) ? w[0] : w);
const words = [];
HZ.words.forEach((w, i) => {
  if ([...w[0]].length < 2) return;
  if (words.length < NW || hsk.has(w[0])) words.push({ w: w[0], rank: i + 1, pin: w[2], meaning: short(w[3]),
    chars: [...w[0]].map(c => c + ' ' + (HZ.index[c] ? short(HZ.index[c][3]).split(';')[0] : '')) });
});
for (let i = 0; i * WORDS_PER < words.length; i++)
  fs.writeFileSync(path.join(out, `words-${String(i).padStart(2, '0')}.json`),
    JSON.stringify(words.slice(i * WORDS_PER, (i + 1) * WORDS_PER)).replace(/},{/g, '},\n{'));
console.log(comps.size, 'components;', chars.length, 'characters;', words.length, 'words');
