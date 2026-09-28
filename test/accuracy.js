/* Score site/textstory.js against the hand-glossed graded stories.
 *
 * Every story in site/data/stories.js was split into words and glossed by hand.
 * Here each story's text is put back together without the spaces, handed to
 * textToStory() as if it were any text, and the result is compared with the
 * hand-made version:
 *
 *   words     how many hand-split words the engine found exactly; and how many
 *             it cut across (a boundary in the middle of a word). Cutting
 *             一个 into 一 个 is a matter of taste; cutting 学校 into 学 校 is not.
 *   pinyin    each character's syllable, with tones and without
 *   meaning   for words the engine found exactly: does its meaning share a
 *             content word with the hand-written one? Reported for all words;
 *             for words not in build/stories/lexicon.txt (the engine uses that
 *             hand-written list, so those words match by construction); and for
 *             the characters whose meaning depends on the sentence (了, 还, 得 …
 *             the STORY_ONLY list of build_stories.py, never in the lexicon).
 *
 * The last story of each HSK level is held out: rules are written while looking
 * at the other 18 (the "dev" set), and the held-out six show whether they
 * carry over to text they were not written for.
 *
 *   node test/accuracy.js              scores
 *   node test/accuracy.js --errors     plus the dev set's mistakes, most common first
 *   node test/accuracy.js --tune       search the scoring parameters on the dev set
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const TextStory = require('../site/textstory.js');

const DATA = path.join(__dirname, '..', 'site', 'data');
const ctx = { HZ: { chunk: {}, phoneticSets: {} } };
vm.createContext(ctx);
for (const f of ['index', 'words', 'readings', 'stories']) {
  vm.runInContext(fs.readFileSync(path.join(DATA, f + '.js'), 'utf8'), ctx);
}
const HZ = ctx.HZ;

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const norm = s => String(s || '').toLowerCase().replace(/ü/g, 'v').trim();
const toneless = s => norm(s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

const CONTEXTUAL = new Set(('了 着 过 得 地 的 还 要 会 就 才 都 又 对 给 让 把 被 为 跟 打 开 上 下 ' +
  '出 起 来 去 到 走 看 想 好 长 只 行 发 觉 教 空 数 种 重 调 便 干 倒 差 场 当 应 相 转 背 分 正 ' +
  '点 头 面 家 在 和 没 多 少 张 本 天 里 中').split(' '));

const STOP = new Set(('a an the of to be is are am in on at for and or with by as it its one ' +
  'someone something etc sb sth').split(' '));
const content = g => new Set(String(g).toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/)
  .filter(w => w && !STOP.has(w)));
const allWords = g => new Set(String(g).toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/).filter(Boolean));
function sameSense(a, b) {
  let A = content(a), B = content(b);
  // "in" or "at; in; on" is nothing but small words: compare those instead
  if (!A.size || !B.size) { A = allWords(a); B = allWords(b); }
  if (!A.size || !B.size) return norm(a) === norm(b);
  for (const w of A) if (B.has(w)) return true;
  return false;
}

/* a story -> its text, and the hand-made words as spans over that text */
function gold(st) {
  let text = '';
  const words = [];
  st.seg.forEach((par, pi) => {
    if (pi) text += '\n';
    for (const tk of par) {
      if (tk.br) continue;
      if (typeof tk !== 'string') { text += tk.s; continue; }
      const [w, pin, gloss] = st.g[tk];
      const start = [...text].length;
      text += w;
      words.push({ start, end: start + [...w].length, w, pin, gloss, sylls: sylls(w, pin) });
    }
  });
  return { text, words };
}

function sylls(w, pin) {
  const n = [...w].filter(isHan).length;
  let s = String(pin).split(/\s+/).filter(Boolean);
  if (s.length === n - 1 && s.length && /r$/.test(s[s.length - 1])) s = [...s.slice(0, -1), s[s.length - 1].slice(0, -1), 'r'];
  return s;
}

/* the engine's story -> the same kind of spans */
function engine(text) {
  const st = TextStory.textToStory(text, HZ);
  const words = [];
  let pos = 0;
  st.seg.forEach((par, pi) => {
    if (pi) pos += 1;
    for (const tk of par) {
      if (tk.br) continue;
      if (typeof tk !== 'string') { pos += [...tk.s].length; continue; }
      const e = st.g[tk];
      const len = [...e[0]].length;
      words.push({ start: pos, end: pos + len, w: e[0], pin: e[1], gloss: e[2], alt: (e[4] || {}).alt, sylls: sylls(e[0], e[1]) });
      pos += len;
    }
  });
  return words;
}

function score(stories, errors) {
  const t = { gold: 0, found: 0, exact: 0, crossed: 0, chars: 0, pin: 0, pinTl: 0,
              mean: 0, meanN: 0, meanX: 0, meanXN: 0, ctx: 0, ctxN: 0, ctxRead: 0 };
  for (const st of stories) {
    const G = gold(st), E = engine(G.text);
    t.gold += G.words.length; t.found += E.length;
    const eBy = new Map(E.map(e => [e.start + ':' + e.end, e]));
    const eStarts = new Set(E.map(e => e.start)), eEnds = new Set(E.map(e => e.end));

    const charPin = new Map();          // text offset -> engine syllable
    E.forEach(e => e.sylls.forEach((s, i) => charPin.set(e.start + i, s)));

    for (const g of G.words) {
      const e = eBy.get(g.start + ':' + g.end);
      if (e) t.exact++;
      else {
        // crossed: an engine word starts or ends strictly inside this word, and
        // this word is not simply split into smaller words the engine also found
        const inner = [];
        for (let i = g.start + 1; i < g.end; i++) if (eStarts.has(i) || eEnds.has(i)) inner.push(i);
        const nested = E.some(x => x.start <= g.start && x.end >= g.end);
        const splitClean = eStarts.has(g.start) && eEnds.has(g.end);
        if (!nested && !splitClean) t.crossed++;
        if (errors) errors.seg[g.w + ' ⟂ ' + E.filter(x => x.end > g.start && x.start < g.end).map(x => x.w).join(' ')] =
          (errors.seg[g.w + ' ⟂ ' + E.filter(x => x.end > g.start && x.start < g.end).map(x => x.w).join(' ')] || 0) + 1;
      }
      g.sylls.forEach((s, i) => {
        t.chars++;
        const mine = charPin.get(g.start + i) || '';
        if (norm(mine) === norm(s)) t.pin++;
        else if (errors) {
          const k = [...g.w][i] + ' ' + s + ' → ' + mine + '  (in ' + g.w + ')';
          errors.pin[k] = (errors.pin[k] || 0) + 1;
        }
        if (toneless(mine) === toneless(s)) t.pinTl++;
      });
      if (e) {
        t.meanN++;
        const ok = sameSense(e.gloss, g.gloss);
        if (ok) t.mean++;
        if (!HZ.lexicon[g.w]) { t.meanXN++; if (ok) t.meanX++; }
        if ([...g.w].length === 1 && CONTEXTUAL.has(g.w)) {
          t.ctxN++;
          if (ok) t.ctx++;
          if (norm(e.pin) === norm(g.pin)) t.ctxRead++;
        }
        if (!ok && errors) {
          const k = g.w + ': "' + g.gloss + '" → "' + e.gloss + '"';
          errors.mean[k] = (errors.mean[k] || 0) + 1;
        }
      }
    }
  }
  return t;
}

const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';

function report(name, t) {
  const P = t.exact / t.found, R = t.exact / t.gold;
  console.log(`${name.padEnd(9)} words: ${pct(t.exact, t.gold)} found exactly (F1 ${(2 * P * R / (P + R) * 100).toFixed(1)}), ` +
    `${pct(t.crossed, t.gold)} cut across`);
  console.log(`${''.padEnd(9)} pinyin: ${pct(t.pin, t.chars)} of characters (${pct(t.pinTl, t.chars)} ignoring tones)`);
  console.log(`${''.padEnd(9)} meaning: ${pct(t.mean, t.meanN)} of words; context-dependent characters ` +
    `${pct(t.ctx, t.ctxN)} (reading ${pct(t.ctxRead, t.ctxN)}, n=${t.ctxN})`);
  console.log(`${''.padEnd(9)}          ${pct(t.meanX, t.meanXN)} of words outside the lexicon (n=${t.meanXN})`);
}

const byLevel = {};
HZ.stories.forEach(s => (byLevel[s.l] = byLevel[s.l] || []).push(s));
const held = new Set(Object.values(byLevel).map(l => l[l.length - 1].id));
const dev = HZ.stories.filter(s => !held.has(s.id));
const hold = HZ.stories.filter(s => held.has(s.id));

if (process.argv.includes('--tune')) {
  const P = TextStory.params;
  let best = null;
  for (const A of [-6, -5, -4, -3, -2]) for (const B of [0, 2, 5, 10, 20]) for (const C of [0.5, 1, 2, 4, 8]) {
    Object.assign(P, { WORD_A: A, WORD_B: B, CHAR_ALONE: C });
    const t = score(dev);
    const f = t.exact / t.gold - 2 * t.crossed / t.gold;   // a cut through a word costs more than a coarser split
    if (!best || f > best.f) best = { f, A, B, C, exact: pct(t.exact, t.gold), crossed: pct(t.crossed, t.gold) };
  }
  console.log('best on dev:', best);
  process.exit(0);
}

/* --show 上: every dev-set sentence where the hand-made word is 上, with both glosses */
const showAt = process.argv.indexOf('--show');
if (showAt > 0) {
  const want = process.argv[showAt + 1];
  for (const st of dev) {
    const G = gold(st), E = engine(G.text), chars = [...G.text];
    const eBy = new Map(E.map(e => [e.start + ':' + e.end, e]));
    for (const g of G.words) {
      if (g.w !== want) continue;
      const e = eBy.get(g.start + ':' + g.end);
      const ok = e && norm(e.pin) === norm(g.pin) && sameSense(e.gloss, g.gloss);
      console.log(`${ok ? '  ' : '✗ '}${chars.slice(Math.max(0, g.start - 12), g.start).join('')}【${g.w}】` +
        `${chars.slice(g.end, g.end + 10).join('')}`.replace(/\n/g, ' ') +
        `\n    hand: ${g.pin} ${g.gloss}\n    mine: ${e ? e.pin + ' ' + e.gloss : '(split differently)'}`);
    }
  }
  process.exit(0);
}

const errors = process.argv.includes('--errors') ? { seg: {}, pin: {}, mean: {} } : null;
console.log(`dev = ${dev.length} stories, held out = ${hold.map(s => s.id).join(' ')}\n`);
report('dev', score(dev, errors));
report('held out', score(hold));

if (errors) {
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `  ${c}× ${k}`).join('\n');
  console.log('\nwords (hand ⟂ engine):\n' + top(errors.seg, 60));
  console.log('\npinyin (hand → engine):\n' + top(errors.pin, 50));
  console.log('\nmeaning (hand → engine):\n' + top(errors.mean, 80));
}
