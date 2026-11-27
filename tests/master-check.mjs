/* tests/master-check.mjs (dev only; server on 8765, puppeteer-core): the Song screen master meter + fader, exports follow song.master. */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
for (const [w, h] of [[1280, 760], [1440, 830]]){
  await p.setViewport({width: w, height: h}); await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await new Promise(r => setTimeout(r, 400));
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Song').click()); await new Promise(r => setTimeout(r, 300));
  const one = await p.evaluate(() => { const hd = [...document.querySelectorAll('header.hdr')].find(x => x.offsetParent); const tops = [...hd.children].filter(c => c.offsetParent && c.offsetHeight > 4).map(c => { const r = c.getBoundingClientRect(); return (r.top + r.bottom) / 2; }); return Math.max(...tops) - Math.min(...tops) < 10 && hd.scrollWidth <= hd.clientWidth + 1; });
  ok(one, `${w}x${h}: Song header on one row with the master section`);
}
await p.keyboard.press('Space'); await new Promise(r => setTimeout(r, 1500));
const cov = () => p.$$eval('.mmcover', e => e.map(x => +(x.style.transform.match(/[\d.]+/) || [1])[0]));
const c1 = await cov(); ok(c1.every(v => v < 0.9), 'meter moves while playing (covers ' + c1 + ')');
await p.screenshot({path: '/tmp/master.png', clip: {x: 0, y: 0, width: 1440, height: 70}});
// the fader: -12 dB → song.master ≈ 0.251, and the engine's output drops ~12 dB
const lvl = async () => { let m = 0; for (let k = 0; k < 6; k++){ m = Math.max(m, await p.evaluate(() => new Promise(r => { const off = window.spores.engine.on('master', x => { off(); r(Math.max(x.L, x.R)); }); }))); await new Promise(r => setTimeout(r, 150)); } return m; };
const before = await lvl();
await p.evaluate(() => { const f = document.querySelector('.mfader'); f.value = -12; f.dispatchEvent(new Event('input', {bubbles: true})); });
await new Promise(r => setTimeout(r, 600)); const after = await lvl();
const g = await p.evaluate(() => window.spores.store.get().master);
ok(Math.abs(g - 0.2512) < 0.001, 'fader at -12 dB sets song.master to ' + g.toFixed(4));
ok(after > 0 && Math.abs(20 * Math.log10(after / before) + 12) < 2.5, `the mix drops about 12 dB (${(20 * Math.log10(after / before)).toFixed(1)} dB)`);
ok(await p.$eval('.mval', e => e.textContent) === '-12.0 dB', 'value shows -12.0 dB');
await p.keyboard.press('Space');
await p.evaluate(() => window.spores.store.undo()); ok((await p.evaluate(() => window.spores.store.get().master)) === 1, 'one Undo puts it back to 0 dB');
await p.evaluate(() => document.querySelector('.mfader').dispatchEvent(new MouseEvent('dblclick', {bubbles: true})));
// export follows the master: render offline at master 0.5 vs 1
const ex = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js'); const base = structuredClone(window.spores.store.get());
  const r = async m => { const s = structuredClone(base); s.master = m; const sr = 48000, ctx = new OfflineAudioContext(2, sr, sr); await ctx.audioWorklet.addModule('/js/engine/worklet.js');
    const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: compile(s), play: {mode: 'scene', scene: Object.keys(s.scenes)[0]}}}); n.connect(ctx.destination);
    const d = (await ctx.startRendering()).getChannelData(0); let e = 0; for (const x of d) e += Math.atanh(Math.max(-0.999999, Math.min(0.999999, x))) ** 2; return Math.sqrt(e); };
  return {a: await r(1), h: await r(0.5)};
});
ok(Math.abs(ex.h / ex.a - 0.5) < 0.01, 'an offline render (exports) follows the master: ratio ' + (ex.h / ex.a).toFixed(3));
const mig = await p.evaluate(async () => { const {migrate} = await import('/js/store.js'); const m = migrate({v: 4, tracks: [{id: 'a', type: 'drum', sound: 'Kick'}], scenes: {A: {name: 'A', bars: 1, steps: {}}}, song: []}); return [m.master, m.loopSong]; });
ok(mig[0] === 1 && mig[1] === true, 'an older song opens with master 0 dB, loop song on: ' + mig);
ok(!errs.length, 'no console errors ' + errs.join(' '));
console.log(bad ? bad + ' FAILED' : 'all ok'); await b.close();
