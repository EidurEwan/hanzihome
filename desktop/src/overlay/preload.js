/* The overlay page's one channel: the bars to draw, from desktop/src/overlays.js. */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onBars: cb => ipcRenderer.on('bars', (e, list) => cb(list)),
});
