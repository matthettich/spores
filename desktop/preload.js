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
  },
  // Song files (see files.js): each returns {path, name, bytes} / {ok, path, name} / {error} / null (dialog cancelled).
  file: {
    open: near => ipcRenderer.invoke('spores:file-open', near),
    read: p => ipcRenderer.invoke('spores:file-read', p),
    save: (p, bytes) => ipcRenderer.invoke('spores:file-save', p, bytes),
    saveAs: (name, bytes, near) => ipcRenderer.invoke('spores:file-saveas', name, bytes, near),
    recent: () => ipcRenderer.invoke('spores:recent'),
    // tell the window whether the song has unsaved changes (it asks before closing), and under what name
    dirty: (isDirty, name) => ipcRenderer.send('spores:dirty', !!isDirty, String(name || ''))
  },
  // Export (see files.js): pick → the path or null (cancelled); write → {ok, path, name} / {error}; show → in Finder / Explorer
  out: {
    pick: (name, near) => ipcRenderer.invoke('spores:out-pick', name, near),
    write: (p, bytes) => ipcRenderer.invoke('spores:out-write', p, bytes),
    show: p => ipcRenderer.invoke('spores:out-show', p)
  }
});
