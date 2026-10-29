/* pinyin.js — Chinese characters from pinyin, offline, as a simple input method does.
 *
 * The translator (site/translate.js) takes pinyin as well as English and characters.
 * With an API key Claude works out the characters from context; without one, this
 * does: the pinyin is cut into syllables, with tone numbers (ni3hao3), tone marks
 * (nǐ hǎo) or no tones at all (ni hao), and every way of grouping the syllables into
 * dictionary words is scored, the likeliest winning, as the reader's segmenter
 * (textstory.js) cuts characters: each word costs minus the log of how often it is
 * used on its own in jieba's corpus (data/readerwords.js), so wo men is 我们 and xiang
 * qu is 想去 (想 + 去), not the rare 乡曲. A particle (吗, 呢, 吧, 啊) is likelier at
 * the end of a phrase than inside one, so ba there is 吧, not 把. A tone you typed has
 * to match. Without tones it is still a guess, and the translator says so: ta can be
 * 他, 她 or 它.
 *
 * toHanzi(text, HZ, Learn) -> {text, words: [{w, pin, alts: [{w, pin}]: the other
 * words those syllables could be, likeliest first]}, unknown: [syllables with no
 * character]}. Needs HZ.rwords (data/readerwords.js), HZ.readings (data/readings.js,
 * the characters' readings) and HZ.index; without the first two it falls back on the
 * characters' frequency ranks and HZ.words (data/words.js). Works in the browser
 * (window.Pinyin) and in Node. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Pinyin = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MARK = { '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 };
  const PUNCT = { '.': '。', ',': '，', '?': '？', '!': '！', ';': '；', ':': '：', '(': '（', ')': '）' };
  const MAX_WORD = 6;                         // syllables in the longest word looked for

  /* Costs, as minus a log probability. Without the corpus: a character's from its
     frequency rank, a word's from its place in the word list. Also: a word's or
     character's other readings 1.5 more; a neutral tone where a tone was typed 0.5
     more; a particle 3 less at the end of a phrase and 3 more inside one; a syllable no
     character has, 30. */
  const charCost = rank => 4 + Math.log(rank);
  const wordCost = i => 5 + Math.log(i + 1);
  const PARTICLE = 3, UNKNOWN = 30;

  /* A little context, from the word before (its part of speech, as jieba tags it): an
     adjective after 很, 太, 不 (很贵, not 很归); a noun after a measure word (三本书, not
     三本属); a verb after 我, 你, 他 (我想, not 我向). Choosing the best path one word
     at a time, this looks back one word only. */
  const DEGREE = /^(很|太|真|挺|非常|特别|比较|更|最|有点|不|没|也|都|好)$/;
  const MEASURE = /^(个|本|只|张|条|件|位|杯|瓶|辆|家|双|块|支|封|台|部|座|首|份|种|碗|斤|口|间|套|片|场|篇|句|门|节|盒|包|顿|根|颗|朵|棵|群|对)$/;
  function context(prev, x) {
    if (!prev) return 0;
    const t = x.tag || '';
    if (DEGREE.test(prev.w)) return /^a/.test(t) ? -2 : /^[vd]/.test(t) ? 0 : 1;
    if (MEASURE.test(prev.w)) return /^n/.test(t) ? -2 : 0;
    if ((prev.tag || '') === 'r') return /^v/.test(t) ? -1 : 0;
    return 0;
  }
  const ALTS = 5;                             // other choices kept for each word...
  const CLOSE = 2.5;                          // ...those at most this much costlier (about 12 times less likely)

  /* 'ni3', 'nǐ', 'ni' -> [{s, t}] (t: the tone typed, 0 for none); ü as v */
  function syllablesOf(chunk, Learn) {
    const out = [];
    const nfd = chunk.toLowerCase().replace(/u:/g, 'v').normalize('NFD');
    // runs of letters (with any tone marks), each optionally followed by a tone number
    for (const m of nfd.matchAll(/([a-z\u0300-\u036f]+)([1-5]?)/g)) {
      let letters = '';
      const marks = [];                       // marks[i]: the tone marked on letter i
      for (const ch of m[1]) {
        if (MARK[ch]) marks[letters.length - 1] = MARK[ch];
        else if (ch === '\u0308') letters = letters.slice(0, -1) + 'v';
        else if (/[a-z]/.test(ch)) letters += ch;
      }
      const syl = Learn.splitPinyin(letters);
      if (!syl) { out.push({ s: letters, t: 0, bad: true }); continue; }
      let at = 0;
      syl.forEach((s, k) => {
        const tone = marks.slice(at, at + s.length).find(Boolean) || 0;
        at += s.length;
        out.push({ s, t: k === syl.length - 1 && m[2] ? +m[2] : tone });
      });
    }
    return out;
  }

  /* toneless syllables joined by spaces -> [{w, pin, tones, cost, particle}] */
  const _ix = new WeakMap();
  function index(HZ, Learn) {
    const have = _ix.get(HZ);
    if (have && have.lex === HZ.rwords && have.readings === HZ.readings) return have.map;
    const map = new Map();
    const add = (pin, w, cost, particle, tag = '') => {
      const syl = String(pin).trim().split(/\s+/).map(x => Learn.parsePinyin(x));
      if (syl.length !== [...w].length || syl.some(x => !x.letters)) return;
      const key = syl.map(x => x.letters).join(' ');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ w, pin, tones: syl.map(x => x.tones[0] || 5), cost, particle, tag });
    };
    const charReadings = c => (HZ.readings && HZ.readings[c] ? HZ.readings[c].map(r => r[0]) : [(HZ.index[c] || [])[2]]).filter(Boolean);
    if (HZ.rwords) {
      // the corpus: every word, and every character used as a word on its own
      const total = HZ.rwordsTotal;
      for (const [w, e] of Object.entries(HZ.rwords)) {
        const cost = -Math.log((e[0] || 1) / total), particle = e[1] === 'y';
        const pins = [...w].length > 1 ? (e[2] || []).map(r => r[0]) : charReadings(w);
        pins.forEach((pin, k) => add(pin, w, cost + 1.5 * k, particle, e[1] || ''));
      }
      // characters it never saw alone
      for (const [c, e] of Object.entries(HZ.index)) {
        if (e[0] && !HZ.rwords[c]) charReadings(c).forEach((pin, k) => add(pin, c, 16 + Math.log(e[0]) + 1.5 * k, false));
      }
    } else {
      (HZ.words || []).forEach((e, i) => add(e[2], e[0], wordCost(i), false));
      for (const [c, e] of Object.entries(HZ.index)) {
        if (e[0]) charReadings(c).forEach((pin, k) => add(pin, c, charCost(e[0]) + 1.5 * k, false));
      }
    }
    _ix.set(HZ, { lex: HZ.rwords, readings: HZ.readings, map });
    return map;
  }

  /* the cheapest words for a run of syllables (between punctuation) */
  function convertRun(syl, map) {
    const n = syl.length, best = [{ cost: 0, words: [] }];
    for (let i = 0; i < n; i++) {
      if (!best[i]) continue;
      for (let j = i + 1; j <= Math.min(n, i + MAX_WORD); j++) {
        const part = syl.slice(i, j);
        if (part.some(x => x.bad)) {
          if (j === i + 1) step(i, j, { w: part[0].s, pin: part[0].s, unknown: true }, UNKNOWN);
          break;
        }
        let found = false;
        for (const x of map.get(part.map(p => p.s).join(' ')) || []) {
          let extra = 0, fits = true;
          part.forEach((p, k) => {
            if (!p.t || p.t === x.tones[k]) return;
            if (x.tones[k] === 5) extra += 0.5; else fits = false;
          });
          if (x.particle) extra += j === n ? -PARTICLE : PARTICLE;
          if (fits) { step(i, j, x, x.cost + extra, part); found = true; }
        }
        if (!found && j === i + 1) step(i, j, { w: part[0].s, pin: part[0].s, unknown: true }, UNKNOWN);
      }
    }
    return best[n].words;

    function step(i, j, x, cost, part) {
      const prev = best[i].words[best[i].words.length - 1];
      const c = best[i].cost + cost + (x.unknown ? 0 : context(prev, x));
      if (!best[j] || c < best[j].cost) {
        best[j] = { cost: c, words: best[i].words.concat({ w: x.w, pin: x.pin, tag: x.tag, unknown: !!x.unknown, part }) };
      }
    }
  }

  /* the other words a run of syllables could likely be, likeliest first (for choosing
     another): none for 我, whose other wo (握, 窝) are far rarer; 借 for 接 */
  function alternatives(part, map, chosen) {
    if (!part) return [];
    const seen = new Set([chosen]), out = [];
    const fits = x => part.every((p, k) => !p.t || p.t === x.tones[k] || x.tones[k] === 5);
    const all = (map.get(part.map(p => p.s).join(' ')) || []).filter(fits).sort((a, b) => a.cost - b.cost);
    const mine = all.find(x => x.w === chosen);
    for (const x of all) {
      if (seen.has(x.w) || (mine && x.cost > mine.cost + CLOSE)) continue;
      seen.add(x.w);
      out.push({ w: x.w, pin: x.pin });
      if (out.length >= ALTS) break;
    }
    return out;
  }

  function toHanzi(text, HZ, Learn) {
    const map = index(HZ, Learn);
    const words = [], unknown = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      for (const x of convertRun(run, map)) {
        if (x.unknown) unknown.push(x.w);
        words.push({ w: x.w, pin: x.pin, alts: x.unknown ? [] : alternatives(x.part, map, x.w) });
      }
      run = [];
    };
    // runs of pinyin (letters, tone marks, tone numbers; an apostrophe or space ends one,
    // as in xi'an), and the punctuation between them
    for (const m of String(text).matchAll(/([A-Za-z\u00C0-\u024F\u0300-\u036f:1-5]+)|([^\sA-Za-z0-9'’-])/g)) {
      if (m[1]) run.push(...syllablesOf(m[1], Learn));
      else { flush(); words.push({ w: PUNCT[m[2]] || m[2], pin: '' }); }
    }
    flush();
    return { text: words.map(x => x.w).join(''), words, unknown };
  }

  return { toHanzi, syllablesOf };
});
