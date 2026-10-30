/* grammar.js — the grammar a sentence uses, explained for a learner, offline.
 *
 * The translator (site/translate.js) asks Gemini to explain a sentence when it has an
 * API key. Without one, or offline, this finds the patterns a learner meets first in
 * the words of a Chinese sentence (as textstory.js cuts them): 了 after a verb or at
 * the end, 过, 着, 把, 被, 是…的, the three de (的 得 地), 比, measure words, the
 * question particles, 不 and 没, modal verbs, time and place before the verb, and the
 * paired connectives (因为…所以, 虽然…但是, 一…就 …). Each comes with the words that
 * show it and a short explanation; it says what a pattern usually means, and where a
 * word has two common jobs (在, 的) it names both rather than guess.
 *
 * explain(words): words is the sentence in order, each {w, pin?} (punctuation as its
 * own word); returns [{id, title, words: [the words involved], explanation}] in the
 * order they first appear. Works in the browser (window.Grammar) and in Node. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Grammar = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
  const isPunct = w => !w || ![...w].some(isHan);
  const NUMERAL = /^[零〇一二两三四五六七八九十百千万亿几半0-9]+$/;
  const POINTER = /^(这|那|哪|每|几|某|上|下|第.+)$/;
  const CLASSIFIER = new Set(('个 本 只 张 条 件 位 杯 瓶 辆 家 次 双 块 节 支 封 台 部 座 首 份 种 些 点 碗 斤 岁 口 头 '
    + '间 套 层 片 场 遍 趟 篇 句 门 课 份 盒 包 把 顿 层 分 元 毛 角 天 年 周 回 架 根 颗 粒 匹 朵 棵 位 名 群 对').split(' '));
  const TIME = /^(今天|明天|昨天|前天|后天|现在|刚才|以前|以后|早上|上午|中午|下午|晚上|今年|明年|去年|每天|周末|最近|马上|已经|平时|有时候|那时候|.+点|.+号|.+月|.+年|星期.|周.)$/;
  const MODAL = /^(想|要|会|能|可以|应该|得|必须|可能|愿意|敢|需要)$/;
  const QWORD = /^(什么|谁|哪|哪里|哪儿|怎么|怎么样|为什么|几|多少|多久|多大)$/;
  // what can't be the noun after a measure word: the grammar words around it
  const NOT_NOUN = /^(比|是|很|都|也|不|没|在|了|的|和|跟|就|还|太|最|更|吗|呢|吧)$/;

  /* words that work as a pair across a sentence: [first, second, title, explanation] */
  const PAIRS = [
    ['因为', '所以', 'because … so …', 'Chinese often marks both halves: 因为 gives the reason, 所以 the result. English uses just one of the two.'],
    ['虽然', '但是', 'although … but …', 'Both halves are marked, unlike English: 虽然 concedes, 但是 (or 可是) turns. Saying "although … but" is right in Chinese.'],
    ['虽然', '可是', 'although … but …', 'Both halves are marked, unlike English: 虽然 concedes, 可是 turns.'],
    ['如果', '就', 'if … then …', '如果 sets the condition; 就 (before the verb of the second half) introduces what follows from it.'],
    ['要是', '就', 'if … then …', '要是 is a spoken 如果: it sets the condition, and 就 introduces the result.'],
    ['一', '就', 'as soon as …', '一 + verb, then 就 + verb: the second thing happens as soon as the first does.'],
    ['越', '越', 'the more … the more …', '越 A 越 B: B grows as A does.'],
    ['又', '又', 'both … and …', '又 A 又 B: two qualities or actions at once.'],
    ['不但', '而且', 'not only … but also …', '不但 gives the first point, 而且 adds a stronger one.'],
    ['不是', '而是', 'not … but rather …', '不是 A 而是 B corrects A to B.'],
    ['除了', '以外', 'apart from …', '除了 … 以外 frames what is set aside; 都 after it means "all except", 也/还 means "besides".'],
    ['只要', '就', 'as long as …', '只要 sets a sufficient condition; 就 brings the result.'],
    ['先', '再', 'first … then …', '先 marks what happens first, 再 (or 然后) what follows.'],
    ['先', '然后', 'first … then …', '先 marks what happens first, 然后 what follows.'],
    ['从', '到', 'from … to …', '从 A 到 B: a span of place or time; the whole phrase comes before the verb.'],
    ['跟', '一起', 'together with …', '跟 (or 和) + person + 一起 + verb: doing something together. The company comes before the verb.'],
    ['和', '一起', 'together with …', '和 + person + 一起 + verb: doing something together. The company comes before the verb.'],
    ['太', '了', 'too … / so …!', '太 + adjective + 了: "too much", or in praise "so …!". The 了 here is part of the pattern, not past tense.'],
  ];

  function explain(words) {
    const ws = words.map(x => (typeof x === 'string' ? { w: x } : x));
    const W = ws.map(x => x.w);
    const out = [], seen = new Set();
    const add = (id, at, title, involved, explanation) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, at, title, words: involved.filter(Boolean), explanation });
    };
    const clauseEnd = i => i + 1 >= W.length || isPunct(W[i + 1]) || /^(吗|呢|吧|啊)$/.test(W[i + 1]);
    const before = i => (i > 0 && !isPunct(W[i - 1]) ? W[i - 1] : '');
    const after = i => (i + 1 < W.length && !isPunct(W[i + 1]) ? W[i + 1] : '');
    // the clause a word is in, as [start, end)
    const clause = i => {
      let a = i, b = i;
      while (a > 0 && !isPunct(W[a - 1])) a--;
      while (b < W.length && !isPunct(W[b])) b++;
      return [a, b];
    };

    W.forEach((w, i) => {
      const prev = before(i), next = after(i), pin = (ws[i].pin || '').toLowerCase();
      switch (w) {
        case '了':
          if (ws.some((x, j) => j < i && x.w === '太' && clause(j)[1] >= i)) break;     // 太…了, below
          if (clauseEnd(i)) add('le-end', i, '了 at the end of the sentence', [w],
            'A 了 closing the sentence marks a change or a new situation: something is now the case that was not before (下雨了 "it\'s raining now"), or rounds off what happened.');
          else add('le-verb', i, '了 after the verb: a completed action', [prev, w],
            'A 了 right after a verb says the action is done, often with an amount or object after it (买了三本书 "bought three books"). It is not a past tense: it marks completion, and the time comes from context or a time word.');
          break;
        case '过':
          if (prev) add('guo', i, 'verb + 过: have ever done', [prev, w],
            '过 after a verb says it has happened at least once, as experience: 我去过中国 "I have been to China". 没 + verb + 过 is "have never".');
          break;
        case '着':
          if (prev) add('zhe', i, 'verb + 着: an ongoing state', [prev, w],
            '着 after a verb describes a state that continues (门开着 "the door is open"), or the manner of another action (笑着说 "said with a smile").');
          break;
        case '正在': case '正':
          add('zai-prog', i, '正在: in the middle of doing', [w],
            '正在 (or 在, or 正) before a verb: the action is in progress right now. A 呢 at the end often comes with it.');
          break;
        case '在':
          if (W[i - 1] === '正') break;
          add('zai', i, '在: at (a place), or doing (an action)', [w, next],
            'Before a place, 在 means "at/in", and the whole 在 + place phrase comes before the verb (我在家吃饭 "I eat at home"): where comes before what you do. Before a verb, 在 means the action is in progress.');
          break;
        case '把':
          if (i > 0 && (NUMERAL.test(W[i - 1]) || POINTER.test(W[i - 1]))) break;     // a measure word: 一把椅子
          add('ba', i, '把: the object before the verb', [w, next],
            '把 brings the object forward: subject + 把 + object + verb + what happens to it (我把书放在桌子上 "I put the book on the table"). It is used when the action does something to a definite object, so the verb needs something after it.');
          break;
        case '被':
          add('bei', i, '被: the passive', [w, next],
            'Receiver + 被 + (doer) + verb + result: the subject is what the action happens to (我的车被偷了 "my car was stolen"). Often for something unwelcome.');
          break;
        case '的': {
          const [a] = clause(i);
          const shi = W.slice(a, i).lastIndexOf('是');
          if (shi >= 0 && clauseEnd(i)) {
            add('shi-de', i, '是 … 的: stressing how, when or where', ['是', w],
              '是 … 的 around a detail of something already done puts the stress on that detail, the time, place or manner (我是坐飞机来的 "it was by plane that I came").');
          } else {
            add('de', i, '的: links a description to a noun', [prev, w, next],
              'A 的 B: A describes or owns B, and the describing part always comes first, however long (我的书 "my book", 昨天买的书 "the book bought yesterday"). The English order is often the reverse.');
          }
          break;
        }
        case '得':
          if (pin.startsWith('děi') || (!prev)) {
            add('dei', i, '得 děi: must', [w, next], 'Read děi, 得 before a verb means "must, have to" (spoken).');
          } else if (pin === 'de' || pin === '' ) {
            add('de-comp', i, 'verb + 得 + how: describing the action', [prev, w, next],
              'Verb + 得 + description says how (well) the action is done: 他说得很快 "he speaks fast". With an object, repeat the verb: 他说中文说得很好.');
          }
          break;
        case '地':
          if (pin === 'de' && prev) add('di', i, '地: turns a description into an adverb', [prev, w],
            'Description + 地 + verb: how the action is done (慢慢地走 "walk slowly").');
          break;
        case '比':
          add('bi', i, 'A 比 B: comparing', [w, next],
            'A 比 B + adjective: "A is more … than B" (他比我高 "he is taller than me"). Never put 很 before the adjective here; add the difference after it (高一点儿, 高得多).');
          break;
        case '吗':
          add('ma', i, '吗: a yes-or-no question', [w],
            'Put 吗 at the end of a statement and it becomes a yes-or-no question, with no change of word order.');
          break;
        case '呢':
          add('ne', i, '呢: "and …?", or a softened question', [w],
            'After a noun, 呢 asks "what about …?" (你呢？ "and you?"). At the end of a question it softens it; after an action, it can mark something still going on.');
          break;
        case '吧':
          add('ba-particle', i, '吧: a suggestion, or "I suppose"', [w],
            '吧 at the end makes a suggestion (我们走吧 "let\'s go") or asks for agreement with a guess (你是学生吧？ "you\'re a student, right?").');
          break;
        case '不': case '没': case '没有':
          add('neg', i, '不 and 没: two negatives', [w, next],
            '不 negates the present, the future, habits, wishes and adjectives (我不去 "I won\'t go / I don\'t go"). 没 (没有) negates what did not happen, and 有 (我没去 "I didn\'t go"; 没有钱 "no money").');
          break;
        case '是': {
          const [, b] = clause(i);
          if (W.slice(i + 1, b).includes('的') && W[b - 1] === '的') break;    // 是…的, at the 的
          if (prev === '不' || prev === '就' || prev === '还' || prev === '都' || prev === '也' || next) {
            add('shi', i, '是: A is B', [w],
              '是 joins two nouns ("A is B"). It is not used before an adjective: "I am busy" is 我很忙, not 我是忙.');
          }
          break;
        }
        case '有':
          add('you', i, '有: have, there is', [w, next],
            '有 means both "have" and "there is" (桌子上有一本书 "there is a book on the table"). Its negative is always 没有, never 不有.');
          break;
        case '给':
          if (next) add('gei', i, '给: to or for someone', [w, next],
            '给 + person before the verb: doing something for or to them (我给你打电话 "I\'ll call you"). As a verb on its own, 给 is "to give".');
          break;
        case '的时候':
          add('de-shihou', i, '… 的时候: when …', [prev, w],
            'A clause + 的时候 means "when …"; it comes first, before what happens then (吃饭的时候 "when eating").');
          break;
        case '以后': case '以前':
          if (prev) add('yihou', i, w === '以后' ? '… 以后: after …' : '… 以前: before …', [prev, w],
            `${w} comes after the event it is measured from, at the front of the sentence: 下课${w} "${w === '以后' ? 'after' : 'before'} class".`);
          break;
        case '还是':
          if (W.slice(i).some(x => x === '？' || x === '?')) {
            add('haishi', i, '还是: "or" in a question', [prev, w, next],
              'In a question offering a choice, "or" is 还是 (茶还是咖啡？ "tea or coffee?"); no 吗 is needed. In a statement, "or" is 或者.');
          } else {
            add('haishi', i, '还是: still, or "had better"', [w, next],
              'Outside a question, 还是 means "still" (他还是没来 "he still hasn\'t come") or "had better" (你还是去吧 "you\'d better go").');
          }
          break;
        case '都': case '也':
          add('dou-ye', i, `${w}: ${w === '都' ? 'all' : 'also'}, before the verb`, [w, next],
            `${w} goes before the verb (or 不/没), never before the subject: 我们${w}去 "we ${w === '都' ? 'are all' : 'are also'} going". It points back at what comes before it.`);
          break;
        case '很':
          if (next && !isPunct(next)) add('hen', i, '很 + adjective', [w, next],
            'An adjective can be the whole predicate, with no "to be": 他很忙 "he is busy". 很 there is often just the link, not a strong "very".');
          break;
        default:
          if (POINTER.test(w) || NUMERAL.test(w)) {
            if (CLASSIFIER.has(next) && W[i + 2] !== undefined) {
              // the noun, when one follows (这个比那个贵: 这个 stands alone, "this one")
              const noun = after(i + 1);
              add('measure', i, 'number + measure word + noun', [w, next, NOT_NOUN.test(noun) ? '' : noun],
                'Between a number (or 这, 那, 几, 每) and a noun goes a measure word: 一本书 "one book", 三个人 "three people". 个 is the general one; others go with kinds of things (本 for books, 张 for flat things).');
            }
          } else if (MODAL.test(w) && next && !isPunct(next) && w !== '得') {
            add('modal', i, 'modal verb + verb', [w, next],
              `${w} goes straight before the main verb, like English "can, want to, will" (我${w}${next}). Negate it with 不 before the modal: 不${w}.`);
          } else if (QWORD.test(w)) {
            add('qword', i, 'question words stay in place', [w],
              `A question word such as ${w} sits where the answer would go; the word order does not change, and no 吗 is added (你去哪儿？ "where are you going?").`);
          } else if (TIME.test(w) && i + 1 < W.length) {
            add('time', i, 'when comes before the verb', [w],
              `Time words like ${w} come before the verb, at the start of the sentence or right after the subject (我明天去 / 明天我去 "I go tomorrow"), never at the end as in English.`);
          } else if (w.length === 2 && w[0] === w[1] && isHan(w[0])) {
            add('redup', i, 'a doubled verb: "have a little …"', [w],
              `Doubling a verb (${w}) softens it: do it briefly or casually, "have a quick look".`);
          } else if (w.length === 3 && w[1] === '一' && w[0] === w[2]) {
            add('redup', i, 'verb 一 verb: "have a little …"', [w],
              `${w}: the verb doubled around 一 softens it, "give it a try, take a quick look".`);
          }
      }
    });

    // the pairs that span a sentence
    for (const [a, b, title, explanation] of PAIRS) {
      const i = W.indexOf(a);
      if (i < 0) continue;
      const j = W.indexOf(b, i + 1);
      if (j < 0 || (a === b && j === i)) continue;
      if (a === '一' && !(W[i + 1] && !isPunct(W[i + 1]))) continue;
      if (seen.has('pair:' + a + b)) continue;
      if (a === '太') { seen.delete('le-end'); seen.delete('le-verb'); }
      add('pair:' + a + b, i, title, [a, b], explanation);
    }

    return out.sort((x, y) => x.at - y.at).map(({ id, title, words: ws2, explanation }) => ({ id, title, words: ws2, explanation }));
  }

  return { explain };
});
