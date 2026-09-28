/* The bridge between the site and the desktop app. The site (site/app.js) checks
 * for window.hanzihomeDesktop and tells it each time its progress store is saved,
 * so the app always has a current copy for the screen overlay. */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hanzihomeDesktop', {
  saved: json => ipcRenderer.send('store-saved', String(json)),
});
