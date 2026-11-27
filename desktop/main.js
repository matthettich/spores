// ...Spores desktop app: the web app (copied into desktop/app/ by copy-app.js) in its own window.
//
// It is served from app://spores/ rather than file://, because ES modules, the AudioWorklet, the sound Worker and
// pump-synth.wasm all refuse to load from file://. The scheme is marked secure, so the AudioWorklet (which needs a
// secure page) works, and fetch works, so the wasm loads.
const { app, BrowserWindow, session, Menu, shell, dialog, screen, protocol, net, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { setupUpdates } = require('./updater');
const { setupFiles } = require('./files');
let updates = { check: async () => false, state: () => null, act: async () => false };

const APP_DIR = path.join(__dirname, 'app');
protocol.registerSchemesAsPrivileged([{ scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

// Sound may start without a click first (the first Play still resumes the AudioContext, as in Chrome).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('Spores');

// MIDI (the Seeds link and MIDI tracks), audio inputs and outputs (Tune CV, choosing the CV output device): granted
// once, like a normal app. Everything else is refused.
const ALLOWED = new Set(['midi', 'midiSysex', 'media', 'audioCapture', 'speaker-selection', 'clipboard-sanitized-write']);

let mainWin = null;
let files = { recent: () => [] };
// Closing (or quitting) with unsaved changes asks first. The page says whether the song is unsaved (spores:dirty).
let dirty = false, songName = '', closeOk = false, asking = false, quitting = false;

function createWindow(){
  const work = screen.getPrimaryDisplay().workAreaSize;
  mainWin = new BrowserWindow({
    width: Math.min(1440, work.width), height: Math.min(900, work.height), minWidth: 1024, minHeight: 640,
    title: '...Spores', backgroundColor: '#ffffff', show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true,
      // MIDI notes and clock are timed from the page: a hidden or covered window must not slow its timers down,
      // or the Seeds link and MIDI tracks would drift.
      backgroundThrottling: false
    }
  });
  dirty = false; songName = ''; closeOk = false;
  mainWin.on('close', e => {
    if (closeOk || !dirty) return;
    e.preventDefault();
    askBeforeClose();
  });
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.loadURL('app://spores/index.html');
  // Links out of the app open in the normal browser; no other windows.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://spores/')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  mainWin.on('closed', () => { mainWin = null; });
}

async function askBeforeClose(){
  if (asking || !mainWin) return;
  asking = true;
  try {
    // Cancel is the default (Enter / Escape), so a stray key never loses or closes anything
    const r = await dialog.showMessageBox(mainWin, { type: 'warning', buttons: ['Save', 'Don’t save', 'Cancel'], defaultId: 2, cancelId: 2,
      message: songName ? `Save changes to “${songName}”?` : 'Save changes to this song?',
      detail: 'If you don’t save, the changes since the last save are lost from the file. (Spores still keeps a recovery copy in this app.)' });
    if (r.response === 0){
      const saved = await pageCall('save()');       // false: cancelled or failed, so the window stays open
      if (saved !== true){ quitting = false; return; }
    } else if (r.response !== 1){ quitting = false; return; }
    closeOk = true;
    if (mainWin) mainWin.close();
    if (quitting) app.quit();
  } finally { asking = false; }
}
// File menu → the page (js/ui/savefile.js), which already handles the keys: the menu shows them but doesn't take them
const pageCall = expr => mainWin ? mainWin.webContents.executeJavaScript(`window.spores && window.spores.files.${expr}`).catch(() => false) : Promise.resolve(false);

// Undo / Redo from the menu do what Ctrl/Cmd+Z do on the page: undo the song, or the text in a text field.
// The keys themselves are left to the page (registerAccelerator: false), which already handles them.
const pageUndo = redo => mainWin && mainWin.webContents.executeJavaScript(`(() => {
  const a = document.activeElement, typing = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['range', 'checkbox', 'button', 'radio'].includes(a.type)));
  if (typing) document.execCommand(${redo ? "'redo'" : "'undo'"});
  else if (window.spores) window.spores.store.${redo ? 'redo' : 'undo'}();
})()`).catch(() => {});

function buildMenu(){
  const recent = files.recent();
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' },
      { label: 'Check for Updates…', click: () => updates.check() },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
    ]}] : []),
    { label: 'File', submenu: [
      { label: 'Save', accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: () => pageCall('save()') },
      { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', registerAccelerator: false, click: () => pageCall('saveAs()') },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', registerAccelerator: false, click: () => pageCall('open()') },
      { label: 'Open Recent', submenu: recent.length
        ? recent.map(r => ({ label: r.name, click: () => pageCall(`openPath(${JSON.stringify(r.path)})`) }))
        : [{ label: 'No recent songs', enabled: false }] },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' } ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: () => pageUndo(false) },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', registerAccelerator: false, click: () => pageUndo(true) },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]},
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }
    ]},
    { role: 'windowMenu' },
    ...(!isMac ? [{ label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => updates.check() }] }] : [])
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Only one copy runs: opening it again brings the open window to the front (two copies would fight over the song).
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) app.quit();
app.on('second-instance', () => {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show(); mainWin.focus();
});

if (firstCopy) app.whenReady().then(() => {
  // app://spores/<path> → a file inside desktop/app/, and nothing outside it
  protocol.handle('app', req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(APP_DIR, p));
    if (u.host !== 'spores' || !file.startsWith(APP_DIR + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(ALLOWED.has(perm)));
  ses.setPermissionCheckHandler((wc, perm) => ALLOWED.has(perm));

  // File › Save a copy… downloads the song: offer a proper Save box, starting in Documents.
  ses.on('will-download', (e, item) => {
    const name = item.getFilename();
    item.setSaveDialogOptions({
      title: 'Save a copy of the song', defaultPath: path.join(app.getPath('documents'), name),
      filters: /\.spores$/i.test(name) ? [{ name: 'Spores song', extensions: ['spores'] }]
        : /\.json$/i.test(name) ? [{ name: 'Spores song', extensions: ['json'] }] : []
    });
  });

  files = setupFiles({ ipcMain, dialog, app, getWin: () => mainWin, onChange: () => buildMenu(),
    onDirty: (d, name) => { dirty = d; songName = name; } });
  buildMenu();
  createWindow();
  // New versions come from the public 'spores' repo's Releases page (see updater.js).
  updates = setupUpdates({ name: '...Spores', page: 'https://github.com/matthettich/spores/releases/latest', repo: 'matthettich/spores', getWin: () => mainWin });
  ipcMain.handle('spores:upd-state', () => updates.state());
  ipcMain.handle('spores:upd-check', () => updates.check());
  ipcMain.handle('spores:upd-act', () => updates.act());
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
