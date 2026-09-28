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
  hoverKey: 'ctrl',          // hold to look up: 'ctrl', 'alt', 'shift' or 'off'.
                             // Not Alt by default: many programs open their menu
                             // bar when Alt is pressed and let go on its own.
  pause: [],                 // program names ("eldenring") where the app stays out of the way
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { /* first run */ }
  return Object.assign({}, DEFAULTS, saved, {
    show: Object.assign({}, DEFAULTS.show, saved.show),
    pause: Array.isArray(saved.pause) ? saved.pause : [],
  });
}

function saveSettings(s) {
  try { fs.writeFileSync(file(), JSON.stringify(s, null, 2)); } catch (e) { console.error('could not save settings', e); }
}

module.exports = { loadSettings, saveSettings };
