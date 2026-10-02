/* Write site/data/s/*.js: how to write each character, stroke by stroke, for the
 * character pages' stroke order and writing practice (site/vendor/hanzi-writer.min.js).
 *
 * The strokes come from hanzi-writer-data (Make Me a Hanzi's graphics, under the
 * Arphic Public License: site/vendor/ARPHICPL.TXT), split into the same 64 buckets
 * by code point as site/data/c/, so a character page loads one ~450 KB file:
 *
 *   HZ.strokes['xx'] = {char: [strokes, medians, radStrokes]}
 *     strokes     SVG path of each stroke's outline, in writing order (1024 units square)
 *     medians     each stroke's centre line, [[x, y], ...]: what a drawn stroke is matched to
 *     radStrokes  which strokes make up the radical (may be missing)
 *
 *   node build/export_strokes.js [path to hanzi-writer-data]
 *
 * Without a path it fetches hanzi-writer-data@2.0.1 with npm pack.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = '2.0.1';
const BUCKETS = 64;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'site', 'data', 's');

function source() {
  if (process.argv[2]) return process.argv[2];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hwdata-'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const file = execFileSync(npm, ['pack', 'hanzi-writer-data@' + VERSION, '--silent'], { cwd: tmp, shell: process.platform === 'win32' })
    .toString().trim().split('\n').pop();
  execFileSync('tar', ['xzf', file], { cwd: tmp });
  return path.join(tmp, 'package');
}

const bucketOf = ch => ('0' + (ch.codePointAt(0) % BUCKETS).toString(16)).slice(-2);

function main() {
  const dir = source();
  const buckets = {};
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'package.json') continue;
    const ch = f.slice(0, -5);
    if ([...ch].length !== 1) continue;
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!Array.isArray(d.strokes) || !Array.isArray(d.medians)) continue;
    // "M 350 571 Q 380 593" -> "M350 571Q380 593": the same path, a fifth smaller
    const entry = [d.strokes.map(p => p.replace(/ ?([A-Za-z]) ?/g, '$1')), d.medians];
    if (d.radStrokes && d.radStrokes.length) entry.push(d.radStrokes);
    (buckets[bucketOf(ch)] = buckets[bucketOf(ch)] || {})[ch] = entry;
    n++;
  }
  fs.mkdirSync(OUT, { recursive: true });
  let total = 0;
  for (const [b, obj] of Object.entries(buckets).sort()) {
    const file = path.join(OUT, b + '.js');
    fs.writeFileSync(file, `HZ.strokes['${b}']=${JSON.stringify(obj)};\n`);
    total += fs.statSync(file).size;
  }
  fs.copyFileSync(path.join(dir, 'ARPHICPL.TXT'), path.join(ROOT, 'site', 'vendor', 'ARPHICPL.TXT'));
  console.log(`site/data/s: ${n} characters in ${Object.keys(buckets).length} files, ${(total / 1e6).toFixed(1)} MB`);
}

main();
