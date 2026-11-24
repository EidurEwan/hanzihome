/* Puts round three (BRIEF.md section 8) into the site:
 *   site/data/sounds.js   the new cast from cast2.js (beginnings with their glides, endings)
 *   site/data/cmnem.js    each character's scene from out/scene2-NN.json, keyword from
 *                         in/scene2-NN.json
 *   site/data/cnames.js   component names from cnames-rename.json, and their look notes
 *                         and stories from out/compren.json where there is one
 * Backs the three files up to "Claude outputs/backup-before-mnemonic-remake/" first
 * (once). Only scenes that pass check.js are taken: run it on every file before this.
 * Usage: node build/mnemonics/merge2.js */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'site', 'data');
const cast = require('./cast2.js');
const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));

const BACK = path.join(ROOT, 'Claude outputs', 'backup-before-mnemonic-remake');
if (!fs.existsSync(BACK)) {
  fs.mkdirSync(BACK, { recursive: true });
  for (const f of ['sounds.js', 'cmnem.js', 'cnames.js']) fs.copyFileSync(path.join(D, f), path.join(BACK, f));
  console.log('backed up to', BACK);
}

global.HZ = {};
for (const f of ['cmnem.js', 'cnames.js']) require(path.join(D, f));

// ---- scenes
const missing = [];
let n = 0;
for (const f of fs.readdirSync(path.join(__dirname, 'in')).filter(f => /^scene2-\d+\.json$/.test(f)).sort()) {
  const inp = read('in/' + f);
  let out = [];
  try { out = read('out/' + f); } catch (e) { /* not written yet */ }
  inp.forEach((x, i) => {
    const o = out[i];
    if (!o || o.c !== x.c || !/\*\*[^*]+\*\*/.test(o.m || '')) return missing.push(x.c);
    const e = HZ.cmnem[x.c];
    e[0] = x.key;
    e[1] = o.m.trim();
    n++;
  });
}
if (missing.length) {
  console.log(`${missing.length} scenes missing, nothing written: ${missing.slice(0, 40).join('')}`);
  process.exit(1);
}

// ---- component names
const rename = read('cnames-rename.json');
let notes = [];
try { notes = read('out/compren.json'); } catch (e) { /* names only */ }
for (const [c, name] of Object.entries(rename)) if (HZ.cnames[c]) HZ.cnames[c][0] = name;
for (const x of notes) if (HZ.cnames[x.c]) {
  if (x.why) HZ.cnames[x.c][1] = x.why;
  if (x.m) HZ.cnames[x.c][2] = x.m;
}

// ---- the cast
const rows = (o, keep) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.slice(0, keep)]));
const sounds = {
  initials: rows(cast.BEGINNINGS, 3),
  finals: rows(cast.ENDINGS, 3),
  tones: cast.TONES,
  heard: { initials: cast.HEARD.beginnings, finals: cast.HEARD.endings },
};
const head = `/* HanziHome's sound cast (build/mnemonics/cast2.js): every Mandarin syllable is a
 * BEGINNING, an ENDING and a TONE, and each gets a picture, so a mnemonic can carry the sound:
 * the beginning (the consonant with any glide after it: b-, bi-, bu-, nü-) is a famous FIGURE,
 * the ending (what is left, or nothing: the Shed) a BUILDING, the tone WHERE at that building:
 * 1 in Front of it, 2 Inside it, 3 its Basement, 4 its Bathroom, 5 on its Roof.
 * 半 bàn is Batman (b-) at the Mansion (-an), in its Bathroom (4); 变 biàn is Beyoncé (bi-).
 * Keys as Learn.soundOf() gives them: ü is v (nv: nü-), "" is no beginning or no ending.
 * initials/finals: [name, why it fits, label]. The keys keep their old names, initials
 * and finals, though the app calls them beginnings and endings. */
`;
fs.writeFileSync(path.join(D, 'sounds.js'), head + 'HZ.sounds = ' + JSON.stringify(sounds, null, 1) + ';\n');
fs.writeFileSync(path.join(D, 'cmnem.js'), `HZ.cmnem=${JSON.stringify(HZ.cmnem)};\n`);
fs.writeFileSync(path.join(D, 'cnames.js'), `HZ.cnames=${JSON.stringify(HZ.cnames)};\n`);
console.log(`${n} scenes, ${Object.keys(rename).length} component names, ${notes.length} component notes; sounds.js written`);
