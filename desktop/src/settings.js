/* settings.js — the desktop app's own settings, in settings.json in Electron's
 * userData folder. (Progress lives in the site's store, not here.) */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  overlay: true,                                     // colour words on screen
  show: { learned: true, learning: true, new: true },
  interval: 500,                                     // ms between screen checks
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { /* first run */ }
  return Object.assign({}, DEFAULTS, saved, { show: Object.assign({}, DEFAULTS.show, saved.show) });
}

function saveSettings(s) {
  try { fs.writeFileSync(file(), JSON.stringify(s, null, 2)); } catch (e) { console.error('could not save settings', e); }
}

module.exports = { loadSettings, saveSettings };
