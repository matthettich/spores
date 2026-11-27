/* tests/fx-ui-check.mjs (dev only): the Effects section of the track panel (js/ui/fxpanel.js) in headless Chrome.
 *   python3 -m http.server 8765 (in the repo), then: CHROME=… [PORT=…] [SHOTS=/some/dir] node tests/fx-ui-check.mjs   (puppeteer-core on your path)
 * Add Echo to a drum track (song gets it, the worklet makes it), a knob changes the value and Undo puts it back, a real
 * drag is one Undo, on / off, reorder, remove asks first and Undo restores it, the 5th effect on a track and the 33rd in
 * the song are refused with a reason, effects on an audio track (loop and song-length), Simple vs More settings, Save →
 * Open keeps them, the "fx 2" hint in the track list, no MIDI / CV section, header one row at both sizes, no control
 * under 44 px, no console errors. SHOTS: screenshots of the panel with 2 effects in all three skins. */
import puppeteer from 'puppeteer-core';
const PORT = process.env.PORT || 8765;
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']});
async function page(ctx = b, w = 1280, h = 760){
  const p = await ctx.newPage(); p.errs = []; await p.setViewport({width: w, height: h});
  p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/MIDI/.test(m.text()) && p.errs.push(m.text()));
  await p.evaluateOnNewDocument(() => {
    if (!sessionStorage.getItem('init')){ sessionStorage.setItem('init', '1'); localStorage.clear(); }
    window.__writes = [];
    window.showSaveFilePicker = async o => ({name: o.suggestedName, kind: 'file', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      createWritable: async () => ({write: async d => { window.__writes.push(new Uint8Array(d)); }, close: async () => {}, abort: async () => {}})});
    window.showOpenFilePicker = async () => [{name: window.__openName, kind: 'file', getFile: async () => new File([window.__openBytes], window.__openName)}];
  });
  await p.goto(`http://localhost:${PORT}/`, {waitUntil: 'networkidle0'}); await sleep(500);
  return p;
}
const p = await page();
const song = () => p.evaluate(() => JSON.parse(JSON.stringify(window.spores.store.get())));
const fxOf = async i => (await song()).tracks[i].fx;
const click = sel => p.evaluate(sel => { const x = document.querySelector(sel); if (!x || x.disabled) return false; x.click(); return true; }, sel);
const clickText = t => p.evaluate(t => { const x = [...document.querySelectorAll('button')].find(y => y.textContent.trim() === t && !y.closest('[hidden]') && !y.disabled); if (!x) return false; x.click(); return true; }, t);
const peek = () => p.evaluate(() => new Promise(r => { const {engine} = window.spores; const f = e => { if (e.data.t === 'peek'){ engine.node.port.removeEventListener('message', f); r(e.data.fx); } }; engine.node.port.addEventListener('message', f); engine.node.port.postMessage({t: 'peek'}); }));
const addVia = async type => { await click('.fxadd'); await sleep(60); const r = await click(`.fxitem[data-type="${type}"]`); await sleep(150); return r; };
const selectTrack = async i => { await p.evaluate(i => document.querySelectorAll('.track')[i].click(), i); await sleep(150); };
const cards = () => p.evaluate(() => [...document.querySelectorAll('.fxcard')].map(c => ({type: c.dataset.type, name: c.querySelector('.fxname').textContent, on: c.querySelector('.fxsw').getAttribute('aria-pressed') === 'true', rows: c.querySelectorAll('.fxbody .prow').length})));
const dialogBtn = t => p.evaluate(t => { const x = [...document.querySelectorAll('.dialog button')].find(y => y.textContent.trim() === t); if (!x) return false; x.click(); return true; }, t);
const undo = async (n = 1) => { for (let i = 0; i < n; i++) await p.evaluate(() => window.spores.store.undo()); await sleep(120); };

/* ---- the section is there, empty, with one short help line ---- */
await p.evaluate(() => window.spores.engine.fxReady); 
let s = await song();
ok(s.tracks[0].type === 'drum', 'track 1 is a drum track');
const sec0 = await p.evaluate(() => ({secs: [...document.querySelectorAll('.panel .psec')].map(x => x.textContent), none: !!document.querySelector('.fxnone'), count: document.querySelector('.fxcount').textContent}));
ok(sec0.secs.includes('Effects') && sec0.none && /0 of 32 in the song/.test(sec0.count), 'drum panel has an Effects section, empty: ' + sec0.count);

/* ---- add Echo: the menu is grouped, the song has it, the worklet makes it ---- */
await click('.fxadd'); await sleep(60);
const menu = await p.evaluate(() => ({groups: [...document.querySelectorAll('.fxgrp')].map(x => x.textContent), items: document.querySelectorAll('.fxitem').length, open: !document.querySelector('.fxmenu').hidden}));
ok(menu.open && menu.groups.join() === 'Space,Echo,Drive & colour,Filter & tone,Movement,Pitch,Dynamics,Experimental' && menu.items === 34, `menu: ${menu.groups.length} groups, ${menu.items} effects`);
const echoName = await p.evaluate(() => { const {FX_LIST} = window.__fx || {}; return document.querySelector('.fxitem[data-type="delay"]') && document.querySelector('.fxitem[data-type="delay"]').textContent; });
await click('.fxadd'); await sleep(60);
ok(await p.evaluate(() => document.querySelector('.fxmenu').hidden), 'the menu closes again');
const fx0 = await peek();
ok(await addVia('delay'), 'picked "' + echoName + '" from the menu');
s = await song();
ok(s.tracks[0].fx.length === 1 && s.tracks[0].fx[0].type === 'delay' && s.tracks[0].fx[0].on, 'the song has the effect on track 1');
ok((await peek()) === fx0 + 1, `the worklet makes it (${fx0} → ${await peek()})`);
ok(await p.evaluate(() => document.querySelector('.fxmenu').hidden), 'the menu closed after adding');
let c = await cards();
ok(c.length === 1 && c[0].on, 'one card, on: ' + c[0].name);
ok(/fx 1/.test(await p.evaluate(() => document.querySelectorAll('.track')[0].querySelector('.tsub').textContent)), 'track row hints "fx 1"');
await undo(); ok((await fxOf(0)).length === 0 && (await cards()).length === 0, 'Undo takes the effect off again'); 
await p.evaluate(() => window.spores.store.redo()); await sleep(120);
ok((await fxOf(0)).length === 1, 'Redo brings it back');

/* ---- a setting: value shown with fxText; changing it, Undo puts it back ---- */
const row0 = await p.evaluate(() => { const r = document.querySelector('.fxcard .fxbody .prow'); return {label: r.querySelector('.plabel').textContent, val: r.querySelector('.pval').textContent, sel: !!r.querySelector('select')}; });
ok(row0.label && row0.val && row0.val !== '', `first setting "${row0.label}" shows "${row0.val}"`);
const simpleN = (await cards())[0].rows;
// set the first slider by input event
const setSlider = (i, v) => p.evaluate((i, v) => { const x = document.querySelectorAll('.fxcard input[type=range]')[i]; x.value = v; x.dispatchEvent(new Event('input', {bubbles: true})); return x.getAttribute('aria-label'); }, i, v);
const key0 = Object.keys(s.tracks[0].fx[0].p)[0];
const label = await setSlider(0, 20); await sleep(100);
const after = await fxOf(0), shown = await p.evaluate(() => document.querySelector('.fxcard .prow .pval').textContent);
const changed = Object.entries(after[0].p).filter(([k, v]) => v !== s.tracks[0].fx[0].p[k]);
ok(changed.length === 1 && changed[0][1] === 20 && shown !== row0.val, `a slider ("${label}") sets ${changed[0] && changed[0][0]}=20 and the text now says "${shown}"`);
await sleep(700); await undo();
ok(JSON.stringify((await fxOf(0))[0].p) === JSON.stringify(s.tracks[0].fx[0].p), 'Undo puts the value back');
ok(await p.evaluate(() => { const x = document.querySelector('.fxcard input[type=range]'); return x.value === String(window.spores.store.get().tracks[0].fx[0].p[Object.keys(window.spores.store.get().tracks[0].fx[0].p)[0]]); }), 'the slider follows Undo');

/* ---- a real drag is one Undo ---- */
await sleep(700);
const before = JSON.stringify((await fxOf(0))[0].p), hist = await p.evaluate(() => window.spores.store.canUndo ? 1 : 0);
const box = await p.evaluate(() => { document.querySelector('.fxcard input[type=range]').scrollIntoView({block: 'center'}); const r = document.querySelector('.fxcard input[type=range]').getBoundingClientRect(); return {x: r.x, y: r.y + r.height / 2, w: r.width}; });
const startV = (await fxOf(0))[0].p[Object.keys((await fxOf(0))[0].p)[0]];
await p.mouse.move(box.x + box.w * 0.1, box.y); await p.mouse.down();
for (let i = 1; i <= 12; i++){ await p.mouse.move(box.x + box.w * (0.1 + 0.06 * i), box.y); await sleep(15); }
await p.mouse.up(); await sleep(150);
const dragged = JSON.stringify((await fxOf(0))[0].p);
ok(dragged !== before, 'dragging the slider changed the value');
await undo();
ok(JSON.stringify((await fxOf(0))[0].p) === before, 'one Undo undoes the whole drag');

/* ---- Simple vs More ---- */
const info = await p.evaluate(async () => { const {fxInfo} = await import('/js/engine/fx.js'); const i = fxInfo(window.spores.store.get().tracks[0].fx[0].type); return {main: i.params.filter(x => x.main).length, all: i.params.length}; });
ok(simpleN === info.main && info.main < info.all, `Simple shows the ${info.main} main settings of ${info.all}`);
await p.evaluate(() => { const x = [...document.querySelectorAll('.hdr .seg .tb')].find(y => /More/.test(y.textContent)); x.click(); }); await sleep(250);
ok((await cards())[0].rows === info.all, `More shows all ${info.all}`);
await p.evaluate(() => { const x = [...document.querySelectorAll('.hdr .seg .tb')].find(y => /Simple/.test(y.textContent)); x.click(); }); await sleep(250);

/* ---- on / off ---- */
await click('.fxsw'); await sleep(120);
ok(!(await fxOf(0))[0].on && !(await cards())[0].on, 'Off: the song says off, the switch says Off');
await undo(); ok((await fxOf(0))[0].on, 'Undo switches it on again');

/* ---- reorder ---- */
await addVia('reverb'); await addVia('eq');
ok((await fxOf(0)).map(f => f.type).join() === 'delay,reverb,eq', 'three effects, in the order added');
ok(await p.evaluate(() => { const c = document.querySelectorAll('.fxcard'); return c[0].querySelector('[data-act=earlier]').disabled && c[2].querySelector('[data-act=later]').disabled && !c[1].querySelector('[data-act=earlier]').disabled; }), '‹ is off on the first card and › on the last');
await p.evaluate(() => document.querySelectorAll('.fxcard')[1].querySelector('[data-act=earlier]').click()); await sleep(150);
ok((await fxOf(0)).map(f => f.type).join() === 'reverb,delay,eq' && (await cards()).map(x => x.type).join() === 'reverb,delay,eq', '‹ moves the second effect first (song and cards)');
ok(await p.evaluate(() => !!(document.activeElement && document.activeElement.closest('.fxcard'))), 'focus stays inside the moved card');
await p.evaluate(() => document.querySelectorAll('.fxcard')[0].querySelector('[data-act=later]').click()); await sleep(150);
ok((await fxOf(0)).map(f => f.type).join() === 'delay,reverb,eq', '› moves it back');
await undo(4); ok((await fxOf(0)).length === 1, 'Undo ×4 back to the one effect');

/* ---- Reset ---- */
await setSlider(0, 17); await sleep(100); 
const dirty = JSON.stringify((await fxOf(0))[0].p);
await click('.fxcard [data-act=reset]'); await sleep(120);
const reset = await p.evaluate(async () => { const {fxDefaults} = await import('/js/engine/fx.js'); const f = window.spores.store.get().tracks[0].fx[0]; return JSON.stringify(f.p) === JSON.stringify(fxDefaults(f.type)); });
ok(reset, 'Reset puts every setting back to its default'); await undo();
ok(JSON.stringify((await fxOf(0))[0].p) === dirty, 'Undo brings the settings back after Reset');

/* ---- remove asks; Undo restores with its settings ---- */
await undo(); await sleep(700);
await setSlider(0, 21); await sleep(100); const kept = JSON.stringify((await fxOf(0))[0].p);
await click('.fxcard [data-act=remove]'); await sleep(150);
const dlg = await p.evaluate(() => ({t: (document.querySelector('.dialog .dtitle') || {}).textContent, b: [...document.querySelectorAll('.dialog button')].map(x => x.textContent)}));
ok(/^Remove /.test(dlg.t) && dlg.t.endsWith('?') && dlg.b.join() === 'Keep it,Remove it', `asks "${dlg.t}" with ${dlg.b}`);
await dialogBtn('Keep it'); await sleep(100);
ok((await fxOf(0)).length === 1, 'Keep it: nothing removed');
await click('.fxcard [data-act=remove]'); await sleep(150); await dialogBtn('Remove it'); await sleep(150);
ok((await fxOf(0)).length === 0 && (await cards()).length === 0, 'Remove it: gone');
ok(!/fx \d/.test(await p.evaluate(() => document.querySelectorAll('.track')[0].querySelector('.tsub').textContent)), 'the "fx" hint is gone from the track row');
await undo();
ok((await fxOf(0)).length === 1 && JSON.stringify((await fxOf(0))[0].p) === kept, 'Undo brings it back with its settings');
await click('.fxcard [data-act=remove]'); await sleep(150); await dialogBtn('Remove it'); await sleep(100); await undo();

/* ---- the 5th effect on a track ---- */
await addVia('reverb'); await addVia('eq'); await addVia('drive');
ok((await fxOf(0)).length === 4, '4 effects on the track');
const full = await p.evaluate(() => ({dis: document.querySelector('.fxadd').disabled, title: document.querySelector('.fxadd').title, note: document.querySelector('.fxcount').textContent}));
ok(full.dis && /4 effects/.test(full.title) && /4 effects.*4 of 32 in the song/.test(full.note), 'Add effect disabled with a reason: ' + full.note);
ok((await p.evaluate(() => document.querySelector('.track').querySelector('.tsub').textContent)).includes('fx 4'), 'row says fx 4');

/* ---- the song limit (32) ---- */
const nBefore = (await song()).tracks.length;
await p.evaluate(async () => { const {newTrack} = await import('/js/store.js'), {addFx} = await import('/js/fxedit.js'), {store} = window.spores;
  store.edit('Add tracks', s => { while (s.tracks.length < 9) s.tracks.push(newTrack(s.tracks.length % 2 ? 'synth' : 'drum')); });
  for (const t of store.get().tracks) while ((t.fx || []).length < 4 && addFx(store, t.id, 'drive')); });
s = await song();
const total = s.tracks.reduce((n, t) => n + t.fx.length, 0);
ok(total === 32, 'filled the song to 32 effects: ' + total);
await selectTrack(8);
const lim = await p.evaluate(() => ({dis: document.querySelector('.fxadd').disabled, note: document.querySelector('.fxcount').textContent}));
ok(lim.dis && /32 of 32 in the song/.test(lim.note) && /song has 32/.test(lim.note), 'song limit message: ' + lim.note);
for (let i = 0; i < 60 && (await song()).tracks.length > nBefore; i++) await undo(); ok((await song()).tracks.length === nBefore && (await fxOf(0)).length === 4, 'Undo back to before the fill');
await selectTrack(0);

/* ---- not for MIDI / CV tracks ---- */
await p.evaluate(async () => { const {newTrack} = await import('/js/store.js'); window.spores.store.edit('Add track', s => { s.tracks.push(newTrack('midi'), newTrack('cv')); }); });
await sleep(150);
const nT = (await song()).tracks.length;
await selectTrack(nT - 2); const midiHas = await p.evaluate(() => !!document.querySelector('.fxadd'));
await selectTrack(nT - 1); const cvHas = await p.evaluate(() => !!document.querySelector('.fxadd'));
ok(!midiHas && !cvHas, 'no Effects section on a MIDI or CV track');
await selectTrack(0);

/* ---- audio tracks: loop and song-length ---- */
await p.evaluate(() => document.querySelector('button[aria-label^="Add a synth"]').click()); await sleep(80);
await clickText('Audio track (record your voice)'); await sleep(250);
ok(await p.evaluate(() => !!document.querySelector('.fxadd')), 'a loop audio track has the Effects section');
const ai = (await song()).tracks.findIndex(t => t.type === 'audio');
await addVia('chorus'); 
ok((await fxOf(ai)).map(f => f.type).join() === 'chorus', 'chorus added to the audio track');
await p.evaluate(() => document.querySelector('button[aria-label^="Add a synth"]').click()); await sleep(80);
await clickText('Song-length audio track (record over the whole song)'); await sleep(250);
ok(await p.evaluate(() => !!document.querySelector('.fxadd')), 'a song-length audio track has it too (in its Steps panel)');
await addVia('eq');
const si = (await song()).tracks.findIndex(t => t.span === 'song');
ok((await fxOf(si)).length === 1, 'effect added to the song-length track');

/* ---- Save → Open keeps them ---- */
const keepFx = JSON.stringify((await song()).tracks.map(t => t.fx));
const bytes = await p.evaluate(async () => { window.__writes = []; await window.spores.files.saveAs(); return Array.from(window.__writes[0]); });
const q = await page(await b.createBrowserContext());
const re = await q.evaluate(async bytes => {
  window.__openBytes = new Uint8Array(bytes); window.__openName = 'Fx.spores';
  const pr = window.spores.files.open(); await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('.dialog button')].find(x => x.textContent === 'Open it').click(); await pr; await new Promise(r => setTimeout(r, 600));
  document.querySelectorAll('.track')[0].click(); await new Promise(r => setTimeout(r, 200));
  return {fx: JSON.stringify(window.spores.store.get().tracks.map(t => t.fx)), cards: document.querySelectorAll('.fxcard').length, hint: document.querySelectorAll('.track')[0].querySelector('.tsub').textContent};
}, bytes);
ok(re.fx === keepFx && re.cards === 4 && /fx 4/.test(re.hint), `Save → Open keeps every effect; the panel shows ${re.cards} cards, row "${re.hint}"`);
ok(q.errs.length === 0, 'no console errors after Open: ' + q.errs);
await q.close();

/* ---- layout: header one row, 44 px, no page scroll ---- */
await selectTrack(0);
async function layout(w, h){
  const r = await b.newPage(); r.errs = []; await r.setViewport({width: w, height: h});
  r.on('pageerror', e => r.errs.push(e.message)); r.on('console', m => m.type() === 'error' && !/MIDI/.test(m.text()) && r.errs.push(m.text()));
  await r.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('init')){ sessionStorage.setItem('init', '1'); localStorage.clear(); } });
  await r.goto(`http://localhost:${PORT}/`, {waitUntil: 'networkidle0'}); await sleep(400);
  await r.evaluate(async () => { const {addFx} = await import('/js/fxedit.js'), {store} = window.spores; const id = store.get().tracks[0].id; addFx(store, id, 'delay'); addFx(store, id, 'reverb'); });
  await sleep(200);
  const m = await r.evaluate(() => {
    const hdr = document.querySelector('.hdr'), kids = [...hdr.querySelectorAll('button, select, input')].filter(x => x.offsetParent);
    const tops = new Set(kids.map(x => Math.round(x.getBoundingClientRect().top / 8)));
    const small = [...document.querySelectorAll('.panel button, .panel select, .panel input')].filter(x => x.offsetParent).map(x => { const q = x.getBoundingClientRect(); return {t: (x.getAttribute('aria-label') || x.textContent).slice(0, 24), w: Math.round(q.width), h: Math.round(q.height)}; }).filter(x => x.h < 44 || (x.w < 44 && !/range/.test(x.t)));
    const P = document.querySelector('.panel');
    return {rows: tops.size, hdrH: hdr.getBoundingClientRect().height, small, pageScroll: document.documentElement.scrollHeight > innerHeight, panelScroll: P.scrollHeight > P.clientHeight, overflowX: P.scrollWidth > P.clientWidth};
  });
  ok(m.rows === 1, `${w}x${h}: header on one row`);
  ok(!m.pageScroll && !m.overflowX, `${w}x${h}: page does not scroll, panel has no sideways scroll (panel scrolls down: ${m.panelScroll})`);
  ok(m.small.length === 0, `${w}x${h}: no panel control under 44 px` + (m.small.length ? ' ' + JSON.stringify(m.small) : ''));
  ok(r.errs.length === 0, `${w}x${h}: no console errors ` + r.errs);
  return r;
}
await (await layout(1280, 760)).close();
const big = await layout(1440, 830);
if (process.env.SHOTS){
  for (const skin of ['minimal', 'tr909', 'tr808', 'idmpg']){
    await big.evaluate(skin => { document.documentElement.dataset.skin = skin; const P = document.querySelector('.panel'); P.scrollTop = [...P.querySelectorAll('.psec')].find(x => x.textContent === 'Effects').offsetTop - 8; }, skin); await sleep(200);
    await big.screenshot({path: `${process.env.SHOTS}/fx-${skin}.png`});
  }
}
await big.close();
ok(p.errs.length === 0, 'no console errors in the main run: ' + p.errs);
await b.close();
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
