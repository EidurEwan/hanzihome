/* Inputs for the renamed components (BRIEF.md section 9): in/compren.json */
'use strict';
const fs = require('fs'), path = require('path');
const D = path.join(__dirname, '..', '..', 'site', 'data');
global.HZ = { chunk: {} };
for (const f of ['index.js', 'cnames.js']) require(path.join(D, f));
for (const f of fs.readdirSync(path.join(D, 'c'))) require(path.join(D, 'c', f));
const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'cnames-rename.json'), 'utf8'));
const name = c => R[c] || HZ.cnames[c][0];
const chunk = c => { for (const b of Object.values(HZ.chunk)) if (b[c]) return b[c]; return null; };
const parts = c => { const d = chunk(c); return d && d.bd ? [...new Set(d.bd[1].map(x => x[0]))].filter(p => p !== c && HZ.cnames[p]) : []; };
const olds = Object.keys(R).map(c => HZ.cnames[c][0]);
const rows = [];
for (const [c, v] of Object.entries(HZ.cnames)) {
  const renamed = c in R, mentions = olds.some(o => (v[2] || '').includes('*' + o + '*'));
  if (!renamed && !mentions) continue;
  rows.push({ c, name: name(c), old: renamed ? v[0] : undefined, meaning: String((HZ.index[c] || [])[3] || '').split(';')[0],
    parts: parts(c).map(p => [p, name(p)]), why: v[1], m: v[2] || '', task: renamed ? 'rename' : 'story' });
}
fs.writeFileSync(path.join(__dirname, 'in', 'compren.json'), '[' + rows.map(x => JSON.stringify(x)).join(',\n') + ']\n');
console.log(rows.length, 'rows,', rows.filter(r => r.task === 'rename').length, 'renamed');
