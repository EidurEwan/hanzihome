/* layout.js — OCR lines -> the text the reader is given.
 *
 * OCR returns what it sees line by line, so one wrapped paragraph comes back as
 * several lines, which the reader would show as several paragraphs. A line joins
 * the one above when it starts just below it, roughly under its left edge, and
 * the line above ran on to the paragraph's right edge (a short line ends one).
 *
 * OCR also reads full-width punctuation as ASCII: “ ” as " or ', ： as :, ， as ,.
 * In Chinese text they are put back, so the reader's dialogue layout (a new line
 * for each speaker) sees the quotation marks it looks for.
 */

'use strict';

const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const hasHan = s => [...s].some(isHan);

const GAP = 0.9;       // lines further apart than this many line heights: new paragraph
const INDENT = 2.5;    // a continuing line starts within this many character widths

/* ASCII punctuation next to Chinese -> full-width. Quotation marks alternate
   open, close within a paragraph, since OCR reads ” as “ (or ") about as often
   as it gets it right. */
function punctuate(text) {
  const cs = [...text];
  const cjk = x => !!x && (isHan(x) || /[，。！？：；、“”]/.test(x));
  let open = false;
  return cs.map((c, i) => {
    const near = cjk(cs[i - 1]) || cjk(cs[i + 1]);
    if (c === '“' || c === '”' || c === '"' || (c === '\'' && near)) {
      open = !open;
      return open ? '“' : '”';
    }
    if (!near) return c;
    return { ':': '：', ',': '，', ';': '；', '!': '！', '?': '？' }[c] || c;
  }).join('');
}

/* lines ({text, x, y, w, h}) -> paragraphs of text, Chinese lines only */
function paragraphs(lines) {
  // reading order: rows top to bottom (pieces of one row can differ in y by a
  // pixel or two), each row left to right
  const byY = lines.filter(l => hasHan(l.text)).sort((a, b) => a.y - b.y);
  const rows = [];
  for (const l of byY) {
    const row = rows[rows.length - 1];
    if (row && l.y < row[0].y + row[0].h * 0.5) row.push(l);
    else rows.push([l]);
  }
  const han = [].concat(...rows.map(r => r.sort((a, b) => a.x - b.x)));
  const paras = [];
  let cur = null;
  for (const l of han) {
    const last = cur && cur.lines[cur.lines.length - 1];
    // OCR can split one row in two (often at a quotation mark): the rest of the row
    const sameRow = last && l.y < last.y + last.h * 0.6 && l.x >= last.x + last.w - last.h;
    const nextRow = last
      && l.y - (last.y + last.h) < GAP * last.h
      && Math.abs(l.x - cur.left) < INDENT * last.h
      && last.x + last.w >= Math.max(cur.right, l.x + l.w) - 1.5 * last.h;
    const joins = sameRow || nextRow;
    if (joins) {
      cur.lines.push(l);
      cur.right = Math.max(cur.right, l.x + l.w);
    } else {
      cur = { lines: [l], left: l.x, right: l.x + l.w };
      paras.push(cur);
    }
  }
  return paras.map(p => punctuate(p.lines.map(l => l.text).join('')));
}

/* lines read directly from a program (desktop/ocr/TextReader.cs), each numbered
   with its paragraph (p) -> paragraphs of text, Chinese ones only. No guessing
   from where lines sit: the program says where its paragraphs end, and its
   punctuation is already right. */
function directParagraphs(lines) {
  const paras = [];
  let cur = null, at = null;
  for (const l of lines) {
    if (cur === null || l.p !== at) { cur = []; paras.push(cur); at = l.p; }
    cur.push(l.text);
  }
  const latin = c => /[A-Za-z0-9]/.test(c || '');
  // a line that wrapped between two English words had its space at the break
  const join = ts => ts.reduce((s, t) => s + (latin(s.slice(-1)) && latin(t[0]) ? ' ' : '') + t, '');
  return paras.map(join).filter(hasHan);
}

module.exports = { paragraphs, directParagraphs, punctuate };
