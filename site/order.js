/* order.js — what you will learn next (#/queue): the character order and the word order. Tap
 * one to prioritise it (it is learnt before the rest of the queue) or skip it (it is never
 * taught). The Study page's queue shows the first ten of this.
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
function pathChars(n) {
  const cfg = Store.cfg(), d = Store.load();
  if (!cfg.path || cfg.path === 'off' || n <= 0) return [];
  const skipped = new Set(skipList());
  const skip = c => !!(d.items[c] || d.status[c] || skipped.has(c));
  if (cfg.path === 'mix' && HZ.charorder) {
    return Learn.pickChars(HZ.charorder, n, p => !!(d.items['c:' + p] || d.items[p] || Store.compKnown(p)), skip);
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

/* what is queued, in order, of one kind */
const queuedOf = kind => {
  const d = Store.load();
  return Store.plan().waiting.filter(k => d.items[k] && d.items[k].kind === kind);
};

/* the Study page's queue: the next ten characters and words, nothing else */
function nextUp(n = 10) {
  const d = Store.load();
  // today's lessons in the order they come, then what is waiting behind them
  const p = Store.plan(), whole = k => d.items[k] && (d.items[k].kind === 'char' || d.items[k].kind === 'word');
  const today = p.lessons.filter(whole), queued = today.concat(p.waiting.filter(k => whole(k) && !today.includes(k)));
  return queued.slice(0, n).concat(pathChars(Math.max(0, n - queued.length)));
}

function upcomingChars(n) {
  const queued = queuedOf('char');
  return queued.concat(pathChars(Math.max(0, n - queued.length))).slice(0, n);
}

/* the words to come: queued, then each just after the last of its characters */
function upcomingWords(n) {
  const d = Store.load(), queued = queuedOf('word'), cfg = Store.cfg();
  if (!HZ.wordorder || !cfg.path || cfg.path === 'off') return queued.slice(0, n);
  const pos = new Map(upcomingChars(ORDER_WORD_HORIZON).map((c, i) => [c, i + 1]));
  const env = learnEnv();
  const charPos = c => ((env.level(c) || 0) >= 1 ? 0 : pos.get(c));
  const skipped = new Set(skipList());
  // (nor a word with a character you have chosen to skip: charPos has none for it)
  const rest = Learn.wordOrder(HZ.wordorder, charPos, w => !!d.items[w] || skipped.has(w) || d.wstatus[w] === 'learned');
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

function orderItem(k, kind, n) {
  const it = Store.item(k), skipped = skipList().includes(k), info = orderInfo(k, kind);
  const mark = skipped ? 'skip' : it && it.prio ? 'prio' : '';
  const label = `${k}, ${info.pin}${mark === 'prio' ? ', prioritised' : mark === 'skip' ? ', skipped' : ''}`;
  return `<button type="button" class="ord-item ${kind} ${mark}" data-k="${esc(k)}" data-kind="${kind}" aria-label="${esc(label)}">
    ${n ? `<small class="ord-n">${n}</small>` : ''}${mark === 'prio' ? '<i class="ord-mark" aria-hidden="true">★</i>' : ''}
    <span class="han">${zh(k)}</span><small>${esc(info.pin)}</small></button>`;
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
  const act = async a => {
    dlg.close();
    if (a === 'close') return;
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
  };
  dlg.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => act(b.dataset.a)));
  dlg.querySelector('a').addEventListener('click', () => dlg.close());
  dlg.showModal();
}

async function pageQueue(tab, count) {
  tab = tab === 'words' ? 'words' : 'chars';
  count = Math.max(1, count || 1);
  if (!document.querySelector('.ord-items')) app.innerHTML = LOADING;
  await fillPath();
  await Promise.all([optional(need.cmnem()), optional(need.cnames()), optional(need.charorder()), optional(need.hskChars()),
    tab === 'words' ? optional(need.wordorder()) : null]);
  const cfg = Store.cfg(), kind = tab === 'words' ? 'word' : 'char', n = count * ORDER_STEP;
  // (asks for one more than it shows, to know if there is more)
  const list = tab === 'words' ? upcomingWords(n + 1) : upcomingChars(n + 1);
  const shown = list.slice(0, n);
  const pathName = { mix: 'Balanced', common: 'Most common first', hsk: 'HSK 1 to 6' }[cfg.path];
  const skipped = skipList().filter(k => (kind === 'word') === ([...k].length > 1));
  const off = !cfg.path || cfg.path === 'off';
  app.innerHTML = `<h1 class="page-title">Upcoming</h1>
    <p class="lede">What you'll learn, in order. Tap one to prioritise it, so it comes before the rest of the queue,
      or skip it, so you never learn it.</p>
    <div class="tabs">
      <a class="${tab === 'chars' ? 'on' : ''}" href="#/queue/chars">Character order</a>
      <a class="${tab === 'words' ? 'on' : ''}" href="#/queue/words">Word order</a>
    </div>
    <p class="small muted">${off ? 'Your learning path is off, so this shows only what you added.'
      : tab === 'words' ? `Learning path: ${pathName}. Words use whatever your new characters and components leave of your daily limit of ${cfg.lessonLimit || 'no'} lessons.`
      : `Learning path: ${pathName}, ${cfg.pathDaily} new characters a day.`}
      <a href="#/settings">Change</a>${tab === 'words' && !off ? '<br>Each word comes after you have learned all its characters.' : ''}</p>
    ${shown.length ? `<div class="ord-items">${shown.map((k, i) => orderItem(k, kind, i + 1)).join('')}</div>`
      : `<p class="empty">${off ? 'Nothing here yet. Turn on a learning path in Settings, or add some yourself.' : 'Nothing to come.'}</p>`}
    ${list.length > n ? `<p class="ord-more"><a class="btn quiet" href="#/queue/${tab}/${count + 1}">Show more</a></p>` : ''}
    ${skipped.length ? `<h2 class="sec-h">Skipped (${skipped.length})</h2>
      <p class="small muted">You won't learn these. Tap one to bring it back.</p>
      <div class="ord-items">${skipped.map(k => orderItem(k, kind)).join('')}</div>` : ''}`;
  app.querySelectorAll('.ord-item').forEach(b => b.addEventListener('click', () => orderPopup(b.dataset.k, b.dataset.kind, tab, count)));
}
