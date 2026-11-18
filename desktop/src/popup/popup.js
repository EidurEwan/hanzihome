/* The hover popup: the reader's word popup (showWordPop in site/app.js) for a word
 * on screen. The main process (desktop/src/hover.js) sends the word's glossary
 * entry, as textToStory made it, and the status of each of its characters; this
 * draws it, reports its size so the window can fit it, and passes on clicks.
 * Its first row has the three choices for the word: "Add to lessons" puts it in the
 * site's lesson queue, Unknown and Known mark it (the word as a word, or the one
 * character); below, each character of a longer word has Unknown and Known of its own.
 * A character or word becomes Known once its lesson is done, or when marked so.
 * The character itself opens its page. */

'use strict';

const pop = document.getElementById('word-pop');
const isHan = c => { const n = c.codePointAt(0); return (n >= 0x3400 && n <= 0x9fff) || n >= 0x20000; };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render({ entry, status, known, learn, wstate }) {
  const [w, p, d, parts, extra] = entry;
  const alt = (extra && extra.alt) || [];
  const han = [...w].filter(isHan);
  const multi = han.length > 1;
  // Unknown / Known for one character (data-c, data-s) or for the word itself (data-ws)
  const choose = (attr, st) => [['', 'Unknown', 'none'], ['learned', 'Known', 'learned']].map(([v, label, cls]) =>
    `<button type="button" ${attr}="${v}"${(st || '') === v ? ` class="on ${cls}"` : ''}>${label}</button>`).join('');
  const lessons = !learn ? ''
    : learn.add ? '<button type="button" class="wp-add" data-learn>＋ Add to lessons</button>'
    : `<span class="wp-in">✓ ${esc(learn.stage)}</span>`;
  const choice = multi ? (wstate !== undefined ? choose('data-ws', wstate) : '')
    : han.length && known[han[0]] ? choose(`data-c="${esc(han[0])}" data-s`, status[han[0]]) : '';
  const row = (c, i) => {
    const [cp, cg] = parts[i] || ['', ''];
    return `<div class="wp-char multi">
      <a class="wp-c han" data-open="${esc(c)}" title="Open in HanziHome">${esc(c)}</a>
      <span class="wp-cbody"><span class="wp-cm"><b>${esc(cp)}</b> ${esc(cg)}</span>${known[c]
        ? `<span class="seg3">${choose(`data-c="${esc(c)}" data-s`, status[c])}</span>` : ''}</span>
    </div>`;
  };
  pop.innerHTML = `
    <div class="wp-head"><span class="han">${esc(w)}</span>
      <b>${esc(p)}</b><span class="wp-d">${esc(d)}</span></div>
    ${alt.map(([ap, ad]) => `<p class="wp-alt">or: <b>${esc(ap)}</b> ${esc(ad)}</p>`).join('')}
    ${lessons || choice ? `<div class="wp-acts seg3">${lessons}${choice}</div>` : ''}
    ${multi ? han.map((c, i) => han.indexOf(c) === i ? row(c, i) : '').join('') : ''}
    ${!multi && han.length === 1 ? `<p class="wp-learn"><a class="wp-card" href="#" data-open="${esc(han[0])}">Character page →</a></p>` : ''}`;
  // the layout size, which no transform changes; + the 1px border on each side
  window.popup.size(pop.offsetWidth + 2, pop.offsetHeight + 2);
}

pop.addEventListener('click', e => {
  const ws = e.target.closest('button[data-ws]');
  if (ws) { window.popup.markWord(ws.dataset.ws || null); return; }
  const b = e.target.closest('button[data-s]');
  if (b) { window.popup.mark(b.dataset.c, b.dataset.s || null); return; }
  if (e.target.closest('button[data-learn]')) { window.popup.learn(); return; }
  const a = e.target.closest('[data-open]');
  if (a) { e.preventDefault(); window.popup.open(a.dataset.open); }
});

window.popup.onShow(render);
