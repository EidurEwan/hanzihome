/* textstory.js — turn any Chinese text into what the story reader draws.
 *
 * The graded stories carry a hand-written glossary: every word has the reading
 * and meaning it has in that sentence. textToStory() builds the same thing for
 * text nobody glossed, from the dictionary alone, offline:
 *
 *   1. split the text into words: every way of cutting a run of characters into
 *      dictionary words is scored and the most probable one wins, as jieba does;
 *   2. regroup the way the stories do (一 个, not 一个; 二十八 as one number);
 *   3. give each word its reading and meaning. A word of two or more characters
 *      brings its own pinyin, which settles polyphones (银行 háng, 进行 xíng).
 *      A character standing alone is where context matters (了, 还, 得, 只 …):
 *      those go through the rules in SINGLE, which look at the words around it,
 *      and name a second sense when they cannot tell.
 *
 * The output has the shape of an entry in stories.js — {seg, g, v, c, n} — so
 * the reader's drawing code works on it unchanged. Each glossary entry may carry
 * a fifth element {alt, s}: other likely senses, and the simplified form of a
 * word written in traditional characters.
 *
 * Needs HZ.index, HZ.words and HZ.readings (data/readings.js). Works in the
 * browser (window.TextStory) and in Node (require), which is how
 * test/accuracy.js scores it against the hand-glossed stories. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TextStory = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };

  /* Scoring. A dictionary word at frequency rank r (words.js is in rank order)
     gets log P = WORD_A - ln(r + WORD_B): Zipf's law standing in for the corpus
     counts, which the static data does not carry. A character on its own gets
     its share of running text scaled down by CHAR_ALONE, since most of a
     character's uses are inside longer words. Tuned with test/accuracy.js --tune. */
  const P = { WORD_A: -4, WORD_B: 2, CHAR_ALONE: 1, UNKNOWN: -22 };
  const MAX_WORD = 8;

  const NUMERAL = '零〇一二三四五六七八九十百千万亿两';
  const DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const UNIT = { '十': 10, '百': 100, '千': 1000 };
  const BIG = { '万': 1e4, '亿': 1e8 };
  // words that count or point at something: a measure word follows them
  const COUNTER = NUMERAL + '几这那哪每半某整';
  const PRONOUN = new Set('我 你 您 他 她 它 我们 你们 他们 她们 它们 咱们 大家 自己 别人 人家'.split(' '));
  const VEHICLE = /^(车|公交车|公共汽车|汽车|出租车|地铁|火车|飞机|船|高铁|电车|车子)$/;

  /* ---------------------------------------------------------------- data */

  const _prepared = new WeakMap();

  function prepare(HZ) {
    let D = _prepared.get(HZ);
    if (D && D.words === HZ.words) return D;
    const rank = new Map();
    HZ.words.forEach((w, i) => {
      if (!rank.has(w[0])) rank.set(w[0], i);
      if (w[1] && !rank.has(w[1])) rank.set(w[1], i);
    });
    D = { HZ, words: HZ.words, rank, readings: HZ.readings || {}, t2s: HZ.t2s || {},
          lexicon: HZ.lexicon || {}, charGloss: HZ.charGloss || {} };
    _prepared.set(HZ, D);
    return D;
  }

  const simp = (D, c) => D.t2s[c] || c;
  const readingsOf = (D, c) => D.readings[c] || D.readings[simp(D, c)] || [];

  function charLogP(D, c) {
    const e = D.HZ.index[c] || D.HZ.index[simp(D, c)];
    if (!e || !e[1]) return P.UNKNOWN;
    return Math.log(e[1] / 100 * P.CHAR_ALONE);
  }
  const wordLogP = r => P.WORD_A - Math.log(r + P.WORD_B);

  /* ------------------------------------------------------------ segmenting */

  /* the most probable way to cut one run of Chinese characters into words */
  function cutRun(D, cs) {
    const n = cs.length, best = new Array(n + 1);
    best[n] = [0, n];
    for (let i = n - 1; i >= 0; i--) {
      best[i] = [charLogP(D, cs[i]) + best[i + 1][0], i + 1];
      for (let L = 2; L <= MAX_WORD && i + L <= n; L++) {
        const r = D.rank.get(cs.slice(i, i + L).join(''));
        if (r === undefined) continue;
        const s = wordLogP(r) + best[i + L][0];
        if (s > best[i][0]) best[i] = [s, i + L];
      }
    }
    const out = [];
    for (let i = 0; i < n; i = best[i][1]) out.push(cs.slice(i, best[i][1]).join(''));
    return out;
  }

  const isNumeral = w => w.length > 0 && [...w].every(c => NUMERAL.includes(c));
  const isCounter = w => !!w && [...w].every(c => COUNTER.includes(c));

  function classifierSense(D, c) {
    for (const [p, ms] of readingsOf(D, c)) {
      const m = ms.find(x => /^\(?classifier\b/i.test(x));
      if (m) return [p, m];
    }
    return null;
  }

  /* Regroup to match the stories: a number or 这/那 is its own word before a
     measure word (一 个, 这 只, 每 天), 不 is its own word before a verb (不 是,
     不 会), a number written out in characters is one word (十一, 二十八,
     一九五二), and a doubled character is one word (看看, 慢慢). */
  function regroup(D, words) {
    const out = [];
    for (const w of words) {
      const cs = [...w];
      if (cs.length === 2 && !KEEP_WHOLE.has(w)
          && (isCounter(cs[0]) && (classifierSense(D, cs[1]) || cs[1] === '天' || cs[1] === '年')
              || cs[0] === '不' && NOT_BEFORE.includes(cs[1]))) {
        out.push(cs[0], cs[1]);
      } else out.push(w);
    }
    const merged = [];
    for (const w of out) {
      const last = merged[merged.length - 1];
      if (last && isNumeral(last) && isNumeral(w) && !(last === '一' && w === '一')) merged[merged.length - 1] = last + w;
      else if (last && w.length === 1 && last === w && !isNumeral(w) && isHan(w)) merged[merged.length - 1] = last + w;
      else if (last && w === '儿' && D.rank.has(last + w)) merged[merged.length - 1] = last + w;
      else merged.push(w);
    }
    return merged;
  }
  // counter + measure word pairs that are words in their own right
  const KEEP_WHOLE = new Set('一些 一点 一下 一切 一样 一起 一直 一定 一般 一边 一面 一会 一口 一时 一度 一头 一旦 一番 一阵 一身 一手 一路 一眼 这些 那些 哪些 这样 那样 这么 那么 这里 那里 哪里 这边 那边 这儿 那儿 哪儿 这种 那种 半天 整天 几乎 两边 整个 一块 一个个 今天 明天 昨天 天天 今年 明年 去年'.split(' '));
  // 不 + one of these is two words; 不过, 不同, 不错, 不用 … stay whole
  const NOT_BEFORE = '是会能要怕想敢肯在去来说看';

  /* text -> paragraphs of tokens: a Chinese word (string) or {s: other text} */
  function segment(D, text) {
    const paras = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const toks = [];
      let run = [];
      const flush = () => { if (run.length) { toks.push(...regroup(D, cutRun(D, run))); run = []; } };
      for (const c of line) {
        if (isHan(c)) { run.push(c); continue; }
        flush();
        toks.push({ s: c });
      }
      flush();
      paras.push(toks);
    }
    return paras;
  }

  /* ------------------------------------------------------------- meanings */

  const XREF = /^((old|unofficial|archaic|Japanese)\s+)*(variant of|see |used in|abbr\. for|CL:|Taiwan pr\.|surname |also written)/i;

  // register labels say how a word is used, not what it means: "(coll.) father" -> "father"
  const REGISTER = /^\((coll\.|colloquial|formal|dialect|literary|old|written|archaic|onom\.|slang|polite|humble|honorific|informal)\)\s*/i;

  /* a dictionary definition -> its senses, cleaned, cross-references dropped */
  function senses(def) {
    const out = [];
    for (let d of String(def || '').split(/;\s*(?![^(]*\))/)) {
      d = d.replace('(bound form) ', '').replace(/\s*\(?CL:[^)]*\)?/g, '')
        .replace(/\S*\|\S*\[[^\]]*\]|\[[^\]]*\]/g, '').replace(/…$/, '').trim().replace(/^[;,\s]+|[;,\s]+$/g, '');
      const bare = d.replace(REGISTER, '');
      if (bare) d = bare;
      if (d && !XREF.test(d) && !out.includes(d)) out.push(d);
    }
    return out;
  }
  const clip = (s, limit) => s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';

  /* a dictionary definition -> a meaning short enough for a popup line */
  const shortGloss = (def, limit = 40) => clip(senses(def)[0] || '', limit);

  /* first sense, plus the second when both fit on a short line */
  function joinMeanings(ms, limit = 34) {
    const all = [].concat(...ms.map(senses));
    if (!all.length) return '';
    return all[1] && (all[0] + '; ' + all[1]).length <= limit ? all[0] + '; ' + all[1] : clip(all[0], limit);
  }

  const toneless = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ü/g, 'v').toLowerCase();
  // drop the tone mark but keep ü: 了 liǎo -> liao, 绿 lǜ -> lü (neutral tone)
  const neutral = s => s.normalize('NFD').replace(/[\u0300-\u0307\u0309-\u036f]/g, '').normalize('NFC').toLowerCase();

  /* what one character contributes to a longer word, given its syllable there.
     The hand-written chars.txt wins, looked up as build_stories.py does: this
     character in this word, then with this reading, then on its own. */
  function charInWord(D, c, syl, word) {
    const G = D.charGloss, same = h => h && toneless(h[0]) === toneless(syl);
    const hand = G[c + '@' + word] || [G[c + ' ' + syl], G[c]].find(same);
    if (hand) return [syl, hand[1]];
    const rs = readingsOf(D, c);
    const low = syl.toLowerCase();
    const row = rs.find(r => r[0].toLowerCase() === low)
      || rs.find(r => toneless(r[0]) === toneless(syl)) || rs[0];
    const g = row ? joinMeanings(row[1], 30) : '';
    const e = D.HZ.index[c] || D.HZ.index[simp(D, c)];
    return [syl, g || (e ? shortGloss(e[3], 30) : '')];
  }

  /* the pinyin of a dictionary word, one syllable per character */
  function syllables(pin, n) {
    let s = pin.split(/\s+/).filter(Boolean);
    // erhua: 这儿 is written zhèr, one syllable for two characters
    if (s.length === n - 1 && s.length && /r$/.test(s[s.length - 1])) s = [...s.slice(0, -1), s[s.length - 1].slice(0, -1), 'r'];
    return (s.concat(new Array(n).fill(''))).slice(0, n);
  }

  function numberValue(w) {
    const cs = [...w];
    // 三四 "three or four"; 一九五二 is a year read digit by digit
    if (cs.length === 2 && cs.every(c => c in DIGIT)) return DIGIT[cs[0]] + ' or ' + DIGIT[cs[1]];
    if (cs.length > 2 && cs.every(c => c in DIGIT)) return cs.map(c => DIGIT[c]).join('');
    let total = 0, section = 0, digit = 0;
    for (const c of cs) {
      if (c in DIGIT) digit = DIGIT[c];
      else if (c in UNIT) { section += (digit || 1) * UNIT[c]; digit = 0; }
      else if (c in BIG) { total += (section + digit) * BIG[c]; section = 0; digit = 0; }
    }
    return String(total + section + digit);
  }

  /* ---- context: what is around a single character ---- */

  function looksVerb(D, w) {
    if (!w) return false;
    if ([...w].length > 1) {
      const r = D.rank.get(w);
      return r !== undefined && /^to /.test(D.words[r][3]);
    }
    const rs = readingsOf(D, w);
    return !!(rs[0] && rs[0][1][0] && /^to /.test(rs[0][1][0]));
  }

  /* One rule per character that means different things in different places.
     Each gets the context and returns [pinyin, meaning] or [pinyin, meaning, alt]
     (alt: another sense worth showing), or nothing to fall back to the dictionary.
     Meanings are written for a learner, in the stories' style. */
  const SINGLE = {
    '了': x => {
      if ((x.prev === '得' || x.prev === '不') && x.end) return ['liǎo', '(can / can\'t manage it)'];
      if (x.end && x.before.includes('太')) return ['le', '(太…了: too …!)'];
      if (x.end && x.before.some(w => w === '不' || w === '没' || w === '没有' || w === '再')) return ['le', '(a new situation: no longer)'];
      if (x.end && !x.verb(x.prev)) return ['le', '(a new situation: now)'];
      return ['le', '(the action is done)', [['le', '(a new situation: now)']]];
    },
    '的': x => {
      if (x.end && x.before.includes('是')) return ['de', '(是…的: stresses who / when / how)'];
      if (x.end) return ['de', '(…的: the one / the thing that …)'];
      if (PRONOUN.has(x.prev)) return ['de', '\'s; of (belonging to)'];
      return ['de', '(links the description before it to the noun)'];
    },
    '地': x => (x.next && x.verb(x.next) && x.prev && !PRONOUN.has(x.prev))
      ? ['de', '(links a description to the verb: …ly)'] : ['dì', 'ground; floor; land'],
    '得': x => {
      // 我明天得去: before a verb, after a subject or time word. After a verb or a
      // one-character adjective it links to how (跑得快, 大得让人吃惊)
      if (x.next && x.verb(x.next) && !x.verb(x.prev)
          && (!x.prev || PRONOUN.has(x.prev) || [...x.prev].length > 1 || '就还也都总可'.includes(x.prev)))
        return ['děi', 'to have to; must'];
      if (x.prev && !PRONOUN.has(x.prev)) return ['de', '(links a verb to how, or how much)'];
      return ['dé', 'to get; to obtain'];
    },
    '着': x => {
      if ((x.prev === '睡' || x.prev === '找' || x.prev === '猜') && (x.end || x.next === '了')) return ['zháo', '(succeed in: 睡着 = fall asleep)'];
      return ['zhe', '(ongoing: …ing / is …ed)'];
    },
    '过': x => x.verb(x.prev) ? ['guo', '(have …ed before)'] : ['guò', 'to pass; to cross'],
    '把': x => isCounter(x.prev) ? ['bǎ', '(measure word for things with handles)'] : ['bǎ', '(把 moves the object before the verb)'],
    '被': x => x.verb(x.next) ? ['bèi', '(passive: to be …ed)'] : ['bèi', '(passive: by)'],
    '吧': x => x.nextText === '？' || x.nextText === '?'
      ? ['ba', '(…, right? checking a guess)'] : ['ba', '(suggestion: let\'s …)'],
    '吗': () => ['ma', '(turns it into a yes/no question)'],
    '呢': x => x.before.length <= 2 ? ['ne', '(what about …?)'] : ['ne', '(softens a question; is still …)'],
    '啊': () => ['a', '(adds feeling: ah; oh)'],
    '呀': () => ['ya', '(adds feeling: ah; oh)'],
    '嘛': () => ['ma', '(it\'s obvious: …, you know)'],
    '还': x => {
      if (x.next === '给' || x.before.includes('把') && x.end || x.prev === '不'
          || /^(钱|书|债|账|东西)$/.test(x.next || '')
          || PRONOUN.has(x.next) && x.next2 && !x.verb(x.next2) && !/^(还|也|都|就|不|没|在)/.test(x.next2))
        return ['huán', 'to give back'];
      if (/^(没|没有|在|是)$/.test(x.next || '')) return ['hái', 'still', [['hái', 'also']]];
      return ['hái', 'also; still', [['huán', 'to give back']]];
    },
    '只': x => isCounter(x.prev) ? ['zhī', '(measure word for animals)'] : ['zhǐ', 'only'],
    '长': x => (x.next === '大' || x.next === '高' || x.next === '出') ? ['zhǎng', 'to grow'] : ['cháng', 'long'],
    '上': x => {
      if (/^(个|次|周|星期|月|半年|回)$/.test(x.next || '')) return ['shàng', 'last (上个月 = last month)'];
      if (/^(大学|中学|小学|学|班|课|网)$/.test(x.next || '')) return ['shàng', 'to attend; to go to (school, work)'];
      if (x.prev && !x.verb(x.prev) && !isCounter(x.prev) && !PRONOUN.has(x.prev)) return ['shang', 'on; in'];
      if (x.verb(x.prev)) return ['shang', '(after a verb) up; on'];
      return ['shàng', 'to go up; to get on'];
    },
    '下': x => {
      if (/^(个|次|周|星期|月|半年|回)$/.test(x.next || '')) return ['xià', 'next (下个月 = next month)'];
      if (/^(雨|雪)$/.test(x.next || '')) return ['xià', 'to fall (of rain, snow)'];
      if (x.prev && !x.verb(x.prev) && !isCounter(x.prev) && !PRONOUN.has(x.prev)) return ['xià', 'under; below'];
      if (x.verb(x.prev)) return ['xià', '(after a verb) down'];
      return ['xià', 'down; to go down'];
    },
    '里': x => x.prev ? ['li', 'in; inside'] : ['lǐ', 'inside'],
    '在': x => x.verb(x.next) && !/^(家|这|那|哪)/.test(x.next) ? ['zài', '(in the middle of) -ing'] : ['zài', 'at; in; on'],
    '会': x => x.prev === '开' || isCounter(x.prev) ? ['huì', 'meeting'] : ['huì', 'can; will'],
    '要': x => {
      if (x.next && COUNTER.includes([...x.next][0])) return ['yào', 'to take (time); to need'];
      return x.verb(x.next) ? ['yào', 'to want to; to be going to'] : ['yào', 'to want; to need'];
    },
    '给': x => {
      if (x.verb(x.prev)) return ['gěi', 'to (someone)'];
      if (x.next && x.next2 && x.verb(x.next2)) return ['gěi', 'for; to (someone)'];
      return ['gěi', 'to give'];
    },
    '对': x => (x.end || /^(不|很|都|也|就)$/.test(x.prev || '')) ? ['duì', 'right; correct'] : ['duì', 'to; towards'],
    '和': () => ['hé', 'and; with'],
    '跟': x => x.verb(x.prev) ? ['gēn', 'to follow'] : ['gēn', 'with; and'],
    '没': x => x.verb(x.next) ? ['méi', 'not (did not)'] : ['méi', 'to not have; there is no'],
    '个': () => ['gè', '(general measure word)'],
    '一': () => ['yī', 'one; a'],
    '点': x => isNumeral(x.prev || '') && x.prev !== '一' ? ['diǎn', 'o\'clock'] : ['diǎn', 'a little; point'],
    '多': x => {
      if (isNumeral(x.prev || '')) return ['duō', 'more than (二十多 = twenty-odd)'];
      if (x.next && /^(大|远|久|长|高|少)$/.test(x.next)) return ['duō', 'how (多远 = how far)'];
      return ['duō', 'many; much; more'];
    },
    '家': x => isCounter(x.prev) ? ['jiā', '(measure word for shops, companies)'] : ['jiā', 'home; family'],
    '天': x => isCounter(x.prev) ? ['tiān', 'day'] : ['tiān', 'day; sky'],
    '去': x => x.verb(x.prev) ? ['qù', '(after a verb) away; there'] : ['qù', 'to go'],
    '来': x => x.verb(x.prev) ? ['lái', '(after a verb) here; toward me'] : ['lái', 'to come'],
    '到': x => x.verb(x.prev) ? ['dào', '(after a verb) to; reaching'] : ['dào', 'to arrive; to; until'],
    '好': x => {
      if (x.verb(x.prev)) return ['hǎo', '(after a verb) done; properly'];
      if (!x.prev && x.end) return ['hǎo', 'OK; all right'];
      return ['hǎo', 'good; well'];
    },
    '打': x => {
      if (/^(电话|手机)$/.test(x.next || '')) return ['dǎ', 'to make (a phone call)'];
      if (/^(车|的|出租车)$/.test(x.next || '')) return ['dǎ', 'to take (a taxi)'];
      if (/球$/.test(x.next || '')) return ['dǎ', 'to play (a ball game)'];
      return ['dǎ', 'to hit; to strike'];
    },
    '开': x => {
      if (VEHICLE.test(x.next || '')) return ['kāi', 'to drive'];
      if (x.verb(x.prev)) return ['kāi', '(after a verb) open; away'];
      return ['kāi', 'to open'];
    },
    '坐': x => VEHICLE.test(x.next || '') ? ['zuò', 'to take; to ride (a bus, train …)'] : ['zuò', 'to sit'],
    '叫': x => x.next && x.next2 && PRONOUN.has(x.next) && x.verb(x.next2)
      ? ['jiào', 'to tell (someone to do something)'] : ['jiào', 'to be called; to call'],
    '想': x => x.verb(x.next) ? ['xiǎng', 'to want to'] : ['xiǎng', 'to think; to miss'],
    '行': x => x.end && (!x.prev || x.prev === '不' || x.prev === '也') ? ['xíng', 'OK; all right'] : undefined,
    '种': x => isCounter(x.prev) ? ['zhǒng', 'kind; type'] : ['zhòng', 'to plant; to grow'],
    '数': x => isCounter(x.prev) ? ['shù', 'number'] : ['shǔ', 'to count'],
    '分': x => isNumeral(x.prev || '') ? ['fēn', 'minute; cent; point'] : undefined,
    '干': x => x.end || /^(什么|活|吗|嘛)$/.test(x.next || '') ? ['gàn', 'to do'] : undefined,
    '背': x => /包$/.test(x.next || '') ? ['bēi', 'to carry on one\'s back'] : undefined,
    '为': x => x.verb(x.prev) ? ['wéi', 'as; to be'] : ['wèi', 'for; because of'],
    '中': x => x.prev && !x.verb(x.prev) ? ['zhōng', 'in; among; during'] : undefined,
    '次': () => ['cì', 'time(s); occurrence'],
    '年': () => ['nián', 'year'],
    '是': () => ['shì', 'to be (is, am, are)'],
    '有': () => ['yǒu', 'to have; there is / there are'],
    '就': () => ['jiù', 'then; right away'],
    '才': () => ['cái', 'only then; just'],
    '都': () => ['dōu', 'all; both'],
    '也': () => ['yě', 'also; too'],
    '又': () => ['yòu', 'again; also'],
    '再': () => ['zài', 'again; then'],
    '比': () => ['bǐ', 'than; compared with'],
    '从': () => ['cóng', 'from'],
    '很': () => ['hěn', 'very'],
    '不': () => ['bù', 'not; no'],
    '这': () => ['zhè', 'this'],
    '那': x => x.end || !x.next ? ['nà', 'then; in that case'] : ['nà', 'that'],
    '每': () => ['měi', 'every; each'],
    '两': () => ['liǎng', 'two'],
    '却': () => ['què', 'but; yet'],
    '能': () => ['néng', 'can; to be able to'],
    '我': () => ['wǒ', 'I; me'],
    '你': () => ['nǐ', 'you'],
    '您': () => ['nín', 'you (polite)'],
    '他': () => ['tā', 'he; him'],
    '她': () => ['tā', 'she; her'],
    '它': () => ['tā', 'it'],
    '太': () => ['tài', 'too (much); very'],
    '最': () => ['zuì', 'most; -est'],
    '刚': () => ['gāng', 'just (a moment ago)'],
    '让': () => ['ràng', 'to let; to make (someone do)'],
    '带': x => isCounter(x.prev) ? undefined : ['dài', 'to bring; to take along'],
    '快': x => /^(要|到)$/.test(x.next || '') ? ['kuài', 'soon; about to'] : ['kuài', 'fast; quick'],
    '老': () => ['lǎo', 'old'],
    '与': () => ['yǔ', 'and; with'],
    '块': x => isNumeral(x.prev || '') ? ['kuài', '(measure word: yuan, or a piece of)'] : undefined,
    // erhua: 儿 after a word adds an -r sound (这儿, 一会儿, 玩儿)
    '儿': x => x.prev ? ['r', '(-r ending on the word before)'] : ['ér', 'child; son'],
  };

  /* the same for words of two or more characters whose sense turns on the sentence */
  const MULTI = {
    '没有': x => x.prev === '还' ? ['méi yǒu', 'not yet'] : x.verb(x.next) ? ['méi yǒu', 'did not; have not'] : ['méi yǒu', 'there is no; not to have'],
    '一边': x => x.verb(x.next) ? ['yī biān', '(一边…一边: while)'] : undefined,
    '什么': x => x.before.some(w => /^(不|没|没有|都|也)$/.test(w)) || /^(都|也)$/.test(x.next || '')
      ? ['shén me', 'anything; whatever'] : undefined,
  };

  /* Unstressed endings, as the stories write them: place words (家里 jiā li, 前面
     qián mian, 南边 nán bian, 网上 wǎng shang) and a direction after a verb
     (回来 huí lai; 站 起来 zhàn qi lai). CC-CEDICT often gives these full tones. */
  const DIRECTION = '前后外里上下左右东南西北';
  function unstress(w, sy, def, x) {
    const cs = [...w];
    if (cs.length !== 2) return sy;
    const [a, b] = cs, out = sy.slice();
    if (b === '里' && !/mile|kilomet|\bli\b/i.test(def)) out[1] = 'li';
    else if (b === '面' && DIRECTION.includes(a)) out[1] = 'mian';
    else if (b === '边' && (DIRECTION.includes(a) || '这那哪'.includes(a))) out[1] = 'bian';
    else if (b === '上' && !/^to /.test(def) && !'马以之向往而至'.includes(a)) out[1] = 'shang';
    else if ((b === '来' || b === '去') && '出进回上下过起开'.includes(a)) {
      if (w === '过去' && !x.verb(x.prev)) return sy;       // guòqù "the past"
      out[1] = neutral(out[1]);
      if (x.verb(x.prev)) out[0] = neutral(out[0]);
    }
    return out;
  }

  /* ---- the reading and meaning of one word ---- */

  function glossWord(D, w, x) {
    const cs = [...w];
    const han = cs.filter(isHan);
    if (han.length === 1) {
      const c = han[0];
      const cls = isCounter(x.prev) && !isNumeral(c) ? classifierSense(D, c) : null;
      const rule = SINGLE[c] || SINGLE[simp(D, c)];
      const hit = rule && rule(x);
      if (hit) return { pin: hit[0], gloss: hit[1], alt: hit[2] || null, parts: [[hit[0], hit[1]]] };
      if (cls) {
        const what = cls[1].replace(/^\(?classifier (used )?(for|of)\s*/i, '').replace(/[,;].*$/, '').replace(/\)$/, '');
        const g = what ? '(measure word for ' + what + ')' : '(measure word)';
        return { pin: cls[0], gloss: g, alt: null, parts: [[cls[0], g]] };
      }
      const lex = D.lexicon[c] || D.lexicon[simp(D, c)];
      if (lex) return { pin: lex[0], gloss: lex[1], alt: null, parts: [[lex[0], lex[1]]] };
      const rs = readingsOf(D, c);
      const pin = rs[0] ? rs[0][0] : ((D.HZ.index[c] || [])[2] || '');
      const e = D.HZ.index[c] || D.HZ.index[simp(D, c)];
      const g = (rs[0] && joinMeanings(rs[0][1])) || (e ? shortGloss(e[3]) : '');
      const alt = rs.slice(1).filter(r => r[1].length).slice(0, 1).map(r => [r[0], joinMeanings(r[1])]);
      return { pin, gloss: g, alt: alt.length ? alt : null, parts: [[pin, g]] };
    }

    const withParts = (pin, gloss) =>
      ({ pin, gloss, alt: null, parts: han.map((c, i) => charInWord(D, c, syllables(pin, han.length)[i], w)) });

    const hit = MULTI[w] && MULTI[w](x);
    if (hit) return withParts(hit[0], hit[1]);
    const sw = [...w].map(c => simp(D, c)).join('');
    const lex = D.lexicon[w] || D.lexicon[sw];
    if (lex) return withParts(lex[0], lex[1]);

    const r = D.rank.get(w);
    if (r !== undefined) {
      const [, , dictPin, def] = D.words[r];
      const base = syllables(dictPin, han.length), sy = unstress(w, base, def, x);
      // keep the dictionary's own spelling (zhèr, Zhōng guó) unless a syllable changed
      return withParts(sy.some((s, i) => s !== base[i]) ? sy.join(' ') : dictPin, joinMeanings([def]));
    }
    if (isNumeral(w)) return withParts(han.map(c => (readingsOf(D, c)[0] || [''])[0]).join(' '), numberValue(w));
    if (han.length === 2 && han[0] === han[1]) {
      // a doubled character: 看看 "have a look", 厚厚 "thick"; a doubled noun is
      // more often a pet name (米米, 花花) than anything else
      const one = glossWord(D, han[0], x);
      const verb = /^to /.test(one.gloss);
      return withParts(one.pin + ' ' + neutral(one.pin), one.gloss + (verb ? ' (a little, briefly)' : ' (doubled; may be a name)'));
    }
    const parts = han.map(c => charInWord(D, c, (readingsOf(D, c)[0] || [''])[0], w));
    return { pin: parts.map(p => p[0]).join(' '), gloss: parts.map(p => p[1]).join(' + '), alt: null, parts };
  }

  /* ------------------------------------------------------------- dialogue */

  const END = new Set(['。', '！', '？', '…', '!', '?']);

  /* Which tokens start a new line, so each speaker's turn gets its own line.
     A port of dialogue_lines() in build/build_stories.py. */
  function dialogueBreaks(toks) {
    const t = toks.map(k => typeof k === 'string' ? k : k.s);
    const sents = [];
    let cur = [], depth = 0;
    t.forEach((x, i) => {
      cur.push(i);
      if (x === '“') depth++;
      else if (x === '”') {
        depth = Math.max(0, depth - 1);
        if (depth === 0 && i && END.has(t[i - 1])) { sents.push(cur); cur = []; }
      } else if (END.has(x) && depth === 0 && !(t[i + 1] && END.has(t[i + 1]))) { sents.push(cur); cur = []; }
    });
    if (cur.length) sents.push(cur);

    const isSpeech = sent => sent.some((i, n) => {
      if (t[i] !== '“') return false;
      const prev = i ? t[i - 1] : '';
      const close = sent.slice(n + 1).find(j => t[j] === '”');
      const last = close ? t[close - 1] : '';
      return n === 0 || prev === '：' || prev === ':' || (prev === '，' && (END.has(last) || last === '，'));
    });

    const starts = new Set();
    let prevSpeech = null, prevQuoteFirst = false;
    for (const sent of sents) {
      const speech = isSpeech(sent), first = t[sent[0]];
      if (prevSpeech === null) { /* first sentence */ }
      else if (speech) {
        const q = sent.findIndex(i => t[i] === '“');
        const lead = sent.slice(0, Math.max(q, 0)).map(i => t[i]);
        const sameSpeaker = prevSpeech && prevQuoteFirst && first !== '“'
          && lead.length > 0 && lead.length <= 6 && lead[lead.length - 1] === '，';
        if (!sameSpeaker) starts.add(sent[0]);
      } else if (prevSpeech) starts.add(sent[0]);
      prevSpeech = speech; prevQuoteFirst = first === '“';
    }
    return starts;
  }

  /* ------------------------------------------------------------ the story */

  function textToStory(text, HZ) {
    const D = prepare(HZ);
    const paras = segment(D, text);
    const g = {}, seg = [], v = [], senses = {};
    let n = 0;

    for (const toks of paras) {
      const breaks = dialogueBreaks(toks);
      const row = [];
      const words = toks.map(k => typeof k === 'string' ? k : null);
      toks.forEach((tk, i) => {
        if (breaks.has(i)) row.push({ br: 1 });
        if (typeof tk !== 'string') {
          const last = row[row.length - 1];
          if (last && typeof last === 'object' && 's' in last) last.s += tk.s;   // keep runs of punctuation together
          else row.push({ s: tk.s });
          return;
        }
        // the clause around this word: words since the last punctuation mark
        let a = i;
        while (a > 0 && words[a - 1]) a--;
        const nextTok = toks[i + 1];
        const x = {
          prev: words[i - 1] || null, next: words[i + 1] || null, next2: words[i + 1] && words[i + 2] || null,
          nextText: nextTok && typeof nextTok === 'object' ? nextTok.s : '',
          end: !words[i + 1], before: words.slice(a, i),
          verb: w => looksVerb(D, w),
        };
        const w = tk, han = [...w].filter(isHan);
        n += han.length;
        const r = glossWord(D, w, x);

        // one key per distinct sense, like 还@huan in the story sources
        let key = w;
        for (let k = 2; g[key] && (g[key][1] !== r.pin || g[key][2] !== r.gloss); k++) key = w + '@' + k;
        if (!g[key]) {
          const extra = {};
          if (r.alt) extra.alt = r.alt;
          const s = [...w].map(c => simp(D, c)).join('');
          if (s !== w) extra.s = s;
          g[key] = Object.keys(extra).length ? [w, r.pin, r.gloss, r.parts, extra] : [w, r.pin, r.gloss, r.parts];
          if (han.length > 1 && !v.some(e => e[0] === w)) v.push([w, r.pin, r.gloss]);
        }
        han.forEach((c, j) => {
          const slot = senses[c] || (senses[c] = { alone: [], inside: [] });
          const bucket = han.length === 1 ? slot.alone : slot.inside;
          const p = r.parts[j] || ['', ''];
          if (!bucket.some(b => b[0] === p[0] && b[1] === p[1])) bucket.push(p);
        });
        row.push(key);
      });
      seg.push(row);
    }

    const c = Object.keys(senses).map(ch => {
      const s = senses[ch].alone.length ? senses[ch].alone : senses[ch].inside;
      const pins = [...new Set(s.map(x => x[0]))];
      const glosses = [];
      s.forEach(x => x[1].split('; ').forEach(part => { if (part && !glosses.includes(part)) glosses.push(part); }));
      return [ch, pins.join(' / '), glosses.join('; ')];
    });
    return { id: 'text', l: 0, tag: '', zh: '', en: '', n, g, seg, v, c };
  }

  return { textToStory, segment: (text, HZ) => segment(prepare(HZ), text), params: P };
});
