/* The second round of mnemonics, in HanziHero's lesson order: a character is learnt
 * from its components (the first level of its breakdown, each a picture name) and its
 * sound (an initial, a final and a tone from site/data/sounds.js, a person, a place
 * and a room). Writes build/mnemonics/in/:
 *   components-2.json   first-level parts of the commonest characters with no picture
 *                       name yet (named as in BRIEF.md section 1)
 * and, once those are named (node build/mnemonics/make_scenes.js scenes):
 *   compmn-NN.json      components with parts: a mnemonic from the parts' names
 *   scene-NN.json       characters: a scene with their sound and components
 * build/mnemonics/merge.js takes the results. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'site', 'data');
global.HZ = { chunk: {} };
for (const f of ['index.js', 'components.js', 'radicalmap.js', 'cmnem.js', 'sounds.js']) require(path.join(D, f));
for (const f of fs.readdirSync(path.join(D, 'c'))) require(path.join(D, 'c', f));
const Learn = require(path.join(ROOT, 'site', 'learn.js'));
const OUT = path.join(__dirname, 'out'), IN = path.join(__dirname, 'in');
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch (e) { return []; } };
const names = {};
for (const f of ['components.json', 'components-2.json']) for (const x of read(f)) names[x.c] = x.name;
const chunk = c => { for (const b of Object.values(HZ.chunk)) if (b[c]) return b[c]; return null; };
const short = s => String(s || '').split(/;\s*/).filter(x => !/…$/.test(x)).slice(0, 3).join('; ');
const NC = 3000;
const ranked = Object.keys(HZ.index).filter(c => HZ.index[c][0]).sort((a, b) => HZ.index[a][0] - HZ.index[b][0]).slice(0, NC);
const firstLevel = c => { const d = chunk(c); return d && d.bd ? d.bd[1].map(x => x[0]).filter(p => p !== c) : []; };
/* a character's components: itself when it is a component of others (半), else the
   first level of its breakdown */
const compsOf = c => names[c] ? [c] : firstLevel(c).filter(p => names[p]);
const dump = (name, rows) => fs.writeFileSync(path.join(IN, name), JSON.stringify(rows).replace(/},{/g, '},\n{'));

if (process.argv[2] !== 'scenes') {
  const miss = new Map();
  for (const c of ranked) if (!names[c]) for (const p of firstLevel(c)) {
    if (names[p]) continue;
    if (!miss.has(p)) miss.set(p, []);
    if (miss.get(p).length < 6) miss.get(p).push(c);
  }
  const rows = [...miss].map(([p, ex]) => {
    const e = HZ.index[p], r = HZ.productiveComponents.find(x => x[1] === p);
    return { c: p, meaning: (r && r[2]) || HZ.radicalMap[p] || (e ? short(e[3]) : ''), pin: e ? e[2] : '',
      parts: firstLevel(p).map(q => q + ' ' + (names[q] || '?')), examples: ex };
  });
  dump('components-2.json', rows);
  console.log(rows.length, 'components to name');
} else {
  const comps = Object.keys(names).map(c => ({ c, name: names[c], parts: firstLevel(c).filter(p => names[p]).map(p => [p, names[p]]) }))
    .filter(x => x.parts.length);
  for (let i = 0; i * 120 < comps.length; i++) dump(`compmn-${String(i).padStart(2, '0')}.json`, comps.slice(i * 120, (i + 1) * 120));
  const S = HZ.sounds, rows = ranked.map(c => {
    const cm = HZ.cmnem[c] || [], pin = cm[2] || HZ.index[c][2], s = Learn.soundOf(pin);
    return { c, pin, key: cm[0] || short(HZ.index[c][3]).split(';')[0],
      sound: [`${s.initial || 'Ø'}- ${S.initials[s.initial][0]}`, `-${s.final} ${S.finals[s.final][0]}`, `${s.tone} ${S.tones[s.tone][0]}`],
      parts: compsOf(c).map(p => [p, names[p]]), old: cm[1] || '' };
  });
  for (let i = 0; i * 150 < rows.length; i++) dump(`scene-${String(i).padStart(2, '0')}.json`, rows.slice(i * 150, (i + 1) * 150));
  console.log(comps.length, 'component mnemonics,', rows.length, 'scenes');
}
