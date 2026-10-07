/* words.js — OCR lines -> words with boxes, and the colour each word gets.
 *
 * Each line is split into words by the reader's engine (TextStory.segment), and a
 * word's box is the union of its characters' boxes. The colour follows the
 * reader's wordState() in site/app.js: learned when every character is learned,
 * learning when any character is marked at all, new otherwise. A traditional
 * character counts with its simplified form's status, since that is what gets
 * marked.
 */

'use strict';

const TextStory = require('../../site/textstory.js');
const { repair } = require('./ocrfix');

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };

/* one OCR line -> [{text, x, y, w, h}] for its Chinese words, in the line's coordinates */
function wordsOf(line, HZ) {
  // which character box each code point of the line's text came from
  const owner = [];
  let text = '';
  line.chars.forEach((c, i) => { for (const cp of c.t) { owner.push(i); text += cp; } });
  const tokens = TextStory.segment(text, HZ)[0] || [];
  const out = [];
  let pos = 0;
  for (const tok of tokens) {
    const s = typeof tok === 'string' ? tok : tok.s;
    const n = [...s].length;
    if (typeof tok === 'string') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of new Set(owner.slice(pos, pos + n))) {
        const c = line.chars[i];
        x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
        x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
      }
      out.push({ text: tok, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    pos += n;
  }
  return out;
}

/* a word's colour: 'learned', 'learning' or 'new' (null: nothing to colour) */
function stateOf(word, status, HZ, wstatus) {
  const t2s = HZ.t2s || {};
  const known = c => HZ.index[c] || HZ.index[t2s[c]];
  const cs = [...word].filter(c => isHan(c) && known(c));
  if (!cs.length) return null;
  // a word marked as a word (or learnt in the lessons) says so itself
  if (cs.length > 1 && wstatus) {
    const own = wstatus[word] || wstatus[[...word].map(c => t2s[c] || c).join('')];
    if (own) return own;
  }
  const st = c => status[c] || status[t2s[c]] || null;
  if (cs.every(c => st(c) === 'learned')) return 'learned';
  if (cs.some(c => st(c))) return 'learning';
  return 'new';
}

/* the OCR helper's lines -> repaired, split into words, boxes mapped by toGlobal
   (helper pixels -> global DIP); each word knows its line and its place among the
   line's words, so hover.js can gloss it in the context of its line */
function wordsFromLines(lines, HZ, toGlobal) {
  // lines read straight from a program ("src": "uia") are exact; only the OCR's
  // need repairing
  const direct = lines.filter(l => l.src === 'uia');
  const read = repair(lines.filter(l => l.src !== 'uia'), HZ).lines;
  const out = [];
  for (const line of direct.concat(read)) {
    wordsOf(line, HZ).forEach((w, index) => out.push(Object.assign(w, toGlobal(w), { line, index })));
  }
  return out;
}

module.exports = { wordsOf, stateOf, wordsFromLines };
