/* Which recordings sound cut off? From measurements of every recording's start and end, made in
 * a browser (`cutScan` below), this writes build/tones/cutoffs.json, which the tone trainer's
 * data leaves out (build/tones/build.js), and adds to `c` in site/data/audio.js the ones with
 * syllable recordings to say instead (Sound.recorded in site/study.js).
 *
 * Cut off means any of:
 *   - under 30 ms between the last sound and the end of the file, or a loud last 20 ms: it stops dead
 *   - the voice falls from a quarter of its peak to nothing in 25 ms or less: a natural ending takes longer
 *   - 20 ms or less before the first sound: speakers that take a moment to wake lose the start
 *
 * A word stays on its own recording, cut off or not, where syllables would say it wrongly: a tone
 * change (水果 isn't shuǐ + guǒ) or a neutral tone, which has few recordings of its own.
 *
 * Usage: node build/tones/cutoffs.js <measured.json>
 * Measured: {s: {ma1: [fall, after, lead, dur, loud]}, w: {…}, tailS: {ma1: tail}, tailW: {…}}, in ms.
 *
 *   async function cutScan(url) {
 *     const ab = await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(await (await fetch(url)).arrayBuffer());
 *     const x = ab.getChannelData(0), w = Math.round(ab.sampleRate * 0.005), env = [];
 *     let pk = 0;
 *     for (let i = 0; i + w <= x.length; i += w) { let e = 0; for (let j = 0; j < w; j++) e += x[i + j] * x[i + j]; e = Math.sqrt(e / w); env.push(e); if (e > pk) pk = e; }
 *     let end = env.length - 1; while (end > 0 && env[end] < pk * 0.03) end--;
 *     let k = end; while (k > 0 && env[k] < pk * 0.25) k--;
 *     let start = 0; while (start < env.length && env[start] < pk * 0.03) start++;
 *     return { fall: (end - k) * 5, after: (env.length - 1 - end) * 5, lead: start * 5 };
 *   }
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), D = path.join(ROOT, 'site', 'data');
global.HZ = {}; global.window = global;
for (const f of ['audio.js', 'hsk.js', 'index.js', 'cmnem.js']) require(path.join(D, f));
const Learn = require(path.join(ROOT, 'site', 'learn.js'));

const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cut = (v, tail) => v[1] < 30 || tail > 0.03 || v[0] <= 25 || v[2] <= 20;
const badS = Object.keys(m.s).filter(k => cut(m.s[k], m.tailS[k] || 0));
const badW = Object.keys(m.w).filter(k => cut(m.w[k], m.tailW[k] || 0));
fs.writeFileSync(path.join(__dirname, 'cutoffs.json'), JSON.stringify({ s: badS, w: badW }));

const pins = {};
for (const l of Object.values(HZ.hsk)) for (const [w, p] of l) if (!pins[w] && p) pins[w] = p;
const pinOf = w => {
  if ([...w].length > 1) return pins[w];
  const cm = HZ.cmnem[w];
  return (cm && cm[2]) || (HZ.index[w] || [])[2] || pins[w];
};
const clean = new Set(Object.keys(m.s).filter(k => !badS.includes(k)));
const canSwap = w => {
  const p = pinOf(w);
  if (!p) return false;
  const sy = String(p).trim().split(/\s+/);
  if (sy.length !== [...w].length) return false;
  const parts = sy.map(s => Learn.parsePinyin(s));
  if (parts.some(x => !x.tones[0] || x.tones[0] === 5 || !clean.has(x.letters + x.tones[0]))) return false;
  if (/[不一]/.test(w) && [...w].length > 1) return false;
  for (let i = 0; i + 1 < parts.length; i++) if (parts[i].tones[0] === 3 && parts[i + 1].tones[0] === 3) return false;
  return true;
};
const was = HZ.audio.c.split('|').filter(Boolean), add = badW.filter(w => !was.includes(w) && canSwap(w));
HZ.audio.c = [...was, ...add].join('|');
// a word's pinyin to say it with, as the word lists may not have loaded when it is said
HZ.audio.p = Object.fromEntries(HZ.audio.c.split('|').filter(w => [...w].length > 1).map(w => [w, String(pinOf(w)).trim().toLowerCase()]));
fs.writeFileSync(path.join(D, 'audio.js'), `HZ.audio=${JSON.stringify(HZ.audio)};\n`);

const stay = badW.filter(w => !was.includes(w) && !add.includes(w));
const dead = stay.filter(w => m.w[w][1] < 30 || (m.tailW[w] || 0) > 0.03);
console.log(`cut off: ${badS.length} of ${Object.keys(m.s).length} syllables, ${badW.length} of ${Object.keys(m.w).length} words`);
console.log(`said on syllables instead: ${add.length} new, ${was.length} already`);
console.log(`keep their own recording: ${stay.length}, of which stop dead: ${dead.length}: ${dead.join(' ')}`);
