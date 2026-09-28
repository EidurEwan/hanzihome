/* ocrfix.js — undo the mistakes Windows OCR makes most often with Chinese.
 *
 * desktop/test/ocr.js shows three kinds, and this undoes each:
 *
 *   1. A character read as its two halves: 你 as 亻 尔, 洗 as 氵 先. The first half
 *      is narrow and the two together are about one character wide, where two real
 *      characters are each about as wide as the line is high. When two neighbours
 *      look like that and desktop/data/ocrpairs.json names the character they make,
 *      they become that character.
 *   2. 儿 read as 丿 and a Latin b or L (its hook looks like one), or as a lone
 *      narrow 丿.
 *   3. Look-alikes (学/字, 已/己, 着/看): swapped when the swap makes the text
 *      around them far likelier Chinese, by TextStory.logProb, than it was. The
 *      margin is set so that correct text is left alone (desktop/test/ocr.js
 *      checks that too).
 *
 * Works on the helper's lines ({text, x, y, w, h, chars: [{t, x, y, w, h}]}) and
 * returns new ones, with the boxes of merged characters joined.
 */

'use strict';

const TextStory = require('../../site/textstory.js');
const PAIRS = require('../data/ocrpairs.json');

const P = {
  NARROW: 0.62,     // a half is narrower than this share of a character
  ONE_CHAR: 1.35,   // two halves together are no wider than this
  MARGIN: 6,        // look-alike swap: this much likelier (log, e^6 ≈ 400×)
  WINDOW: 4,        // characters either side weighed with a swap
};

const LOOKALIKE = {};
for (const group of ['学字', '已己巳', '大太犬', '看着', '里黑', '未末', '土士', '入人八', '日曰',
  '千干于', '点占', '说兑', '找我', '候侯', '间问', '儿几']) {
  for (const c of group) LOOKALIKE[c] = [...group].filter(o => o !== c);
}

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const isLatin = c => /[A-Za-z0-9]/.test(c);
// the hook of 儿 as OCR reads it
const HOOK = new Set(['b', 'L', 'l', '乚', '⺃']);

function median(xs) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

const join = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

function textOf(chars) {
  let s = '';
  chars.forEach((c, i) => {
    if (i && isLatin(chars[i - 1].t.slice(-1)) && isLatin(c.t[0])) s += ' ';
    s += c.t;
  });
  return s;
}

function repairLine(line, HZ, fixes) {
  const chars = line.chars.map(c => Object.assign({}, c));
  // a full character is about as wide as the line's typical Chinese character
  const full = median(chars.filter(c => isHan(c.t)).map(c => c.w)) || line.h;

  // 1-2: halves and 儿
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const a = chars[i], b = chars[i + 1];
    const narrow = a.w < full * P.NARROW && isHan(a.t);
    if (narrow && b && b.x + b.w - a.x <= full * P.ONE_CHAR) {
      const second = a.t === '丿' && HOOK.has(b.t) ? '⺃' : b.t;
      const whole = PAIRS[a.t + second];
      if (whole) {
        fixes.push(a.t + b.t + '→' + whole);
        out.push(Object.assign({ t: whole }, join(a, b)));
        i++;
        continue;
      }
    }
    if (narrow && a.t === '丿') {
      fixes.push('丿→儿');
      out.push(Object.assign({}, a, { t: '儿' }));
      continue;
    }
    out.push(a);
  }

  // 3: look-alikes, judged by how likely the text around them reads
  for (let i = 0; i < out.length; i++) {
    const alts = LOOKALIKE[out[i].t];
    if (!alts) continue;
    const lo = Math.max(0, i - P.WINDOW), hi = Math.min(out.length, i + P.WINDOW + 1);
    const around = t => out.slice(lo, hi).map((c, k) => lo + k === i ? t : c.t).join('');
    const base = TextStory.logProb(around(out[i].t), HZ);
    let best = null, bestGain = P.MARGIN;
    for (const alt of alts) {
      const gain = TextStory.logProb(around(alt), HZ) - base;
      if (gain > bestGain) { best = alt; bestGain = gain; }
    }
    if (best) {
      fixes.push(out[i].t + '→' + best);
      out[i] = Object.assign({}, out[i], { t: best });
    }
  }

  return Object.assign({}, line, { chars: out, text: textOf(out) });
}

/* lines from the OCR helper -> {lines, fixes}; fixes lists what changed ("亻尔→你") */
function repair(lines, HZ) {
  const fixes = [];
  return { lines: lines.map(l => repairLine(l, HZ, fixes)), fixes };
}

module.exports = { repair, params: P };
