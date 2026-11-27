/* tests/audio-ui-check.mjs (dev only): the audio-track screens in headless Chrome with the fake microphone.
 *   python3 -m http.server 8765 (in the repo), then: CHROME=… [SHOTS=/some/dir] node tests/audio-ui-check.mjs   (puppeteer-core on your path)
 * Add an audio track (the 5th is refused with a reason), the panel and lane, a level meter that moves, Hear myself off,
 * recording a 1-bar take (count-in shown, the take appears as a waveform, Undo removes it, Redo brings it back), loop
 * length, More controls writing and undoing, Save → Open keeping the take, the Song mini bar, header one row at both
 * sizes, no control under 44 px, no console errors. SHOTS: also writes screenshots of the Steps screen in all skins. */
import puppeteer from 'puppeteer-core';
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']});
async function page(ctx = b, w = 1280, h = 760){
  const p = await ctx.newPage(); p.errs = []; await p.setViewport({width: w, height: h});
  p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => m.type() === 'error' && p.errs.push(m.text()));
  await p.evaluateOnNewDocument(() => {
    if (!sessionStorage.getItem('init')){ sessionStorage.setItem('init', '1'); localStorage.clear(); }
    window.__writes = [];
    window.showSaveFilePicker = async o => ({name: o.suggestedName, kind: 'file', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      createWritable: async () => ({write: async d => { window.__writes.push(new Uint8Array(d)); }, close: async () => {}, abort: async () => {}})});
    window.showOpenFilePicker = async () => [{name: window.__openName, kind: 'file', getFile: async () => new File([window.__openBytes], window.__openName)}];
  });
  await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await sleep(400);
  return p;
}
const p = await page();
const btn = t => p.evaluate(t => { const x = [...document.querySelectorAll('button')].find(y => y.textContent.trim() === t && !y.closest('[hidden]') && !y.disabled); if (!x) return false; x.click(); return true; }, t);
const song = () => p.evaluate(() => JSON.parse(JSON.stringify(window.spores.store.get())));
const addAudio = async () => { await p.evaluate(() => document.querySelector('button[aria-label^="Add a synth"]').click()); await sleep(80);
  const r = await btn('Audio track (record your voice)'); await sleep(120); return r; };

/* ---- add tracks ---- */
const before = (await song()).tracks.length;
ok(await addAudio(), 'menu has "Audio track (record your voice)" and adds a track');
let s = await song(), t = s.tracks[s.tracks.length - 1];
ok(t.type === 'audio' && t.name === 'Voice 1' && s.tracks.length === before + 1, 'a "Voice 1" audio track was added');
const row = await p.evaluate(() => { const r = document.querySelector('.track.audiotrack'); const sub = r.querySelector('.tsub'); const bar = r.querySelector('.tbar');
  return {sub: sub.textContent, vis: getComputedStyle(sub).display, col: getComputedStyle(bar).backgroundImage, tealVar: getComputedStyle(document.documentElement).getPropertyValue('--audio').trim()}; });
ok(row.sub === 'Audio · no take yet' && row.vis !== 'none', 'track row says "' + row.sub + '"');
ok(/34, 149, 141/.test(row.col), 'the colour bar is the teal audio colour: ' + row.col.slice(0, 40));
const lane0 = await p.evaluate(() => { const l = document.querySelector('.lane.audio'); return {msg: l.querySelector('.lanemsg').textContent, hidden: l.querySelector('.lanemsg').hidden, cells: l.querySelectorAll('.cell').length, canvas: !!l.querySelector('canvas')}; });
ok(lane0.msg === 'No take in this scene · press Record' && !lane0.hidden, 'empty lane says: ' + lane0.msg);
for (let i = 0; i < 3; i++) await addAudio();
s = await song();
ok(s.tracks.filter(x => x.type === 'audio').length === 4, '4 audio tracks');
await p.evaluate(() => document.querySelector('button[aria-label^="Add a synth"]').click()); await sleep(80);
const full = await p.evaluate(() => { const x = [...document.querySelectorAll('.menu button')].find(y => /Audio track/.test(y.textContent)); return {dis: x.disabled, text: x.textContent, title: x.title}; });
ok(full.dis && /4 of 4/.test(full.text) && /4 audio tracks/.test(full.title), '5th audio track disabled with a reason: ' + full.text + ' / ' + full.title);
await p.keyboard.press('Escape'); await sleep(80);
// delete the extra three through the app (asks first) so the rest of the run has one track
for (let i = 0; i < 3; i++){
  await p.evaluate(() => { const rows = [...document.querySelectorAll('.track.audiotrack')]; rows[rows.length - 1].click(); });
  await sleep(100); await btn('Delete track'); await sleep(100); await p.evaluate(() => [...document.querySelectorAll('.dialog button')].find(x => /^Delete /.test(x.textContent)).click()); await sleep(100);
}
s = await song(); ok(s.tracks.filter(x => x.type === 'audio').length === 1, 'deleted the extra three (asked first)');
await p.evaluate(() => document.querySelector('.track.audiotrack').click()); await sleep(100);

/* ---- panel (Simple) ---- */
const panel = await p.evaluate(() => { const P = document.querySelector('.panel');
  return {sec: [...P.querySelectorAll('.psec')].map(x => x.textContent), rec: P.querySelector('.bigrec').textContent, loop: [...P.querySelectorAll('.pseg .tb')].map(x => x.textContent + (x.classList.contains('on') ? '*' : '')),
    hear: [...P.querySelectorAll('.checkrow')].map(x => x.textContent + ':' + x.querySelector('input').checked), notes: [...P.querySelectorAll('.note')].map(x => x.textContent), more: !!P.querySelector('input[aria-label=Gain]')}; });
ok(/Record/.test(panel.rec) && panel.sec.includes('Input') && panel.sec.includes('Track'), 'panel: Record, Input, Track: ' + panel.sec);
ok(panel.loop.join(',') === '1,2*,4,8', 'loop length 1/2/4/8, 2 bars chosen by default: ' + panel.loop);
ok(panel.hear[0] === 'Hear myself:false' && panel.hear[1] === 'Keep going:false', 'Hear myself off by default, Keep going off: ' + panel.hear);
ok(panel.notes.includes('Wear headphones so the speakers don’t get recorded.'), 'headphones line is there');
ok(!panel.more, 'Simple has no gain / offset');
ok(await p.evaluate(() => !window.spores.engine.monitor), 'engine.monitor is false');

/* ---- loop length through store.edit / Undo ---- */
await p.evaluate(() => [...document.querySelectorAll('.pseg .tb')].find(x => x.textContent === '4').click()); await sleep(100);
s = await song(); ok(s.tracks.find(x => x.type === 'audio').loop === 4, 'loop 4 stored on the track');
await p.evaluate(() => window.spores.store.undo()); await sleep(100);
ok((await p.evaluate(() => [...document.querySelectorAll('.pseg .tb.on')].map(x => x.textContent))).join() === '2', 'Undo: back to 2');
await p.evaluate(() => [...document.querySelectorAll('.pseg .tb')].find(x => x.textContent === '1').click()); await sleep(100);
ok((await song()).tracks.find(x => x.type === 'audio').loop === 1, 'loop 1 chosen for the take');

/* ---- input, meter ---- */
await btn('Turn on the microphone'); await sleep(800);   // (already on when Chrome says the permission is granted)
const inp = await p.evaluate(() => ({open: window.spores.engine.input.open, dev: [...document.querySelectorAll('select[aria-label="Input device"] option')].map(o => o.textContent), ch: document.querySelector('select[aria-label="Input channel"]').closest('.prow').hidden}));
ok(inp.open && inp.dev[0] === 'Default input', 'input opened; devices: ' + inp.dev);
const lv = []; for (let i = 0; i < 40; i++){ lv.push(await p.evaluate(() => document.querySelector('.mfill').style.transform)); await sleep(100); }
ok(new Set(lv).size >= 3, 'level meter moves (' + new Set(lv).size + ' values: ' + [...new Set(lv)].slice(0, 4) + ')');

/* ---- record a 1-bar take ---- */
await btn('● Record');
const seen = {count: new Set(), line: new Set(), lane: new Set(), stop: false}; let take = null;
for (let i = 0; i < 100; i++){
  const r = await p.evaluate(() => { const P = document.querySelector('.panel'), c = P.querySelector('.counts');
    return {count: c.hidden ? '' : (P.querySelector('.cnt.now') || {}).textContent, line: P.querySelector('.recline').textContent, btn: P.querySelector('.bigrec').textContent, lane: document.querySelector('.lane.audio .lanemsg').textContent,
      clip: Object.values(window.spores.store.get().scenes.A.clips || {})[0]}; });
  if (r.count) seen.count.add(r.count); if (r.line) seen.line.add(r.line.replace(/ \(take.*/, '')); seen.lane.add(r.lane); if (r.btn === '■ Stop') seen.stop = true;
  if (r.clip){ take = r.clip; break; } await sleep(100);
}
ok([...seen.count].join('') === '1234' || seen.count.size >= 3, 'count-in shown as 1 2 3 4 (saw ' + [...seen.count] + ')');
ok(seen.line.has('Recording… bar 1 of 1'), 'status: ' + [...seen.line]);
ok(seen.stop && seen.lane.has('Counting in…') && seen.lane.has('Recording…'), 'button turns to ■ Stop; lane says: ' + [...seen.lane]);
ok(take && take.bars === 1, 'a 1-bar take arrived in scene A: ' + JSON.stringify(take));
await sleep(600);
const after = await p.evaluate(() => { const l = document.querySelector('.lane.audio'), cv = l.querySelector('canvas'), g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
  return {px: n, msgHidden: l.querySelector('.lanemsg').hidden, sub: document.querySelector('.track.audiotrack .tsub').textContent, rec: document.querySelector('.bigrec').textContent, w: cv.clientWidth, lw: l.clientWidth}; });
ok(after.px > 300 && after.msgHidden, 'the take shows as a waveform in the lane (' + after.px + ' px drawn)');
ok(after.sub === 'Audio · 1 bar' && after.rec === '● Record', 'row says "' + after.sub + '", button back to Record');
ok(await p.evaluate(() => !window.spores.engine.recording), 'recording finished');
await p.evaluate(() => window.spores.store.undo()); await sleep(200);
const und = await p.evaluate(() => { const l = document.querySelector('.lane.audio'); return {clips: Object.keys(window.spores.store.get().scenes.A.clips).length, msg: l.querySelector('.lanemsg').textContent, sub: document.querySelector('.track.audiotrack .tsub').textContent}; });
ok(und.clips === 0 && /No take/.test(und.msg) && und.sub === 'Audio · no take yet', 'Undo removes the take: ' + und.msg);
await p.evaluate(() => window.spores.store.redo()); await sleep(300);
const red = await p.evaluate(() => { const cv = document.querySelector('.lane.audio canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return {n, clips: Object.keys(window.spores.store.get().scenes.A.clips).length}; });
ok(red.clips === 1 && red.n > 300, 'Redo brings the take (and its waveform) back');

/* ---- playing: the playhead crosses the audio lane, the take plays ---- */
await p.evaluate(() => window.spores.engine.play('scene', 'A')); await sleep(700);
ok(await p.evaluate(() => !!document.querySelector('.lane.audio .cell.now')) || await (async () => { await sleep(500); return p.evaluate(() => !!document.querySelector('.lane.audio .cell.now')); })(), 'playhead crosses the audio lane');
await p.evaluate(() => window.spores.engine.stop());

/* ---- More ---- */
await btn('More'); await sleep(200);
const setRange = async (label, v) => { await p.evaluate((l, v) => { const i = document.querySelector(`input[aria-label="${l}"]`); i.value = v; i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); }, label, v); await sleep(150); };
const clip = async () => (await song()).scenes.A.clips[(await song()).tracks.find(x => x.type === 'audio').id];
await setRange('Gain', 6); ok(Math.abs((await clip()).gain - 1.995) < 0.01, 'Gain +6 dB written: ' + (await clip()).gain);
await p.evaluate(() => window.spores.store.undo()); await sleep(150); ok((await clip()).gain === 1, 'Undo: gain back to 1');
await setRange('Start offset', 40); ok(Math.abs((await clip()).offset - 0.04) < 1e-9, 'Start offset 40 ms written');
await setRange('Fade in', 100); await setRange('Fade out', 200); const c2 = await clip(); ok(c2.fadeIn === 0.1 && c2.fadeOut === 0.2, 'fades written: ' + c2.fadeIn + ' / ' + c2.fadeOut);
await p.evaluate(() => document.querySelector('.checkrow input[type=checkbox]:not([checked])') && [...document.querySelectorAll('.checkrow')].find(x => x.textContent === 'Reverse').click()); await sleep(200);
ok((await clip()).reverse === true, 'Reverse written');
await p.evaluate(() => window.spores.store.undo()); await sleep(150); ok((await clip()).reverse === false && (await clip()).fadeOut === 0.2, 'Undo: reverse off again, earlier edits kept');
ok(await p.evaluate(() => /Latency: [\d.]+ ms/.test(document.querySelector('.panel').textContent)), 'latency value shown');
await p.evaluate(() => { const i = document.querySelector('input[aria-label^="Latency adjustment"]'); i.value = '12'; i.dispatchEvent(new Event('change', {bubbles: true})); }); await sleep(150);
ok(await p.evaluate(() => window.spores.engine.latency.offsetMs === 12), 'manual latency offset written (12 ms)');
ok(await p.evaluate(() => JSON.parse(localStorage.getItem('spores.rec')).offsetMs === 12), 'latency is kept on this computer (localStorage)');
await btn('Test latency…'); await sleep(200);
const dlg = await p.evaluate(() => ({t: document.querySelector('.dialog').textContent, b: [...document.querySelectorAll('.dialog button')].map(x => x.textContent)}));
ok(/Hold your headphones/.test(dlg.t) && dlg.b.includes('Start the test'), 'Test latency dialog explains it: ' + dlg.b);
await btn('Not now'); await sleep(100);
ok(await p.evaluate(() => !document.querySelector('.dialog')), 'dialog closed');
await p.evaluate(() => window.spores.engine.setLatencyOffset(0));

/* ---- Keep going: two takes follow one another; Stop ends it; Undo goes back one take ---- */
await btn('Simple'); await sleep(200);
await p.evaluate(() => [...document.querySelectorAll('.checkrow')].find(x => x.textContent === 'Keep going').click()); await sleep(100);
const idBefore = (await clip()).id; let kept = 0, last = idBefore;
await btn('● Record');
for (let i = 0; i < 120 && kept < 2; i++){ await sleep(100); const c = await clip(); if (c && c.id !== last){ kept++; last = c.id; } }
ok(kept === 2, 'keep going: two takes in a row replaced the scene take');
await btn('■ Stop'); await sleep(500);
ok(await p.evaluate(() => document.querySelector('.bigrec').textContent === '● Record' && !window.spores.engine.recording), 'Stop ends keep going, button back to Record');
await p.evaluate(() => window.spores.store.undo()); await sleep(150);
ok((await clip()).id !== last, 'Undo goes back one take');
await p.evaluate(() => [...document.querySelectorAll('.checkrow')].find(x => x.textContent === 'Keep going').click());

/* ---- Song screen mini bar ---- */
await p.evaluate(() => window.spores.show('song')); await sleep(200);
ok(await p.evaluate(() => !!document.querySelector('.minibar.on')), 'Song screen: teal bar for the audio track');
await p.evaluate(() => window.spores.show('steps')); await sleep(200);

/* ---- Save → Open keeps the take visible ---- */
const bytes = await p.evaluate(async () => { window.__writes = []; await window.spores.files.saveAs(); return Array.from(window.__writes[0]); });
const q = await page(await b.createBrowserContext());
const reopened = await q.evaluate(async bytes => {
  window.__openBytes = new Uint8Array(bytes); window.__openName = 'Take.spores';
  const pr = window.spores.files.open(); await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('.dialog button')].find(x => x.textContent === 'Open it').click(); await pr; await new Promise(r => setTimeout(r, 600));
  const cv = document.querySelector('.lane.audio canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
  return {n, sub: document.querySelector('.track.audiotrack .tsub').textContent};
}, bytes);
ok(reopened.n > 300 && reopened.sub === 'Audio · 1 bar', 'Save → Open in a fresh profile: take visible as a waveform, row "' + reopened.sub + '"');
ok(q.errs.length === 0, 'no console errors after Open: ' + q.errs);

/* ---- permission denied → a plain message (no input at all) ---- */
const d = await b.createBrowserContext(); const r = await d.newPage(); r.errs = [];
await r.evaluateOnNewDocument(() => { localStorage.clear(); navigator.mediaDevices.getUserMedia = async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; }; });
await r.setViewport({width: 1280, height: 760}); await r.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await sleep(300);
await r.evaluate(() => { document.querySelector('button[aria-label^="Add a synth"]').click(); [...document.querySelectorAll('.menu button')].find(x => /Audio track/.test(x.textContent)).click(); });
await sleep(200); await r.evaluate(() => document.querySelector('.bigrec').click()); await sleep(400);
const msg = await r.evaluate(() => (document.querySelector('.errnote') || {}).textContent + '|' + (document.querySelector('.errnote') || {hidden: true}).hidden);
ok(/needs permission/.test(msg) && /\|false$/.test(msg), 'permission denied → plain message: ' + msg.slice(0, 80));

/* ---- layout: header one row, no page scroll, targets ≥ 44 px, at both sizes and all skins ---- */
for (const [w, h] of [[1280, 760], [1440, 830]]){
  for (const skin of ['', 'tr909', 'tr808', 'idmpg']){
    await p.setViewport({width: w, height: h});
    await p.evaluate(sk => { sk ? document.documentElement.dataset.skin = sk : delete document.documentElement.dataset.skin; }, skin); await sleep(250);
    for (const mode of ['simple', 'more']){
      await p.evaluate(m => window.spores.store.edit('Mode', s => { s.mode = m; }), mode); await sleep(200);
      const L = await p.evaluate(() => { const hd = document.querySelector('.screen:not([hidden]) .hdr'), kids = [...hd.children].filter(x => x.offsetParent), tops = new Set(kids.map(k => Math.round(k.getBoundingClientRect().top)));
        const small = [...document.querySelectorAll('.screen:not([hidden]) button, .panel input, .panel select, .panel .checkrow')].filter(x => x.offsetParent && !x.classList.contains('tbar')).map(x => [x, x.getBoundingClientRect()])
          .filter(([x, r]) => (x.matches('input[type=checkbox]') ? false : (r.height < 43.5 || r.width < 43.5)) && !(x.classList.contains('tb') && x.classList.contains('text'))).map(([x, r]) => (x.getAttribute('aria-label') || x.textContent || x.tagName).slice(0, 20) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        return {rows: hd.getBoundingClientRect().height < 72 && hd.scrollWidth <= hd.clientWidth + 1 ? 1 : 2, hh: hd.getBoundingClientRect().height, scrollH: document.documentElement.scrollHeight, innerH: innerHeight, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, small}; });
      ok(L.rows === 1 && L.scrollH <= L.innerH && L.scrollW <= L.innerW, `${w}x${h} ${skin || 'minimal'} ${mode}: header one row, no page scroll`);
      if (!skin && mode === 'more') ok(L.small.length === 0, `${w}x${h}: no control under 44 px` + (L.small.length ? ' → ' + L.small : ''));
      if (process.env.SHOTS && w === 1280 && mode === 'more') await p.screenshot({path: `${process.env.SHOTS}/steps-${skin || 'minimal'}-${mode}.png`});
      if (process.env.SHOTS && w === 1440 && mode === 'simple') await p.screenshot({path: `${process.env.SHOTS}/steps-${skin || 'minimal'}-${mode}.png`});
    }
  }
}
await p.evaluate(() => { delete document.documentElement.dataset.skin; });
ok(p.errs.length === 0, 'no console errors: ' + p.errs);
console.log(bad ? `\n${bad} FAILED` : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
