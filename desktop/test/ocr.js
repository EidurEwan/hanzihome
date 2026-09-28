/* How well does Windows OCR read Chinese as it appears on screen?
 *
 * Paragraphs from the graded stories are drawn as pictures in several styles
 * (render.exe), read back by the OCR helper at several enlargements, and
 * compared with the original text. Accuracy counts Chinese characters only:
 * 1 - edit distance / length, so a missed, extra or wrong character each cost
 * one. The most common mix-ups are listed, since those are what a repair step
 * would have to undo.
 *
 *   node desktop/ocr/build.js render     once, to build the helper and render.exe
 *   node desktop/test/ocr.js             accuracy per style and enlargement
 *   node desktop/test/ocr.js --incremental  change one paragraph of a page and check
 *                                        only that band is read again, correctly
 *   node desktop/test/ocr.js --screen    read the real screen once, whole and then
 *                                        incrementally, and report timings and counts
 *                                        (never the text: it could be anything)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { OcrHelper } = require('../src/ocr');
const { loadHZ } = require('../src/data');
const ocrfix = require('../src/ocrfix');
const { repair } = ocrfix;

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');
const RENDER = path.join(__dirname, 'bin', 'render.exe');

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const han = s => [...s].filter(isHan);

// On this kind of screen, at 100% display scaling body text is ~16 px; at 150% it is ~24 px.
const STYLES = [
  { name: 'web 16px', font: 'Microsoft YaHei', size: 16 },
  { name: 'web 24px', font: 'Microsoft YaHei', size: 24 },
  { name: 'small 13px', font: 'Microsoft YaHei', size: 13 },
  { name: 'DengXian 20px', font: 'DengXian', size: 20 },
  { name: 'SimSun 20px (books, PDFs)', font: 'SimSun', size: 20 },
  { name: 'KaiTi 24px', font: 'KaiTi', size: 24 },
  { name: 'dark mode 20px', font: 'Microsoft YaHei', size: 20, fg: '#dddddd', bg: '#1e1e1e' },
  { name: 'subtitles 34px', font: 'Microsoft YaHei', size: 34, bold: true, fg: '#ffffff', style: 'subtitle', width: 1100 },
];
const SCALES = [1, 1.5, 2, 3];
const DEFAULT = 1.5;                  // the helper's DefaultScale
const PER_STYLE = 3;

function storyParagraphs() {
  const ctx = { HZ: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'site', 'data', 'stories.js'), 'utf8'), ctx);
  const paras = [];
  for (const st of ctx.HZ.stories) {
    for (const par of st.seg) {
      paras.push(par.map(tk => tk.br ? '' : typeof tk === 'string' ? st.g[tk][0] : tk.s).join(''));
    }
  }
  return paras;
}

/* edit distance with the substitutions it took */
function align(a, b) {
  const n = a.length, m = b.length;
  const d = Array.from({ length: n + 1 }, (_, i) => new Int32Array(m + 1).fill(0).map((_, j) => i || j ? (i ? (j ? 0 : i) : j) : 0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const subs = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    if (i && j && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (a[i - 1] !== b[j - 1]) subs.push(a[i - 1] + '→' + b[j - 1]);
      i--; j--;
    } else if (i && d[i][j] === d[i - 1][j] + 1) { subs.push(a[i - 1] + '→∅'); i--; }
    else { subs.push('∅→' + b[j - 1]); j--; }
  }
  return { dist: d[n][m], subs };
}

async function accuracy() {
  if (!fs.existsSync(RENDER)) throw new Error('run: node desktop/ocr/build.js render');
  fs.mkdirSync(OUT, { recursive: true });
  const paras = storyParagraphs();

  // each picture gets its own stretch of story text, about 300 characters
  const jobs = [];
  let p = 0;
  STYLES.forEach((s, si) => {
    for (let k = 0; k < PER_STYLE; k++) {
      let text = '';
      while (han(text).length < 300) text += (text ? '\n' : '') + paras[p++ % paras.length];
      jobs.push(Object.assign({ out: path.join(OUT, `s${si}-${k}.png`), text, width: 900 }, s));
    }
  });
  const jobFile = path.join(OUT, 'jobs.json');
  fs.writeFileSync(jobFile, JSON.stringify(jobs));
  const fonts = JSON.parse(execFileSync(RENDER, [jobFile]).toString());

  const ocr = new OcrHelper();
  const HZ = loadHZ(['index', 'readings', 'readerwords']);
  const read = [];                     // the default enlargement's lines, for the repair
  const pct = (dist, len) => `${(100 * (1 - dist / len)).toFixed(1)}%`;
  console.log('Chinese characters read correctly, by style and enlargement (ms per picture);');
  console.log(`the last column repairs the ×${DEFAULT} reading with desktop/src/ocrfix.js\n`);
  console.log('style'.padEnd(28) + SCALES.map(s => `×${s}`.padStart(15)).join('') + 'repaired'.padStart(11));
  for (let si = 0; si < STYLES.length; si++) {
    const mine = jobs.filter((_, i) => Math.floor(i / PER_STYLE) === si);
    const got = fonts[si * PER_STYLE];
    if (got !== STYLES[si].font) {
      console.log(STYLES[si].name.padEnd(28) + `  (skipped: font not installed, Windows gave ${got})`);
      continue;
    }
    const cells = [];
    let fixed = 0, fixedLen = 0;
    for (const scale of SCALES) {
      let dist = 0, len = 0, ms = 0;
      for (const job of mine) {
        const r = await ocr.request('file', { path: job.out, scale });
        const want = han(job.text);
        dist += align(want, han(r.lines.map(l => l.text).join(''))).dist;
        len += want.length; ms += r.ms;
        if (scale === DEFAULT) {
          read.push({ want, lines: r.lines });
          fixed += align(want, han(repair(r.lines, HZ).lines.map(l => l.text).join(''))).dist;
          fixedLen += want.length;
        }
      }
      cells.push(`${pct(dist, len)} ${String(Math.round(ms / mine.length)).padStart(4)}`);
    }
    console.log(STYLES[si].name.padEnd(28) + cells.map(c => c.padStart(15)).join('') + pct(fixed, fixedLen).padStart(11));
  }
  ocr.close();

  // The look-alike swaps trade fixes against harm: try margins on the OCR readings,
  // and on the stories' own correct text laid out as lines (where every change is harm).
  const clean = [];
  for (const par of storyParagraphs()) {
    const cs = [...par];
    for (let i = 0; i < cs.length; i += 30) {
      const chars = cs.slice(i, i + 30).map((t, k) => ({ t, x: k * 20, y: 0, w: 20, h: 20 }));
      clean.push({ text: chars.map(c => c.t).join(''), x: 0, y: 0, w: chars.length * 20, h: 20, chars });
    }
  }
  const cleanLen = clean.reduce((n, l) => n + han(l.text).length, 0);
  console.log(`\nlook-alike margin: accuracy at ×${DEFAULT} after repair | changes to ${cleanLen} correct characters`);
  const keep = ocrfix.params.MARGIN;
  for (const m of [2, 4, 6, 8, 10]) {
    ocrfix.params.MARGIN = m;
    let dist = 0, len = 0;
    for (const r of read) { dist += align(r.want, han(repair(r.lines, HZ).lines.map(l => l.text).join(''))).dist; len += r.want.length; }
    const harm = repair(clean, HZ).fixes;
    console.log(`  ${String(m).padStart(2)}${m === keep ? ' (used)' : '       '}  ${pct(dist, len)} | ${harm.length} changed` +
      (harm.length ? ': ' + [...new Set(harm)].slice(0, 12).join(' ') : ''));
  }
  ocrfix.params.MARGIN = keep;

  const mixups = {};
  for (const r of read) {
    for (const s of align(r.want, han(repair(r.lines, HZ).lines.map(l => l.text).join(''))).subs) mixups[s] = (mixups[s] || 0) + 1;
  }
  const top = Object.entries(mixups).sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log(`\nmix-ups left after repair at ×${DEFAULT}, all styles (expected→read, ∅ = nothing):`);
  console.log('  ' + (top.map(([k, n]) => `${k} ${n}`).join('  ') || 'none'));
}

/* Incremental reading: a page, then the same page with one paragraph altered
   (same length, so nothing else moves). Only the band around that paragraph
   should be read again, and the result must equal reading the new page whole. */
async function incremental() {
  if (!fs.existsSync(RENDER)) throw new Error('run: node desktop/ocr/build.js render');
  fs.mkdirSync(OUT, { recursive: true });
  const paras = storyParagraphs().slice(40, 46);
  const changed = paras.slice();
  // swap the third paragraph's characters for others from the same text, so its length stays
  changed[2] = [...changed[2]].map(c => isHan(c) ? '好' : c).join('');
  const style = { font: 'Microsoft YaHei', size: 24, width: 900 };
  const a = path.join(OUT, 'inc-a.png'), b = path.join(OUT, 'inc-b.png');
  const jobFile = path.join(OUT, 'inc.json');
  fs.writeFileSync(jobFile, JSON.stringify([
    Object.assign({ out: a, text: paras.join('\n') }, style),
    Object.assign({ out: b, text: changed.join('\n') }, style),
  ]));
  execFileSync(RENDER, [jobFile]);

  const ocr = new OcrHelper();
  await ocr.request('forget');
  const first = await ocr.request('screen', { picture: a });
  const second = await ocr.request('screen', { picture: b });
  await ocr.request('forget');
  const whole = await ocr.request('screen', { picture: b });
  ocr.close();

  const text = r => r.lines.map(l => l.text).join('\n');
  const height = first.rect.h;
  const reread = second.bands.reduce((n, [y0, y1]) => n + y1 - y0, 0);
  console.log(`page ${height}px high, ${first.lines.length} lines; whole read ${first.ms.total} ms`);
  console.log(`after changing paragraph 3: ${second.bands.length} band(s) re-read, ` +
    `${reread}px of ${height}px (${Math.round(100 * reread / height)}%), ${second.ms.total} ms`);
  console.log(`result equals reading the new page whole: ${text(second) === text(whole) ? 'yes' : 'NO'}`);
  if (text(second) !== text(whole)) console.log('incremental:\n' + text(second) + '\nwhole:\n' + text(whole));
}

async function screen() {
  const ocr = new OcrHelper();
  const { monitors, foreground } = await ocr.request('monitors');
  console.log('monitors:', monitors.map(m => `${m.w}×${m.h} at ${Math.round(m.scale * 100)}%`).join(', '),
    '| foreground window on monitor', foreground ? foreground.monitor : '?');
  const count = r => `${r.lines.length} lines, ${r.lines.reduce((n, l) => n + han(l.text).length, 0)} Chinese characters`;
  for (const scale of [1, 2]) {
    await ocr.request('forget');
    const full = await ocr.request('screen', { scale });
    console.log(`×${scale} whole screen: ${count(full)}; ms`, full.ms);
    const again = await ocr.request('screen', { scale });
    console.log(`×${scale} again, incremental: changed=${again.changed}` +
      (again.changed ? `, ${again.bands.length} band(s), ${count(again)}` : '') + '; ms', again.ms);
  }
  ocr.close();
}

const run = process.argv.includes('--screen') ? screen
  : process.argv.includes('--incremental') ? incremental : accuracy;
run().catch(e => { console.error(e.message); process.exit(1); });
