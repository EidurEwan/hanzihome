/* Updates from the repository's GitHub Releases (electron-updater).
 *
 * The installed app looks a minute after it starts and then every six hours. A
 * newer release downloads in the background and installs when the app quits; the
 * tray and the site's Settings page say when one is waiting, and can restart into
 * it now. A copy running from the repository (npm start) never updates itself.
 *
 * Releases are made by .github/workflows/desktop-installer.yml from a tag that
 * matches the version in desktop/package.json; the latest.yml it publishes beside
 * the installer is what tells this app a newer version exists.
 */

'use strict';

const { app } = require('electron');

const FIRST = 60 * 1000;
const EVERY = 6 * 60 * 60 * 1000;

const state = { status: 'off', version: null, error: null };
let updater = null, changed = () => {};

function set(status, info, error) {
  state.status = status;
  if (info && info.version) state.version = info.version;
  state.error = error ? String(error.message || error).split('\n')[0] : null;
  changed(state);
}

/* onChange(state) runs whenever there is news: status is "off" (not the installed
   app), "idle", "checking", "downloading", "ready" (installs on quit) or "error" */
function start(onChange) {
  changed = onChange || changed;
  if (!app.isPackaged || updater) return;
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('checking-for-update', () => set('checking'));
  updater.on('update-not-available', () => set('idle'));
  updater.on('update-available', info => set('downloading', info));
  updater.on('update-downloaded', info => set('ready', info));
  updater.on('error', e => set('error', null, e));
  set('idle');
  setTimeout(check, FIRST);
  setInterval(check, EVERY);
}

function check() {
  if (!updater || state.status === 'downloading' || state.status === 'ready') return;
  updater.checkForUpdates().catch(e => set('error', null, e));
}

/* quit and install the downloaded update, starting the new version after */
function install() {
  if (updater && state.status === 'ready') updater.quitAndInstall(true, true);
}

module.exports = { start, check, install, state };
