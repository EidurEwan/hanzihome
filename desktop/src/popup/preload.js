/* The hover popup's channel to desktop/src/hover.js. */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popup', {
  onShow: cb => ipcRenderer.on('popup-show', (e, data) => cb(data)),
  size: (w, h) => ipcRenderer.send('popup-size', w, h),
  mark: (c, s) => ipcRenderer.send('popup-mark', c, s),
  markWord: s => ipcRenderer.send('popup-wmark', s),
  learn: () => ipcRenderer.send('popup-learn'),
  open: c => ipcRenderer.send('popup-open', c),
});
