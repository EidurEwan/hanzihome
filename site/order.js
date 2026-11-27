/* order.js — what you will learn next (#/queue): the character order and the word order. Tap
 * one to prioritise it (it is learnt before the rest of the queue) or skip it (it is never
 * taught). Today's queue shows the first ten of this.
 *
 *   #/queue/chars | #/queue/words, /N for how many hundred to show
 *
 * The order is what is queued (Learn.plan's order, prioritised first), then what the learning
 * path would choose after that, worked out afresh from what you know.
 */

'use strict';

const ORDER_STEP = 300;
/* how far ahead the characters are worked out, to place the words after them */
const ORDER_WORD_HORIZON = 800;

const skipList = () => Store.load().study.skip || [];

/* the characters the path would choose next, after what is queued */
function pathChars(n, withSkipped) {
  const cfg = Store.cfg(), d = Store.load();
  if (!cfg.path || cfg.path === 'off' || n <= 0) return [];
  const skipped = new Set(withSkipped ? [] : skipList());
  // (as if nothing were skipped, what the path put in the queue counts as still to choose:
  // a skipped one was taken out of the queue, so only the path's order says where it was)
  const taken = c => !!d.items[c] && !(withSkipped && pathQueued(d.items[c]));
  const skip = c => !!(taken(c) || d.status[c] || skipped.has(c));
  if (cfg.path === 'mix' && HZ.charorder) {
    return Learn.pickChars(HZ.charorder, n, p => !!(d.items['c:' + p] || (d.items[p] && taken(p)) || Store.compKnown(p)), skip);
  }
  const all = cfg.path === 'hsk'
    ? Object.keys(HZ.hskChars || {}).sort((a, b) => a - b).flatMap(lv => HZ.hskChars[lv])
    : byRank();
  const out = [];
  for (const c of all) {
    if (out.length >= n) break;
    if (HZ.index[c] && !skip(c)) out.push(c);
  }
  return out;
}

/* put in the queue by the path, and not started or asked for */
const pathQueued = it => !!(it.path && it.stage === 0 && !it.learnt && !it.prio);

/* what is queued, in order, of one kind (but for what the path put there, withSkipped) */
const queuedOf = (kind, withSkipped) => {
  const d = Store.load();
  return Store.plan().waiting.filter(k => d.items[k] && d.items[k].kind === kind && !(withSkipped && pathQueued(d.items[k])));
};

/* Today's queue: the next ten characters and words, nothing else */
function nextUp(n = 10) {
  const d = Store.load();
  // today's lessons in the order they come, then what is waiting behind them
  const p = Store.plan(), whole = k => d.items[k] && (d.items[k].kind === 'char' || d.items[k].kind === 'word');
  const today = p.lessons.filter(whole), queued = today.concat(p.waiting.filter(k => whole(k) && !today.includes(k)));
  return queued.slice(0, n).concat(pathChars(Math.max(0, n - queued.length)));
}

function upcomingChars(n, withSkipped) {
  const queued = queuedOf('char', withSkipped);
  return queued.concat(pathChars(Math.max(0, n - queued.length), withSkipped)).slice(0, n);
}

/* the words to come: queued, then each just after the last of its characters */
function upcomingWords(n, withSkipped) {
  const d = Store.load(), queued = queuedOf('word', withSkipped), cfg = Store.cfg();
  if (!HZ.wordorder || !cfg.path || cfg.path === 'off') return queued.slice(0, n);
  const pos = new Map(upcomingChars(ORDER_WORD_HORIZON, withSkipped).map((c, i) => [c, i + 1]));
  const env = learnEnv();
  const charPos = c => ((env.level(c) || 0) >= 1 ? 0 : pos.get(c));
  const skipped = new Set(withSkipped ? [] : skipList());
  // (nor a word with a character you have chosen to skip: charPos has none for it)
  const rest = Learn.wordOrder(HZ.wordorder, charPos, w => (!!d.items[w] && !(withSkipped && pathQueued(d.items[w]))) || skipped.has(w) || d.wstatus[w] === 'learned');
  return queued.concat(rest).slice(0, n);
}

function orderInfo(k, kind) {
  const it = Store.item(k);
  if (kind === 'word') {
    const r = (HZ.wordorder || {})[k];
    return { pin: (it && it.pin) || (r && r[2]) || '', mean: (it && it.mean) || (r && r[3]) || '' };
  }
  const cm = HZ.cmnem && HZ.cmnem[k], e = HZ.index[k] || [];
  return { pin: (it && it.pin) || (cm && cm[2]) || e[2] || '', mean: (cm && cm[0]) || (it && it.mean) || String(e[3] || '').split(/;|…/)[0] };
}

/* The order with what you skipped left in, where it would have come (greyed out on the
   page): the order as if nothing were skipped says where each skipped one goes, just after
   the last one before it that is still coming. */
function withSkips(list, ghost) {
  const skips = new Set(skipList()), out = list.map(k => ({ k })), at = new Map(list.map((k, i) => [k, i]));
  const after = new Map();      // index in list (-1: before all) → skipped ones that follow it
  let prev = -1;
  for (const k of ghost) {
    if (skips.has(k)) after.set(prev, [...(after.get(prev) || []), k]);
    else if (at.has(k)) prev = at.get(k);
  }
  const res = (after.get(-1) || []).map(k => ({ k, skip: true }));
  out.forEach((o, i) => { res.push(o); for (const k of after.get(i) || []) res.push({ k, skip: true }); });
  return res;
}

/* a new item for what you prioritised */
function orderAdd(k, kind) {
  if (kind === 'char') return Store.learnAdd(k, 'char', charInfo(k));
  const r = (HZ.wordorder || {})[k] || [];
  const means = String(r[3] || '').split(/;\s*/).filter(Boolean);
  return Store.learnAdd(k, 'word', { pin: r[2] || '', mean: means.slice(0, 2).join('; '), alts: means });
}

function orderPrioritise(k, kind) {
  const d = Store.load();
  d.study.skip = skipList().filter(x => x !== k);
  let it = d.items[k];
  if (!it) { it = orderAdd(k, kind); it.prioAdded = true; }
  it.prio = true;
  Store.save();
}
function orderUnprioritise(k) {
  const d = Store.load(), it = d.items[k];
  if (!it) return;
  if (it.prioAdded && it.stage === 0 && !it.learnt) dropQueued([k]);
  else { delete it.prio; delete it.prioAdded; }
  Store.save();
}
function orderSkip(k) {
  const d = Store.load();
  d.study.skip = [...new Set([...skipList(), k])];
  if (d.items[k] && d.items[k].stage === 0) dropQueued([k]);
  Store.save();
}
function orderUnskip(k) {
  const d = Store.load();
  d.study.skip = skipList().filter(x => x !== k);
  Store.save();
}

function orderItem(k, kind, n, extra = '') {
  const it = Store.item(k), skipped = skipList().includes(k), info = orderInfo(k, kind);
  const mark = skipped ? 'skip' : it && it.prio ? 'prio' : '';
  const label = `${k}, ${info.pin}${mark === 'prio' ? ', prioritised' : mark === 'skip' ? ', skipped' : ''}`;
  // the quick actions: learn it next (or not), skip it (or bring it back)
  const acts = skipped
    ? `<button type="button" class="ord-act back" data-a="unskip" title="Bring it back" aria-label="Bring ${esc(k)} back">${ORD_ICO.back}</button>`
    : `${mark === 'prio'
        ? `<button type="button" class="ord-act up on" data-a="unprio" title="Stop prioritising" aria-label="Stop prioritising ${esc(k)}">${ORD_ICO.up}</button>`
        : `<button type="button" class="ord-act up" data-a="prio" title="Learn it next" aria-label="Learn ${esc(k)} next">${ORD_ICO.up}</button>`}
      <button type="button" class="ord-act skip" data-a="skip" title="Skip it" aria-label="Skip ${esc(k)}">${ORD_ICO.skip}</button>`;
  return `<div class="ord-item ${kind} ${mark}${extra}" data-k="${esc(k)}" data-kind="${kind}">
    <button type="button" class="ord-main" aria-label="${esc(label)}">
      ${n ? `<small class="ord-n">${n}</small>` : ''}${mark === 'prio' ? '<i class="ord-mark" aria-hidden="true">★</i>' : ''}
      <span class="ord-face"><span class="han">${zh(k)}</span><small class="ord-pin">${esc(info.pin)}</small></span>${ordMean(info.mean)}</button>
    <span class="ord-acts">${acts}</span></div>`;
}
/* a tile's meaning: its first sense, short */
const ordMean = m => {
  const first = String(m || '').split(/[;；]|\s\(/)[0].trim();
  return `<small class="ord-mean"${first ? ` title="${esc(m)}"` : ''}>${esc(first) || '&nbsp;'}</small>`;
};
const ORD_ICO = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
  skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h11a5 5 0 0 1 0 10H9"/><path d="M8 5 4 9l4 4"/></svg>',
};

/* an action on one item, from its popup or its tile, then the page again where it was */
async function orderDo(a, k, kind, tab, count) {
  if (a === 'prio') orderPrioritise(k, kind);
  if (a === 'unprio') orderUnprioritise(k);
  if (a === 'skip') orderSkip(k);
  if (a === 'unskip') orderUnskip(k);
  await fillPath();
  await fillParts();
  markNav(currentPath());
  if (currentPath().startsWith('/queue')) {
    const y = window.scrollY;
    await pageQueue(tab, count);
    window.scrollTo(0, y);
  }
}

function orderPopup(k, kind, tab, count) {
  let dlg = document.getElementById('ord-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'ord-dlg';
    dlg.className = 'ord-dlg';
    document.body.appendChild(dlg);
    // a click on the backdrop lands on the dialog itself
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }
  const it = Store.item(k), info = orderInfo(k, kind);
  const skipped = skipList().includes(k), prio = !!(it && it.prio);
  const href = kind === 'word' ? '#/word/' + encodeURIComponent(k) : '#/character/' + encodeURIComponent(k);
  dlg.innerHTML = `<p class="ord-dlg-g han">${zh(k)}</p>
    <p class="ord-dlg-p"><b>${esc(info.pin)}</b></p>
    <p class="muted ord-dlg-m">${esc(info.mean)}</p>
    ${skipped ? '<p class="small muted">Skipped: you won\'t learn this.</p>' : prio ? '<p class="small muted">Prioritised: you\'ll learn this before the rest of the queue.</p>' : ''}
    <div class="ord-dlg-acts">
      ${prio ? '<button class="btn quiet" data-a="unprio">Stop prioritising</button>' : '<button class="btn" data-a="prio">★ Prioritise</button>'}
      ${skipped ? '<button class="btn quiet" data-a="unskip">Don\'t skip</button>' : '<button class="btn quiet" data-a="skip">Skip</button>'}
    </div>
    <p class="ord-dlg-foot"><a class="small" href="${href}">Open its page</a>
      <button class="btn quiet" data-a="close">Close</button></p>`;
  const act = a => {
    dlg.close();
    if (a !== 'close') orderDo(a, k, kind, tab, count);
  };
  dlg.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => act(b.dataset.a)));
  dlg.querySelector('a').addEventListener('click', () => dlg.close());
  dlg.showModal();
}

/* the HSK level each character is first in */
let ordHskOf = null;
const charHsk = c => {
  if (!ordHskOf) {
    ordHskOf = {};
    Object.keys(HZ.hskChars || {}).sort((x, y) => x - y).forEach(l => HZ.hskChars[l].forEach(ch => { if (!ordHskOf[ch]) ordHskOf[ch] = +l; }));
  }
  return ordHskOf[c] || 0;
};

/* when a day from now is, in words: by the day this week, then by the week, then by the month */
function ordWhen(day) {
  if (day <= 0) return 'Today';
  if (day === 1) return 'Tomorrow';
  if (day < 7) return new Date(Date.now() + day * 864e5).toLocaleDateString(undefined, { weekday: 'long' });
  if (day < 14) return 'Next week';
  if (day < 28) return `In ${Math.floor(day / 7)} weeks`;
  const m = Math.max(1, Math.round(day / 30.4));
  return `In about ${m} month${m === 1 ? '' : 's'}`;
}

/* how far along: what you know, against the HSK characters, a bar a level */
function ordProgress(kind) {
  const d = Store.load();
  const had = Object.keys(d.items).filter(k => d.items[k].kind === kind && d.items[k].stage >= 1);
  if (kind === 'word') {
    return `<div class="ord-prog"><p class="ord-prog-h"><b>${had.length.toLocaleString()}</b> word${had.length === 1 ? '' : 's'} learned
      <a href="#/queue/learned">See them</a></p></div>`;
  }
  const known = new Set(had);
  Object.keys(d.status || {}).forEach(c => { if ([...c].length === 1) known.add(c); });
  const levels = Object.keys(HZ.hskChars || {}).sort((x, y) => x - y);
  const per = levels.map(l => {
    const all = HZ.hskChars[l].filter(c => charHsk(c) === +l);
    return [l, all.filter(c => known.has(c)).length, all.length];
  });
  const total = per.reduce((n, [, , a]) => n + a, 0), have = per.reduce((n, [, h]) => n + h, 0);
  return `<div class="ord-prog">
    <p class="ord-prog-h"><b>${known.size.toLocaleString()}</b> character${known.size === 1 ? '' : 's'} learned${total
      ? `<span>· ${(total - have).toLocaleString()} to go in HSK 1–${levels[levels.length - 1]}</span>` : ''}
      <a href="#/queue/learned">See them</a></p>
    ${total ? `<div class="ord-bars" role="list" aria-label="By HSK level">${per.map(([l, h, a]) => `<div class="ord-bar" role="listitem"
        aria-label="${hskName(l)}: ${h} of ${a}" title="${hskName(l)}: ${h} of ${a} characters"><span>${hskName(l)}</span>
        <i style="--w:${a ? Math.max(h ? 3 : 0, Math.round(100 * h / a)) : 0}%"></i><small>${h}/${a}</small></div>`).join('')}</div>` : ''}
  </div>`;
}

/* what you've learned already: the other side of the queue */
function ordLearnedHtml() {
  const d = Store.load();
  const of = kind => Object.keys(d.items).filter(k => d.items[k].kind === kind && d.items[k].stage >= 1)
    .sort((a, b) => (d.items[a].learnt || d.items[a].added || 0) - (d.items[b].learnt || d.items[b].added || 0));
  const tiles = (ks, kind) => ks.map(k => {
    const it = d.items[k];
    return `<a class="ord-item ${kind} learned" href="${kind === 'word' ? '#/word/' : '#/character/'}${encodeURIComponent(k)}">
      <span class="ord-main"><span class="ord-face"><span class="han">${zh(k)}</span><small class="ord-pin">${esc(it.pin || '')}</small></span>${ordMean(orderInfo(k, kind).mean)}</span></a>`;
  }).join('');
  const chars = of('char'), words = of('word');
  return !chars.length && !words.length ? '<p class="empty">Nothing learned yet. Your first lessons are on Today.</p>'
    : `${chars.length ? `<h2 class="sec-h">Characters <span class="muted">${chars.length}</span></h2><div class="ord-items">${tiles(chars, 'char')}</div>` : ''}
       ${words.length ? `<h2 class="sec-h">Words <span class="muted">${words.length}</span></h2><div class="ord-items">${tiles(words, 'word')}</div>` : ''}`;
}

async function pageQueue(tab, count) {
  tab = tab === 'words' ? 'words' : tab === 'learned' ? 'learned' : 'chars';
  count = Math.max(1, count || 1);
  if (!document.querySelector('.ord-items')) app.innerHTML = LOADING;
  await fillPath();
  await Promise.all([optional(need.cmnem()), optional(need.cnames()), optional(need.charorder()), optional(need.hskChars()),
    tab === 'words' ? optional(need.wordorder()) : null]);
  const tabs = `<div class="tabs">
      <a class="${tab === 'chars' ? 'on' : ''}" href="#/queue/chars">Character order</a>
      <a class="${tab === 'words' ? 'on' : ''}" href="#/queue/words">Word order</a>
      <a class="${tab === 'learned' ? 'on' : ''}" href="#/queue/learned">Learned</a>
    </div>`;
  if (tab === 'learned') {
    app.innerHTML = `<h1 class="page-title">Upcoming</h1>
      <p class="lede">What you've learned so far, in the order you learned it. Tap one for its page.</p>
      ${tabs}${ordProgress('char')}${ordLearnedHtml()}`;
    return;
  }
  const cfg = Store.cfg(), kind = tab === 'words' ? 'word' : 'char', n = count * ORDER_STEP;
  // (asks for one more than it shows, to know if there is more)
  const list = tab === 'words' ? upcomingWords(n + 1) : upcomingChars(n + 1);
  // (with what you skipped greyed out where it would have come, out of the count)
  const ghost = tab === 'words' ? upcomingWords(n + 1, true) : upcomingChars(n + 1, true);
  const shown = list.slice(0, n), rows = withSkips(shown, ghost);
  const pathName = { mix: 'Balanced', common: 'Most common first', hsk: 'HSK 1 to 9' }[cfg.path];
  const inline = new Set(rows.filter(r => r.skip).map(r => r.k));
  const skipped = skipList().filter(k => (kind === 'word') === ([...k].length > 1) && !inline.has(k));
  const off = !cfg.path || cfg.path === 'off';

  // the characters by when they come: today's still to do, then the day's new characters a day
  const d = Store.load();
  const per = Math.max(1, cfg.pathDaily || 5);
  const todayLeft = kind === 'char' && !off ? Store.plan().lessons.filter(k => d.items[k] && d.items[k].kind === 'char').length : 0;
  const dayOf = i => i < todayLeft ? 0 : 1 + Math.floor((i - todayLeft) / per);
  const dated = kind === 'char' && !off;
  // an HSK level done: after the last of its characters still to learn, if that's on the page
  const known = new Set(Object.keys(d.items).filter(k => d.items[k].stage >= 1).concat(Object.keys(d.status || {})));
  const doneAfter = new Map();
  if (kind === 'char') {
    const at = new Map(shown.map((c, i) => [c, i])), skips = new Set(skipList());
    Object.keys(HZ.hskChars || {}).sort((x, y) => x - y).forEach(l => {
      const left = HZ.hskChars[l].filter(c => charHsk(c) === +l && !known.has(c) && !skips.has(c));
      if (!left.length || left.some(c => !at.has(c))) return;
      const i = Math.max(...left.map(c => at.get(c)));
      doneAfter.set(i, [...(doneAfter.get(i) || []), [l, HZ.hskChars[l].filter(c => charHsk(c) === +l).length]]);
    });
  }
  let html = '', last = null, i = -1;
  for (const { k, skip } of rows) {
    if (skip) { html += orderItem(k, kind); continue; }
    i++;
    if (dated) {
      const when = ordWhen(dayOf(i));
      if (when !== last) {
        const cnt = shown.filter((_, j) => ordWhen(dayOf(j)) === when).length;
        html += `<p class="ord-day${dayOf(i) >= 28 ? ' far' : ''}"><b>${when}</b><span>${cnt}</span></p>`;
        last = when;
      }
    }
    const lv = kind === 'char' ? charHsk(k) : 0;
    html += orderItem(k, kind, i + 1, `${dated && dayOf(i) >= 28 ? ' far' : ''}${lv ? ` hsk${lv}` : ''}`);
    for (const [l, all] of doneAfter.get(i) || []) {
      html += `<p class="ord-mile"><b>${hskName(l)} complete</b><span>All ${all} of its characters${dated ? `, ${ordWhen(dayOf(i)).toLowerCase()}` : ''}</span></p>`;
    }
  }
  app.innerHTML = `<h1 class="page-title">Upcoming</h1>
    <p class="lede">What you'll learn, in order. <span class="ord-hint-hover">Use <span class="ord-key">${ORD_ICO.up}</span> to learn one next, or
      <span class="ord-key">${ORD_ICO.skip}</span> to skip it, so you never learn it. Click one for more.</span><span class="ord-hint-touch">Tap one to learn it
      next, skip it, or open its page.</span></p>
    ${tabs}
    ${ordProgress(kind)}
    <p class="small muted">${off ? 'Your learning path is off, so this shows only what you added.'
      : tab === 'words' ? `Learning path: ${pathName}. Words use whatever your new characters and components leave of your daily limit of ${cfg.lessonLimit || 'no'} lessons.`
      : `Learning path: ${pathName}, ${cfg.pathDaily} new characters a day.`}
      <a href="#/settings">Change</a>${tab === 'words' && !off ? '<br>Each word comes after you have learned all its characters.' : ''}</p>
    ${shown.length ? `<div class="ord-items${dated ? ' dated' : ''}">${html}</div>`
      : `<p class="empty">${off ? 'Nothing here yet. Turn on a learning path in Settings, or add some yourself.' : 'Nothing to come.'}</p>`}
    ${list.length > n ? `<p class="ord-more"><a class="btn quiet" href="#/queue/${tab}/${count + 1}">Show more</a></p>` : ''}
    ${skipped.length ? `<h2 class="sec-h">${inline.size ? 'Also skipped' : 'Skipped'} (${skipped.length})</h2>
      <p class="small muted">You won't learn these${inline.size ? ' (the ones above stay greyed out where they would have come)' : ''}. Use ${ORD_ICO.back.replace('<svg', '<svg class="ord-inline"')} to bring one back.</p>
      <div class="ord-items">${skipped.map(k => orderItem(k, kind)).join('')}</div>` : ''}`;
  app.querySelectorAll('.ord-item').forEach(el => {
    const k = el.dataset.k, kd = el.dataset.kind;
    el.querySelector('.ord-main').addEventListener('click', () => orderPopup(k, kd, tab, count));
    el.querySelectorAll('.ord-act').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      orderDo(b.dataset.a, k, kd, tab, count);
    }));
  });
}
