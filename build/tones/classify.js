/* Which recordings say what their answer says? Reads the pitch measured from each recording
 * (build/tones/pitch.js, run in a browser) and writes build/tones/checked.json: the syllables
 * and words whose measured pitch agrees with the tones the trainer would mark as right.
 * A trainer that marks a good ear wrong is worse than none, and there are plenty to spare, so
 * this errs on the strict side: when in doubt a recording is left out.
 *
 * Pitch tracking can't hear everything: passing here means "nothing contradicts it".
 *
 * Usage: node build/tones/classify.js <measured.json> [--report]
 * A measurement is [start, mean, end, lowest, highest, frames], in semitones above 100 Hz. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
global.HZ = {}; global.window = global;
require(path.join(ROOT, 'site', 'data', 'hsk.js'));
const Learn = require(path.join(ROOT, 'site', 'learn.js'));
const { said } = require('./rules.js');
const SEEN = { words: ['一起', '不要', '不过'], syl: ['ma'] };

/* one syllable, against the speaker's usual pitch `home` */
function fits(f, tone, home, final) {
  if (!f) return false;
  const [start, mean, end] = f, move = end - start;
  if (tone === 1) return Math.abs(move) <= 3 && mean - home >= -1.5;
  if (tone === 2) return move >= 1.5 && (final || move >= 1.5);
  if (tone === 3) return mean - home <= (final ? 0 : 0.5) && !(move >= 3 && !final);
  if (tone === 4) return move <= -2;
  return true;           // neutral: too short to judge. Which words have it is decided by rules.js
}

function checkAll(m) {
  const home = {}, syl = {};
  for (const [k, f] of Object.entries(m.s)) { const x = /^([a-z]+)([1-4])$/.exec(k); (syl[x[1]] = syl[x[1]] || {})[x[2]] = f; }
  // a syllable's four tones, each its own recording, have to come out as four different shapes
  const good = Object.keys(syl).filter(l => {
    const s = syl[l];
    if (![1, 2, 3, 4].every(t => s[t])) return false;
    const h = (s[1][1] + s[2][1] + s[3][1] + s[4][1]) / 4;
    return [1, 2, 3, 4].every(t => fits(s[t], t, h, true)) && s[1][1] > s[3][1] + 2;
  });
  // words: the speaker's level, from all of the words
  const means = Object.values(m.w).map(w => w[2] && w[2][1]).filter(x => x != null).sort((a, b) => a - b);
  const wordHome = means[means.length >> 1];
  const words = {};
  const pin = {};
  for (const l in HZ.hsk) for (const [w, p] of HZ.hsk[l]) if (!pin[w] && p) pin[w] = p;
  for (const r of Object.keys(require('./extra.json'))) pin[r] = require('./extra.json')[r][0];
  for (const [w, f] of Object.entries(m.w)) {
    if (!pin[w] || !f[0] || !f[1]) continue;
    const s = said(w, pin[w], Learn);
    if (!s) continue;
    // A tone change is a matter of the first syllable, so that is what decides those; cutting a
    // word in two is rough, and judging the second too would only lose good ones
    const wh = f[2][1];
    words[w] = fits(f[0], s.tones[0], wh, false) && (!!s.rule || fits(f[1], s.tones[1], wh, true));
  }
  // A stray frame at the start can throw the summary off. These were looked at frame by frame and are right
  for (const w of SEEN.words) if (w in words) words[w] = true;
  for (const s of SEEN.syl) if (!good.includes(s)) good.push(s);
  return { good, words, wordHome, syllables: Object.keys(syl).length };
}

if (require.main === module) {
  const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const c = checkAll(m);
  const passed = Object.keys(c.words).filter(w => c.words[w]);
  console.log(`syllables: ${c.good.length} of ${c.syllables} have four clear tones`);
  console.log(`words: ${passed.length} of ${Object.keys(c.words).length} agree. speaker's level ${c.wordHome}`);
  fs.writeFileSync(path.join(__dirname, 'checked.json'), JSON.stringify({ syl: c.good, words: passed }));
  if (process.argv.includes('--report')) {
    const tally = {};
    for (const [w, ok] of Object.entries(c.words)) {
      const pin = Object.values(HZ.hsk).flat().find(x => x[0] === w);
      const e = pin ? pin[1] : require('./extra.json')[w][0];
      const k = said(w, e, Learn).tones.join('') + (said(w, e, Learn).rule ? '*' : '');
      (tally[k] = tally[k] || [0, 0])[ok ? 0 : 1]++;
    }
    console.log(Object.entries(tally).sort().map(([k, v]) => `${k}:${v[0]}/${v[0] + v[1]}`).join(' '));
    const sample = (w, n) => w.slice(0, n).join(' ');
    console.log('rule words kept:', sample(passed.filter(w => /^[不一]/.test(w)), 60));
    console.log('rule words dropped:', sample(Object.keys(c.words).filter(w => !c.words[w] && /^[不一]/.test(w)), 60));
  }
}
module.exports = { fits, checkAll };
