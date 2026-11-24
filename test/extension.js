/* Checks for the browser extension (extension/), in Chromium with Playwright:
 *
 *   node extension/build.js && node test/extension.js [--shots DIR]
 *
 * Serves site/ and a page of Chinese from localhost, loads the extension, and checks
 * that: the page's words are underlined; progress comes over from the site (bridge.js)
 * and recolours them; holding Ctrl over a word shows its popup; marking a character
 * there recolours the page at once and is made in the site's own store once a
 * HanziHome tab is open; and text sent to the reader arrives there. */

'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;

const PAGE = `<!doctype html><meta charset="utf-8"><title>测试</title>
<body style="font: 22px/1.8 sans-serif; margin: 40px; max-width: 700px">
<h1>今天的新闻</h1>
<p id="p1">我们今天去<b>银行</b>了。他说这本书很有意思。</p>
<p id="p2">English only here.</p>
<div id="later"></div>
</body>`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/page.html') { rsp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return rsp.end(PAGE); }
      const f = path.join(ROOT, 'site', u.replace(/^\/site\//, '/').replace(/\/$/, '/index.html'));
      if (!f.startsWith(path.join(ROOT, 'site')) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

let n = 0;
const ok = name => { n++; console.log('ok  ' + name); };
const until = async (fn, what, ms = 15000) => {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('timed out: ' + what);
    await new Promise(r => setTimeout(r, 100));
  }
};

(async () => {
  if (!fs.existsSync(path.join(EXT, 'hz', 'readerwords.js'))) throw new Error('run node extension/build.js first');
  const srv = await serve();
  const port = srv.address().port;
  const page0 = `http://127.0.0.1:${port}/page.html`;
  // the site from localhost, where bridge.js runs (as on the live site)
  const site = `http://localhost:${port}/site/`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-ext-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true, channel: 'chromium', viewport: { width: 900, height: 700 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const storage = k => sw.evaluate(k => chrome.storage.local.get(k), k);

    // ---- colour
    const page = await ctx.newPage();
    await page.goto(page0);
    const counts = () => page.evaluate(() => Object.fromEntries(['learned', 'learning', 'new']
      .map(k => [k, CSS.highlights.has('hz-' + k) ? CSS.highlights.get('hz-' + k).size : 0])));
    await until(async () => (await counts()).new >= 10, 'words underlined');
    const c0 = await counts();
    assert.strictEqual(c0.learned + c0.learning, 0);
    ok(`the page's words are underlined as new (${c0.new})`);

    // text added later is read too
    await page.evaluate(() => { document.getElementById('later').innerHTML = '<p>中国人喜欢喝茶。</p>'; });
    await until(async () => (await counts()).new > c0.new, 'added text read');
    ok('text added to the page later is read too');

    // ---- progress from the site
    const hz = await ctx.newPage();
    await hz.goto(site + '#/study');
    await hz.evaluate(() => {
      Store.setStatus('我', 'learned'); Store.setStatus('们', 'learned'); Store.setStatus('今', 'learning');
    });
    await until(async () => { const s = (await storage('store')).store; return s && s.status['我'] === 'learned'; },
      'store copied from the site');
    ok('progress comes over from the site');
    await until(async () => (await counts()).learned >= 1 && (await counts()).learning >= 1, 'page recoloured');
    ok('the page recolours: 我们 learned, 今天 learning');

    // ---- the look-up popup
    await page.bringToFront();
    const box = await page.evaluate(() => {
      const t = document.querySelector('#p1 b').firstChild, r = document.createRange();
      r.setStart(t, 0); r.setEnd(t, 2);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 4, y: b.top + b.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    await page.keyboard.down('Control');
    await until(() => page.evaluate(() => {
      const h = document.querySelector('hanzihome-popup');
      return h && h.style.display === 'block' && CSS.highlights.has('hz-look');
    }), 'popup shown');
    await page.keyboard.up('Control');
    const pop = await page.evaluate(() => document.querySelector('hanzihome-popup').getBoundingClientRect().toJSON());
    assert(pop.top > box.y, 'the popup is under the word');
    if (shots) await page.screenshot({ path: path.join(shots, 'popup.png') });
    ok('holding Ctrl over 银行 shows its popup, under it');

    // Ctrl+another key is a shortcut, not a look-up
    await page.keyboard.press('Escape');
    await page.mouse.move(box.x + 5, box.y);
    await page.keyboard.down('Control');
    await page.keyboard.press('c');
    await page.waitForTimeout(400);
    assert(!(await page.evaluate(() => { const h = document.querySelector('hanzihome-popup'); return h && h.style.display === 'block'; })));
    await page.keyboard.up('Control');
    ok('Ctrl+C opens no popup');

    const before = await counts();
    // mark 银 Learned from the popup: the page recolours at once, the site makes the change
    await page.mouse.move(box.x, box.y);
    await page.keyboard.down('Control');
    await until(() => page.evaluate(() => document.querySelector('hanzihome-popup').style.display === 'block'), 'popup again');
    await page.keyboard.up('Control');
    await page.locator('hanzihome-popup .wp-char button[data-s="learned"]').first().click();
    await until(async () => (await counts()).learning > before.learning, '银行 recoloured as learning');
    await until(() => page.evaluate(() => !!document.querySelector('hanzihome-popup')
      .shadowRoot.querySelector('.wp-char button.on.learned')), 'popup shows the mark');
    if (shots) await page.screenshot({ path: path.join(shots, 'marked.png') });
    ok('marking 银 Learned in the popup recolours 银行 at once');
    await until(() => hz.evaluate(() => Store.load().status['银'] === 'learned'), 'site store has 银');
    await until(async () => ((await storage('queue')).queue || []).length === 0, 'queue emptied');
    ok('the open HanziHome tab made the change in its own store');

    // a change made while no HanziHome tab is open waits for the next one
    await hz.close();
    await sw.evaluate(() => new Promise(r => chrome.storage.local.set({ bridges: [] }, r)));
    await page.locator('hanzihome-popup .wp-char button[data-s="learned"]').nth(1).click();
    await until(async () => ((await storage('queue')).queue || []).length === 1, 'change waits');
    const hz2 = await ctx.newPage();
    await hz2.goto(site + '#/study');
    await until(() => hz2.evaluate(() => Store.load().status['行'] === 'learned'), 'applied on the next visit');
    await until(async () => ((await storage('queue')).queue || []).length === 0, 'queue emptied again');
    await until(async () => (await counts()).learned > before.learned, '银行 now learned');
    ok('a change made with HanziHome closed is made the next time it opens');

    // add the word to the lessons
    await page.bringToFront();
    await page.locator('hanzihome-popup button[data-learn]').click();
    await until(() => hz2.evaluate(() => !!Store.load().items['银行']), 'word in lessons', 30000);
    const ex = await hz2.evaluate(() => Store.load().items['银行'].ex);
    assert(ex && ex.text.includes('我们今天去银行了'), 'its sentence is the example: ' + JSON.stringify(ex));
    await until(() => page.evaluate(() => /In lessons|Novice|Apprentice/.test(document.querySelector('hanzihome-popup').shadowRoot.textContent)), 'popup says so');
    ok('Add to lessons puts 银行 in the site\'s lessons, with its sentence');

    // ---- read in HanziHome
    await sw.evaluate(() => new Promise(res => {
      chrome.storage.local.set({ read: { text: '这是从扩展来的文字。', title: 'From the extension' } }, res);
    }));
    const reader = await ctx.newPage();
    await reader.goto(site + '#/reader');
    await until(() => reader.evaluate(() => location.hash === '#/reader/text' && readerText().includes('扩展')), 'reader got the text');
    ok('text sent to the reader opens there');

    console.log(`\n${n} checks passed`);
  } finally {
    await ctx.close();
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
