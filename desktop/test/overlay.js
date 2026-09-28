/* Do the overlay's bars land under the right words?
 *
 * Runs the overlay controller on a test picture instead of the screen, in a
 * window drawn off screen, puts the picture behind the bars and saves the result.
 * A few characters are given made-up statuses so all three colours show.
 *
 *   npx electron test/overlay.js [picture.png] [out.png]      (from desktop/)
 *   default: test/out/s1-0.png -> test/out/overlay.png (run test/ocr.js first)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, nativeImage } = require('electron');
const { OcrHelper } = require('../src/ocr');
const { loadHZ } = require('../src/data');
const { Overlays } = require('../src/overlays');

const picture = path.resolve(process.argv[2] || path.join(__dirname, 'out', 's1-0.png'));
const out = path.resolve(process.argv[3] || path.join(__dirname, 'out', 'overlay.png'));
const STATUS = { '我': 'learned', '妈': 'learned', '你': 'learned', '了': 'learned', '鸡': 'learning', '做': 'learning' };

app.on('window-all-closed', () => {});
process.on('unhandledRejection', e => { console.error('failed:', e); app.exit(1); });

app.whenReady().then(async () => {
  const { width: w, height: h } = nativeImage.createFromPath(picture).getSize();
  const HZ = loadHZ(['index', 'readings', 'readerwords']);
  const ocr = new OcrHelper();
  const overlays = new Overlays({
    ocr: () => ocr, HZ: () => HZ, status: () => STATUS, exclude: () => null,
    settings: () => ({ show: { learned: true, learning: true, new: true }, interval: 100000 }),
    picture: { path: picture, w, h }, offscreen: true, log: m => console.log(m),
  });
  await overlays.start();
  const pane = overlays.panes[0];
  for (let t = 0; t < 40 && !pane.words.length; t++) await new Promise(r => setTimeout(r, 250));

  await pane.win.webContents.executeJavaScript(`document.body.style.background =
    'url(${pathToFileURL(picture).href}) top left no-repeat'`);
  await new Promise(r => setTimeout(r, 600));
  fs.writeFileSync(out, (await pane.win.webContents.capturePage()).toPNG());
  console.log(`saved ${path.relative(process.cwd(), out)}: ${pane.words.length} words`);
  overlays.stop();
  ocr.close();
  app.quit();
});
