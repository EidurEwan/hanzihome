/* Write site/data/lookalike.js: for each of the 3,000 most common characters, the
 * common characters that look like it, for the look-alike practice (site/lookalike.js)
 * and the character pages' "Looks like".
 *
 *   HZ.lookalike = {char: 'look-alikes, most alike first'}
 *
 * Two characters look alike when (from site/data/c/: each character's stroke count st,
 * its breakdown bd, and its parts down to strokes gr):
 *   - their stroke counts are within one, their parts-to-strokes nearly the same (one
 *     or two parts or strokes apart), and they share a part of two strokes or more, or
 *     one is a part of the other: 拔 拨, 未 末, 大 太, 白 百; or
 *   - they share their main part and differ only in a side part (a radical such as
 *     讠 忄 氵 日 目), the shared part the bigger: 请 情 清 晴 睛.
 * Before those come the pairs every learner mixes up that the data can't see (己 已 巳,
 * 人 入, 鸟 乌, 候 侯...), listed below by hand.
 *
 *   node build/export_lookalikes.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', 'site');
const TOP = 3000;          // the most common characters, by rank
const MOST = 6;            // look-alikes kept for each

// look-alikes the stroke data can't tell apart, or misses
const BY_HAND = `己已巳 未末 土士 日曰 人入八 大太犬 天夭夫 刀力 千干于 王玉主 木本术 禾木 白百自 目且 鸟乌
  免兔 戊戌 贝见 午牛 失矢 拔拨 候侯 折析拆 待侍持特 晴睛请情清 辨辩 今令 历厉 买卖 问间 冶治 即既
  准淮 撤撒 往住注 竞竟 孤狐 季李 采米 洒酒 旦且 句勺 斤斥 由甲申 田由 兵乒乓 很狠 理埋 怕拍 坐座 气汽
  题提 爪瓜 毛手 儿几 九丸 叉又 丸凡 匕七 外处 码吗妈 蓝篮 喝渴 搏博 幕墓慕暮 缓暖 未味 休体 午干
  己乙 鸣呜 历力 已己 乌鸟 衣农 衷哀 衰衷 哀衰 卯卵 赢嬴 栗粟 侯喉猴 拣练炼 银很`;

const HZ = { chunk: {} };
global.HZ = HZ;
for (const f of fs.readdirSync(path.join(SITE, 'data', 'c'))) eval(fs.readFileSync(path.join(SITE, 'data', 'c', f), 'utf8'));
eval(fs.readFileSync(path.join(SITE, 'data', 'index.js'), 'utf8'));
const all = Object.assign({}, ...Object.values(HZ.chunk));
const rank = c => (HZ.index[c] || [])[0] || 1e9;
const chars = Object.keys(HZ.index).filter(c => rank(c) <= TOP && all[c] && all[c].st);
const strokes = c => (all[c] && all[c].st) || 1;

// side parts: radicals that sit beside (or over) a character's main part
const SIDE = new Set([...'氵讠忄扌亻彳纟钅饣礻衤犭阝口日目月木火王土石米足车马虫女贝舟禾矢弓山巾冫攵欠刂力页鸟隹又寸⻊⺮艹宀穴广疒尸户厂']);

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const parts = c => (all[c].bd[1] || []).map(x => x[0]);

/* how alike two characters look, 0 for not */
function alike(a, b) {
  const A = all[a], B = all[b], ds = Math.abs(A.st - B.st);
  if (ds > 2) return 0;
  const pa = parts(a), pb = parts(b);
  if (ds <= 1 && A.gr.length >= 3 && B.gr.length >= 3) {
    const L = lev(A.gr, B.gr), len = Math.max(A.gr.length, B.gr.length);
    const shared = pa.some(x => pb.includes(x) && strokes(x) >= 2) || pa.includes(b) || pb.includes(a)
      || (pa.length && pa.join() === pb.join());
    if (1 - L / len >= 0.8 && L <= (len <= 5 ? 1 : 2) && shared) return 1 - L / len;
  }
  if (pa.length === 2 && pb.length === 2) {
    for (const x of [0, 1]) {
      const o = 1 - x;
      if (pa[o] === pb[o] && pa[x] !== pb[x] && SIDE.has(pa[x]) && SIDE.has(pb[x]) && !SIDE.has(pa[o])
        && strokes(pa[o]) >= 3 && strokes(pa[o]) >= Math.max(strokes(pa[x]), strokes(pb[x]))) return 0.7;
    }
  }
  return 0;
}

const out = {};
const put = (a, b, score) => { if (a !== b) (out[a] = out[a] || new Map()).set(b, Math.max(score, (out[a].get(b) || 0))); };
for (const group of BY_HAND.split(/\s+/).filter(Boolean)) {
  const g = [...group].filter(c => HZ.index[c]);
  for (const a of g) for (const b of g) put(a, b, 2);           // by hand: first
}
for (let i = 0; i < chars.length; i++) {
  for (let j = i + 1; j < chars.length; j++) {
    const s = alike(chars[i], chars[j]);
    if (s) { put(chars[i], chars[j], s); put(chars[j], chars[i], s); }
  }
}
const data = {};
for (const [c, m] of Object.entries(out)) {
  data[c] = [...m].sort((x, y) => y[1] - x[1] || rank(x[0]) - rank(y[0])).slice(0, MOST).map(x => x[0]).join('');
}
const file = path.join(SITE, 'data', 'lookalike.js');
fs.writeFileSync(file, '/* look-alike characters: build/export_lookalikes.js */\nHZ.lookalike=' + JSON.stringify(data) + ';\n');
console.log(`${Object.keys(data).length} characters with look-alikes -> ${path.relative(process.cwd(), file)} (${fs.statSync(file).size} bytes)`);
for (const c of process.argv.slice(2).join('')) console.log(c, data[c] || '');
