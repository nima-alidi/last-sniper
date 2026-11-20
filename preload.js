'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  isApp: true,
  hostStart: port => ipcRenderer.invoke('host:start', { port }),
  hostStop: () => ipcRenderer.invoke('host:stop'),
  localIPs: () => ipcRenderer.invoke('net:ips'),
  quit: () => ipcRenderer.invoke('app:quit'),
  toggleFullscreen: () => ipcRenderer.invoke('app:fullscreen'),
});
