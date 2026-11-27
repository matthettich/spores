// tests/desktop-export-check.js (dev only): File › Export… in the desktop app, with the native Save dialog and Finder stubbed.
// Needs Electron + xvfb:  cd desktop && npm install && node copy-app.js && cd ..
//   xvfb-run -a desktop/node_modules/.bin/electron --no-sandbox --user-data-dir=/tmp/spores-ud2 tests/desktop-export-check.js
// The menu's Export… opens the dialog; Song → the Save dialog (a .wav filter, Music folder), the file is written there (a
// 2-channel 48 kHz 24-bit WAV), Show in Finder shows that path; Stems → a .zip (unzip -t); the out channels refuse paths
// that weren't picked and anything but .wav / .zip.
const { app, dialog, shell, BrowserWindow, Menu } = require('electron');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const OUT = require('os').tmpdir() + '/spores-export-out'; fs.rmSync(OUT, {recursive: true, force: true}); fs.mkdirSync(OUT, {recursive: true});
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const calls = {save: 0, shown: []}; let next = {};
dialog.showSaveDialog = async (...a) => { calls.save++; calls.lastSave = a[a.length - 1]; return next.save; };
shell.showItemInFolder = p => { calls.shown.push(p); };
app.commandLine.appendSwitch('no-sandbox');
require(path.join(__dirname, '..', 'desktop', 'main.js'));
(async () => {
  await app.whenReady(); await sleep(500);
  let w; for (let i = 0; i < 60 && !w; i++){ await sleep(250); w = BrowserWindow.getAllWindows()[0]; }
  const js = x => w.webContents.executeJavaScript(x);
  for (let i = 0; i < 60; i++){ if (await js('!!(window.spores && window.spores.files)').catch(() => false)) break; await sleep(250); }
  const errs = []; w.webContents.on('console-message', (e, level, msg) => { if (level >= 3 && !/MIDI/.test(msg)) errs.push(msg); });
  ok(await js('!!(window.sporesNative.out && window.sporesNative.out.pick)'), 'page has the export bridge');
  const menuItem = () => Menu.getApplicationMenu().items.find(i => i.label === 'File').submenu.items.find(i => i.label === 'Export…');
  ok(!!menuItem(), 'native File menu has Export…');
  async function run(what){
    menuItem().click(); await sleep(300);
    await js(`(() => { const d = document.querySelector('.xpdlg'); [...d.querySelectorAll('.seg .tb')].find(x => x.textContent.toLowerCase() === '${what}').click();
      [...d.querySelectorAll('.dacts .tb')].find(x => x.textContent === 'Export').click(); })()`);
    let s = ''; for (let i = 0; i < 300; i++){ await sleep(100); s = await js(`(document.querySelector('.xpdlg .xpprog .note') || {}).textContent || ''`); if (/^(Saved|Stopped|Couldn)/.test(s)) break; }
    return s;
  }
  const A = path.join(OUT, 'My song.wav');
  next.save = {canceled: false, filePath: path.join(OUT, 'My song')};   // (no extension typed: .wav is added)
  const s1 = await run('song');
  ok(/^Saved “My song\.wav”/.test(s1), 'song: ' + s1);
  ok(calls.lastSave.defaultPath.endsWith('Song.wav') && calls.lastSave.filters[0].extensions.join() === 'wav' && path.dirname(calls.lastSave.defaultPath) === app.getPath('music'),
    'save dialog: Song.wav, .wav filter, starts in ' + path.dirname(calls.lastSave.defaultPath));
  ok(fs.existsSync(A), 'the WAV is written where the dialog said');
  const wav = JSON.parse(execFileSync('python3', ['-I', '-c', 'import wave,sys,json; w=wave.open(sys.argv[1]); print(json.dumps([w.getnchannels(), w.getframerate(), w.getsampwidth(), w.getnframes()]))', A]).toString());
  ok(wav[0] === 2 && wav[1] === 48000 && wav[2] === 3 && wav[3] > 48000, 'python wave: ' + JSON.stringify(wav));
  const show = await js(`(() => { const b = [...document.querySelectorAll('.xpdlg .dacts .tb')].find(x => /^Show in/.test(x.textContent)); if (!b || b.hidden) return ''; b.click(); return b.textContent; })()`);
  await sleep(300);
  ok(show && calls.shown[0] === A, `${show} shows ${calls.shown[0]}`);
  await js(`document.querySelectorAll('.scrim').forEach(x => x.remove())`);
  next.save = {canceled: false, filePath: path.join(OUT, 'Stems.zip')};
  const s2 = await run('stems');
  ok(/^Saved “Stems\.zip”/.test(s2) && path.dirname(calls.lastSave.defaultPath) === OUT && calls.lastSave.filters[0].extensions.join() === 'zip', 'stems: ' + s2 + ' (dialog starts where the last export went)');
  execFileSync('unzip', ['-tq', path.join(OUT, 'Stems.zip')]); ok(true, 'unzip -t passes');
  await js(`document.querySelectorAll('.scrim').forEach(x => x.remove())`);
  next.save = {canceled: true};
  const before = calls.save, s3 = await run('song');
  ok(calls.save === before + 1 && s3 === '' && !(await js(`!document.querySelector('.xpdlg .xpprog').hidden`)), 'cancelled Save dialog: nothing rendered or written');
  await js(`document.querySelectorAll('.scrim').forEach(x => x.remove())`);
  const r1 = await js(`window.sporesNative.out.write(${JSON.stringify(path.join(OUT, 'other.wav'))}, new Uint8Array(4))`);
  const r2 = await js(`window.sporesNative.out.write(${JSON.stringify(path.join(OUT, 'x.spores'))}, new Uint8Array(4))`);
  const r3 = await js(`window.sporesNative.out.pick('evil.sh', '')`);
  ok(r1.error && r2.error && r3 === null && !fs.existsSync(path.join(OUT, 'other.wav')) && !fs.existsSync(path.join(OUT, 'x.spores')), `refused: ${r1.error} | ${r2.error} | pick .sh → ${r3}`);
  ok(!errs.length, 'no console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(bad ? `${bad} FAILED` : 'ALL OK');
  app.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); app.exit(1); });
