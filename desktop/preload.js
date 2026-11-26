// Small bridge the web app can use to know it's running as the desktop app (the app itself doesn't need it to work).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sporesNative', {
  isApp: true,
  platform: process.platform,
  // Updates (see updater.js): what version this is and whether a newer one is out, a "check now", and "get it".
  updates: {
    state: () => ipcRenderer.invoke('spores:upd-state'),
    check: () => ipcRenderer.invoke('spores:upd-check'),
    act: () => ipcRenderer.invoke('spores:upd-act'),
    on: cb => { const f = (e, s) => cb(s); ipcRenderer.on('spores:upd', f); return () => ipcRenderer.removeListener('spores:upd', f); }
  }
});
