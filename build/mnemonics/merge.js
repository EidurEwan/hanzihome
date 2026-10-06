/* Turns the agents' output (build/mnemonics/out/, see BRIEF.md) into the site's data:
 *   site/data/cnames.js   HZ.cnames = {component: [picture name, why, mnemonic]}
 *   site/data/cmnem.js    HZ.cmnem  = {character: [keyword, mnemonic, reading if not the index's]}
 *   site/data/winfo.js    HZ.winfo  = {word: [part of speech, mnemonic, examples, note]}
 * Each example is ['我|的|电脑|…', 'wǒ|de|diàn nǎo|…', 'English']: the sentence cut into
 * words by textstory.js, the reader's own segmenter, with each word's pinyin as it reads
 * there, so the page needn't load the 9 MB dictionary to show it.
 * Only entries that pass check.js's rules are taken; the rest are listed.
 * Usage: node build/mnemonics/merge.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'site', 'data');
const OUT = path.join(__dirname, 'out');
global.HZ = {};
for (const f of ['index.js', 'readings.js', 'readerwords.js']) require(path.join(D, f));
const TextStory = require(path.join(ROOT, 'site', 'textstory.js'));
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch (e) { return null; } };
const files = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => f.endsWith('.json')).sort() : [];
const write = (name, v, obj) => {
  fs.writeFileSync(path.join(D, name), `HZ.${v}=${JSON.stringify(obj)};\n`);
  console.log(`site/data/${name}: ${Object.keys(obj).length} entries, ${(fs.statSync(path.join(D, name)).size / 1024).toFixed(0)} KB`);
};
const skipped = [];

// components: [picture name, why, mnemonic from its parts (compmn-*.json) if it has one]
const cnames = {};
for (const f of ['components.json', 'components-2.json']) for (const x of read(f) || []) if (x.c && x.name) cnames[x.c] = [x.name, x.why || ''];
for (const f of files.filter(f => f.startsWith('compmn-'))) for (const x of read(f) || []) {
  if (cnames[x.c] && /\*\*[^*]+\*\*/.test(x.m || '')) cnames[x.c][2] = x.m.trim(); else skipped.push('compmn ' + x.c);
}
write('cnames.js', 'cnames', cnames);

const cmnem = {};
for (const f of files.filter(f => f.startsWith('chars-'))) for (const x of read(f) || []) {
  if (x.c && x.key && /\*\*[^*]+\*\*/.test(x.m || '')) cmnem[x.c] = [x.key, x.m.trim()];
  else skipped.push(x.c);
}
// the reviewed keys (out/review-*.json): the sense a learner needs first, and its reading
// when that isn't the index's (HZ.cmnem[c][2])
for (const f of files.filter(f => f.startsWith('review-'))) for (const x of read(f) || []) {
  if (!x.c || !x.key || !/\*\*[^*]+\*\*/.test(x.m || '') || !cmnem[x.c]) { skipped.push('review ' + x.c); continue; }
  const pins = (HZ.readings[x.c] || []).map(r => r[0]);
  if (x.pin && !pins.includes(x.pin)) { skipped.push(`review ${x.c} (${x.pin}?)`); continue; }
  cmnem[x.c] = [x.key, x.m.trim()];
  if (x.pin && x.pin !== HZ.index[x.c][2]) cmnem[x.c].push(x.pin);
}
// the scenes (scene-*.json): sound and components in one story, in place of the first mnemonic
for (const f of files.filter(f => f.startsWith('scene-'))) for (const x of read(f) || []) {
  if (cmnem[x.c] && /\*\*[^*]+\*\*/.test(x.m || '') && /\{[^}]+\}/.test(x.m)) cmnem[x.c][1] = x.m.trim();
  else skipped.push('scene ' + x.c);
}
write('cmnem.js', 'cmnem', cmnem);

/* a sentence -> [words joined by |, their pinyin joined by |]; the word kept whole */
function cut(zh, w) {
  const st = TextStory.textToStory(zh, HZ);
  const words = [], pins = [];
  for (const par of st.seg) for (const tk of par) {
    if (tk.br) continue;
    if (typeof tk !== 'string') { words.push(tk.s); pins.push(''); continue; }
    const g = st.g[tk];
    words.push(g[0]); pins.push(g[1]);
  }
  // where the segmenter split the word itself (or joined it to a neighbour), put it back
  const out = [], outP = [];
  for (let i = 0; i < words.length; i++) {
    let j = i, acc = '';
    while (j < words.length && acc.length < w.length && w.startsWith(acc + words[j])) acc += words[j++];
    if (acc === w && j > i + 1) { out.push(w); outP.push(pins.slice(i, j).join(' ')); i = j - 1; }
    else { out.push(words[i]); outP.push(pins[i]); }
  }
  return [out.join('|'), outP.join('|')];
}

const winfo = {};
for (const f of files.filter(f => f.startsWith('words-'))) for (const x of read(f) || []) {
  const ok = x.w && /\*\*[^*]+\*\*/.test(x.m || '') && Array.isArray(x.ex)
    && x.ex.every(e => Array.isArray(e) && e[0] && e[1] && e[0].includes(x.w));
  if (!ok) { skipped.push(x.w); continue; }
  winfo[x.w] = [x.pos || '', x.m.trim(), x.ex.slice(0, 3).map(([zh, en]) => [...cut(zh.trim(), x.w), en.trim()]), (x.use || '').trim()];
}
write('winfo.js', 'winfo', winfo);
if (skipped.length) console.log(`skipped ${skipped.length}: ${skipped.slice(0, 40).join(' ')}`);
