/* HanziHome Desktop — the Electron main process.
 *
 * The whole site (site/) runs in one window, served at app://hanzihome/ so it has
 * a proper origin for localStorage. That page owns the progress store and its
 * Google Sheet sync, exactly as in a browser. Closing the window only hides it:
 * the app lives in the tray, and the page keeps running so sync and (later) the
 * screen overlay always have the store. The page reports each save through the
 * preload bridge, and this process keeps a copy (store) for the overlay.
 *
 * The tray's "Read the screen now" runs the whole pipeline: the OCR helper reads
 * the screen, ocrfix repairs it, and the text opens in the site's reader.
 *
 *   npm start                                    (from desktop/)
 *   npm start -- --picture=a.png --read-now      read a picture instead of the
 *                                                screen, straight away (for tests)
 *   npm start -- --snapshot=out.png              save the window as a picture once
 *                                                it has drawn, then quit (for tests)
 *   npm start -- --check-store                   check the store bridge, then quit
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, net, protocol, powerMonitor, shell } = require('electron');
const { OcrHelper } = require('./ocr');
const { repair } = require('./ocrfix');
const { loadHZ } = require('./data');
const { paragraphs } = require('./layout');

const SITE = path.join(__dirname, '..', '..', 'site');
const ASSETS = path.join(__dirname, '..', 'assets');
const ORIGIN = 'app://hanzihome';
const SYNC_EVERY = 5 * 60 * 1000;

const arg = name => {
  const hit = process.argv.find(a => a === '--' + name || a.startsWith('--' + name + '='));
  return hit ? (hit.split('=')[1] || true) : null;
};

let win = null, tray = null, ocr = null, HZ = null, quitting = false;
let store = null;               // the page's progress store, as it last saved it

// ------------------------------------------------------------------ the site

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

function serveSite() {
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(SITE, decodeURIComponent(pathname)));
    if (!file.startsWith(SITE + path.sep)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function icon(size) {
  return nativeImage.createFromPath(path.join(ASSETS, `icon-${size}.png`));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 420, minHeight: 500,
    show: false, title: 'HanziHome', icon: icon(256), backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      // the page syncs and keeps the store while hidden in the tray
      backgroundThrottling: false,
      // --snapshot: a hidden window stops painting, so draw off screen instead
      offscreen: !!arg('snapshot'),
    },
  });
  win.removeMenu();
  win.loadURL(ORIGIN + '/index.html#/dashboard');

  // links out of the app open in the browser; the app itself never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN + '/')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  // F12 or Ctrl+Shift+I: developer tools; F5 / Ctrl+R: reload
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    if (k === 'f12' || (input.control && input.shift && k === 'i')) win.webContents.toggleDevTools();
    else if (k === 'f5' || (input.control && k === 'r')) win.webContents.reload();
  });

  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.once('ready-to-show', () => { if (!arg('snapshot') && !arg('read-now')) win.show(); });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// the page calls window.hanzihomeDesktop.saved(json) whenever its store changes
ipcMain.on('store-saved', (e, json) => {
  if (e.sender !== win.webContents) return;
  try { store = JSON.parse(json); } catch (err) { /* keep the last good copy */ }
});

// the page in the tray still syncs on changes, but its own timer only runs while
// it is visible; so ask it to sync now and then, and after the PC wakes
function syncNow() {
  if (win && !win.isVisible()) {
    win.webContents.executeJavaScript('Sync.on() && Sync.run(), 0', true).catch(() => {});
  }
}

// ----------------------------------------------------------- reading the screen

function helper() {
  if (!ocr || ocr.dead) ocr = new OcrHelper();
  return ocr;
}

async function readScreen() {
  const wasVisible = win.isVisible();
  if (wasVisible) {
    win.hide();                                  // read what is under the window
    await new Promise(r => setTimeout(r, 250));
  }
  try {
    const picture = arg('picture');
    const r = await helper().request('screen', picture
      ? { picture: path.resolve(String(picture)), incremental: false }
      : { incremental: false });
    if (!HZ) HZ = loadHZ(['index', 'readings', 'readerwords']);
    // Chinese lines only (menus and English text would crowd the reader), wrapped
    // lines joined back into paragraphs
    const text = paragraphs(repair(r.lines, HZ).lines).join('\n');
    if (!text) {
      await showNote('No Chinese found on the screen.');
      return;
    }
    await win.webContents.executeJavaScript(`(() => {
      setReaderText(${JSON.stringify(text)});
      if (location.hash === '#/reader/text') render(); else go('/reader/text');
    })()`, true);
    if (!arg('snapshot')) showWindow();
  } catch (e) {
    await showNote('Could not read the screen: ' + e.message);
  }
}

// a short message in the window, for when there is nothing to show
async function showNote(message) {
  await win.webContents.executeJavaScript(`(() => {
    app.innerHTML = '<div class="card"><p class="empty">' + esc(${JSON.stringify(message)}) + '</p></div>';
  })()`, true);
  showWindow();
}

/* --check-store: mark a character in the page, see this process's copy follow,
   then put the page's store back exactly as it was, and quit */
async function checkStore() {
  const page = code => win.webContents.executeJavaScript(code, true);
  const before = await page('localStorage.getItem(Store.key)');
  const status = () => store && store.status ? store.status['我'] || null : null;
  const seenAtStart = store !== null;
  await page(`Store.setStatus('我', '${status() === 'learned' ? 'learning' : 'learned'}')`);
  await new Promise(r => setTimeout(r, 300));
  const followed = status();
  await page(`(() => {
    const before = ${JSON.stringify(before)};
    before === null ? localStorage.removeItem(Store.key) : localStorage.setItem(Store.key, before);
    Store.data = null; tellDesktop();
  })()`);
  await new Promise(r => setTimeout(r, 300));
  console.log(`store bridge: copy at start ${seenAtStart ? 'yes' : 'NO'}, followed a change ${followed ? 'yes (' + followed + ')' : 'NO'}, ` +
    `restored ${(await page('localStorage.getItem(Store.key)')) === before ? 'yes' : 'NO'}`);
  quitting = true;
  app.quit();
}

// ------------------------------------------------------------------- tray

function createTray() {
  const img = nativeImage.createEmpty();
  for (const [size, scale] of [[16, 1], [20, 1.25], [24, 1.5], [32, 2]]) {
    img.addRepresentation({ scaleFactor: scale, buffer: icon(size).toPNG() });
  }
  tray = new Tray(img);
  tray.setToolTip('HanziHome');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open HanziHome', click: showWindow },
    { label: 'Read the screen now', click: readScreen },
    { type: 'separator' },
    { label: 'Quit HanziHome', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

// ------------------------------------------------------------------ start

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.setAppUserModelId('app.hanzihome.desktop');

  app.whenReady().then(() => {
    serveSite();
    createWindow();
    createTray();
    setInterval(syncNow, SYNC_EVERY);
    powerMonitor.on('resume', syncNow);

    win.webContents.once('did-finish-load', async () => {
      if (arg('check-store')) await checkStore();
      if (arg('read-now')) await readScreen();
      const out = arg('snapshot');
      if (out) {
        // wait for the page to finish (it says "Loading…" while data files load)
        for (let t = 0; t < 40; t++) {
          await new Promise(r => setTimeout(r, 250));
          if (!(await win.webContents.executeJavaScript('/Loading/.test(app.textContent)', true))) break;
        }
        await new Promise(r => setTimeout(r, 300));
        console.log('snapshot of', await win.webContents.executeJavaScript(
          'location.hash + " | " + app.textContent.replace(/\\s+/g, " ").slice(0, 120)', true));
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.resolve(String(out)), image.toPNG());
        quitting = true;
        app.quit();
      }
    });
  });

  // living in the tray: closing the last window does not quit
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    quitting = true;
    if (ocr) ocr.close();
  });
}
