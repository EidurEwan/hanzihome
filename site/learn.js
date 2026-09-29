/* learn.js — lessons and spaced repetition, the way HanziHero does them.
 *
 * You add characters and words you meet to a lesson queue. A lesson shows the
 * item's parts, your mnemonic and an example, then checks you can type its
 * pinyin and its meaning; from then on it comes back for review on HanziHero's
 * schedule (https://hanzihero.com/docs/srs-stages): ten stages from Novice I
 * (a day) to Expert III (a year), then Master. A wrong answer halves the
 * interval, and halves it again for each of the item's last five reviews that
 * was also wrong.
 *
 * An item, kept in the store under its characters (Store.data.items):
 *   {kind: 'char' | 'word', pin: 'rèn shi', mean: 'to know', alts: [...meanings],
 *    syn: [your synonyms], mnemonic, ex: {text, t} (where you met it),
 *    added, stage (0 = waiting for its lesson, 1-9 reviewing, 10 master), due, hist}
 *
 * Pure functions, no DOM: site/app.js draws the pages, test/learn.js checks this.
 * Works in the browser (window.Learn) and in Node (require). */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Learn = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 864e5;
  // [name, days until the next review once an item reaches this stage]
  const STAGES = [
    ['Lesson', 0],
    ['Novice I', 1], ['Novice II', 4],
    ['Apprentice I', 7], ['Apprentice II', 14],
    ['Journeyman I', 30], ['Journeyman II', 60],
    ['Expert I', 120], ['Expert II', 240], ['Expert III', 365],
    ['Master', Infinity],
  ];
  const MASTER = STAGES.length - 1;
  const LEARNED_FROM = 5;      // Journeyman and up count as learned on the rest of the site
  const GROUPS = ['Lesson', 'Novice', 'Novice', 'Apprentice', 'Apprentice', 'Journeyman', 'Journeyman',
    'Expert', 'Expert', 'Expert', 'Master'];

  const stageName = s => (STAGES[s] || STAGES[0])[0];
  const group = s => GROUPS[s] || 'Lesson';

  /* a little spread, so a day's lessons don't all come back in one lump (HanziHero
     adds ±1 to ±4 days depending on the interval) */
  function fuzz(days, rnd) {
    const span = days >= 120 ? 4 : days >= 30 ? 2 : days >= 7 ? 1 : 0;
    return span ? Math.round((rnd() * 2 - 1) * span) : 0;
  }

  function newItem(kind, info, now) {
    return {
      kind, pin: info.pin || '', mean: info.mean || '', alts: info.alts || [], syn: [],
      mnemonic: '', ex: info.ex || null, added: now, stage: 0, due: 0, hist: [],
    };
  }

  function finishLesson(item, now) {
    item.stage = 1;
    item.due = now + STAGES[1][1] * DAY;
    item.learnt = now;
    return item;
  }

  /* a review's result: right = both questions right first time */
  function review(item, right, now, rnd = Math.random) {
    const wrongBefore = (item.hist || []).slice(-5).filter(r => !r).length;
    item.hist = (item.hist || []).concat(right).slice(-10);
    item.last = now;
    if (right) {
      item.stage = Math.min(MASTER, Math.max(1, item.stage) + 1);
      const days = STAGES[item.stage][1];
      item.due = days === Infinity ? 0 : now + (days + fuzz(days, rnd)) * DAY;
      return item;
    }
    const days = STAGES[Math.max(1, Math.min(item.stage, MASTER - 1))][1] / Math.pow(2, 1 + wrongBefore);
    let stage = 1;
    for (let s = 1; s < MASTER; s++) if (STAGES[s][1] <= days) stage = s;
    item.stage = stage;
    item.due = now + days * DAY;
    return item;
  }

  const isDue = (item, now) => item.stage >= 1 && item.stage < MASTER && item.due <= now;
  const waiting = item => item.stage === 0;

  /* how many reviews fall due on each of the next `days` days (index 0 = today, from now) */
  function forecast(items, now, days = 7) {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const out = new Array(days).fill(0);
    for (const it of items) {
      if (it.stage < 1 || it.stage >= MASTER) continue;
      const k = Math.max(0, Math.floor((it.due - start) / DAY));
      if (k < days) out[k]++;
    }
    return out;
  }

  /* what a character's review stage means for the rest of the site */
  const statusFor = item => item.stage >= LEARNED_FROM ? 'learned' : item.stage >= 1 ? 'learning' : null;

  /* A character you already know (marked Learned on the rest of the site) joins the
     reviews at Journeyman I without a lesson; its first review comes `wait` ms from now.
     It has no `learnt` time, so it doesn't count against the day's lessons. */
  function known(kind, info, now, wait) {
    const item = newItem(kind, info, now);
    item.stage = LEARNED_FROM;
    item.joined = now;
    item.due = now + wait;
    return item;
  }

  /* back from vacation: every review waits as long again as you were away */
  function resume(items, since, now) {
    const away = Math.max(0, now - since);
    for (const it of Object.values(items)) if (it.stage >= 1 && it.stage < MASTER) it.due += away;
  }

  // ------------------------------------------------------------ settings

  const FAMILIAR = 3;          // HanziHero: familiar = reached the third stage (Apprentice I)

  /* HanziHero's application settings, as far as they apply here (every item here is
     one you added yourself, so there is no course, dictionary queue or skipping) */
  const DEFAULTS = {
    batch: 5,                  // lessons per batch
    lessonLimit: 10,           // lessons a day (0: no limit)
    wordLimit: 7,              // how many of those may be words
    reviewLimit: 0,            // a soft limit on reviews a day (0: none)
    charUnlock: 'now',         // a character waits for its components: 'now' | 'learned' | 'familiar'
    wordWait: true,            // a word waits for its characters...
    wordUnlock: 'familiar',    // ...until they are 'familiar' or 'learned' (lesson done)
    autoChars: true,           // adding a word adds its characters too, prioritized
    questionOrder: 'pinyin',   // 'pinyin': pronunciation then meaning, in pairs; 'random': shuffled
    lessonOrder: 'words',      // 'words' first | 'chars' first | 'mix'
    prioRespect: true,         // prioritized items keep to the limits and the lesson order
    reviewOrder: 'random',     // 'random' | 'type' | 'oldest' | 'newest' | 'easiest' | 'lowest'
    showPct: true, showCount: true,
    validate: false,           // shake at answers that aren't pinyin, instead of marking them wrong
    sentences: false,          // word reviews show the word in a sentence
    voice: 'female', speed: 'normal', muteSfx: false, muteVoice: false,
    vacation: 0,               // when vacation mode began (0: not on vacation)
  };
  const settings = s => Object.assign({}, DEFAULTS, s || {});

  const dayStart = now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return +d; };
  const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };

  function shuffle(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* due reviews in the order the settings ask for */
  function reviewOrder(keys, items, how, now, rnd = Math.random) {
    const ks = keys.slice(), it = k => items[k];
    const since = x => x.learnt || x.joined || x.added || 0;
    switch (how) {
      case 'type': return ks.sort((a, b) => (it(a).kind === 'word') - (it(b).kind === 'word') || it(a).due - it(b).due);
      case 'oldest': return ks.sort((a, b) => since(it(a)) - since(it(b)));
      case 'newest': return ks.sort((a, b) => since(it(b)) - since(it(a)));
      case 'lowest': return ks.sort((a, b) => it(a).stage - it(b).stage || it(a).due - it(b).due);
      case 'easiest': {
        // most likely still remembered: the least time gone by for the wait it was given
        const worn = x => {
          const from = x.last || since(x), wait = Math.max(1, x.due - from);
          return (now - from) / wait;
        };
        return ks.sort((a, b) => worn(it(a)) - worn(it(b)));
      }
      default: return shuffle(ks, rnd);
    }
  }

  /* What there is to study now.
     env.level(c): how far along a character is, as a stage (null: nothing to wait for);
     env.comps(k): a character's components (null: not known yet);
     env.compOk(c, stage): whether a component counts as known at that stage.
     -> {lessons: ready now in order, waiting: every queued key in order, locked: {key:
        [what it waits for]}, lessonsToday, wordsToday, due, reviews (due, in order),
        reviewsToday, reviewsLeft (under the soft limit), vacation} */
  function plan(items, cfg, now, env, rnd = Math.random) {
    cfg = settings(cfg);
    const start = dayStart(now), keys = Object.keys(items), it = k => items[k];
    const today = keys.filter(k => it(k).learnt >= start);
    const out = {
      lessons: [], waiting: [], locked: {},
      lessonsToday: today.length, wordsToday: today.filter(k => it(k).kind === 'word').length,
      due: [], reviews: [], reviewsToday: keys.filter(k => it(k).last >= start).length, reviewsLeft: 0,
      vacation: !!cfg.vacation,
    };

    const need = { learned: 1, familiar: FAMILIAR };
    const queued = keys.filter(k => it(k).stage === 0);
    for (const k of queued) {
      let wait = [];
      if (it(k).kind === 'word' && cfg.wordWait) {
        wait = [...new Set([...k].filter(isHan))].filter(c => {
          const l = env.level(c);
          return l != null && l < need[cfg.wordUnlock];
        });
      } else if (it(k).kind !== 'word' && need[cfg.charUnlock]) {
        wait = (env.comps(k) || []).filter(c => !env.compOk(c, need[cfg.charUnlock]));
      }
      if (wait.length) out.locked[k] = wait;
    }

    const first = (a, b) => (it(b).prio ? 1 : 0) - (it(a).prio ? 1 : 0) || it(a).added - it(b).added;
    const order = ks => {
      const w = ks.filter(k => it(k).kind === 'word').sort(first);
      const c = ks.filter(k => it(k).kind !== 'word').sort(first);
      if (cfg.lessonOrder === 'words') return w.concat(c);
      if (cfg.lessonOrder === 'chars') return c.concat(w);
      const mixed = [];                            // 'mix': each kind in proportion
      let i = 0, j = 0;
      while (i < w.length || j < c.length) {
        if (j < c.length && (i >= w.length || j / c.length <= i / w.length)) mixed.push(c[j++]);
        else mixed.push(w[i++]);
      }
      return mixed;
    };
    // with the priority queue absolute, prioritized items go before everything
    out.waiting = cfg.prioRespect ? order(queued)
      : order(queued.filter(k => it(k).prio)).concat(order(queued.filter(k => !it(k).prio)));

    let left = cfg.lessonLimit ? Math.max(0, cfg.lessonLimit - out.lessonsToday) : Infinity;
    let words = cfg.lessonLimit ? Math.max(0, Math.min(cfg.wordLimit, cfg.lessonLimit) - out.wordsToday) : Infinity;
    for (const k of out.waiting) {
      if (out.locked[k]) continue;
      const word = it(k).kind === 'word';
      if (it(k).prio && !cfg.prioRespect) { out.lessons.push(k); continue; }
      if (left <= 0 || (word && words <= 0)) continue;
      out.lessons.push(k);
      left--;
      if (word) words--;
    }

    out.due = keys.filter(k => isDue(it(k), now));
    out.reviews = reviewOrder(out.due, items, cfg.reviewOrder, now, rnd);
    out.reviewsLeft = cfg.reviewLimit ? Math.min(out.due.length, Math.max(0, cfg.reviewLimit - out.reviewsToday))
      : out.due.length;
    if (out.vacation) { out.lessons = []; out.reviews = []; out.reviewsLeft = 0; }
    return out;
  }

  // ------------------------------------------------------------ answers

  const MARKS = { '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 };

  /* pinyin -> {letters, tones}: tones are the syllables' tone numbers in order, 5 for
     none. Takes tone marks (rèn shi), tone numbers (ren4shi5, ren4 shi) or both */
  function parsePinyin(s) {
    // ü, u: and v are all the same letter: v
    const t = String(s || '').toLowerCase().replace(/u:/g, 'v').normalize('NFD').replace(/u\u0308/g, 'v');
    let letters = '';
    const tones = [];
    for (const ch of t) {
      if (MARKS[ch]) tones.push(MARKS[ch]);
      else if (/[1-5]/.test(ch)) tones.push(+ch);
      else if (/[a-z]/.test(ch)) letters += ch === 'ü' ? 'v' : ch;
    }
    return { letters: letters.replace(/ü/g, 'v'), tones };
  }

  /* the expected pinyin's syllables, each with its tone (5 = neutral) */
  function syllableTones(pin) {
    return String(pin || '').toLowerCase().split(/\s+/).filter(Boolean).map(syl => {
      const p = parsePinyin(syl);
      return p.tones.length ? p.tones[0] : 5;
    });
  }

  /* Right when the letters match and the tones typed match the syllables' tones in
     order. A neutral syllable may be typed with any tone or none (认识 ren4shi,
     ren4shi5 and ren4shi4 all pass): that is a matter of style, not of knowing it. */
  function checkPinyin(answer, expected) {
    const a = parsePinyin(answer), e = parsePinyin(expected);
    if (!a.letters || a.letters !== e.letters) return false;
    const want = syllableTones(expected), got = a.tones.filter(t => t !== 5);
    const fit = (i, j) => {
      if (j === want.length) return i === got.length;
      if (want[j] === 5) return fit(i, j + 1) || (i < got.length && fit(i + 1, j + 1));
      return i < got.length && got[i] === want[j] && fit(i + 1, j + 1);
    };
    return fit(0, 0);
  }

  const norm = s => String(s || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/\b(sb|sth|someone|something|one's)\b/g, ' ')
    .replace(/[^a-z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(to|a|an|the) /, '').trim();

  /* typing distance: a letter added, dropped or wrong, or two neighbours swapped (knwo) */
  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  /* every meaning an item accepts, one sense each */
  function meanings(item) {
    const out = [];
    for (const m of [item.mean].concat(item.alts || [], item.syn || [])) {
      for (const part of String(m || '').split(/;|\//)) {
        const n = norm(part);
        if (n && !out.includes(n)) out.push(n);
      }
    }
    return out;
  }

  /* Right when the answer is one of the item's meanings, give or take "to", "a",
     brackets and a typo (one letter wrong from 4 letters, two from 8) */
  function checkMeaning(answer, item) {
    const a = norm(answer);
    if (!a) return false;
    return meanings(item).some(m => m === a
      || (a.length >= 4 && distance(a, m) <= (a.length >= 8 ? 2 : 1)));
  }

  /* Pinyin answer validation: is this pinyin at all? Every syllable has to be a real one
     (an erhua r allowed), and a tone number has to follow a syllable (not "yi22" or
     "jeu4"). A typo that lands on another real syllable (yi as yu) can't be caught. */
  const SYLLABLES = new Set(('a ai an ang ao ba bai ban bang bao bei ben beng bi bia bian biang biao bie bin bing bo bu ca '
    + ' cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua '
    + ' chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo da dai dan dang dao de dei '
    + ' den deng di dia dian diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan '
    + ' fang fei fen feng fiao fo fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai '
    + ' guan guang gui gun guo ha hai han hang hao he hei hen heng hm hng hong hou hu hua huai huan '
    + ' huang hui hun huo ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ka kai kan '
    + ' kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo la lai lan lang lao le '
    + ' lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lv lve m ma mai '
    + ' man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu n na nai nan nang nao '
    + ' ne nei nen neng ng ni nian niang niao nie nin ning niu nong nou nu nuan nun nuo nv nve o ou '
    + ' pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian qiang qiao '
    + ' qie qin qing qiong qiu qu quan que qun r ran rang rao re ren reng ri rong rou ru rua ruan '
    + ' rui run ruo sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi '
    + ' shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ta tai tan '
    + ' tang tao te tei teng ti tian tiao tie ting tong tou tu tuan tui tun tuo wa wai wan wang wei '
    + ' wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ya yan yang yao '
    + ' ye yi yin ying yo yong you yu yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan '
    + ' zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi '
    + ' zong zou zu zuan zui zun zuo').split(/\s+/));

  function syllables(x) {                          // can x be cut into syllables?
    const ok = [true];
    for (let i = 1; i <= x.length; i++) {
      ok[i] = false;
      for (let j = Math.max(0, i - 7); j < i && !ok[i]; j++) {
        const s = x.slice(j, i);
        if (ok[j] && (SYLLABLES.has(s) || (s.length > 1 && s.endsWith('r') && SYLLABLES.has(s.slice(0, -1))))) ok[i] = true;
      }
    }
    return ok[x.length];
  }

  function validPinyin(answer) {
    const s = String(answer || '').toLowerCase().replace(/u:/g, 'v').normalize('NFD')
      .replace(/u\u0308/g, 'v').replace(/[\u0300-\u036f]/g, '').trim();
    if (!/[a-z]/.test(s) || /[^a-z1-5\s'’-]/.test(s)) return false;
    if (/\d\d/.test(s) || /(^|[\s'’-])\d/.test(s)) return false;
    return s.split(/[\s'’-]+|(?<=\d)/).filter(Boolean).every(chunk => syllables(chunk.replace(/\d$/, '')));
  }

  return {
    STAGES, MASTER, LEARNED_FROM, FAMILIAR, DAY, DEFAULTS, stageName, group, newItem, finishLesson,
    review, known, resume, isDue, waiting, forecast, statusFor, settings, dayStart, plan, reviewOrder,
    checkPinyin, checkMeaning, validPinyin, meanings, parsePinyin,
  };
});
