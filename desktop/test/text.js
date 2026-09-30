/* Does reading text directly (UI Automation, desktop/ocr/TextReader.cs) get the
 * same characters, in the same places, as the page really has, and how does it
 * compare with the OCR?
 *
 * Shows a window of Chinese text for a few seconds (it has to be on screen: text
 * is found by pointing at it), measures where every character really is with the
 * page's own DOM, then asks the helper:
 *   text-at     the line under a character, for three kinds of line
 *   read-text   the window's visible text
 *   screen      the window read with "text":true (direct, and OCR for the canvas,
 *               which only shows pixels), and with the OCR alone
 * and prints how many characters each got right, how far their boxes are from the
 * real ones, and how long it took. Then it looks words up as the app does when the
 * key is held (Hover.direct), and reads again under a window like the colour
 * overlay's, which the text must be found through.
 *
 *   npx electron test/text.js          (from desktop/)
 */

'use strict';

const { app, BrowserWindow, screen } = require('electron');
const { OcrHelper } = require('../src/ocr');
const { directParagraphs } = require('../src/layout');
const { loadHZ } = require('../src/data');
const { Hover } = require('../src/hover');

const LINES = {
  a: '我家有一只小猫，名字叫米米。',
  b: '我今天学了 HanziHome 的 lesson 和复习。',
  c: '他说：“你好！”这是链接，然后继续。',
};
const LONG = '学习汉语的时候，读很多文章是很有用的。每天读一点，慢慢地你会认识越来越多的字，'
  + '也会更容易明白句子的意思。有时候一个字有两个读音，要看上下文才知道怎么读。';
const CANVAS = '画布上的字';

const HTML = `<!doctype html><meta charset="utf-8"><body style="margin:24px;font:22px 'Microsoft YaHei',sans-serif;background:#fff;color:#111">
  <p id="a">${LINES.a}</p>
  <p id="b">${LINES.b}</p>
  <p id="c">他说：“你好！”<a href="#">这是链接</a>，然后继续。</p>
  <p id="d" style="width:620px">${LONG}</p>
  <canvas id="k" width="300" height="60"></canvas>
  <script>
    const k = document.getElementById('k').getContext('2d');
    k.font = "32px 'Microsoft YaHei'"; k.fillStyle = '#111'; k.fillText('${CANVAS}', 4, 42);
  </script></body>`;

const wait = ms => new Promise(r => setTimeout(r, ms));
app.on('window-all-closed', () => {});
process.on('unhandledRejection', e => { console.error('failed:', e); app.exit(1); });

app.whenReady().then(async () => {
  const win = new BrowserWindow({ x: 80, y: 80, width: 900, height: 620, alwaysOnTop: true, show: false,
    webPreferences: { sandbox: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  win.showInactive();
  win.moveTop();
  await wait(800);

  // where each character really is, in physical screen pixels
  const content = win.getContentBounds();
  const dom = await win.webContents.executeJavaScript(`(() => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) {
      if (n.parentNode.tagName === 'SCRIPT') continue;
      const s = n.textContent;
      for (let i = 0; i < s.length; i++) {
        if (!s[i].trim()) continue;
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        out.push({ t: s[i], x: b.left, y: b.top, w: b.width, h: b.height });
      }
    }
    return out;
  })()`);
  const phys = r => screen.dipToScreenRect(win, { x: content.x + r.x, y: content.y + r.y, width: r.w, height: r.h });
  const truth = dom.map(c => Object.assign({ t: c.t }, phys(c)));
  const hwnd = Number(win.getNativeWindowHandle().readBigUInt64LE(0));
  const area = screen.dipToScreenRect(win, content);

  const ocr = new OcrHelper();
  // compare characters read with the real ones: right, and how far their boxes are
  const score = lines => {
    let right = 0, off = 0, n = 0;
    const pool = truth.slice();
    for (const l of lines) for (const c of l.chars) {
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      let best = null, d = Infinity;
      for (const t of pool) {
        const dd = Math.hypot(t.x + t.width / 2 - cx, t.y + t.height / 2 - cy);
        if (dd < d) { d = dd; best = t; }
      }
      if (best && best.t === c.t && d < best.width) { right++; off += d; n++; pool.splice(pool.indexOf(best), 1); }
    }
    return { right, of: truth.length, off: n ? (off / n).toFixed(1) : '-' };
  };

  // Chromium turns its accessibility on when first asked: ask once, then measure
  await ocr.request('read-text', { hwnd });
  await wait(700);

  console.log('text-at (the line under a character):');
  for (const [id, target] of [['a', '名'], ['b', '复'], ['c', '链'], ['d', '音']]) {
    const t = truth.find(c => c.t === target);
    const r = await ocr.request('text-at', { x: t.x + t.width / 2, y: t.y + t.height / 2 });
    const line = r.lines[0];
    const c = line && line.chars.find(ch => ch.t === target);
    const off = c ? Math.hypot(c.x + c.w / 2 - (t.x + t.width / 2), c.y + c.h / 2 - (t.y + t.height / 2)).toFixed(1) : '-';
    console.log(`  ${id} ${target}: ${line ? '"' + line.text + '"' : 'nothing (' + r.why + ')'}; ${target} is ${off} px off; ${r.ms} ms`);
  }

  const rt = await ocr.request('read-text', { hwnd });
  const want = [LINES.a, LINES.b, LINES.c, LONG];
  // the lines joined into paragraphs, as "On screen now" does
  const paras = directParagraphs(rt.lines);
  console.log(`read-text: ${paras.length ? want.filter(w => paras.includes(w)).length + ' of 4 paragraphs exact, '
    + paras.length + ' in all' : 'nothing (' + rt.why + ')'}` +
    `, canvas ${rt.text.includes(CANVAS) ? 'included (?!)' : 'left out'}; ${rt.ms} ms`);

  const rect = { x: area.x, y: area.y, w: area.width, h: area.height };
  await ocr.request('forget');
  const both = await ocr.request('screen', Object.assign({ text: true, hwnd, incremental: true }, rect));
  const direct = both.lines.filter(l => l.src === 'uia'), rest = both.lines.filter(l => l.src !== 'uia');
  const sb = score(both.lines);
  console.log(`screen, direct + OCR: ${direct.length} lines direct, ${rest.length} by OCR` +
    ` (${rest.map(l => l.text).join(' / ')}); ${sb.right} of ${sb.of} characters right, ${sb.off} px off;` +
    ` ${both.ms.total} ms (direct ${both.ms.text} ms)`);
  const again = await ocr.request('screen', Object.assign({ text: true, hwnd, incremental: true }, rect));
  console.log(`  again, nothing changed: changed=${again.changed}, ${again.ms.total} ms`);

  await ocr.request('forget');
  const only = await ocr.request('screen', Object.assign({ incremental: false }, rect));
  const so = score(only.lines);
  console.log(`screen, OCR alone: ${so.right} of ${so.of} characters right, ${so.off} px off; ${only.ms.total} ms`);

  // the look-up, as the app does it when a key is held: the word under the pointer
  const HZ = loadHZ(['index', 'readings', 'readerwords']);
  const hover = new Hover({ ocr: () => ocr, HZ: () => HZ, direct: () => true, skip: [],
    key: () => 'off', overlays: () => null, status: () => ({}), log: () => {} });
  const got = [];
  for (const word of ['名字', '链接', '读音', '复习']) {
    const t = truth.find(c => c.t === word[0] && truth[truth.indexOf(c) + 1] && truth[truth.indexOf(c) + 1].t === word[1]);
    const started = Date.now();
    const hit = await hover.direct(screen.screenToDipPoint({ x: t.x + t.width / 2, y: t.y + t.height / 2 }));
    got.push(`${word} → ${hit ? hit.text : 'nothing'} (${Date.now() - started} ms)`);
  }
  console.log('look-up: ' + got.join(', '));

  // again under a window like the colour overlay's: see-through, click-through, on
  // top of everything. The text has to be found through it.
  const cover = new BrowserWindow({ x: 60, y: 60, width: 960, height: 680, transparent: true, frame: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, type: 'toolbar', hasShadow: false, show: false });
  cover.setIgnoreMouseEvents(true);
  cover.setAlwaysOnTop(true, 'screen-saver');
  await cover.loadURL('data:text/html,<body style="background:transparent"></body>');
  cover.showInactive();
  await wait(500);
  const t = truth.find(c => c.t === '名');
  const under = await ocr.request('text-at', { x: t.x + t.width / 2, y: t.y + t.height / 2, skip: [process.pid + 1e7] });
  await ocr.request('forget');
  const under2 = await ocr.request('screen', Object.assign({ text: true, hwnd, incremental: true }, rect));
  console.log(`under an overlay: text-at ${under.lines[0] ? '"' + under.lines[0].text + '"' : 'nothing (' + under.why + ')'};` +
    ` screen ${under2.direct} lines direct`);
  cover.destroy();

  ocr.close();
  win.destroy();
  app.quit();
});
