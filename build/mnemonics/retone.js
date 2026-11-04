/* One pass over the character scenes (out/scene-*.json) for the new tone places: the
 * tone is now WHERE in or around the final's building the scene happens, 1 in Front of
 * it, 2 Inside it, 3 its Basement, 4 its Bathroom, 5 on its Roof (site/data/sounds.js).
 *   1. the clause naming the place is reworded by rule (place)
 *   2. the rest of the scene stops mentioning places that now mean another tone: a
 *      tone-1 scene has no roof, a tone-4 scene no trapdoor or cellar (scenery). Component
 *      chips (*roof*, 宀) are left alone: they are what the character is made of.
 *   3. retone-fixes.json ({character: [[old text, new text], …]}) tidies what rules can't.
 * Run it on the scenes as they were before: the rules look for the old names.
 * Usage: node build/mnemonics/retone.js [--dry], then node build/mnemonics/merge.js */
'use strict';
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out');
const ADJ = String.raw`(?: [a-z-]+?){0,3}?`;                  // "a mossy", "the rickety vine"
const DET = '(the|his|her|their|a|an)';
const LINK = String.raw`(?: (?:of|in|at|on|by|beside|to|into|up|down|cut into the cliff at|down to|out of|above|over))+`;

function place(m) {
  // tone 4: Trapdoor -> Bathroom
  m = m.replace(/\b(up |back up )?(?:through|down|under|beneath|below|underneath) (the|a) \{Trapdoor\}/g,
    (a, up, det) => `${up ? up + 'in' : 'into'} ${det} {Bathroom}`)
    .replace(/\b(lifts|raises|heaves|hoists|prises|pries|yanks|pulls|flings|swings|levers) (open |up )?the \{Trapdoor\}/g, 'opens the {Bathroom}')
    .replace(/\{Trapdoor\}/g, '{Bathroom}')
    .replace(/\{Bathroom\} (?:at the (?:top|bottom|edge|foot) of|in the (?:middle|floor) of|in the floor of|into|in|to|above|beneath|under|below|at|on|onto|by|beside|near) (the|his|her) /g, '{Bathroom} of $1 ')
    // "drops into the Bathroom of the Tower into a cabinet": one "into" is enough
    .replace(/(\binto (?:the|a) \{Bathroom\} of \w+ \{[^}]+\}(?: [a-z]+)?) into (a|an|the|his|her|their) /, '$1 and lands in $2 ');
  // tone 1: Rooftop -> in Front of
  m = m.replace(new RegExp(String.raw`\bclimbs (?:up )?(?:onto|on|to|up to) the \{Rooftop\} (?:of|above|over|by|beside) ${DET} `, 'g'), 'marches out in {Front} of $1 ')
    .replace(new RegExp(String.raw`\bOn the \{Rooftop\} (?:of|above|over|by|beside) ${DET} `, 'g'), 'In {Front} of $1 ')
    .replace(new RegExp(String.raw`\b(?:up onto|up on|up to|on top of|at the top of|high on|high above|atop|on|onto|to|across|along|over|up|from|off) the \{Rooftop\} (?:of|above|over|by|beside) ${DET} `, 'g'), 'in {Front} of $1 ')
    .replace(/\{Rooftop\}/g, '{Front}');
  // tone 2: Staircase -> Inside
  m = m.replace(new RegExp(String.raw`\b(?:On|Up|Down|Halfway up|At the top of|At the foot of) (?:the|a|an)${ADJ} \{Staircase\}${LINK} ${DET} `, 'g'), '{Inside} $1 ')
    .replace(new RegExp(String.raw`\b(?:halfway up|halfway down|at the top of|at the foot of|at the bottom of|to the top of|to the bottom of|up and down|up|down|on|onto|to|across|along|from|off|under|beside|by) (?:the|a|an)${ADJ} \{Staircase\}${LINK} ${DET} `, 'g'), '{Inside} $1 ')
    .replace(new RegExp(String.raw`\b(climbs|ascends|descends|mounts|takes|scales|rides|storms) (?:the|a|an)${ADJ} \{Staircase\}${LINK} ${DET} `, 'g'),
      (a, v, det) => `${{ climbs: 'wanders', ascends: 'wanders', descends: 'wanders', mounts: 'wanders', takes: 'wanders', scales: 'creeps' }[v] || v} {Inside} ${det} `)
    .replace(/\{Staircase\}/g, '{Inside}');
  // tone 5: Front Step -> Roof
  m = m.replace(/\{Front Step\}/g, '{Roof}');
  return m;
}

/* Ordered [pattern, replacement] per tone place. Only text outside chips is touched. */
const LAWN = [
  [/\broof tiles\b/g, 'paving stones'], [/\btiles\b/g, 'paving stones'], [/\bTiles\b/g, 'Paving stones'],
  [/\b(falls?|tumbles?|topples?|floats?|rolls?|cannonballs?|slides?|bounces?|skates?|spins?) off (a|the) roof\b/g, '$1 across the lawn'],
  [/\brooftops\b/g, 'lawns'], [/\ba roof\b/g, 'a lawn'], [/\broofs\b/g, 'lawns'], [/\broof\b/g, 'lawn'],
  [/\bchimney pot\b/g, 'lamp post'], [/\bchimneys\b/g, 'lamp posts'], [/\bchimney\b/g, 'lamp post'],
  [/\bgutters\b/g, 'ditches'], [/\bgutter\b/g, 'ditch'],
  [/\bweathervanes\b/g, 'signposts'], [/\bweathervane\b/g, 'signpost'],
  [/\bskylights\b/g, 'front windows'], [/\bskylight\b/g, 'front window'],
];
const CEILING = [
  [/\brooftops\b/g, 'corridors'], [/\ba roof\b/g, 'a ceiling'], [/\broofs\b/g, 'ceilings'], [/\broof\b/g, 'ceiling'],
];
const INDOORS = [...CEILING, [/\bchimneys\b/g, 'pipes'], [/\bchimney\b/g, 'pipe']];
const SCENERY = {
  Front: LAWN,
  Inside: CEILING,
  Basement: [...INDOORS, [/\btrapdoor\b/g, 'cellar door']],
  Bathroom: [[/\brooftops\b/g, 'bathtubs'], ...INDOORS, [/\bcellar\b/g, 'bathroom'], [/\btrapdoor\b/g, 'bathroom door'], [/\bhatch\b/g, 'bathroom door']],
  Roof: [[/\bdoorstep\b/g, 'roof'], [/\bstep\b/g, 'roof'], [/\bsteps\b/g, 'tiles']],
};
function scenery(m) {
  const room = (m.match(/\{(Front|Inside|Basement|Bathroom|Roof)\}/) || [])[1];
  if (!room) return m;
  return m.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\{[^}]+\})/).map((bit, i) => {
    if (i % 2) return bit;
    for (const [a, b] of SCENERY[room]) bit = bit.replace(a, b);
    return bit;
  }).join('');
}

function run(dry) {
  let fixes = {};
  try { fixes = JSON.parse(fs.readFileSync(path.join(__dirname, 'retone-fixes.json'), 'utf8')); } catch (e) { /* none yet */ }
  const stale = [];
  let changed = 0;
  for (const f of fs.readdirSync(OUT).filter(f => /^scene-.*\.json$/.test(f)).sort()) {
    const rows = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
    for (const x of rows) {
      const was = x.m;
      x.m = scenery(place(x.m));
      for (const [a, b] of fixes[x.c] || []) {
        if (x.m.includes(a)) x.m = x.m.replace(a, b);
        else if (!x.m.includes(b)) stale.push(`${x.c}: ${a}`);
      }
      if (x.m !== was) changed++;
    }
    if (!dry) fs.writeFileSync(path.join(OUT, f), JSON.stringify(rows).replace(/},{/g, '},\n{'));
  }
  console.log(`${changed} scenes reworded`);
  if (stale.length) console.log(`fixes that no longer apply:\n${stale.join('\n')}`);
}

if (require.main === module) run(process.argv.includes('--dry'));
module.exports = { place, scenery };
