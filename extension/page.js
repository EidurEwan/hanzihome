/* page.js — runs inside a HanziHome page itself (the manifest's "world": "MAIN"), next
 * to the site's own scripts, so it works with the site as it is deployed.
 *
 * bridge.js (the extension's side, which can't reach the page's code) and this talk
 * with window.postMessage, {hanzihomeExtension: what, ...}, within the window:
 *   bridge -> page: 'ping' (are you HanziHome?), 'apply' {ops}, 'read' {text, title}
 *   page -> bridge: 'ready', 'saved' (the store was just saved), 'applied' {ids}
 * Changes from the popup are made as the site's own buttons make them (Store.setStatus,
 * Store.setWStatus, learnFromReader), so they are saved and synced as usual. On a
 * localhost page that isn't HanziHome there is no Store, and this does nothing. */

(() => {
  'use strict';
  if (window.__hanzihomeExtPage) return;
  window.__hanzihomeExtPage = true;

  const tell = (what, m) => window.postMessage(Object.assign({ hanzihomeExtension: what }, m || {}), location.origin);
  /* the site's globals (top-level consts in its scripts, reachable by name here) */
  const site = () => (typeof Store === 'object' && Store && typeof Store.setStatus === 'function') ? Store : null;
  const fns = () => ({
    wordInfo: typeof wordInfo === 'function' ? wordInfo : null,
    learnFromReader: typeof learnFromReader === 'function' ? learnFromReader : null,
    rerenderKeepingScroll: typeof rerenderKeepingScroll === 'function' ? rerenderKeepingScroll : null,
    markNav: typeof markNav === 'function' ? markNav : null,
    currentPath: typeof currentPath === 'function' ? currentPath : null,
    setReaderText: typeof setReaderText === 'function' ? setReaderText : null,
  });
  const call = (name, ...a) => { const f = fns()[name]; return f ? f(...a) : undefined; };

  let hooked = false;
  function hook() {
    const S = site();
    if (!S || hooked) return !!S;
    hooked = true;
    // hear every save the page makes
    const save = S.save;
    S.save = function () { const r = save.apply(this, arguments); tell('saved'); return r; };
    window.addEventListener('message', onMessage);
    // another tab saved: this page starts again from its copy, and so does the extension
    window.addEventListener('storage', e => { if (e.key === S.key) tell('saved'); });
    tell('ready');
    return true;
  }

  async function onMessage(e) {
    const d = e.data;
    if (e.source !== window || !d || typeof d.hanzihomeExtension !== 'string') return;
    const S = site();
    if (d.hanzihomeExtension === 'ping') tell('ready');
    else if (d.hanzihomeExtension === 'apply' && Array.isArray(d.ops)) {
      const done = [];
      const state = s => s === 'learning' || s === 'learned' ? s : null;
      for (const op of d.ops) {
        try {
          if (op.t === 'mark' && typeof op.c === 'string') {
            S.setStatus(op.c, state(op.s));
          } else if (op.t === 'wmark' && typeof op.w === 'string') {
            if (typeof need === 'object' && need.words) await need.words();
            S.setWStatus(op.w, state(op.s), call('wordInfo', op.w));
          } else if (op.t === 'learn' && typeof op.w === 'string') {
            if (typeof need === 'object' && need.textStory) await need.textStory();
            await call('learnFromReader', op.w, String(op.p || ''), String(op.d || ''), String(op.sentence || ''));
          }
        } catch (err) { console.warn('HanziHome extension:', err); }
        done.push(op.id);
      }
      if (done.length) {
        try { call('rerenderKeepingScroll'); call('markNav', call('currentPath')); } catch (err) { /* redrawn next time */ }
      }
      tell('applied', { ids: done });
    } else if (d.hanzihomeExtension === 'read' && typeof d.text === 'string') {
      call('setReaderText', d.text.slice(0, 200000), String(d.title || '').slice(0, 80));
      location.hash = '#/reader/text';
    }
  }

  // the site's scripts have usually run by now; if not, wait for them a little
  let tries = 0;
  (function wait() { if (!hook() && ++tries < 40) setTimeout(wait, 250); })();
})();
