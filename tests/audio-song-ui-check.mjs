/* tests/audio-song-ui-check.mjs (dev only): the song-length audio track's screens in headless Chrome with the fake mic.
 *   python3 -m http.server 8765 (in the repo), then: CHROME=… [SHOTS=/dir] node tests/audio-song-ui-check.mjs   (puppeteer-core on your path)
 * Add (the 4-audio limit is shared with loop tracks), the Steps screen's one-line lane, recording from the start and from
 * block 2 (the waveform starts at the right x), Undo / Redo, start bar − / + (undoable), Save → Open, layout at both
 * sizes in all skins on both screens, no control under 44 px, no console errors. SHOTS: Song-screen screenshots. */
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
const btn = (t, root = 'document') => p.evaluate((t, root) => { const x = [...(root === 'document' ? document : document.querySelector(root)).querySelectorAll('button')].find(y => y.textContent.trim() === t && !y.closest('[hidden]') && !y.disabled); if (!x) return false; x.click(); return true; }, t, root);
const song = () => p.evaluate(() => JSON.parse(JSON.stringify(window.spores.store.get())));
const menu = async label => { await p.evaluate(() => document.querySelector('button[aria-label^="Add a synth"]').click()); await sleep(80);
  const r = await btn(label); await sleep(150); return r; };
const hdr = a => p.evaluate(a => document.querySelector(`.screen:not([hidden]) button[aria-label=${a}]`).click(), a);
const SONGITEM = 'Song-length audio track (record over the whole song)';

/* ---- add; the limit is shared with loop tracks ---- */
ok(await menu(SONGITEM), 'menu has "' + SONGITEM + '" and adds a track');
let s = await song(), t = s.tracks[s.tracks.length - 1];
ok(t.type === 'audio' && t.span === 'song' && t.take === null && t.name === 'Song voice 1', 'a "Song voice 1" song-length track was added');
for (let i = 0; i < 3; i++) await menu('Audio track (record your voice)');
s = await song(); ok(s.tracks.filter(x => x.type === 'audio').length === 4, '3 loop tracks fit next to it: 4 audio tracks');
await p.evaluate(() => document.querySelector('button[aria-label^="Add a synth"]').click()); await sleep(80);
const full = await p.evaluate(() => [...document.querySelectorAll('.menu button')].filter(y => /audio track/i.test(y.textContent)).map(x => x.disabled + '|' + x.textContent));
ok(full.length === 2 && full.every(x => /^true\|/.test(x) && /4 of 4/.test(x)), 'at 4 audio tracks both items are disabled with a reason: ' + full);
await p.keyboard.press('Escape'); await sleep(80);
// remove the three loop tracks again (through the app: it asks first)
for (let i = 0; i < 3; i++){
  await p.evaluate(() => { const rows = [...document.querySelectorAll('.track.audiotrack')]; rows[rows.length - 1].click(); });
  await sleep(100); await btn('Delete track'); await sleep(100); await p.evaluate(() => [...document.querySelectorAll('.dialog button')].find(x => /^Delete /.test(x.textContent)).click()); await sleep(100);
}
s = await song(); ok(s.tracks.filter(x => x.type === 'audio').length === 1, 'back to one audio track');

/* ---- Steps screen: one line, no empty loop lane ---- */
const st = await p.evaluate(() => ({sub: document.querySelector('.track.audiotrack .tsub').textContent, loopLanes: document.querySelectorAll('.lane.audio').length,
  ptr: (document.querySelector('.lane.songpointer') || {}).textContent, h: document.querySelector('.lane.songpointer').getBoundingClientRect().height}));
ok(st.loopLanes === 0 && st.ptr === 'Song-length take · on the Song screen', 'Steps: no loop lane, line "' + st.ptr + '"');
ok(st.sub === 'Audio · whole song · no take yet', 'Steps: row says "' + st.sub + '"');
await p.evaluate(() => document.querySelector('.track.audiotrack').click()); await sleep(150);
const pn = await p.evaluate(() => document.querySelector('.panel').textContent);
ok(/records once over the whole song/.test(pn), 'Steps panel points at the Song screen');
await p.evaluate(() => document.querySelector('.lane.songpointer').click()); await sleep(250);
ok(await p.evaluate(() => !document.querySelectorAll('.screen')[1].hidden), 'tapping the line goes to the Song screen');

/* ---- a song to record over: A (1 bar) once, B (2 bars) twice, A once = 6 bars; 240 BPM = 1 s a bar ---- */
await p.evaluate(() => window.spores.store.edit('Test song', s => { s.bpm = 240; s.scenes.A.bars = 1; s.scenes.B = s.scenes.B || {name: 'Scene B', bars: 2, steps: {}, clips: {}}; s.scenes.B.bars = 2;
  s.song = [{scene: 'A', repeat: 1, loop: false}, {scene: 'B', repeat: 2, loop: false}, {scene: 'A', repeat: 1, loop: false}]; })); await sleep(300);
const lane = await p.evaluate(() => { const c = document.querySelector('.slane'); return {text: document.querySelector('.sstrip .lanemsg').textContent, btns: [...c.querySelectorAll('.bigrec')].filter(x => !x.hidden).map(x => x.textContent + (x.disabled ? '(off)' : '')), vol: !!c.querySelector('input[aria-label=Volume]'), m: !!c.querySelector('.mute'),
  miniAudio: document.querySelectorAll('.minibar').length}; });
ok(lane.text === 'No take yet · press Record', 'empty lane says: ' + lane.text);
ok(lane.btns[0] === '● Record from start' && /selected block\(off\)/.test(lane.btns[1]) && lane.vol && lane.m, 'lane card: ' + lane.btns + ', Volume, Mute');
ok(lane.miniAudio === 0, 'song tracks are not a mini-grid bar');

const waveCols = () => p.evaluate(() => { const cv = document.querySelector('.sstrip canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, dpr = cv.width / parseFloat(cv.style.width);
  let a = 1e9, z = -1; for (let x = 0; x < cv.width; x++) for (let y = 0; y < cv.height; y++) if (d[(y * cv.width + x) * 4 + 3] > 40){ a = Math.min(a, x); z = Math.max(z, x); break; }
  const cards = [...document.querySelectorAll('.sblk')].map(c => [c.offsetLeft, c.offsetWidth]); return {a: a / dpr, z: z / dpr, cards}; });
const recordFor = async (label, ms) => {
  ok(await btn(label, '.slane'), 'pressed "' + label + '"');
  await sleep(400);
  const cnt = await p.evaluate(() => ({counts: !document.querySelector('.slane .counts').hidden, line: document.querySelector('.slane .recline').textContent, stop: !!document.querySelector('.slane .bigrec.on:not([hidden])')}));
  let saw = cnt.counts ? 'count' : '';
  await sleep(1500);
  const rl = await p.evaluate(() => ({line: document.querySelector('.slane .recline').textContent, strip: document.querySelector('.sstrip .lanemsg').textContent}));
  ok(/^Recording… bar \d+/.test(rl.line) && /^Recording… bar/.test(rl.strip), 'during the take: "' + rl.line + '" / lane "' + rl.strip + '"');
  await sleep(ms); await btn('■ Stop', '.slane'); await sleep(900);
  return {saw, cnt};
};
const r1 = await recordFor('● Record from start', 1700);
ok(r1.cnt.counts || /Count-in|Starting/.test(r1.cnt.line) || r1.cnt.stop, 'count-in / stop shown while it starts: ' + JSON.stringify(r1.cnt));
s = await song(); let tk = s.tracks.find(x => x.span === 'song').take;
ok(tk && tk.startBar === 0, 'take kept with startBar 0 (Stop keeps it): ' + JSON.stringify(tk && {startBar: tk.startBar, bpm: tk.bpm}));
let w = await waveCols();
ok(w.a >= w.cards[0][0] - 2 && w.a < w.cards[0][0] + w.cards[0][1] + 4 && w.z > w.cards[1][0], `waveform starts at block 1's left (x ${w.a.toFixed(0)}, block 1 at ${w.cards[0][0]}) and runs on past block 2 (to ${w.z.toFixed(0)})`);
// Undo / Redo
await hdr('Undo'); await sleep(250); s = await song();
ok(s.tracks.find(x => x.span === 'song').take === null && /No take yet/.test(await p.evaluate(() => document.querySelector('.sstrip .lanemsg').textContent)), 'Undo removes the take; the lane says "No take yet"');
await hdr('Redo'); await sleep(250); s = await song();
ok(!!s.tracks.find(x => x.span === 'song').take, 'Redo brings it back');
// from block 2: tap the block, record
await p.evaluate(() => document.querySelectorAll('.sblk')[1].querySelector('.sblk-name').click()); await sleep(200);
ok(await p.evaluate(() => document.querySelectorAll('.sblk')[1].classList.contains('sel')), 'tapping block 2 selects it');
const fb = await p.evaluate(() => [...document.querySelectorAll('.slane .bigrec')].find(x => /block/.test(x.textContent)).textContent);
ok(fb === '● Record from block 2', 'button says "' + fb + '"');
await recordFor(fb, 1500);
s = await song(); tk = s.tracks.find(x => x.span === 'song').take;
ok(tk && tk.startBar === 1, 'take from block 2 has startBar 1 (block 1 is one bar): ' + (tk && tk.startBar));
w = await waveCols();
ok(w.a >= w.cards[1][0] - 2 && w.a < w.cards[1][0] + 40, `waveform starts at block 2's left (x ${w.a.toFixed(0)}, block 2 at ${w.cards[1][0]})`);
ok(w.a > w.cards[0][0] + w.cards[0][1] - 2, 'nothing is drawn over block 1');
await hdr('Undo'); await sleep(200); await hdr('Redo'); await sleep(200);

/* ---- start bar − / + ---- */
await btn('More ▾', '.slane'); await sleep(200);
const sb = () => p.evaluate(() => document.querySelector('.slane .stepper .num').textContent);
ok(await sb() === 'Bar 2', 'More: start bar shows "Bar 2"');
await p.evaluate(() => document.querySelector('.slane button[aria-label="Start one bar later"]').click()); await sleep(200);
s = await song(); ok(s.tracks.find(x => x.span === 'song').take.startBar === 2 && await sb() === 'Bar 3', 'start bar + moves it a whole bar');
let w2 = await waveCols(); ok(w2.a > w.a + 5, 'the waveform moved right');
await hdr('Undo'); await sleep(200); s = await song(); ok(s.tracks.find(x => x.span === 'song').take.startBar === 1, 'Undo puts the start bar back');
await hdr('Redo'); await sleep(200);
await p.evaluate(() => document.querySelector('.slane button[aria-label="Start one bar earlier"]').click()); await p.evaluate(() => document.querySelector('.slane button[aria-label="Start one bar earlier"]').click()); await sleep(250);
s = await song(); ok(s.tracks.find(x => x.span === 'song').take.startBar === 0 && await p.evaluate(() => document.querySelector('.slane button[aria-label="Start one bar earlier"]').disabled), '− moves it earlier, and stops at bar 1');
await p.evaluate(() => document.querySelector('.slane button[aria-label="Start one bar later"]').click()); await sleep(200);
const mo = await p.evaluate(() => [...document.querySelectorAll('.slane-more [aria-label], .slane-more .psec')].map(x => x.getAttribute('aria-label') || x.textContent));
ok(['Trim start', 'Trim end', 'Fade in', 'Fade out', 'Gain', 'Input device', 'Input level', 'Latency'].every(k => mo.some(m => m.indexOf(k) >= 0)), 'More has trim, fades, gain, the shared input picker / meter and latency: ' + mo.length + ' items');
// a slider writes one Undo step
await p.evaluate(() => { const r = document.querySelector('.slane input[aria-label="Fade in"]'); r.value = 250; r.dispatchEvent(new Event('change', {bubbles: true})); }); await sleep(200);
s = await song(); ok(Math.abs(s.tracks.find(x => x.span === 'song').take.fadeIn - 0.25) < 1e-6, 'fade in writes');
await hdr('Undo'); await sleep(150); s = await song(); ok(s.tracks.find(x => x.span === 'song').take.fadeIn === 0.004, 'fade in Undo');
await p.evaluate(() => { const r = document.querySelector('.slane input[aria-label="Trim start"]'); r.value = 0.5; r.dispatchEvent(new Event('change', {bubbles: true})); }); await sleep(250);
s = await song(); ok(s.tracks.find(x => x.span === 'song').take.trimStart === 0.5, 'trim start writes');
// meter is quiet (not black) while the mic is off
await p.evaluate(() => { window.spores.engine.closeInput(); }); await sleep(300);
const mt = await p.evaluate(() => { const f = document.querySelector('.slane .mfill'); return {bg: getComputedStyle(f).backgroundColor, tr: f.style.transform, root: getComputedStyle(document.documentElement).getPropertyValue('--track').trim(), glass: getComputedStyle(document.documentElement).getPropertyValue('--glass').trim()}; });
ok(mt.tr === 'scaleX(1)' && mt.bg !== 'rgb(5, 6, 7)' && mt.bg !== 'rgb(0, 0, 0)', 'level meter cover is the quiet track colour, not black, while the mic is off: ' + mt.bg);
await btn('Less ▴', '.slane');

/* ---- Save → Open keeps it ---- */
const bytes = await p.evaluate(async () => { window.__writes = []; await window.spores.files.saveAs(); return Array.from(window.__writes[0]); });
const q = await page(await b.createBrowserContext());
const re = await q.evaluate(async bytes => {
  window.__openBytes = new Uint8Array(bytes); window.__openName = 'Song.spores';
  const pr = window.spores.files.open(); await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('.dialog button')].find(x => x.textContent === 'Open it').click(); await pr; await new Promise(r => setTimeout(r, 600));
  window.spores.show('song'); await new Promise(r => setTimeout(r, 500));
  const cv = document.querySelector('.sstrip canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
  return {n, startBar: window.spores.store.get().tracks.find(x => x.span === 'song').take.startBar};
}, bytes);
ok(re.n > 300 && re.startBar === 1, 'Save → Open in a fresh profile: the take is drawn on the Song lane, startBar ' + re.startBar);
ok(q.errs.length === 0, 'no console errors after Open: ' + q.errs);

/* ---- layout, both screens, both sizes, all skins ---- */
const check = () => p.evaluate(() => { const scr = document.querySelector('.screen:not([hidden])'), hd = scr.querySelector('.hdr'), kids = [...hd.children].filter(x => x.offsetParent), tops = new Set(kids.map(k => Math.round(k.getBoundingClientRect().top)));
  const small = [...scr.querySelectorAll('button, input, select, .checkrow')].filter(x => x.offsetParent && !x.classList.contains('tbar') && !x.closest('.sinner'))
    .map(x => [x, x.getBoundingClientRect()]).filter(([x, r]) => (x.matches('input[type=checkbox]') ? false : (r.height < 43.5 || r.width < 43.5)) && !(x.classList.contains('tb') && x.classList.contains('text')))
    .map(([x, r]) => (x.getAttribute('aria-label') || x.textContent || x.tagName).slice(0, 24) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  return {rows: hd.getBoundingClientRect().height < 72 && hd.scrollWidth <= hd.clientWidth + 1 ? 1 : 2, scrollH: document.documentElement.scrollHeight, innerH: innerHeight, scrollW: document.documentElement.scrollWidth, innerW: innerWidth, small}; });
for (const [w, h] of [[1280, 760], [1440, 830]]){
  await p.setViewport({width: w, height: h});
  for (const skin of ['', 'black', 'pastel']){
    await p.evaluate(sk => { sk ? document.documentElement.dataset.skin = sk : delete document.documentElement.dataset.skin; }, skin); await sleep(250);
    for (const scr of ['steps', 'song']){
      await p.evaluate(x => window.spores.show(x), scr); await sleep(300);
      if (scr === 'song') await btn('More ▾', '.slane');
      const L = await check();
      ok(L.rows === 1 && L.scrollH <= L.innerH && L.scrollW <= L.innerW, `${w}x${h} ${skin || 'minimal'} ${scr}: header one row, no page scroll`);
      if (!skin) ok(L.small.length === 0, `${w}x${h} ${scr}: no control under 44 px` + (L.small.length ? ' → ' + L.small : ''));
      if (process.env.SHOTS && scr === 'song' && w === 1280) await p.screenshot({path: `${process.env.SHOTS}/song-${skin || 'minimal'}.png`});
      if (scr === 'song') await btn('Less ▴', '.slane');
    }
  }
}
await p.evaluate(() => { delete document.documentElement.dataset.skin; });
ok(p.errs.length === 0, 'no console errors: ' + p.errs);
console.log(bad ? `\n${bad} FAILED` : '\nall passed'); await b.close(); process.exit(bad ? 1 : 0);
