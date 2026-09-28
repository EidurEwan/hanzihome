/* Does the overlay stay out of the OCR helper's screen captures?
 *
 * Shows a small magenta square for a moment, built like the overlay (a
 * transparent, click-through, always-on-top window), once with content
 * protection and once without, and asks the helper for the average colour
 * under it. Unprotected, the capture should be magenta; protected, it should be
 * whatever is behind. Only that average colour is read, never the screen itself.
 *
 *   npx electron test/protect.js        (from desktop/)
 */

'use strict';

const { app, BrowserWindow, screen } = require('electron');
const { OcrHelper } = require('../src/ocr');

const SIZE = 60;
const isMagenta = ([r, g, b]) => r > 200 && g < 60 && b > 200;

// the test closes its first window before opening the second: don't quit in between
app.on('window-all-closed', () => {});
process.on('unhandledRejection', e => { console.error('failed:', e); app.exit(1); });

app.whenReady().then(async () => {
  const ocr = new OcrHelper();
  const d = screen.getPrimaryDisplay();
  const dip = { x: d.workArea.x + 40, y: d.workArea.y + 40, width: SIZE, height: SIZE };
  const phys = screen.dipToScreenRect(null, dip);
  // sample inside the square, away from its antialiased edge
  const probe = { x: phys.x + 8, y: phys.y + 8, w: phys.width - 16, h: phys.height - 16 };

  const results = {};
  for (const protect of [false, true]) {
    const win = new BrowserWindow(Object.assign({
      transparent: true, frame: false, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, type: 'toolbar', show: false, hasShadow: false,
    }, dip));
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(protect);
    await win.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="margin:0;background:transparent"><div style="width:100vw;height:100vh;background:#ff00ff"></div></body>'));
    win.showInactive();
    await new Promise(r => setTimeout(r, 700));
    results[protect ? 'protected' : 'unprotected'] = (await ocr.request('color', probe)).rgb;
    win.destroy();
    await new Promise(r => setTimeout(r, 300));
  }
  ocr.close();

  const u = results.unprotected, p = results.protected;
  console.log(`display scale ${d.scaleFactor}; square at ${JSON.stringify(dip)} (DIP) = ${JSON.stringify(phys)} (physical)`);
  console.log(`unprotected: rgb ${u} -> ${isMagenta(u) ? 'captured (as expected)' : 'NOT captured: this test cannot tell anything'}`);
  console.log(`protected:   rgb ${p} -> ${isMagenta(p) ? 'CAPTURED: the overlay would be read by OCR' : 'left out of the capture'}`);
  app.quit();
});
