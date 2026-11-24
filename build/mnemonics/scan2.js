/* node build/mnemonics/scan2.js — style problems check.js lets through in out/scene2-*.json:
 * the key in **…** more than 3 times, another tone's place named outside a token or part,
 * a figure from another row of the cast. Prints "c: problem" lines and a count per file. */
'use strict';
const fs = require('fs'), path = require('path');
const cast = require('./cast2.js');
const PLACES = { Front: /\bfront\b/i, Inside: /\binside\b/i, Basement: /\bbasements?\b/i, Bathroom: /\bbathrooms?\b/i, Roof: /\b(roofs?|rooftops?)\b/i };
const figures = Object.values(cast.BEGINNINGS).map(v => [v[0], v[4].replace(/^the /, '')]);
const flagged = [];
for (const f of fs.readdirSync(path.join(__dirname, 'in')).filter(f => /^scene2-\d+\.json$/.test(f)).sort()) {
  let out;
  try { out = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', f), 'utf8')); } catch (e) { continue; }
  const inp = JSON.parse(fs.readFileSync(path.join(__dirname, 'in', f), 'utf8'));
  let n = 0;
  inp.forEach((x, i) => {
    const m = (out[i] || {}).m || '', why = [];
    const bold = (m.match(/\*\*[^*]+\*\*/g) || []).length;
    if (bold > 4) why.push(`key bolded ${bold}x`);
    const tone = x.sound[2].replace(/^\S+ /, '');
    const text = m.replace(/\*\*[^*]+\*\*|\*[^*]+\*|\{[^}]+\}/g, '');
    for (const [p, re] of Object.entries(PLACES)) if (p !== tone && re.test(text)) why.push(`mentions ${p.toLowerCase()}`);
    const own = x.sound[0].replace(/^\S+ /, '');
    for (const [full, short] of figures) {
      if (full === own) continue;
      if (new RegExp('\\b' + full.replace(/[.]/g, '\\.') + '\\b').test(text) && !own.includes(full)) why.push(`other figure ${full}`);
    }
    if (why.length) { n++; flagged.push({ f, c: x.c, why: why.join(', ') }); }
  });
  console.log(f, n, 'flagged');
}
fs.writeFileSync(path.join(__dirname, 'scan2-flagged.json'), JSON.stringify(flagged, null, 1));
for (const x of flagged) console.log(x.c, x.why);
