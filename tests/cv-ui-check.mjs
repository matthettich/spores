/* tests/cv-ui-check.mjs (dev only, like the others): CV UI end to end in headless Chrome: add a CV track, panel, outputs, Test dialog holds, Tune dialog with a fake input */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.evaluateOnNewDocument(() => localStorage.clear());
await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await new Promise(r => setTimeout(r, 500));
const q = async (f, ...a) => p.evaluate(f, ...a);
const clickText = (txt) => q(t => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t && !x.closest('[hidden]')); if (!b) return false; b.click(); return true; }, txt);
await q(() => { const m = [...document.querySelectorAll('button')].find(b => /synth, MIDI or CV/.test(b.title || '')); m.click(); });
console.log('menu CV item:', await clickText('CV track'));
await new Promise(r => setTimeout(r, 200));
const panel = await q(() => { const s = window.spores.store.get(), t = s.tracks[s.tracks.length - 1];
  return {name: t.name, cv: t.cv, sec: [...document.querySelectorAll('.psec')].map(x => x.textContent), notes: [...document.querySelectorAll('.note')].map(x => x.textContent).filter(x => /tuned|Outputs 1/.test(x)),
    list: [...document.querySelectorAll('*')].some(x => x.children.length === 0 && /out 3 \/ 4/.test(x.textContent)), volume: !![...document.querySelectorAll('.plabel')].find(x => /Volume/i.test(x.textContent))}; });
console.log('panel', JSON.stringify(panel));
// a second CV track takes 5 / 6
await q(() => [...document.querySelectorAll('button')].find(b => /synth, MIDI or CV/.test(b.title || '')).click()); await clickText('CV track');
console.log('second CV:', JSON.stringify(await q(() => { const s = window.spores.store.get(); return s.tracks.slice(-1)[0].cv; })));
// change pitch output to 1 → warning; undo
await q(() => { const sel = document.querySelector('select[aria-label="Pitch output"]'); sel.value = '1'; sel.dispatchEvent(new Event('change')); });
console.log('warning:', await q(() => [...document.querySelectorAll('.note')].map(x => x.textContent).find(x => /Outputs 1–2/.test(x)) || 'none'));
await q(() => window.spores.store.undo && window.spores.store.undo());
console.log('after undo pitch:', await q(() => window.spores.store.get().tracks.slice(-1)[0].cv.pitch));
// Test outputs dialog: hold +5 V → the worklet's output 1 channel 5 (index 4) carries 0.5. Tap the node with a splitter.
await clickText('Test outputs…'); await new Promise(r => setTimeout(r, 100));
await clickText('+5 V');
const held = await q(async () => { const e = window.spores.engine, ctx = e.ctx; await ctx.resume();
  const sp = ctx.createChannelSplitter(32), an = ctx.createAnalyser(); an.fftSize = 2048; e.node.connect(sp, 1); sp.connect(an, 4);
  await new Promise(r => setTimeout(r, 300)); const buf = new Float32Array(2048); an.getFloatTimeDomainData(buf); const v = buf[1000]; sp.disconnect(); return v; });
console.log('held on output 5 (pitch of 2nd CV):', held.toFixed(3), 'want 0.500');
await clickText('Done');
const after = await q(async () => { const e = window.spores.engine, ctx = e.ctx, sp = ctx.createChannelSplitter(32), an = ctx.createAnalyser(); an.fftSize = 2048; e.node.connect(sp, 1); sp.connect(an, 4);
  await new Promise(r => setTimeout(r, 300)); const buf = new Float32Array(2048); an.getFloatTimeDomainData(buf); sp.disconnect(); return buf[1000]; });
console.log('after Done:', after.toFixed(3));
// Tune dialog opens, lists the fake input, a run with the fake mic (a beep, not a VCO) ends with a clear message
await clickText('Tune CV…'); await new Promise(r => setTimeout(r, 800));
console.log('tune inputs:', await q(() => [...document.querySelectorAll('select[aria-label="Input the oscillator comes in on"] option')].map(o => o.textContent).join(' | ')));
await clickText('Start tuning'); await new Promise(r => setTimeout(r, 12000));
console.log('tune result:', await q(() => [...document.querySelectorAll('.dialog .note')].map(x => x.textContent).slice(-2).join(' || ')));
await clickText('Close');
console.log('ERR', errs); await b.close();
