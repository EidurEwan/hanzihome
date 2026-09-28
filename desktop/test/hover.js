/* Does pointing at a word give the right popup, and does marking from it work?
 *
 * Reads a test picture with the overlay controller (off screen, as in
 * test/overlay.js), "points" at a word with Hover.lookAt (no keyboard hook, no
 * real pointer), saves the popup, clicks Learned on its first character inside
 * the popup page, and saves it again. Marking goes through the same channel as in
 * the app, to a stand-in for the site's store.
 *
 *   npx electron test/hover.js [word]        (from desktop/; default 鸡蛋)
 *   -> test/out/hover-1.png, test/out/hover-2.png
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');
const { OcrHelper } = require('../src/ocr');
const { loadHZ } = require('../src/data');
const { Overlays } = require('../src/overlays');
const { Hover } = require('../src/hover');

const picture = path.join(__dirname, 'out', 's1-0.png');
const want = process.argv.find(a => /[\u4e00-\u9fff]/.test(a)) || '鸡蛋';
const OUT = n => path.join(__dirname, 'out', `hover-${n}.png`);
const status = { '我': 'learned', '做': 'learning' };
const wait = ms => new Promise(r => setTimeout(r, ms));
let pointer = { x: -1, y: -1 };

app.on('window-all-closed', () => {});
process.on('unhandledRejection', e => { console.error('failed:', e); app.exit(1); });

app.whenReady().then(async () => {
  const { width: w, height: h } = nativeImage.createFromPath(picture).getSize();
  const HZ = loadHZ(['index', 'readings', 'readerwords']);
  const ocr = new OcrHelper();
  const overlays = new Overlays({
    ocr: () => ocr, HZ: () => HZ, status: () => status, exclude: () => null,
    settings: () => ({ show: { learned: true, learning: true, new: true }, interval: 100000 }),
    picture: { path: picture, w, h }, offscreen: true,
  });
  const marks = [];
  const hover = new Hover({
    key: () => 'off', overlays: () => overlays, ocr: () => ocr, HZ: () => HZ, status: () => status,
    mark: async (c, s) => { marks.push(c + '=' + s); if (s) status[c] = s; else delete status[c]; return status; },
    open: () => {}, offscreen: true, log: m => console.log(m),
    pointer: () => pointer,          // stays on the word, as a real user's would
  });

  await overlays.start();
  const pane = overlays.panes[0];
  for (let t = 0; t < 40 && !pane.words.length; t++) await wait(250);
  const word = pane.words.find(x => x.text === want);
  if (!word) throw new Error(`no word ${want} among ${pane.words.length}`);

  pointer = { x: word.x + word.w / 2, y: word.y + word.h / 2 };
  await hover.lookAt(pointer);
  await wait(700);
  const page = hover.win.webContents;
  const shot = async n => fs.writeFileSync(OUT(n), (await page.capturePage()).toPNG());
  await shot(1);
  const before = await page.executeJavaScript('document.getElementById("word-pop").innerText');

  const first = [...want][0];
  await page.executeJavaScript(`document.querySelector('button[data-c="${first}"][data-s="learned"]').click()`);
  await wait(700);
  await shot(2);
  const on = await page.executeJavaScript(
    `[...document.querySelectorAll('button.on')].map(b => b.dataset.c + '=' + (b.dataset.s || 'none')).join(' ')`);

  console.log(`pointed at ${want} (${Math.round(word.x)},${Math.round(word.y)} ${Math.round(word.w)}×${Math.round(word.h)})`);
  console.log('popup: ' + before.replace(/\s+/g, ' ').trim());
  console.log(`clicked Learned on ${first}: store got ${marks.join(', ') || 'nothing'}; popup now shows ${on || 'no marks'}`);
  console.log(`window ${JSON.stringify(hover.win.getContentBounds())}; saved ${path.relative(process.cwd(), OUT(1))}, ${path.relative(process.cwd(), OUT(2))}`);
  overlays.stop();
  hover.hide();
  ocr.close();
  app.quit();
});
