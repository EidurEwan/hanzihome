/* Draw the app's icons from the site's logo (site/logo.svg).
 *
 * Electron can't use SVG for tray or window icons, so Electron itself renders the
 * logo at each size (sharper than shrinking one big picture) and saves PNGs to
 * desktop/assets/. At SMALL px and below the dashed guides are left out, as in
 * site/favicon.svg: at tray size they only blur.
 *
 *   npx electron tools/make-icons.js        (from desktop/)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const LOGO = path.join(__dirname, '..', '..', 'site', 'logo.svg');
const OUT = path.join(__dirname, '..', 'assets');
const SIZES = [16, 20, 24, 32, 48, 64, 256];
const SMALL = 24;

app.whenReady().then(async () => {
  const logo = fs.readFileSync(LOGO, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const plain = logo.replace(/<path id="guides"[^>]*\/>/, '');
  if (plain === logo) throw new Error('logo.svg has no path with id="guides"');

  const win = new BrowserWindow({
    show: false, width: 256, height: 256, transparent: true, frame: false, useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<html><body style="margin:0;background:transparent"><div id="at"></div></body></html>'));

  fs.mkdirSync(OUT, { recursive: true });
  for (const s of SIZES) {
    const svg = (s <= SMALL ? plain : logo).replace('<svg ', `<svg width="${s}" height="${s}" `);
    await win.webContents.executeJavaScript(`document.getElementById('at').innerHTML = ${JSON.stringify(svg)}`);
    await new Promise(r => setTimeout(r, 150));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: s, height: s });
    fs.writeFileSync(path.join(OUT, `icon-${s}.png`), image.toPNG());
  }
  console.log('wrote', SIZES.map(s => `icon-${s}.png`).join(' '), 'to', path.relative(process.cwd(), OUT));
  app.quit();
});
