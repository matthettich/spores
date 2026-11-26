/* tests/sounds-check.mjs: every engine renders through the worklet (offline), then the realtime path (pump wasm reaches
 * the worklet, a Modal track records its notes, hit() on an unrecorded note waits for it). Dev only, like engine-check.mjs:
 *   python3 -m http.server 8765 (repo folder) · CHROME=/path/to/chrome [WAV=out.wav] node tests/sounds-check.mjs
 * Each engine should show bad 0, onsetMs ≈ 60 (the first step) and rmsDb within a few dB of the others (about -20). */
import puppeteer from 'puppeteer-core';
import {writeFileSync} from 'fs';
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
const p = await b.newPage(); const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'});
await new Promise(r => setTimeout(r, 800));
const r = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js'), {SOUNDS, settingsFor} = await import('/js/engine/sounds.js');
  const {ModalCore, ScannedCore} = await import('/js/engine/rendered.js');
  const wasm = await WebAssembly.compile(await (await fetch('/js/engine/pump-synth.wasm')).arrayBuffer());
  const sr = 48000, out = {}, wavs = [];
  const tests = [['Coil · Spring harp', 'synth'], ['Orbit · Lorenz lead', 'synth'], ['Fold · Folded marimba', 'synth'], ['Modal · Marimba', 'synth'], ['Scanned · Evolving bell', 'synth'],
    ['Boing kick', 'drum'], ['Boing snare', 'drum'], ['Kick', 'drum'], ['Acid bass', 'synth']];
  for (const [name, kind] of tests){
    const s = structuredClone(window.spores.store.get());
    const ti = kind === 'synth' ? 7 : 0, t = s.tracks[ti]; t.sound = name; t.params = {};
    if (kind === 'synth'){ t.oct = 3; s.scenes.A.steps[t.id] = [0, 2, 4, 7].flatMap(d => [{on: true, deg: d, vel: 100, chance: 100}, null, null, null]); }
    s.tracks.forEach((x, i) => x.mute = i !== ti);
    const c = compile(s), ct = c.tracks[ti], bufs = [];
    if (ct.rendered){ const E = ct.engine === 'modal' ? ModalCore : ScannedCore;
      for (const st of c.scenes.A.steps[ti]) if (st && !bufs.some(x => x.note === st.note)) bufs.push({id: ct.id, note: st.note, data: E.render(Object.assign({}, ct.vals, {oct: 0, tune: st.note - 36}), sr, ct.vals.hold || 0.5)}); }
    const ctx = new OfflineAudioContext(2, sr * 2.2, sr); await ctx.audioWorklet.addModule('/js/engine/worklet.js');
    const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: c, play: {mode: 'scene', scene: 'A'}, wasm, bufs}});
    n.connect(ctx.destination); const B = await ctx.startRendering(), L = B.getChannelData(0);
    let pk = 0, rms = 0, bad = 0, first = -1; for (let i = 0; i < L.length; i++){ const a = Math.abs(L[i]); if (a > pk) pk = a; rms += L[i] * L[i]; if (!isFinite(L[i])) bad++; if (first < 0 && a > 0.005) first = i; }
    out[name] = {engine: ct.engine, peak: +pk.toFixed(3), rmsDb: +(10 * Math.log10(rms / L.length + 1e-12)).toFixed(1), onsetMs: +(first / sr * 1000).toFixed(1), bad,
      main: settingsFor(name).main.map(x => x.s).join(','), all: settingsFor(name).all.length};
    wavs.push(L);
  }
  // one listening file: every test one after the other
  const tot = wavs.reduce((a, w) => a + w.length, 0), dv = new DataView(new ArrayBuffer(44 + tot * 2)), w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + tot * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, tot * 2, true);
  let o = 44; for (const W of wavs) for (const x of W){ dv.setInt16(o, Math.max(-1, Math.min(1, x)) * 32767, true); o += 2; }
  const u8 = new Uint8Array(dv.buffer); let bin = ''; for (let i = 0; i < u8.length; i += 32768) bin += String.fromCharCode(...u8.subarray(i, i + 32768));
  out.counts = {sounds: Object.keys(SOUNDS).length}; out.wav = btoa(bin);
  return out;
});
if (process.env.WAV) writeFileSync(process.env.WAV, Buffer.from(r.wav, 'base64')); delete r.wav;
for (const [k, v] of Object.entries(r)) console.log(k, JSON.stringify(v));
// realtime: wasm reaches the worklet; a Modal track records its notes; hit() on an unrecorded note waits and plays
const rt = await p.evaluate(async () => {
  const {engine, store} = window.spores; const ok = await engine.wasmReady;
  store.edit('t', s => { s.tracks[7].sound = 'Modal · Vibes'; s.tracks[7].params = {}; s.scenes.A.steps[s.tracks[7].id] = [{on: true, deg: 0, vel: 100, chance: 100}, null, {on: true, deg: 4, vel: 100, chance: 100}]; });
  const t0 = performance.now(); await engine.hit(7, 9); const hitMs = performance.now() - t0;
  store.edit('t', s => { s.tracks[7].params = {mat: 5, inharm: 0.4}; });
  await new Promise(r => setTimeout(r, 900));
  store.edit('t', s => { s.tracks[6].sound = 'Coil · Tank bass'; });
  await new Promise(r => setTimeout(r, 200));
  return {wasm: ok, hitMs: Math.round(hitMs)};
});
console.log('REALTIME', JSON.stringify(rt));
console.log('ERRORS', errs);
await b.close();
