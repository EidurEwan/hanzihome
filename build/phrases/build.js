/* Turns build/phrases/phrases.json into site/data/phrases.js, giving each sentence its words
 * and pinyin with the reader's own segmenter, as build/grammar/build.js does.
 *
 * In phrases.json a category is {id, glyph, colour, title, blurb,
 *   phrases: [[zh, en, note?], …], qa: [[question, en, [[answer, en], …], note?], …]}
 * A sentence comes out as ['我|饿|了|。', 'wǒ|è|le|', "I'm hungry."].
 * Usage: node build/phrases/build.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'site', 'data');
global.HZ = {};
for (const f of ['index.js', 'readings.js', 'readerwords.js']) require(path.join(D, f));
const TextStory = require(path.join(ROOT, 'site', 'textstory.js'));

/* what the segmenter reads otherwise here: the way each is said in these phrases */
const AS_USED = { 得: 'de', 地: 'de', 着: 'zhe', 过: 'guo', 上: 'shang', 里: 'li', 空: 'kòng' };
function cut(zh, en) {
  const st = TextStory.textToStory(zh, HZ), words = [], pins = [];
  for (const par of st.seg) for (const tk of par) {
    if (tk.br) continue;
    if (typeof tk !== 'string') { words.push(tk.s); pins.push(''); continue; }
    const g = st.g[tk];
    words.push(g[0]); pins.push(AS_USED[g[0]] || g[1]);
  }
  return [words.join('|'), pins.join('|'), en];
}

const cats = JSON.parse(fs.readFileSync(path.join(__dirname, 'phrases.json'), 'utf8'));
const out = cats.map(c => ({
  id: c.id, glyph: c.glyph, colour: c.colour, title: c.title, blurb: c.blurb,
  units: [
    ...c.phrases.map(([zh, en, note]) => ({ id: zh, ex: cut(zh, en), note: note || '' })),
    ...c.qa.map(([zh, en, answers, note]) => ({ id: zh, ex: cut(zh, en), note: note || '', answers: answers.map(([a, ae]) => cut(a, ae)) })),
  ],
}));
fs.writeFileSync(path.join(D, 'phrases.js'), `HZ.phrases=${JSON.stringify(out)};\n`);
const n = out.reduce((s, c) => s + c.units.length, 0), q = out.reduce((s, c) => s + c.units.filter(u => u.answers).length, 0);
console.log(`site/data/phrases.js: ${out.length} categories, ${n} to learn (${q} questions), ${(fs.statSync(path.join(D, 'phrases.js')).size / 1024).toFixed(0)} KB`);
