/* Write site/data/charorder.js: what the balanced learning path (Learn.pickChars) needs
 * to know of each character it could teach, so that it needn't open the 64 files of
 * site/data/c/ to choose.
 *
 *   HZ.charorder = {char: [rank, HSK level or 0, strokes, 'its components']}
 *
 * For the 6,000 commonest simplified characters and every HSK one. The components are
 * those a lesson would ask for first, as study.js compParts finds them: the first level of
 * the breakdown with a picture name (data/cnames.js), going one level further down for a
 * part that has none. A character that is a named component itself (人, 木, 半) is learnt
 * as itself, with nothing before it, so it lists none.
 *
 *   node build/export_charorder.js
 */

'use strict';
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, '..', 'site', 'data');
global.HZ = { chunk: {} };
for (const f of ['index.js', 'cnames.js', 'hskchars.js']) require(path.join(D, f));
for (const f of fs.readdirSync(path.join(D, 'c'))) require(path.join(D, 'c', f));

const data = {};
for (const b of Object.values(HZ.chunk)) Object.assign(data, b);
const hsk = {};
for (const [lv, cs] of Object.entries(HZ.hskChars)) for (const c of cs) if (!hsk[c]) hsk[c] = +lv;

function parts(c, d) {
  if (HZ.cnames[c]) return [];
  const out = [];
  const walk = (nodes, depth) => {
    for (const [p, kids] of nodes || []) {
      if (p === c) continue;
      if (HZ.cnames[p]) out.push(p);
      else if (depth < 2) walk(kids, depth + 1);
    }
  };
  walk(d.bd ? d.bd[1] : [], 0);
  return [...new Set(out)];
}

const rows = {};
const take = Object.keys(HZ.index).filter(c => hsk[c] || (HZ.index[c][0] && HZ.index[c][0] <= 6000));
let noStrokes = 0;
for (const c of take.sort((a, b) => (HZ.index[a][0] || 1e9) - (HZ.index[b][0] || 1e9))) {
  const d = data[c];
  // (a traditional form: its simplified one is taught. Not an HSK character, whatever the
  // data gives as its simplified form: 么 has 幺, 宁 has 㝉)
  if (!d || (!hsk[c] && d.s && d.s !== c)) continue;
  const st = d.st || (d.gr || []).length;
  if (!d.st) noStrokes++;
  rows[c] = [HZ.index[c][0] || 0, hsk[c] || 0, st, parts(c, d).join('')];
}
const out = path.join(D, 'charorder.js');
fs.writeFileSync(out, `HZ.charorder=${JSON.stringify(rows)};\n`);
console.log(`site/data/charorder.js: ${Object.keys(rows).length} characters, ${(fs.statSync(out).size / 1024).toFixed(0)} KB (${noStrokes} counted from their strokes list)`);
