/* One pass over the character scenes (out/scene-*.json) for the new cast: the person a
 * syllable's initial stands for is now a pop-culture figure (site/data/sounds.js), not a
 * job. For each scene whose person is still a job:
 *   1. {Baker} becomes {Batman}, and "The {Baker}" loses its article (the Joker keeps his)
 *   2. callbacks to the person ("the baker sighs") take the short name ("Batman sighs")
 *   3. pronouns follow the figure. The scenes gave each job either sex, so when the first
 *      pronoun in a scene is the wrong one, those pronouns are turned round. A scene that
 *      also names someone of that sex (a queen, a *woman*) is left for recast-fixes.json.
 *   4. recast-fixes.json ({character: {flip: true|false, subs: [[old text, new text], …]}})
 *      settles step 3 by hand and rewords what rules can't.
 * Component chips and **meanings** are never touched, and a scene already recast is skipped.
 * Usage: node build/mnemonics/recast.js [--dry] [--report FILE], then merge.js
 * This is the baseline: BRIEF.md section 7 then rewrites each scene around its figure. */
'use strict';
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out');

/* old job: [figure, short name in a callback, sex] */
const CAST = {
  Ghost: ['Casper', 'Casper', 'm'], Baker: ['Batman', 'Batman', 'm'], Pirate: ['Pikachu', 'Pikachu', 'm'],
  Magician: ['Mario', 'Mario', 'm'], Firefighter: ['Frodo', 'Frodo', 'm'], Dentist: ['Darth Vader', 'Vader', 'm'],
  Tailor: ['Tarzan', 'Tarzan', 'm'], Ninja: ['Naruto', 'Naruto', 'm'], Lifeguard: ['Lara Croft', 'Lara', 'f'],
  Gardener: ['Gandalf', 'Gandalf', 'm'], King: ['Kermit', 'Kermit', 'm'], Hunter: ['Homer', 'Homer', 'm'],
  Juggler: ['James Bond', 'Bond', 'm'], Cheerleader: ['Chewbacca', 'Chewbacca', 'm'], Shepherd: ['Shrek', 'Shrek', 'm'],
  Jockey: ['Joker', 'the Joker', 'm'], Chef: ['Charlie Brown', 'Charlie', 'm'], Sheriff: ['Sherlock', 'Sherlock', 'm'],
  Robot: ['Robocop', 'Robocop', 'm'], Zookeeper: ['Zorro', 'Zorro', 'm'], Tsar: ['Cookie Monster', 'Cookie Monster', 'm'],
  Sailor: ['Sailor Moon', 'Sailor Moon', 'f'], Yogi: ['Yoshi', 'Yoshi', 'm'], Wizard: ['Walter White', 'Walter', 'm'],
};
const KEEPS_THE = new Set(['Joker']);
const JOB = new RegExp(`\\{(${Object.keys(CAST).join('|')})\\}`);

const FEMALE = /\b(woman|women|girl|lady|ladies|queen|princess|mother|mum|mom|grandmother|granny|grandma|sister|daughter|bride|wife|aunt|nun|widow|duchess|empress|goddess|witch|maid|actress|waitress|ballerina|girlfriend|baroness|mermaid|niece|crone|dowager|hen|cow|ewe|mare)s?\b/i;
const MALE = /\b(man|men|boy|king|prince|father|dad|grandfather|grandpa|brother|son|groom|husband|uncle|monk|emperor|butler|duke|lord|knight|gentleman|sir|nephew|baron|wizard|bull|rooster|cockerel|stallion|ram)s?\b/i;
/* after these "her" is an object (him), not a possessive (his) */
const NOT_NOUN = /^(a|an|the|to|in|on|at|into|back|up|down|out|off|over|and|but|or|as|with|from|for|until|when|while|because|that|this|so|then|again|away|around|round|through|across|about|by|is|was|along|if|before|after|not|just|too|onto|under|behind|past|toward|towards|where|who|how|what|like|every|all|one|two|three|above|below|between|near|beside|instead|forever|right|straight|anything|something|nothing|everything|flat|upside|alone|free|home|outside|inside|whole|sideways|further|once|twice|each|some|any|no)\b/i;

const cap = (from, to) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);
const mapBits = (m, fn) => m.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\{[^}]+\})/).map((bit, i) => (i % 2 ? bit : fn(bit))).join('');

/* she/her -> he/him/his, in the text outside chips */
function toMale(m) {
  return mapBits(m, bit => bit
    .replace(/\bherself\b/gi, a => cap(a, 'himself'))
    .replace(/\bhers\b/gi, a => cap(a, 'his'))
    .replace(/\bshe\b/gi, a => cap(a, 'he'))
    .replace(/\bher\b(\s+)?([^\s]*)?/gi, (a, sp, nxt) => {
      if (!sp) return cap(a, 'him') + (nxt || '');
      if (!nxt) return cap(a, 'his') + sp; // a chip follows: her *jade*
      return cap(a, NOT_NOUN.test(nxt) ? 'him' : 'his') + sp + nxt;
    }));
}
/* he/him/his -> she/her, in the text outside chips */
function toFemale(m) {
  return mapBits(m, bit => bit
    .replace(/\bhimself\b/gi, a => cap(a, 'herself'))
    .replace(/\bhim\b/gi, a => cap(a, 'her'))
    .replace(/\bhe\b/gi, a => cap(a, 'she'))
    .replace(/\bhis\b(\s+)?([^\s]*)?/gi, (a, sp, nxt) => {
      if (!sp) return cap(a, 'hers') + (nxt || '');
      if (!nxt) return cap(a, 'her') + sp;
      return cap(a, NOT_NOUN.test(nxt) ? 'hers' : 'her') + sp + nxt;
    }));
}
const masked = m => m.replace(/\*\*[^*]+\*\*|\*[^*]+\*|\{[^}]+\}/g, ' ');

function recast(row, fix) {
  const hit = row.m.match(JOB);
  if (!hit) return { m: row.m, done: false };
  const job = hit[1], [figure, short, sex] = CAST[job];
  let m = row.m;
  // 1. the token
  const the = KEEPS_THE.has(figure);
  m = m.replace(new RegExp(`\\b([Tt]he )?\\{${job}\\}`, 'g'), (a, art) => (the ? `${art || 'The '}{${figure}}` : `{${figure}}`));
  // 2. callbacks. "The hunter" and "the Hunter", with or without 's; other uses stay
  const open = short.startsWith('the ') ? short : null;
  m = mapBits(m, bit => bit.replace(new RegExp(`\\b([Tt])he ${job}\\b(?!s)`, 'gi'), (a, t) => {
    if (open) return (t === 'T' ? 'The' : 'the') + open.slice(3);
    return short;
  }));
  // 3. pronouns
  const first = (masked(m).match(/\b(he|his|him|himself|she|her|hers|herself)\b/i) || [])[1];
  const firstSex = !first ? '' : /^(he|his|him|himself)$/i.test(first) ? 'm' : 'f';
  const wrong = firstSex && firstSex !== sex;
  const clash = wrong && (sex === 'm' ? FEMALE : MALE).test(row.m);
  let flip = wrong && !clash;
  if (fix && typeof fix.flip === 'boolean') flip = fix.flip;
  if (flip) m = sex === 'm' ? toMale(m) : toFemale(m);
  // 4. by hand
  const stale = [];
  for (const [a, b] of (fix && fix.subs) || []) {
    if (m.includes(a)) m = m.replace(a, b);
    else if (!m.includes(b)) stale.push(a);
  }
  return { m, done: true, job, figure, flip, review: clash && !(fix && typeof fix.flip === 'boolean'), stale };
}

function run(dry, reportFile) {
  let fixes = {};
  try { fixes = JSON.parse(fs.readFileSync(path.join(__dirname, 'recast-fixes.json'), 'utf8')); } catch (e) { /* none yet */ }
  let changed = 0, flipped = 0;
  const review = [], stale = [], flips = [];
  for (const f of fs.readdirSync(OUT).filter(f => /^scene-.*\.json$/.test(f)).sort()) {
    const rows = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
    for (const x of rows) {
      const r = recast(x, fixes[x.c]);
      if (!r.done) continue;
      changed++;
      if (r.flip) { flipped++; flips.push(`${x.c}\t${r.m}`); }
      if (r.review) review.push(`${x.c}\t${r.m}`);
      for (const s of r.stale) stale.push(`${x.c}: ${s}`);
      x.m = r.m;
    }
    if (!dry) fs.writeFileSync(path.join(OUT, f), JSON.stringify(rows).replace(/},{/g, '},\n{'));
  }
  console.log(`${changed} scenes recast, ${flipped} with their pronouns turned round, ${review.length} to settle by hand`);
  if (stale.length) console.log(`fixes that no longer apply:\n${stale.join('\n')}`);
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify({ review, flips }, null, 1));
}

if (require.main === module) {
  const a = process.argv, i = a.indexOf('--report');
  run(a.includes('--dry'), i > 0 ? a[i + 1] : '');
}
module.exports = { recast, CAST, toMale, toFemale };
