/* Does site/textstory.js read characters with several readings the right way?
 *
 * test/polyphones.txt has sentences with one character in brackets and the reading
 * it has there (了 le in 吃了, liǎo in 受不了). Each sentence goes through
 * textToStory(); the syllable the engine gives that character is compared with the
 * expected one. A neutral tone matches any tone of the same syllable (头发 tóu fa
 * for fà), since that is a matter of style rather than of which reading.
 *
 *   node test/polyphones.js            score, and each miss
 *   node test/polyphones.js --heldout  the same for test/polyphones-heldout.txt, written
 *                                      after the rules and not tuned on
 *   node test/polyphones.js --tune     choose the neighbour model's thresholds
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const TextStory = require('../site/textstory.js');

const DATA = path.join(__dirname, '..', 'site', 'data');
const ctx = { HZ: { chunk: {}, phoneticSets: {} } };
vm.createContext(ctx);
for (const f of ['index', 'readerwords', 'readings']) {
  vm.runInContext(fs.readFileSync(path.join(DATA, f + '.js'), 'utf8'), ctx);
}
const HZ = ctx.HZ;

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const bare = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ü/g, 'v').toLowerCase();
const toned = s => bare(s) !== s.normalize('NFD').replace(/ü/g, 'v').toLowerCase().replace(/[\u0308]/g, '');
const same = (got, want) => bare(got) === bare(want)
  && (got.toLowerCase() === want.toLowerCase() || !toned(got) || !toned(want));

function sylls(w, pin) {
  const n = [...w].filter(isHan).length;
  let s = String(pin).split(/\s+/).filter(Boolean);
  if (s.length === n - 1 && s.length && /r$/.test(s[s.length - 1])) s = [...s.slice(0, -1), s[s.length - 1].slice(0, -1), 'r'];
  return s;
}

/* the reading and meaning the engine gives the character at `at` (code points) */
function readingAt(text, at) {
  const st = TextStory.textToStory(text, HZ);
  let pos = 0;
  for (const par of st.seg) {
    for (const tk of par) {
      if (tk.br) continue;
      if (typeof tk !== 'string') { pos += [...tk.s].length; continue; }
      const [w, pin, gloss] = st.g[tk];
      const n = [...w].length;
      if (at >= pos && at < pos + n) {
        const han = [...w].slice(0, at - pos).filter(isHan).length;
        return { word: w, syl: sylls(w, pin)[han] || '', gloss };
      }
      pos += n;
    }
  }
  return null;
}

const cases = [];
fs.readFileSync(path.join(__dirname, process.argv.includes('--heldout') ? 'polyphones-heldout.txt' : 'polyphones.txt'), 'utf8').split(/\r?\n/).forEach((line, i) => {
  if (!line.trim() || line.startsWith('#')) return;
  const [marked, want] = line.split('|').map(s => s.trim());
  const at = [...marked].indexOf('[');
  const text = marked.replace('[', '').replace(']', '');
  cases.push({ line: i + 1, marked, text, at, char: [...text][at], want });
});

/* Leave one out: for every common dictionary word, hide it and ask the neighbour
   model (TextStory.neighbours) how each of its multi-reading characters is read,
   from the other words alone. Against always taking a character's first reading,
   this shows whether the neighbours add anything, and tunes when to trust them. */
function leaveOneOut(show) {
  const NB = TextStory.neighbourParams;
  const cases = [];
  for (const [w, e] of Object.entries(HZ.rwords)) {
    if (!e[2] || e[0] < 10) continue;                      // common words only
    const cs = [...w];
    if (cs.length < 2) continue;
    const sy = sylls(w, e[2][0][0]);
    cs.forEach((c, i) => {
      const rs = (HZ.readings[c] || []).filter(r => r[1].length);
      if (rs.length < 2 || !sy[i]) return;
      const exact = rs.find(r => r[0].toLowerCase() === sy[i].toLowerCase());
      const loose = rs.filter(r => bare(r[0]) === bare(sy[i]));
      const truth = exact ? exact[0] : loose.length === 1 ? loose[0][0] : null;
      if (!truth) return;
      cases.push({ truth, first: rs[0][0], h: TextStory.neighbours(HZ, c, cs[i - 1] || '^', cs[i + 1] || '$', w) });
    });
  }
  const score = () => {
    let base = 0, mine = 0, decided = 0, decidedRight = 0;
    for (const k of cases) {
      const d = k.h && k.h.weight >= NB.MIN && k.h.share >= NB.SHARE;
      const r = d ? k.h.reading : k.first;
      if (k.first === k.truth) base++;
      if (r === k.truth) mine++;
      if (d) { decided++; if (k.h.reading === k.truth) decidedRight++; }
    }
    return { base, mine, decided, decidedRight, n: cases.length };
  };
  const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
  if (show === 'tune') {
    const keep = [NB.MIN, NB.SHARE];
    for (const min of [0.5, 1, 2, 4, 8]) {
      for (const share of [0.55, 0.6, 0.7, 0.8, 0.9]) {
        Object.assign(NB, { MIN: min, SHARE: share });
        const s = score();
        console.log(`MIN ${String(min).padEnd(3)} SHARE ${share.toFixed(2)}: ${pct(s.mine, s.n)} right ` +
          `(decides ${pct(s.decided, s.n)}, ${pct(s.decidedRight, s.decided)} of those right)`);
      }
    }
    [NB.MIN, NB.SHARE] = keep;
    return;
  }
  const s = score();
  console.log(`leave one out, ${s.n} readings in common dictionary words: first reading ${pct(s.base, s.n)}, ` +
    `with the neighbours ${pct(s.mine, s.n)} (they decide ${pct(s.decided, s.n)}, ${pct(s.decidedRight, s.decided)} right)`);
}

if (process.argv.includes('--tune')) { leaveOneOut('tune'); process.exit(0); }
leaveOneOut();

let right = 0;
const misses = [];
for (const c of cases) {
  const got = readingAt(c.text, c.at);
  if (got && same(got.syl, c.want)) right++;
  else misses.push(c.marked.padEnd(22 - [...c.marked].filter(isHan).length) +
    ` want ${c.want.padEnd(6)} got ${got ? got.syl.padEnd(6) + ' in ' + got.word + ' "' + got.gloss + '"' : '?'}`);
}
console.log(`${right} of ${cases.length} readings right (${(100 * right / cases.length).toFixed(1)}%)\n`);
if (misses.length) console.log('misses:\n  ' + misses.join('\n  '));
