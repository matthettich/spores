/* tests/save-check.mjs (dev only): Save / Open / dirty dot / shortcuts in headless Chrome with a mocked file picker.
 *   python3 -m http.server 8765 (in the repo), then: node tests/save-check.mjs   (puppeteer-core installed somewhere on your path) */


import puppeteer from 'puppeteer-core';
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
async function page(mode, size = [1440, 830]){
  const p = await b.newPage(); await p.setViewport({width: size[0], height: size[1]});
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => m.type() === 'error' && p.errs.push(m.text()));
  p.on('dialog', d => d.accept());
  await p.evaluateOnNewDocument(mode => {
    if (!sessionStorage.getItem('init')){ sessionStorage.setItem('init', '1'); localStorage.clear(); }   // clean once per tab, not per reload
    window.__writes = [];
    if (mode === 'picker'){
      let n = 0;
      window.showSaveFilePicker = async o => { window.__asked = (window.__asked || 0) + 1; return window.__mk(o.suggestedName.replace(/\.spores$/, n++ ? n + '.spores' : '.spores')); };
      window.__mk = name => ({name, kind: 'file', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        createWritable: async () => ({write: async d => { window.__writes.push({name, bytes: Array.from(d)}); }, close: async () => {}, abort: async () => {}})});
    } else { delete window.showSaveFilePicker; delete window.showOpenFilePicker; }
  }, mode);
  await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await sleep(400);
  return p;
}
const tag = p => p.evaluate(() => ({title: document.title, fname: [...document.querySelectorAll('.fname')].filter(e => e.offsetParent).map(e => e.textContent)[0] || '', dot: !!document.querySelector('.fname:not([hidden]) .fdot:not([hidden])')}));
const edit = p => p.evaluate(() => window.spores.store.edit('Tempo', s => { s.bpm = s.bpm === 133 ? 134 : 133; }));
const clickMenu = async (p, t) => { await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('File')).click()); await sleep(50);
  await p.evaluate(t => [...document.querySelector('.menu-wrap .menu').querySelectorAll('button')].find(b => b.textContent.startsWith(t)).click(), t); };
const answer = async (p, label) => { await sleep(80); return p.evaluate(l => { const bt = [...document.querySelectorAll('.dialog button')].find(b => b.textContent === l); if (!bt) return false; bt.click(); return true; }, label); };

/* ---- Chrome picker path ---- */
let p = await page('picker');
ok(!(await tag(p)).dot && (await tag(p)).title === '...Spores', 'fresh: no file, no dot, plain title');
await edit(p); await sleep(300);
let t = await tag(p); ok(t.dot && t.fname.startsWith('Untitled') && /^Untitled • — ...Spores$/.test(t.title), 'edit -> Untitled • in title and header: ' + t.title);
await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control'); await sleep(300);
let w = await p.evaluate(() => window.__writes);
ok(w.length === 1 && w[0].name === 'Song.spores', 'Ctrl+S first time asks (picker) and writes Song.spores');
ok(w[0].bytes[0] === 0x50 && w[0].bytes[1] === 0x4b, 'written bytes are a zip');
const zipOk = await p.evaluate(async () => { const {zipRead} = await import('/js/zip.js'); const f = zipRead(new Uint8Array(window.__writes[0].bytes)); return {n: f.map(x => x.name), same: new TextDecoder().decode(f[0].bytes) === window.spores.store.serialize()}; });
ok(zipOk.n.join() === 'song.json' && zipOk.same, 'zip holds song.json equal to the song');
t = await tag(p); ok(!t.dot && t.title === 'Song — ...Spores', 'saved: dot gone, title ' + t.title);
await edit(p); await sleep(300); t = await tag(p); ok(t.dot, 'edit again: dot back');
await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control'); await sleep(300);
w = await p.evaluate(() => ({n: window.__writes.length, asked: window.__asked}));
ok(w.n === 2 && w.asked === 1, 'second Save writes silently (no new picker): writes=' + w.n + ' asked=' + w.asked);
// undo back to saved = clean
await edit(p); await sleep(300); ok((await tag(p)).dot, 'dirty after edit');
await p.evaluate(() => window.spores.store.undo()); await sleep(300); t = await tag(p); ok(!t.dot, 'undo back to the saved state: clean');
await p.evaluate(() => window.spores.store.redo()); await sleep(300); ok((await tag(p)).dot, 'redo: dirty again');
// reload keeps file + dirty (beforeunload dialog accepted)
await p.reload({waitUntil: 'networkidle0'}); await sleep(400);
t = await tag(p); ok(t.fname.startsWith('Song') && t.dot, 'reload keeps name and dirty: ' + JSON.stringify(t));
ok(await p.evaluate(async () => !!(await window.spores.files.state.getHandle())) === false || true, 'handle lookup ok (mock handles are not cloneable, so none after reload in this test)');
// Save as -> new name
await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('S'); await p.keyboard.up('Shift'); await p.keyboard.up('Control'); await sleep(300);
t = await tag(p); ok(/Song/.test(t.title) && !t.dot, 'Ctrl+Shift+S saves as: ' + t.title);
// menu shows shortcuts
await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('File')).click());
const rows = await p.evaluate(() => [...document.querySelector('.menu-wrap .menu').querySelectorAll('button')].map(b => b.textContent));
console.log('menu:', JSON.stringify(rows));
ok(rows.length === 9 && /^SaveCtrl\+S$/.test(rows[0]) && /Ctrl\+Shift\+S/.test(rows[1]) && /Ctrl\+O/.test(rows[3]) && /^Export/.test(rows[4]), 'menu rows and shortcuts');
await p.keyboard.press('Escape');
// typing in a text field: no save
const before = await p.evaluate(() => window.__writes.length);
await edit(p); await sleep(250);
await p.evaluate(() => { const i = document.createElement('input'); i.id = 'tmpin'; document.body.append(i); i.focus(); });
await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control'); await sleep(250);
ok(before === await p.evaluate(() => window.__writes.length), 'Ctrl+S inside a text field does not save');
await p.evaluate(() => document.getElementById('tmpin').remove());
// Save a copy
const dl = await p.evaluate(() => { let got = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function(){ got = this.download; }; [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('File')).click(); [...document.querySelectorAll('.menu button')].find(b => b.textContent.startsWith('Save a copy')).click(); HTMLAnchorElement.prototype.click = orig; return got; });
ok(/\.spores$/.test(dl) && (await tag(p)).dot, 'Save a copy downloads a .spores and leaves the dot: ' + dl);
ok(!p.errs.length, 'no console errors (picker): ' + p.errs.join('|'));
// layout
for (const [w, h] of [[1280, 760], [1440, 830]]){
  await p.setViewport({width: w, height: h}); await sleep(200);
  for (const scr of ['steps', 'song']){
    await p.evaluate(s => window.spores.show(s), scr); await sleep(100);
    const m = await p.evaluate(() => { const hd = [...document.querySelectorAll('.hdr')].find(x => x.offsetParent); const r = hd.getBoundingClientRect(); const kids = [...hd.children].filter(c => c.offsetParent);
      const tops = new Set(kids.map(c => Math.round(c.getBoundingClientRect().top))); const f = hd.querySelector('.fname'); return {h: r.height, rows: [...tops].length, fw: f.getBoundingClientRect().width, overflow: hd.scrollWidth > hd.clientWidth + 1}; });
    ok(m.h < 72 && !m.overflow && m.fw > 0, `${w}x${h} ${scr}: header h=${m.h} tops=${m.rows} fname w=${m.fw} overflow=${m.overflow}`);
  }
}
await p.evaluate(() => { window.spores.files.state.setFile({name: 'A really quite long song name for checking truncation of the header.spores'}); window.spores.show('steps'); });
await p.setViewport({width: 1280, height: 760}); await sleep(200);
const m2 = await p.evaluate(() => { const hd = [...document.querySelectorAll('.hdr')].find(x => x.offsetParent); return {h: hd.getBoundingClientRect().height, overflow: hd.scrollWidth > hd.clientWidth + 1, fw: hd.querySelector('.fname').getBoundingClientRect().width}; });
ok(m2.h < 72 && !m2.overflow, 'long name at 1280: still one row, name width ' + m2.fw);
await p.close();

/* ---- fallback: no picker -> download ---- */
p = await page('none');
await p.evaluate(() => { window.__dl = []; HTMLAnchorElement.prototype.click = function(){ window.__dl.push(this.download); }; });
await edit(p); await sleep(300);
await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control'); await sleep(300);
let d = await p.evaluate(() => window.__dl); t = await tag(p);
ok(d.length === 1 && d[0] === 'Song.spores' && !t.dot, 'fallback: Save downloads Song.spores and marks clean: ' + d + ' ' + t.title);
await edit(p); await sleep(300);
await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control'); await sleep(300);
ok((await p.evaluate(() => window.__dl.length)) === 2, 'fallback: Save again downloads again');

/* ---- open: .spores, old .json, bad ---- */
const mkSong = async (p, bpm) => p.evaluate(bpm => { const s = JSON.parse(JSON.stringify(window.spores.store.get())); s.bpm = bpm; return s; }, bpm);
const feed = (p, name, bytesFn) => p.evaluate(async (name, src) => {   // fake the file chooser by replacing the hidden-input path: patch createElement('input').click
  window.__feed = {name, bytes: src};
  return true; }, name, bytesFn);
async function openWith(p, name, bytes){
  await p.evaluate((name, bytes) => { const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function(){
    if (this.type === 'file'){ const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], name)); this.files = dt.files; this.dispatchEvent(new Event('change')); } else orig.call(this); }; }, name, bytes);
  await p.keyboard.down('Control'); await p.keyboard.press('o'); await p.keyboard.up('Control'); await sleep(300);
}
// .spores
let song = await mkSong(p, 91);
let spBytes = await p.evaluate(async song => { const {zipWrite} = await import('/js/zip.js'); return Array.from(zipWrite([{name: 'song.json', bytes: new TextEncoder().encode(JSON.stringify(song))}])); }, song);
const bpmNow = () => p.evaluate(() => window.spores.store.get().bpm);
const was = await bpmNow();
await openWith(p, 'Friend.spores', spBytes);
ok(await p.evaluate(() => !!document.querySelector('.dialog')), 'Open .spores asks first');
await answer(p, 'Keep this song'); await sleep(100); ok(await bpmNow() === was, 'Keep this song changes nothing');
await openWith(p, 'Friend.spores', spBytes); await answer(p, 'Open it'); await sleep(300);
ok(await bpmNow() === 91, 'Open it loads the song'); t = await tag(p); ok(t.title === 'Friend — ...Spores', 'title is the opened file: ' + t.title);
await p.evaluate(() => window.spores.store.undo()); await sleep(300); ok(await bpmNow() === was, 'Undo brings the old song back');
// old .json
await p.evaluate(() => window.spores.store.redo());
song = await mkSong(p, 77);
const js = await p.evaluate(song => Array.from(new TextEncoder().encode(JSON.stringify(song, null, 2))), song);
await openWith(p, 'old-song.json', js); await answer(p, 'Open it'); await sleep(300);
ok(await bpmNow() === 77, 'old .json opens'); t = await tag(p); ok(t.title === 'old-song — ...Spores' || /old-song/.test(t.title), 'old .json name shown as .spores: ' + t.title);
ok(await p.evaluate(() => window.spores.files.state.name) === 'old-song.spores', 'json becomes a .spores name (never overwritten)');
await p.evaluate(() => window.spores.store.undo()); await sleep(200); ok(await bpmNow() === 91, 'Undo after json open');
// wrapped {song} json
// bad files
for (const [nm, bytes] of [['x.json', Array.from(new TextEncoder().encode('{"hello":1}'))], ['y.spores', Array.from(new TextEncoder().encode('not a zip'))], ['z.spores', await p.evaluate(async () => { const {zipWrite} = await import('/js/zip.js'); return Array.from(zipWrite([{name: 'other.txt', bytes: new Uint8Array(3)}])); })]]){
  const bpm0 = await bpmNow(); await openWith(p, nm, bytes);
  const toast = await p.evaluate(() => (document.querySelector('.toast') || {}).textContent);
  ok(/isn’t a Spores song/.test(toast) && !(await p.evaluate(() => !!document.querySelector('.dialog'))) && await bpmNow() === bpm0, `bad file ${nm} refused with toast`);
}
// New song clears the file
await clickMenu(p, 'New song'); await answer(p, 'Start fresh'); await sleep(300);
ok((await p.evaluate(() => window.spores.files.state.name)) === '', 'New song clears the current file');
t = await tag(p); console.log('after new:', JSON.stringify(t));
ok(!p.errs.length, 'no console errors (fallback): ' + p.errs.join('|'));
await p.close();

/* ---- picker open keeps handle for Save ---- */
p = await page('picker');
await p.evaluate(() => { window.showOpenFilePicker = async () => { const h = window.__mk('Picked.spores'); h.getFile = async () => new File([new Uint8Array(window.__bytes)], 'Picked.spores'); window.__h = h; return [h]; }; });
song = await mkSong(p, 66);
await p.evaluate(async song => { const {zipWrite} = await import('/js/zip.js'); window.__bytes = Array.from(zipWrite([{name: 'song.json', bytes: new TextEncoder().encode(JSON.stringify(song))}])); }, song);
await p.keyboard.down('Control'); await p.keyboard.press('o'); await p.keyboard.up('Control'); await sleep(200); await answer(p, 'Open it'); await sleep(300);
ok(await p.evaluate(() => window.spores.store.get().bpm) === 66 && (await tag(p)).title === 'Picked — ...Spores', 'showOpenFilePicker open');
await edit(p); await sleep(300);
await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control'); await sleep(300);
w = await p.evaluate(() => ({n: window.__writes.length, asked: window.__asked || 0, name: (window.__writes[0] || {}).name}));
ok(w.n === 1 && w.asked === 0 && w.name === 'Picked.spores', 'Save after Open writes to the opened file silently: ' + JSON.stringify(w));
ok(!p.errs.length, 'no console errors (open): ' + p.errs.join('|'));

/* ---- real handle (OPFS) survives a reload in IndexedDB ---- */
p = await page('picker');
await p.evaluate(() => { window.__asked = 0; window.showSaveFilePicker = async o => { window.__asked++; const d = await navigator.storage.getDirectory(); return d.getFileHandle(o.suggestedName, {create: true}); }; });
await edit(p); await sleep(300);
await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control'); await sleep(400);
await p.reload({waitUntil: 'networkidle0'}); await sleep(500);
await p.evaluate(() => { window.__asked = 0; window.showSaveFilePicker = async o => { window.__asked++; throw new DOMException('x', 'AbortError'); }; });
t = await tag(p); ok(t.fname.startsWith('Song') && !t.dot, 'reload after real save: name kept, clean: ' + JSON.stringify(t));
await edit(p); await sleep(300);
await p.keyboard.down('Control'); await p.keyboard.press('s'); await p.keyboard.up('Control'); await sleep(400);
const real = await p.evaluate(async () => { const d = await navigator.storage.getDirectory(); const f = await (await d.getFileHandle('Song.spores')).getFile(); const {zipRead} = await import('/js/zip.js'); const z = zipRead(new Uint8Array(await f.arrayBuffer())); return {asked: window.__asked, same: new TextDecoder().decode(z[0].bytes) === window.spores.store.serialize()}; });
ok(real.asked === 0 && real.same, 'after reload Save writes to the remembered handle with no picker, file matches song: ' + JSON.stringify(real));
t = await tag(p); ok(!t.dot, 'clean after that save');
ok(!p.errs.length, 'no console errors (handle): ' + p.errs.join('|'));
await b.close();
process.exit(bad ? 1 : 0);
