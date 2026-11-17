/* bridge.js — on a HanziHome tab: the extension's link to your progress.
 *
 * The site keeps your progress in its own localStorage (and syncs it, when you've
 * set that up). This hands the extension a copy whenever the page saves it, and
 * hands the page the changes made in the extension's popup on other sites, which
 * the page makes itself (Store.setStatus, Store.setWStatus, learnFromReader), as its
 * own buttons would. It also hands over text sent to the site's reader.
 *
 * The page's side is the "browser extension" block in site/app.js; the two talk
 * with window.postMessage, {hanzihomeExtension: what, ...}. On a localhost page that
 * isn't HanziHome nothing answers, and this does nothing. */

(() => {
  'use strict';
  if (window.__hanzihomeBridge) return;
  window.__hanzihomeBridge = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;
  const STORE_KEY = 'hanzicraft.v2';
  let ready = false;

  const post = (what, m) => window.postMessage(Object.assign({ hanzihomeExtension: what }, m || {}), location.origin);
  const send = m => new Promise(res => {
    try { api.runtime.sendMessage(m, r => { void (api.runtime.lastError); res(r && r.ok ? r.r : null); }); }
    catch (e) { res(null); }
  });

  /* the store, as much of it as the extension needs */
  function sendStore() {
    let d;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { d = null; }
    if (!d) d = {};
    const items = {};
    for (const [k, it] of Object.entries(d.items || {})) items[k] = (it && it.stage) || 0;
    const site = location.origin + location.pathname.replace(/[^/]*$/, '');
    return send({ t: 'store', site, data: { status: d.status || {}, wstatus: d.wstatus || {}, items } });
  }

  let flushing = false;
  async function flush() {
    if (!ready || flushing) return;
    flushing = true;
    try {
      const r = await send({ t: 'claim' });
      if (!r) return;
      if (r.ops.length) post('apply', { ops: r.ops });
      if (r.read) post('read', r.read);
    } finally { flushing = false; }
  }

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || typeof e.data.hanzihomeExtension !== 'string') return;
    const what = e.data.hanzihomeExtension;
    if (what === 'ready') {
      if (ready) return;
      ready = true;
      sendStore().then(flush);
    } else if (what === 'saved' && ready) {
      sendStore();
    } else if (what === 'applied' && Array.isArray(e.data.ids)) {
      send({ t: 'applied', ids: e.data.ids });
    }
  });

  api.runtime.onMessage.addListener(m => { if (m && m.t === 'flush') flush(); return false; });

  // the page says 'ready' once it has loaded; this asks, in case that was before now
  post('ping');
})();
