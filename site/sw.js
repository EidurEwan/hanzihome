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
const SHELL = ['./', 'index.html', 'logo.svg?v=2', 'favicon.svg?v=2', 'manifest.webmanifest?v=2',
  'fonts/poppins-400.woff2', 'fonts/poppins-500.woff2', 'fonts/poppins-600.woff2',
  'img/flame.svg', 'img/gift.svg', 'img/hourglass.svg', 'img/star.svg'];

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

/* the part of a whole response that a Range header asks for, as a 206 */
async function ranged(res, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((range || '').trim());
  if (!m || (!m[1] && !m[2])) return res;
  const body = await res.arrayBuffer(), size = body.byteLength;
  let from = m[1] ? +m[1] : Math.max(0, size - +m[2]);
  const to = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (from >= size || from > to) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(body.slice(from, to + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Length': String(to - from + 1),
      'Content-Range': `bytes ${from}-${to}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

/* Sound asks for its file in ranges, and Safari won't play it unless it gets 206s. A
   206 can't be cached (cache.put throws, which used to fail the request), so the whole
   file is fetched and kept, and each range is cut from that. */
async function media(cache, req) {
  const whole = new Request(req.url);
  let res = await cache.match(whole);
  if (!res) {
    res = await fetch(whole);
    if (!res.ok) return res;
    // kept in the background: sound shouldn't wait for it, and a recording's ?v never
    // changes, so there is no older copy to look through the whole cache for
    cache.put(whole, res.clone()).catch(() => {});
  }
  return ranged(res, req.headers.get('range'));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;     // sync goes straight through
  if (req.headers.has('range') || req.destination === 'audio' || req.destination === 'video') {
    e.respondWith(caches.open(CACHE).then(cache => media(cache, req)));
    return;
  }
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
