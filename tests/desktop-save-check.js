// tests/desktop-save-check.js (dev only): the desktop app's Save / Open / Open Recent / close-with-unsaved prompt, with the native
// dialogs stubbed. Needs Electron + xvfb:  cd desktop && npm install && node copy-app.js && cd ..
//   xvfb-run -a desktop/node_modules/.bin/electron --no-sandbox --user-data-dir=/tmp/spores-ud tests/desktop-save-check.js
const { app, dialog, BrowserWindow, Menu } = require('electron');
const fs = require('fs'), path = require('path');
const OUT = require('os').tmpdir() + '/spores-save-out'; fs.rmSync(OUT, {recursive: true, force: true}); fs.mkdirSync(OUT, {recursive: true});
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const calls = {open: 0, save: 0, msg: 0}; let next = {};
dialog.showOpenDialog = async (...a) => { calls.open++; calls.lastOpen = a[a.length - 1]; return next.open; };
dialog.showSaveDialog = async (...a) => { calls.save++; calls.lastSave = a[a.length - 1]; return next.save; };
dialog.showMessageBox = async (...a) => { calls.msg++; calls.lastMsg = a[a.length - 1]; return {response: next.msg}; };
app.commandLine.appendSwitch('no-sandbox'); const realQuit = app.quit.bind(app); let quitCalls = 0; app.quit = () => { quitCalls++; };
require(require('path').join(__dirname, '..', 'desktop', 'main.js'));
(async () => {
  await app.whenReady(); await sleep(500);
  let w; for (let i = 0; i < 60 && !w; i++){ await sleep(250); w = BrowserWindow.getAllWindows()[0]; }
  const js = x => w.webContents.executeJavaScript(x);
  for (let i = 0; i < 60; i++){ if (await js('!!(window.spores && window.spores.files)').catch(() => false)) break; await sleep(250); }
  ok(await js('!!window.sporesNative.file'), 'page has the file bridge');
  const edit = () => js(`window.spores.store.edit('Tempo', s => { s.bpm = s.bpm === 133 ? 134 : 133; })`);
  const answer = async lbl => { await sleep(150); return js(`(() => { const b = [...document.querySelectorAll('.dialog button')].find(b => b.textContent === ${JSON.stringify(lbl)}); if (b) b.click(); return !!b; })()`); };
  const title = () => w.getTitle();
  await edit(); await sleep(400);
  ok(/^Untitled • — /.test(await title()), 'title dirty before first save: ' + await title());
  const A = path.join(OUT, 'A song.spores');
  next.save = {canceled: false, filePath: A};
  ok(await js('window.spores.files.save()') === true, 'first Save goes through the Save dialog and returns true');
  ok(calls.save === 1 && calls.lastSave.defaultPath.endsWith('Song.spores') && calls.lastSave.filters[0].extensions[0] === 'spores', 'save dialog: default Song.spores, .spores filter, starts in ' + path.dirname(calls.lastSave.defaultPath));
  ok(fs.existsSync(A) && fs.readFileSync(A)[0] === 0x50, 'file written and is a zip');
  require('child_process').execSync(`unzip -tq "${A}"`);
  ok(true, 'unzip -t passes');
  ok(/^A song — /.test(await title()), 'title: ' + await title());
  const bpmA = await js('window.spores.store.get().bpm');
  await edit(); await sleep(400);
  const t0 = fs.statSync(A).mtimeMs; const before = fs.readFileSync(A).length;
  ok(await js('window.spores.files.save()') === true && calls.save === 1, 'second Save: no dialog');
  ok(/^A song — /.test(await title()) && !(await title()).includes('•'), 'clean after save: ' + await title());
  const bpmA2 = await js('window.spores.store.get().bpm');
  // Open: write a different song as B, then open A
  next.save = {canceled: false, filePath: path.join(OUT, 'B.spores')};
  await edit(); await js('window.spores.files.saveAs()'); await sleep(300);
  ok(fs.existsSync(path.join(OUT, 'B.spores')) && /^B — /.test(await title()), 'Save as… made B.spores');
  const bpmB = await js('window.spores.store.get().bpm');
  next.open = {canceled: false, filePaths: [A]};
  const op = js('window.spores.files.open()'); await answer('Keep this song'); ok(await op === false && await js('window.spores.store.get().bpm') === bpmB, 'Open then Keep this song changes nothing');
  const op2 = js('window.spores.files.open()'); await answer('Open it'); ok(await op2 === true && await js('window.spores.store.get().bpm') === bpmA2, 'Open loads A (bpm ' + bpmA2 + ')');
  ok(calls.lastOpen.defaultPath === OUT, 'open dialog starts in the current file\'s folder');
  await js('window.spores.store.undo()'); await sleep(200);
  ok(await js('window.spores.store.get().bpm') === bpmB, 'Undo restores the old song');
  // recent
  const rec = await js('window.sporesNative.file.recent()');
  ok(rec.length === 2 && rec[0].name === 'A song.spores', 'recent: ' + JSON.stringify(rec.map(r => r.name)));
  const m = Menu.getApplicationMenu().items.find(i => i.label === 'File').submenu.items.map(i => i.label);
  const rm = Menu.getApplicationMenu().items.find(i => i.label === 'File').submenu.items.find(i => i.label === 'Open Recent').submenu.items.map(i => i.label);
  ok(m.includes('Save') && m.includes('Save As…') && m.includes('Open…') && rm.join() === 'A song.spores,B.spores', 'native File menu: ' + m.join('|') + ' / recent ' + rm);
  // menu click calls the page
  Menu.getApplicationMenu().items.find(i => i.label === 'File').submenu.items.find(i => i.label === 'Open Recent').submenu.items[1].click();
  await answer('Open it'); await sleep(300);
  ok(/^B — /.test(await title()), 'Open Recent menu item opens that file');
  // allow list
  const r1 = await js(`window.sporesNative.file.save(${JSON.stringify(path.join(OUT, 'evil.spores'))}, new Uint8Array(3))`);
  const r2 = await js(`window.sporesNative.file.read('/etc/passwd')`);
  const r3 = await js(`window.sporesNative.file.save(${JSON.stringify(path.join(OUT, 'x.txt'))}, new Uint8Array(3))`);
  const r4 = await js(`window.sporesNative.file.read(${JSON.stringify(path.join(OUT, 'unpicked.json'))})`);
  ok(r1.error && !fs.existsSync(path.join(OUT, 'evil.spores')) && r2.error && r3.error && r4.error, 'unpicked / wrong-extension paths refused: ' + [r1, r2, r3, r4].map(r => r.error).join(' | '));
  // close with unsaved changes
  await edit(); await sleep(400);
  next.msg = 2; w.close(); await sleep(600);
  ok(!w.isDestroyed() && calls.msg === 1 && calls.lastMsg.defaultId === 2 && calls.lastMsg.cancelId === 2 && calls.lastMsg.buttons.join() === 'Save,Don’t save,Cancel', 'close with changes asks (Cancel default); Cancel keeps the window: ' + calls.lastMsg.message);
  next.msg = 0; const sizeBefore = fs.statSync(path.join(OUT, 'B.spores')).mtimeMs; await sleep(20);
  w.close(); await sleep(900);
  ok(/Save changes to “B.spores”/.test(calls.lastMsg.message), 'prompt names the song: ' + calls.lastMsg.message);
  ok(calls.msg === 2 && fs.statSync(path.join(OUT, 'B.spores')).mtimeMs > sizeBefore && BrowserWindow.getAllWindows().length === 0, 'Save then closes; file updated');
  // a second window (as a Mac dock click makes): Don't save, and quitting
  app.emit('activate'); await sleep(1500);
  w = BrowserWindow.getAllWindows()[0];
  for (let i = 0; i < 40; i++){ if (await js('!!(window.spores && window.spores.files)').catch(() => false)) break; await sleep(250); }
  await edit(); await sleep(400);
  const quitsBefore = quitCalls;
  next.msg = 2; realQuit(); await sleep(700);
  ok(!w.isDestroyed() && calls.msg === 3 && quitCalls === quitsBefore, 'Quit with changes asks; Cancel keeps the window and the app');
  next.msg = 1; realQuit(); await sleep(900);
  ok(calls.msg === 4 && BrowserWindow.getAllWindows().length === 0 && quitCalls > quitsBefore, 'Quit, Don’t save: window closes without writing and the app quits (quit calls ' + quitCalls + ')');
  console.log(bad ? 'FAILED ' + bad : 'ALL OK'); app.exit(bad ? 1 : 0);
})().catch(e => { console.log('ERR', e); app.exit(2); });
