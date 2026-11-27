/* tests/scene-mute-check.mjs (dev only; server on 8765, puppeteer-core): per-scene mute: song A then B; the Kick plays in A, is muted in B; the Snare is soloed in B only. UI: M in scene A leaves B alone. */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox']});
const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.setViewport({width: 1440, height: 900});
await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await new Promise(r => setTimeout(r, 400));
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const r = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js'); const {newSong, migrate} = await import('/js/store.js');
  const s = newSong(), K = s.tracks[0].id, S = s.tracks[1].id, B = s.tracks[6].id, on = i => ({on: true, deg: 0, vel: 110, chance: 100});
  const lane = idx => idx.reduce((a, i) => (a[i] = on(), a), []);
  s.scenes.A = {name: 'A', bars: 1, steps: {[K]: lane([0, 4, 8, 12])}, clips: {}, mute: {}, solo: {}};
  s.scenes.B = {name: 'B', bars: 1, steps: {[K]: lane([0, 4, 8, 12]), [S]: lane([2, 10]), [B]: lane([6, 14])}, clips: {}, mute: {[K]: true}, solo: {[S]: true}};
  s.song = [{scene: 'A', repeat: 1}, {scene: 'B', repeat: 1}];
  const sr = 48000, ctx = new OfflineAudioContext(2, sr * 4, sr); await ctx.audioWorklet.addModule('/js/engine/worklet.js');
  const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: compile(s), play: {mode: 'song', block: 0}}});
  n.connect(ctx.destination); const d = (await ctx.startRendering()).getChannelData(0);
  const st = sr * 15 / 120, t0 = Math.round(0.06 * sr), pk = (a, z) => { let m = 0; for (let i = a; i < z; i++) m = Math.max(m, Math.abs(d[i])); return m; };
  const at = step => pk(t0 + step * st, t0 + step * st + 2400);
  // an old v3 file: a muted track stays muted in every scene
  const old = migrate({v: 3, tracks: [{id: 'x1', type: 'drum', sound: 'Kick', mute: true, solo: false}, {id: 'x2', type: 'drum', sound: 'Snare'}], scenes: {A: {name: 'A', bars: 1, steps: {}}, B: {name: 'B', bars: 1, steps: {}}}, song: []});
  return {kickA: at(0), kickB: at(16), snareB: at(18), bassB: at(22), old: {v: old.v, A: old.scenes.A.mute, B: old.scenes.B.mute, trackFlag: 'mute' in old.tracks[0]}};
});
ok(r.kickA > 0.05, 'scene A: the Kick plays (' + r.kickA.toFixed(3) + ')');
ok(r.kickB < 1e-4, 'scene B: the Kick is muted there (' + r.kickB.toExponential(1) + ')');
ok(r.snareB > 0.02, 'scene B: the soloed Snare plays (' + r.snareB.toFixed(3) + ')');
ok(r.bassB < 1e-4, 'scene B: the Bass is soloed out (' + r.bassB.toExponential(1) + ')');
ok(r.old.v === 5 && r.old.A.x1 && r.old.B.x1 && !r.old.trackFlag, 'an old v3 song: its muted track is muted in every scene: ' + JSON.stringify(r.old));
// UI: M in scene A, then look at B
const sc = k => p.evaluate(k => [...document.querySelectorAll('.scenewrap .scn')].find(x => x.textContent.trim() === k).click(), k);
await sc('A'); await new Promise(r => setTimeout(r, 150));
await p.evaluate(() => document.querySelectorAll('.track .mute:not(.solo)')[0].click()); await new Promise(r => setTimeout(r, 150));
const ui = await p.evaluate(() => { const s = window.spores.store.get(), id = s.tracks[0].id; return {A: !!(s.scenes.A.mute || {})[id], B: !!((s.scenes.B || {}).mute || {})[id], lit: document.querySelectorAll('.track .mute:not(.solo)')[0].classList.contains('on')}; });
await sc('B'); await new Promise(r => setTimeout(r, 150));
const litB = await p.evaluate(() => document.querySelectorAll('.track .mute:not(.solo)')[0].classList.contains('on'));
ok(ui.A && !ui.B && ui.lit && !litB, 'M in scene A mutes the Kick in A only (lit in A, not in B): ' + JSON.stringify(ui) + ' litB ' + litB);
await p.evaluate(() => window.spores.store.undo()); ok(!(await p.evaluate(() => { const s = window.spores.store.get(); return !!(s.scenes.A.mute || {})[s.tracks[0].id]; })), 'Undo unmutes it');
ok(!errs.length, 'no page errors ' + errs.join(' '));
console.log(bad ? bad + ' FAILED' : 'all ok'); await b.close();
