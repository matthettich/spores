/* tests/engine-check.mjs: headless checks of the engine (not part of the app; needs Node and Chrome).
 *   npm i --no-save puppeteer-core        (once, anywhere on your path)
 *   python3 -m http.server 8765           (in the repo folder, in another terminal)
 *   CHROME=/path/to/chrome node tests/engine-check.mjs
 * Prints: kick timing at 170 BPM (gaps should equal `want`), a bass note's pitch (C2 = 65.4 Hz), the song order
 * for A ×2 → B ×1 (AABAA…), and MIDI sent to a fake port while playing at 120 (clock gaps ≈ 20.83 ms, lead > 0). */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
const p = await b.newPage(); const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
// a fake MIDI port that records what it is sent
await p.evaluateOnNewDocument(() => {
  window.__sent = [];
  const out = {id: 'iac', name: 'IAC Bus 1', send: (d, t) => window.__sent.push({d: [...d], t: t ?? performance.now(), at: performance.now()}), clear(){}};
  navigator.requestMIDIAccess = async () => ({outputs: new Map([['iac', out]]), onstatechange: null});
});
await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'});
await new Promise(r => setTimeout(r, 300));

const r = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js');
  const sr = 48000, res = {};
  async function render(song, secs, play, onStep){
    const ctx = new OfflineAudioContext(2, sr * secs, sr);
    await ctx.audioWorklet.addModule('/js/engine/worklet.js');
    const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: compile(song), play}});
    n.connect(ctx.destination); if (onStep) n.port.onmessage = e => e.data.t === 'step' && onStep(e.data);
    const buf = await ctx.startRendering(); return buf;
  }
  // 1. 170 BPM kick onsets
  const s = structuredClone(window.spores.store.get()); s.bpm = 170; for (const t of s.tracks) t.mute = t.sound !== 'Kick';
  const L = (await render(s, 2, {mode: 'scene', scene: 'A'})).getChannelData(0), ons = []; let last = -1e9;
  for (let i = 0; i < L.length; i++){ const a = Math.abs(L[i]) > 0.01; if (a && i - last > sr * 0.15) ons.push(i / sr); if (a) last = i; }
  const gaps = ons.slice(1).map((t, i) => t - ons[i]);
  res.bpm170 = {first: +ons[0].toFixed(4), gapMin: +Math.min(...gaps).toFixed(5), gapMax: +Math.max(...gaps).toFixed(5), want: +(60 / 170).toFixed(5)};
  // 2. synth pitch: a lone bass note on step 0, deg 0, oct 2 in C minor → C2 = 65.41 Hz
  const q = structuredClone(window.spores.store.get()); for (const t of q.tracks) t.mute = t.name !== 'Bass';
  const bid = q.tracks[6].id; q.scenes.A.steps[bid] = [{on: true, deg: 0, vel: 100, chance: 100}]; q.tracks[6].sound = 'Round bass';
  const B = (await render(q, 1, {mode: 'scene', scene: 'A'})).getChannelData(0);
  let zc = 0; const a0 = Math.round(0.08 * sr), a1 = Math.round(0.11 * sr) + sr * 0.0; for (let i = a0 + 1; i < Math.round(0.11 * sr); i++) if (B[i - 1] < 0 && B[i] >= 0) zc++;
  // longer window for a better estimate
  let z = [], prev = 0; for (let i = Math.round(0.07 * sr); i < Math.round(0.12 * sr); i++){ if (B[i - 1] < 0 && B[i] >= 0) z.push(i); }
  res.bassHz = z.length > 2 ? +((z.length - 1) * sr / (z[z.length - 1] - z[0])).toFixed(2) : null;
  // 3. song order: A ×2 → B ×1, at a fast tempo
  const g = structuredClone(window.spores.store.get()); g.bpm = 300; g.scenes.B = {name: 'B', bars: 1, steps: {}}; g.song = [{scene: 'A', repeat: 2}, {scene: 'B', repeat: 1}];
  const seq = []; await render(g, 3.5, {mode: 'song', block: 0}, m => { if (m.counter === 0) seq.push(m.scene); });
  res.songOrder = seq.join('');
  return res;
});
console.log(JSON.stringify(r));

// 5. MIDI: Seeds link + a MIDI track, clock, start / stop, while really playing
await p.evaluate(() => window.spores.store.edit('test', s => {
  s.link.seedsPort = 'iac'; s.link.clock = true;
  s.tracks[7].type = 'midi'; s.tracks[7].midi = {port: 'iac', ch: 2, clock: false};
  s.scenes.A.steps[s.tracks[7].id] = [{on: true, deg: 2, vel: 90, chance: 100}];
}));
await p.click('#play');
await new Promise(r => setTimeout(r, 2050));
const m = await p.evaluate(async () => { window.spores.engine.stop(); await new Promise(r => setTimeout(r, 300)); return window.__sent; });
const kind = d => d[0] === 0xF8 ? 'clock' : d[0] === 0xFA ? 'start' : d[0] === 0xFC ? 'stop' : (d[0] & 0xF0) === 0x90 ? 'on' : (d[0] & 0xF0) === 0x80 ? 'off' : '?';
const count = {}; for (const x of m) count[kind(x.d)] = (count[kind(x.d)] || 0) + 1;
const clocks = m.filter(x => x.d[0] === 0xF8).map(x => x.t), cg = clocks.slice(1).map((t, i) => t - clocks[i]);
const lead = m.filter(x => x.d[0] !== 0xFC && x.d[0] !== 0x80 && x.d[0] !== 0x81 && x.d[0] !== 0x8F).map(x => x.t - x.at);
const ons = m.filter(x => (x.d[0] & 0xF0) === 0x90);
const big = cg.map((g,i)=>[i,+g.toFixed(1)]).filter(x=>x[1]>22||x[1]<19.5); console.log('odd clock gaps', JSON.stringify(big), 'of', cg.length);
console.log('MIDI', JSON.stringify({count, clockGapMs: [+Math.min(...cg).toFixed(2), +Math.max(...cg).toFixed(2)], want: (60000 / 120 / 24).toFixed(2),
  minLeadMs: +Math.min(...lead).toFixed(1), seedsKicks: ons.filter(x => x.d[0] === 0x9F && x.d[1] === 36).length, midiTrack: ons.filter(x => x.d[0] === 0x91).map(x => x.d[1])[0]}));
console.log('ERRORS', errs);
await b.close();
