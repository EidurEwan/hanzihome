/* What a two-syllable word is actually said as: the tone changes, and which words can be
 * asked about at all. Shared by build/tones/classify.js and build/tones/build.js.
 *
 * said(word, pinyin, Learn) gives {tones: [a, b], rule} (rule: '' or which change applies),
 * or null for a word to leave out because the answer isn't clear-cut. */
'use strict';

/* A neutral second syllable is the riskiest thing to mark right or wrong: dictionaries and
 * speakers disagree (学生, 知道), and a careful recording can give it a full tone. Only these
 * are asked about: the little words that are always light, and everyday words nobody says otherwise. */
const LIGHT_ENDINGS = new Set('们子么吗呢吧的了着过'.split(''));
const LIGHT_WORDS = new Set(['妈妈', '爸爸', '哥哥', '弟弟', '妹妹', '姐姐', '奶奶', '爷爷', '谢谢', '东西', '朋友', '衣服', '先生', '客气', '漂亮', '休息', '认识', '时候', '明白', '地方', '舒服', '清楚', '喜欢', '告诉', '意思', '名字']);

function said(word, pin, Learn) {
  const chars = [...word], sy = String(pin).trim().split(/\s+/);
  if (chars.length !== 2 || sy.length !== 2) return null;
  const t = sy.map(s => Learn.parsePinyin(s).tones[0] || 5);
  if (t[0] === 5) return null;
  // 一 and 不 in the second place, and doubled words, follow rules of their own
  if (chars[1] === '一' || chars[1] === '不') return null;
  if (t[1] === 5) {
    if (chars[0] === '不' || chars[0] === '一') return null;      // 一个, 一下: written and said too many ways
    if (!LIGHT_ENDINGS.has(chars[1]) && !LIGHT_WORDS.has(word)) return null;
    return { tones: t, rule: '' };
  }
  if (chars[0] === '不') {
    if (t[0] !== 4 && t[0] !== 2) return null;
    return t[1] === 4 ? { tones: [2, 4], rule: 'bu' } : null;     // (不 before the others is as written: nothing to learn)
  }
  if (chars[0] === '一') {
    if (t[1] === 4) return { tones: [2, 4], rule: 'yi2' };
    return { tones: [4, t[1]], rule: 'yi4' };
  }
  if (t[0] === 3 && t[1] === 3) return { tones: [2, 3], rule: '33' };
  return { tones: t, rule: '' };
}
module.exports = { said };
