/* The third round of character scenes: the new sound cast (cast2.js: a beginning with
 * its glide, an ending and a tone), the renamed components (cnames-rename.json) and the
 * cleaned-up meanings (site/data/index.js). Writes build/mnemonics/in/scene2-NN.json,
 * 150 characters each, in lesson order:
 *   {c, pin, key, also, sound, parts}
 * key   the meaning to teach (the first meaning in index.js)
 * also  the other meanings, for flavour
 * sound ["b- Batman", "-an Mansion", "4 Bathroom"]
 * parts [[glyph, picture name], …]: itself when it is a component of others, else the
 *       first level of its breakdown
 * See BRIEF.md section 8. merge2.js takes the results. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'site', 'data');
global.HZ = { chunk: {} };
for (const f of ['index.js', 'cnames.js', 'cmnem.js']) require(path.join(D, f));
for (const f of fs.readdirSync(path.join(D, 'c'))) require(path.join(D, 'c', f));
const Learn = require(path.join(ROOT, 'site', 'learn.js'));
const cast = require('./cast2.js');
const rename = JSON.parse(fs.readFileSync(path.join(__dirname, 'cnames-rename.json'), 'utf8'));
const IN = path.join(__dirname, 'in');
fs.mkdirSync(IN, { recursive: true });

const name = c => rename[c] || (HZ.cnames[c] && HZ.cnames[c][0]);
const chunk = c => { for (const b of Object.values(HZ.chunk)) if (b[c]) return b[c]; return null; };
const firstLevel = c => { const d = chunk(c); return d && d.bd ? d.bd[1].map(x => x[0]).filter(p => p !== c) : []; };
const compsOf = c => HZ.cnames[c] ? [c] : [...new Set(firstLevel(c))].filter(p => HZ.cnames[p]);
const senses = c => String(HZ.index[c][3]).split(/;\s*/).map(s => s.trim()).filter(Boolean);
const plain = s => s.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || s.replace(/[()]/g, '');

const ranked = Object.keys(HZ.cmnem).sort((a, b) => HZ.index[a][0] - HZ.index[b][0]);
const rows = ranked.map(c => {
  const pin = HZ.cmnem[c][2] || HZ.index[c][2];
  const L = Learn.parsePinyin(pin), sp = cast.split(L.letters), tone = L.tones[0] || 5;
  const b = cast.BEGINNINGS[sp.beginning], e = cast.ENDINGS[sp.ending];
  const [key, ...also] = senses(c);
  return { c, pin, key: plain(key), also: also.slice(0, 2).join('; '),
    sound: [`${b[2]}- ${b[0]}`.replace('--', '-'), `${e[2]} ${e[0]}`, `${tone} ${cast.TONES[tone][0]}`],
    parts: compsOf(c).map(p => [p, name(p)]) };
});
const dump = (f, r) => fs.writeFileSync(path.join(IN, f), '[' + r.map(x => JSON.stringify(x)).join(',\n') + ']\n');
for (let i = 0; i * 150 < rows.length; i++) dump(`scene2-${String(i).padStart(2, '0')}.json`, rows.slice(i * 150, (i + 1) * 150));
console.log(rows.length, 'scenes in', Math.ceil(rows.length / 150), 'files');
