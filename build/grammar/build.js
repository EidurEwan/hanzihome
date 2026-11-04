/* Turns build/grammar/points.json into site/data/gpoints.js, giving each sentence its words
 * and pinyin with the reader's own segmenter, as build/mnemonics/merge.js does for examples.
 *
 * In points.json a point is {id, title, pattern, why, mark: [words to highlight],
 *   level: roughly its HSK level, mistake: [wrong, right, why], ex: [[zh, en], …],
 *   gap: [[zh with ___, answer, [wrong options], en], …],
 *   order: [[en, 'words|cut|like|this|。', [other right orders]], …],
 *   spot: [[right, wrong, en], …]}
 * An example comes out as ['我|是|学生|。', 'wǒ|shì|xué sheng|', 'I am a student.'].
 * Usage: node build/grammar/build.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'site', 'data');
global.HZ = {};
for (const f of ['index.js', 'readings.js', 'readerwords.js']) require(path.join(D, f));
const TextStory = require(path.join(ROOT, 'site', 'textstory.js'));

/* a sentence -> [words joined by |, their pinyin joined by |] */
function cut(zh) {
  const st = TextStory.textToStory(zh, HZ), words = [], pins = [];
  for (const par of st.seg) for (const tk of par) {
    if (tk.br) continue;
    if (typeof tk !== 'string') { words.push(tk.s); pins.push(''); continue; }
    const g = st.g[tk];
    words.push(g[0]); pins.push(g[1]);
  }
  return [words.join('|'), pins.join('|')];
}
/* what a word cut out alone can't tell the segmenter: 只 as a measure word, the particles,
   上 and 里 after a place */
const AS_USED = { 只: 'zhī', 得: 'de', 地: 'de', 着: 'zhe', 过: 'guo', 上: 'shang', 里: 'li', 星期天: 'xīng qī tiān' };
/* the words the author cut a sentence into: each one's pinyin */
function tilesPin(cutWords) {
  return cutWords.map(w => (/[一-鿿]/.test(w) ? AS_USED[w] || cut(w)[1].split('|').join(' ') : ''));
}
/* the same words read the same way when the segmenter cut the sentence */
const fixSaid = ex => {
  const zs = ex[0].split('|'), ps = ex[1].split('|');
  zs.forEach((z, i) => { if (AS_USED[z]) ps[i] = AS_USED[z]; });
  return [ex[0], ps.join('|'), ex[2]];
};
/* the author's words with their pinyin, as an example */
const asEx = (joined, en) => {
  const words = joined.split('|');
  return [joined, tilesPin(words).join('|'), en];
};

const points = JSON.parse(fs.readFileSync(path.join(__dirname, 'points.json'), 'utf8'));
const out = points.map(p => ({
  id: p.id, level: p.level, title: p.title, pattern: p.pattern, why: p.why, mark: p.mark,
  mistake: p.mistake,
  ex: p.ex.map(([zh, en]) => fixSaid([...cut(zh), en])),
  gap: p.gap.map(([zh, a, wrong, en]) => {
    const [before, after] = zh.split('___');
    return { en, before, after, a, wrong, pins: Object.fromEntries([a, ...wrong].map(w => [w, tilesPin([w])[0]])),
      full: fixSaid([...cut(before + a + after), en]) };
  }),
  order: p.order.map(([en, a, alt]) => ({ en, a, alt: alt || [], full: asEx(a, en) })),
  spot: p.spot.map(([right, wrong, en]) => ({ en, right, wrong, full: fixSaid([...cut(right), en]) })),
}));
fs.writeFileSync(path.join(D, 'gpoints.js'), `HZ.gpoints=${JSON.stringify(out)};\n`);
console.log(`site/data/gpoints.js: ${out.length} points, ${out.reduce((n, p) => n + p.gap.length + p.order.length + p.spot.length, 0)} exercises, ${(fs.statSync(path.join(D, 'gpoints.js')).size / 1024).toFixed(0)} KB`);
