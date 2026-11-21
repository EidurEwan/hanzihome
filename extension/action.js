/* action.js — the toolbar popup: the extension's settings, kept in chrome.storage.local
 * as `settings` (content.js follows them as they change), and where your progress
 * stands. */

'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = id => document.getElementById(id);
const DEFAULTS = { on: true, show: { learned: true, learning: true, new: true }, key: 'ctrl', paused: [] };
let settings, tab = null, host = '';

const save = () => api.storage.local.set({ settings });

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
}

function paint(st) {
  $('on').checked = settings.on;
  $('colours').classList.toggle('off', !settings.on);
  for (const b of document.querySelectorAll('[data-show]')) b.checked = settings.show[b.dataset.show] !== false;
  $('key').value = settings.key;
  $('key-help').textContent = settings.key === 'off' ? 'Looking words up is off.'
    : `…on its own, and point at a word to see its popup. Esc closes it.`;
  $('site-row').hidden = !host;
  $('host').textContent = host;
  $('here').checked = !settings.paused.includes(host);

  const store = st.store;
  if (store && st.storeAt) {
    const L = Object.values(store.status).filter(x => x).length;
    const W = Object.values(store.wstatus || {}).filter(x => x).length;
    $('progress').textContent = `Your progress: ${L} character${L === 1 ? '' : 's'} and ${W} word${W === 1 ? '' : 's'} known `
      + `(from HanziHome, ${ago(st.storeAt)}).`;
  } else {
    $('progress').textContent = 'No progress yet: open HanziHome in this browser once and it comes over by itself. '
      + 'Until then every word counts as unknown.';
  }
  const q = (st.queue || []).length;
  $('queue').hidden = !q;
  $('queue').textContent = `${q} change${q === 1 ? '' : 's'} made here will be saved next time HanziHome is open.`;
}

async function refresh() {
  const st = await api.storage.local.get(['settings', 'store', 'storeAt', 'queue']);
  settings = Object.assign({}, DEFAULTS, st.settings || {});
  settings.show = Object.assign({}, DEFAULTS.show, settings.show);
  settings.paused = settings.paused || [];
  paint(st);
}

async function init() {
  try {
    [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const u = new URL(tab.url);
    if (/^https?:$/.test(u.protocol)) host = u.hostname;
  } catch (e) { tab = null; }
  await refresh();

  $('on').addEventListener('change', e => { settings.on = e.target.checked; save(); });
  for (const b of document.querySelectorAll('[data-show]'))
    b.addEventListener('change', e => { settings.show[b.dataset.show] = e.target.checked; save(); });
  $('key').addEventListener('change', e => { settings.key = e.target.value; save(); });
  $('here').addEventListener('change', e => {
    settings.paused = settings.paused.filter(h => h !== host);
    if (!e.target.checked) settings.paused.push(host);
    save();
  });
  $('open').addEventListener('click', async () => { await api.runtime.sendMessage({ t: 'openSite' }); window.close(); });
  $('read').addEventListener('click', async () => {
    let r = null;
    try { r = await api.tabs.sendMessage(tab.id, { t: 'pageText' }, { frameId: 0 }); } catch (e) { r = null; }
    if (!r || !r.text.trim()) { $('read').textContent = 'No text to read on this page'; $('read').disabled = true; return; }
    await api.runtime.sendMessage({ t: 'read', text: r.text, title: r.title });
    window.close();
  });

  // how this page's words stand
  if (tab) {
    try {
      const c = await api.tabs.sendMessage(tab.id, { t: 'stats' }, { frameId: 0 });
      if (c && c.learned + c.learning + c.new) {
        $('page').hidden = false;
        $('counts').innerHTML = `<span>Words here:</span> <span><b style="color:var(--learned)">${c.learned}</b> known</span>`
          + `<span><b style="color:var(--learning)">${c.learning}</b> partly known</span><span><b style="color:var(--new)">${c.new}</b> unknown</span>`;
      }
    } catch (e) { /* no content script here */ }
  }
  api.storage.onChanged.addListener(refresh);
}

init();
