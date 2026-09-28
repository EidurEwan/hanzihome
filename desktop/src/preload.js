/* The bridge between the site and the desktop app. The site (site/app.js) checks
 * for window.hanzihomeDesktop: it tells it each time its progress store is saved
 * (so the app has a current copy for the screen overlay), shows its desktop-only
 * parts ("On screen now", the Settings page's Desktop app card), and reads and
 * changes the app's settings through it. */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hanzihomeDesktop', {
  saved: json => ipcRenderer.send('store-saved', String(json)),
  readScreen: () => ipcRenderer.send('read-screen'),
  settings: () => ipcRenderer.invoke('desktop-settings'),
  set: patch => ipcRenderer.invoke('desktop-set', patch),
  onSettings: cb => ipcRenderer.on('desktop-settings-changed', (e, state) => cb(state)),
});
