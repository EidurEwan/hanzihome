/* Puts the cleaned-up meanings into the site's data files.
 *
 *   node build/meanings/apply.js
 *
 * chars.txt  the 3,000 taught characters: the mnemonic keyword first, then plain senses.
 * words.txt  hand-picked meanings for HSK words. HSK words not listed there get their
 *            dictionary meaning tidied automatically (notes, measure words and rare
 *            senses dropped, "sb"/"sth" spelled out).
 *
 * The first meaning is the main one: it is what lists, flashcards and search results show.
 * Safe to run more than once. Note that build/export_static.py rewrites these files from
 * data/hanzicraft.db, so run this again after an export.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'site', 'data');

function readList(file) {
  const out = new Map();
  for (const line of fs.readFileSync(path.join(__dirname, file), 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf(' = ');
    if (i > 0) out.set(line.slice(0, i).trim(), line.slice(i + 3).trim());
  }
  return out;
}

/* A data file is `HZ.name=<json>;` and sometimes more statements after it
   (readings.js also holds HZ.t2s and others): only the first one is touched. */
function load(file) {
  const src = fs.readFileSync(path.join(DATA, file), 'utf8');
  const eq = src.indexOf('=');
  let body = src.slice(eq + 1), tail = '';
  try {
    JSON.parse(body.replace(/;\s*$/, ''));
    body = body.replace(/;\s*$/, '');
    tail = ';\n';
  } catch (e) {
    const m = /after JSON at position (\d+)/.exec(e.message);
    if (!m) throw e;
    tail = body.slice(+m[1]);
    body = body.slice(0, +m[1]);
  }
  return { head: src.slice(0, eq + 1), data: JSON.parse(body), tail };
}
function save(file, f) {
  fs.writeFileSync(path.join(DATA, file), f.head + JSON.stringify(f.data) + f.tail);
}

/* tidy a dictionary meaning list into a few plain senses */
const DROP = new RegExp([
  '^CL:', 'variant of', 'used in ', 'surname', '\\bsee\\b', 'Kangxi', 'radical', 'old name', 'place name', 'name of ',
  '\\((literary|archaic|dialect|old|classical|Cantonese|Buddhism|Taoism|math\\.|chemistry|physics|Internet slang)\\)',
].join('|'), 'i');
const tidy = s => String(s)
  .replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '')
  .replace(/\bCL:.*$/, '').replace(/\($/, '')
  .replace(/^(lit|fig)\.\s*/, '')
  .replace(/\bsb\b/g, 'someone').replace(/\bsth\b/g, 'something')
  .replace(/\s+/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').trim();
const key = s => s.toLowerCase().replace(/^to /, '').replace(/[^a-z0-9 ]/g, '').trim();
function senses(list) {
  const out = [];
  for (const raw of list.flatMap(x => String(x).split(/;\s*/))) {
    if (DROP.test(raw)) continue;
    const c = tidy(raw);
    if (!c || /[㐀-鿿]/.test(c) || /^[0-9 ]+$/.test(c) || c.length > 40 || c.includes('…')) continue;
    if (!out.some(o => key(o) === key(c))) out.push(c);
  }
  return out;
}
/* put the chosen senses first in a reading's sense list, without repeating any */
function lead(list, gloss) {
  const first = gloss.split(/;\s*/);
  const seen = new Set(first.map(key));
  const rest = list.flatMap(x => String(x).split(/;\s*/)).filter(s => !seen.has(key(s)) && (seen.add(key(s)), true));
  return [...first, ...rest];
}
const bare = s => String(s || '').toLowerCase().replace(/\s+/g, '');

const chars = readList('chars.txt');
const words = readList('words.txt');

// ---- characters: index (lists, search, flashcards), readings and the detail page
const index = load('index.js');
let nChars = 0;
for (const [c, gloss] of chars) {
  const e = index.data[c];
  if (!e) continue;
  if (e[3] !== gloss) { e[3] = gloss; nChars++; }
}
save('index.js', index);

const readings = load('readings.js');
for (const [c, gloss] of chars) {
  const rds = readings.data[c], e = index.data[c];
  if (!rds || !e) continue;
  const rd = rds.find(r => r[0] === e[2]) || rds[0];
  rd[1] = lead(rd[1], gloss);
}
save('readings.js', readings);

for (const f of fs.readdirSync(path.join(DATA, 'c'))) {
  const chunk = load(path.join('c', f));
  let touched = false;
  for (const [c, d] of Object.entries(chunk.data)) {
    const gloss = chars.get(c);
    if (!gloss || !d.rd || !d.rd.length) continue;
    const rd = d.rd.find(r => r[1] === index.data[c][2]) || d.rd[0];
    rd[2] = lead(rd[2], gloss);
    touched = true;
  }
  if (touched) save(path.join('c', f), chunk);
}

// ---- HSK words: the HSK lists and the word dictionary
const hsk = load('hsk.js');
const hskGloss = new Map();
let nHand = 0, nAuto = 0;
for (const list of Object.values(hsk.data)) for (const w of list) {
  let g = words.get(w[0]);
  if (g) nHand++;
  else {
    const s = senses(String(w[2]).split(/;\s*/));
    g = s.length ? s.slice(0, 3).join('; ') : w[2];
    if (g !== w[2]) nAuto++;
  }
  w[2] = g;
  hskGloss.set(w[0] + '|' + bare(w[1]), g);
  if (!hskGloss.has(w[0])) hskGloss.set(w[0], g);
}
save('hsk.js', hsk);

const dict = load('words.js');
let nWords = 0;
for (const e of dict.data) {
  const g = hskGloss.get(e[0] + '|' + bare(e[2]));
  if (g && e[3] !== g) { e[3] = g; nWords++; }
}
save('words.js', dict);

console.log(`characters: ${nChars} meanings changed`);
console.log(`HSK words: ${nHand} hand-picked, ${nAuto} tidied automatically; ${nWords} dictionary entries updated`);
