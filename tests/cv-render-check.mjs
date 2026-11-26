/* tests/cv-render-check.mjs: a CV track rendered offline through the worklet: pitch values per note (1 V/oct at 10 V
 * full scale) and the gate (5 V, half a step). Dev only: python3 -m http.server 8765, then CHROME=… node tests/cv-render-check.mjs */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await new Promise(r => setTimeout(r, 500));
const r = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js'), {newTrack} = await import('/js/store.js');
  const s = structuredClone(window.spores.store.get()); const t = newTrack('cv'); t.oct = 3; s.tracks.push(t);
  s.tracks.forEach(x => x.mute = x.type !== 'cv'); s.key = 'C'; s.scale = 'minor';
  for (const k of Object.keys(s.scenes)) s.scenes[k].steps[t.id] = [0, 2, 4, 7].flatMap(d => [{on: true, deg: d, vel: 100, chance: 100}, null, null, null]);
  const sr = 48000, ctx = new OfflineAudioContext(6, sr * 2.2, sr); ctx.destination.channelInterpretation = 'discrete';
  await ctx.audioWorklet.addModule('/js/engine/worklet.js');
  const sceneKey = Object.keys(s.scenes)[0];
  const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 32], processorOptions: {song: compile(s), play: {mode: 'scene', scene: sceneKey}}});
  n.connect(ctx.destination, 1);
  const B = await ctx.startRendering(), P = B.getChannelData(2), G = B.getChannelData(3), L = B.getChannelData(0);
  const at = ms => +P[Math.round(ms / 1000 * sr)].toFixed(4), gt = ms => +G[Math.round(ms / 1000 * sr)].toFixed(3);
  let leak = 0; for (const x of L) leak = Math.max(leak, Math.abs(x));
  // steps every 125 ms from 60 ms; notes on steps 0,4,8,12 → 60, 560, 1060, 1560 ms
  return {pitch: [at(100), at(600), at(1100), at(1600)], want: [0, 0.3/1.2*0+ (3/12)/10, (7/12)/10, (12/12)/10].map(x => +x.toFixed(4)),
    gate: [gt(59), gt(61), gt(100), gt(130), gt(561)], leakToCh1: leak};
});
console.log(JSON.stringify(r)); console.log('ERR', errs); await b.close();
