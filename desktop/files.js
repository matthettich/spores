// Open / Save for the desktop app: the page's file channels (spores:file-open / file-read / file-save / file-saveas /
// spores:recent). Dialog and write shape follow ...Thunder Plus (electron/main.js thunder:file-*). Only .spores / .json
// files the person picked (path-allow.js) are read or written; bytes travel as Uint8Array / ArrayBuffer.
'use strict';
const fs = require('fs'), fsp = fs.promises, path = require('path');
const { createAllowList, isSongFile } = require('./path-allow');

const NOT_APP = 'not from the Spores window';
const MAX_BYTES = 512 * 1024 * 1024;
const RECENT = 8;
const OPEN_FILTERS = [{ name: 'Spores song', extensions: ['spores', 'json'] }];
const SAVE_FILTERS = [{ name: 'Spores song', extensions: ['spores'] }];

const toBuffer = d => d instanceof ArrayBuffer ? Buffer.from(d) : ArrayBuffer.isView(d) ? Buffer.from(d.buffer, d.byteOffset, d.byteLength) : null;

// deps: ipcMain, dialog, app, getWin() (the window dialogs hang off), onChange() (the recent list changed),
// onDirty(isDirty, name) (the page says whether the song has unsaved changes)
function setupFiles({ ipcMain, dialog, app, getWin, onChange, onDirty, allowFile }) {
  const allow = createAllowList({ file: allowFile === undefined ? path.join(app.getPath('userData'), 'allowed-paths.txt') : allowFile });
  const fromApp = e => { try { const u = new URL(e.senderFrame.url); return u.protocol === 'app:' && u.host === 'spores'; } catch (err) { return false; } };
  const dirOf = near => isSongFile(near) && fs.existsSync(path.dirname(near)) ? path.dirname(near) : app.getPath('documents');
  const remember = p => { allow.allow(p); try { app.addRecentDocument(p); } catch (e) {} if (onChange) onChange(); };

  async function readSong(p) {
    if (!isSongFile(p)) return { error: 'that isn’t a .spores or .json file' };
    const bad = allow.check(p); if (bad) return { error: bad };
    try {
      if ((await fsp.stat(p)).size > MAX_BYTES) return { error: 'that file is too big to be a song' };
      return { path: p, name: path.basename(p), bytes: new Uint8Array(await fsp.readFile(p)) };
    } catch (e) { return { error: e.code === 'ENOENT' ? 'it isn’t there any more' : e.message }; }
  }
  // written next to the file first, then renamed over it, so a crash mid-save never leaves half a song
  async function writeSong(p, data) {
    const buf = toBuffer(data);
    if (!isSongFile(p) || !buf) return { error: 'not a song file' };
    const bad = allow.check(p); if (bad) return { error: bad };
    const tmp = p + '.saving';
    try { await fsp.writeFile(tmp, buf); await fsp.rename(tmp, p); return { ok: true, path: p, name: path.basename(p) }; }
    catch (e) { try { await fsp.unlink(tmp); } catch (_) {} return { error: e.message }; }
  }
  const recent = () => allow.list().slice().reverse().filter(p => isSongFile(p) && fs.existsSync(p)).slice(0, RECENT)
    .map(p => ({ path: p, name: path.basename(p) }));

  ipcMain.handle('spores:file-read', (e, p) => fromApp(e) ? readSong(p) : { error: NOT_APP });
  ipcMain.handle('spores:file-save', (e, p, data) => fromApp(e) ? writeSong(p, data) : { error: NOT_APP });
  ipcMain.handle('spores:file-open', async (e, near) => {
    if (!fromApp(e)) return { error: NOT_APP };
    const r = await dialog.showOpenDialog(getWin(), { title: 'Open a song', defaultPath: dirOf(near), properties: ['openFile'], filters: OPEN_FILTERS });
    if (r.canceled || !r.filePaths[0]) return null;
    remember(r.filePaths[0]);                  // chosen in the dialog
    return readSong(r.filePaths[0]);
  });
  ipcMain.handle('spores:file-saveas', async (e, name, data, near) => {
    if (!fromApp(e)) return { error: NOT_APP };
    const base = String(name || 'Song.spores').replace(/[\\/:*?"<>|]/g, '_');
    const r = await dialog.showSaveDialog(getWin(), { title: 'Save the song', defaultPath: path.join(dirOf(near), base), filters: SAVE_FILTERS });
    if (r.canceled || !r.filePath) return null;
    const out = /\.spores$/i.test(r.filePath) ? r.filePath : r.filePath.replace(/\.json$/i, '') + '.spores';
    remember(out);                             // chosen in the dialog
    return writeSong(out, data);
  });
  ipcMain.on('spores:dirty', (e, d, name) => { if (fromApp(e) && onDirty) onDirty(!!d, String(name || '')); });
  ipcMain.handle('spores:recent', e => fromApp(e) ? recent() : []);
  return { recent, allow };
}

module.exports = { setupFiles };
