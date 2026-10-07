/* The hover popup: the reader's word popup (showWordPop in site/app.js) for a word
 * on screen. The main process (desktop/src/hover.js) sends the word's glossary
 * entry, as textToStory made it, and the status of each of its characters; this
 * draws it, reports its size so the window can fit it, and passes on clicks:
 * a status button marks the character (or, in "The word" row, the word itself:
 * Learning or Learned, as the site's Words page does), the character itself opens
 * its page, and "Add to lessons" puts the word in the site's lesson queue. */

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
  const row = (c, i) => {
    const st = status[c] || '';
    const [cp, cg] = parts[i] || ['', ''];
    const btn = (v, label, cls) =>
      `<button type="button" data-c="${esc(c)}" data-s="${v}"` +
      `${st === v ? ' class="on ' + cls + '"' : ''}>${label}</button>`;
    // a one-character word already shows its meaning in the heading
    const meaning = multi ? `<span class="wp-cm"><b>${esc(cp)}</b> ${esc(cg)}</span>` : '';
    return `<div class="wp-char${multi ? ' multi' : ''}">
      <a class="wp-c han" data-open="${esc(c)}" title="Open in HanziHome">${esc(c)}</a>
      <span class="wp-cbody">${meaning}${known[c]
        ? `<span class="seg3">${btn('', 'Not known', 'none')}${btn('learning', 'Learning', 'learning')}${btn('learned', 'Learned', 'learned')}</span>`
        : ''}</span>
    </div>`;
  };
  pop.innerHTML = `
    <div class="wp-head"><span class="han">${esc(w)}</span>
      <b>${esc(p)}</b><span class="wp-d">${esc(d)}</span></div>
    ${alt.map(([ap, ad]) => `<p class="wp-alt">or: <b>${esc(ap)}</b> ${esc(ad)}</p>`).join('')}
    ${!learn ? '' : `<p class="wp-learn">${learn.add
      ? '<button type="button" data-learn>＋ Add to lessons</button>'
      : `<span>✓ ${esc(learn.stage)}</span>`}</p>`}
    ${multi && wstate !== undefined ? `<div class="wp-word"><span class="wp-wl">The word</span><span class="seg3">${
      [['', 'Not known', 'none'], ['learning', 'Learning', 'learning'], ['learned', 'Learned', 'learned']].map(([v, label, cls]) =>
        `<button type="button" data-ws="${v}"${(wstate || '') === v ? ` class="on ${cls}"` : ''}>${label}</button>`).join('')}</span></div>` : ''}
    ${han.map((c, i) => han.indexOf(c) === i ? row(c, i) : '').join('')}`;
  const r = pop.getBoundingClientRect();
  window.popup.size(Math.ceil(r.width) + 2, Math.ceil(r.height) + 2);   // + the 1px border
}

pop.addEventListener('click', e => {
  const ws = e.target.closest('button[data-ws]');
  if (ws) { window.popup.markWord(ws.dataset.ws || null); return; }
  const b = e.target.closest('button[data-s]');
  if (b) { window.popup.mark(b.dataset.c, b.dataset.s || null); return; }
  if (e.target.closest('button[data-learn]')) { window.popup.learn(); return; }
  const a = e.target.closest('[data-open]');
  if (a) window.popup.open(a.dataset.open);
});

window.popup.onShow(render);
