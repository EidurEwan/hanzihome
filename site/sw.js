/* HanziHome's service worker: the site keeps working without a connection once
 * installed from a web address (GitHub Pages; not from file://, and not in the
 * desktop app, which has everything on disk).
 *
 * Every file is kept in one cache as it is first used, so whatever you have opened
 * opens again offline. Settings → Use offline puts the rest in too (data/ is ~70 MB:
 * app.js offlineAll). The page itself (index.html) is asked for over the network
 * first, so a new version shows as soon as there is one; everything else carries a
 * ?v= version in its address (app.js DATA_VERSION, index.html's script tags) and is
 * served from the cache, where a newer version of a file replaces the older one.
 */

'use strict';

const CACHE = 'hanzihome';
const SHELL = ['./', 'index.html', 'logo.svg', 'favicon.svg', 'manifest.webmanifest',
  'fonts/nunito-400.woff2', 'fonts/nunito-600.woff2', 'fonts/nunito-700.woff2', 'fonts/nunito-800.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* one copy per file: a newer ?v= of it replaces the older */
async function keep(cache, req, res) {
  const url = new URL(req.url);
  if (url.search) {
    for (const old of await cache.keys()) {
      const o = new URL(old.url);
      if (o.pathname === url.pathname && o.search !== url.search) await cache.delete(old);
    }
  }
  await cache.put(req, res);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;     // sync goes straight through
  const page = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  e.respondWith(caches.open(CACHE).then(async cache => {
    if (page) {
      try {
        const res = await fetch(req);
        if (res.ok) await cache.put('index.html', res.clone());
        return res;
      } catch (err) {
        return (await cache.match('index.html')) || Response.error();
      }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) await keep(cache, req, res.clone());
    return res;
  }));
});
