/* tests/fx-check.mjs (dev only): the track effects (js/engine/fx.js, fxhost.js) in headless Chrome.
 *   python3 -m http.server 8765 (in the repo), then: CHROME=… node tests/fx-check.mjs   (puppeteer-core on your path; PORT=… for another port)
 * 1. every effect renders a snare through the worklet (offline): signal out, no NaN / Inf
 * 2. on / off, add and remove mid-note (a held audio take, a sine) make no click: the largest sample-to-sample jump stays
 *    within what the effect on or off makes by itself
 * 3. 16 tracks × 4 effects: the kick's steps land exactly as without (170 BPM), and what one 128-frame block costs
 * 4. a reverb's tail rings after the hit; after Stop it rings on, and an endless echo is faded and cleared 3 s after the
 *    sound stops going in
 * 5. an effect on an audio take changes it
 * 6. on the page: Add / setting / Undo / Redo through fxedit.js, the worklet makes the effect; an old v2 song opens */
import puppeteer from 'puppeteer-core';
const PORT = process.env.PORT || 8765;
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
const errs = [];
async function page(){
  const p = await b.newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/MIDI/.test(m.text()) && errs.push(m.text()));
  await p.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('init')){ sessionStorage.setItem('init', '1'); localStorage.clear(); } });
  await p.goto(`http://localhost:${PORT}/`, {waitUntil: 'networkidle0'}); await sleep(400);
  return p;
}
// each section in a fresh page: every offline render keeps its own two wasm instances until the page goes
const R = {};
for (const sec of (process.env.ONLY || 'each,clicks,timing,tails').split(',')){ const p = await page(); Object.assign(R, await p.evaluate(offline, sec), {made: (R.made || '') + ' ' + sec + ':' + (await p.evaluate(() => window.__made.join(',')))}); await p.close(); }
async function offline(sec){
  window.__made = [];
  const {compile} = await import('/js/engine/engine.js'), {newTrack, newClip} = await import('/js/store.js');
  const {FX_TYPES, fxDefaults} = await import('/js/engine/fx.js');
  const tfx = await WebAssembly.compile(await (await fetch('/js/engine/tfx.wasm')).arrayBuffer());
  const sr = 48000, res = {};
  const fx = (type, p = {}, on = true, id) => ({id: id || type, type, on, p: Object.assign(fxDefaults(type), p)});
  // render; events: [{at (s), msg}] posted while the render is suspended there
  async function render(s, secs, {clips = [], events = [], play = {mode: 'scene', scene: 'A'}} = {}){
    const ctx = new OfflineAudioContext(2, Math.round(sr * secs), sr);
    await ctx.audioWorklet.addModule('/js/engine/worklet.js');
    const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: compile(s), play, clips, tfx}});
    n.connect(ctx.destination);
    for (const e of events) ctx.suspend(Math.round(e.at * sr / 128) * 128 / sr).then(async () => {
      n.port.postMessage(typeof e.msg === 'function' ? e.msg() : e.msg); await new Promise(r => setTimeout(r, 30)); ctx.resume(); });
    const t0 = performance.now(), buf = await ctx.startRendering(), ms = performance.now() - t0;
    const pk = await new Promise(r => { n.port.onmessage = e => e.data.t === 'peek' && r(e.data); n.port.postMessage({t: 'peek'}); });
    window.__made.push(pk.fx);
    return {L: buf.getChannelData(0), Rr: buf.getChannelData(1), ms};
  }
  const base = () => { const s = structuredClone(window.spores.store.get()); s.mode = 'simple'; s.bpm = 120; s.tracks.forEach(t => { t.mute = true; t.fx = []; }); return s; };
  const bad = a => { for (const x of a) if (!Number.isFinite(x)) return true; return false; };
  const rms = (a, t0, t1) => { let q = 0; const i0 = Math.round(t0 * sr), i1 = Math.round(t1 * sr); for (let i = i0; i < i1; i++) q += a[i] * a[i]; return Math.sqrt(q / (i1 - i0)); };
  const jump = (a, t0 = 0, t1 = a.length / sr) => { let m = 0; for (let i = Math.max(1, Math.round(t0 * sr)); i < Math.round(t1 * sr); i++){ const d = Math.abs(a[i] - a[i - 1]); if (d > m) m = d; } return m; };

  if (sec === 'each'){
  /* 1. every effect: a snare on every beat */
  const snare = () => { const s = base(), t = s.tracks[1]; t.mute = false; t.vol = 0.8; s.scenes.A.steps[t.id] = [0, 4, 8, 12].reduce((a, i) => (a[i] = {on: true, deg: 0, vel: 100, chance: 100}, a), []); return {s, t}; };
  { const {s} = snare(); const d = await render(s, 1); res.dry = +rms(d.L, 0, 1).toFixed(4); }
  res.each = {};
  for (const type of FX_TYPES){
    const {s, t} = snare(); t.fx = [fx(type)];
    const o = await render(s, 1.5);
    res.each[type] = {rms: +rms(o.L, 0.1, 1.5).toFixed(4), bad: bad(o.L) || bad(o.Rr)};
  }

  }
  /* 2. clicks: a held sine take (1 bar at 120, loops seamlessly: 2 Hz × whole cycles), effect toggled / added / removed */
  const hz = 220, len = 2 * sr, sine = new Float32Array(len); for (let i = 0; i < len; i++) sine[i] = 0.4 * Math.sin(2 * Math.PI * hz * i / sr);
  const take = () => { const s = base(), t = newTrack('audio'); t.vol = 1; t.fx = []; s.tracks.push(t); s.scenes = {A: {name: 'A', bars: 1, steps: {}, clips: {[t.id]: newClip({id: 'sine', bars: 1, bpm: 120, sr}, {fadeIn: 0, fadeOut: 0})}}}; s.song = [{scene: 'A', repeat: 1}]; return {s, t}; };
  const clips = () => [{id: 'sine', data: sine.slice()}];
  if (sec === 'clicks'){
  res.clicks = {};
  for (const type of ['eq', 'density', 'reverb', 'space', 'delay', 'chorus', 'ladder', 'pshift', 'comp', 'tube', 'odrive', 'crush']){
    const strong = {eq: {bass: 255, treble: 255}, density: {drive: 255}, ladder: {cut: 60, res: 200}, pshift: {semis: 12}, odrive: {drive: 230}, reverb: {mix: 200}, space: {mix: 200}, delay: {mix: 180}}[type] || {};
    const one = take(), mk = on => { const s = structuredClone(one.s); s.tracks.at(-1).fx = [fx(type, strong, on)]; return s; };
    const A = await render(mk(true), 2.6, {clips: clips()}), B = await render(mk(false), 2.6, {clips: clips()});
    const songWith = on => compile(mk(on));
    const C = await render(mk(true), 2.6, {clips: clips(), events: [{at: 1.0, msg: {t: 'song', song: songWith(false)}}, {at: 1.6, msg: {t: 'song', song: songWith(true)}}]});
    const ref = Math.max(jump(A.L, 0.3), jump(B.L, 0.3)), got = jump(C.L, 0.3);
    let at = 0; for (let i = sr * 0.3; i < C.L.length; i++) if (Math.abs(C.L[i] - C.L[i - 1]) === got){ at = i; break; }
    res.clicks[type] = {at: +(at / sr).toFixed(4), ref: +ref.toFixed(4), toggled: +got.toFixed(4), ok: got <= ref * 1.25 + 0.004 && !bad(C.L)};
  }
  { // add the first effect, then remove it (the track goes back to playing straight)
    const {s, t} = take(); const s2 = structuredClone(s); s2.tracks.at(-1).fx = [fx('eq', {bass: 255, treble: 255})];
    const A = await render(s2, 2.6, {clips: clips()}), B = await render(s, 2.6, {clips: clips()});
    const C = await render(s, 2.6, {clips: clips(), events: [{at: 1.0, msg: {t: 'song', song: compile(s2)}}, {at: 1.6, msg: {t: 'song', song: compile(s)}}]});
    const ref = Math.max(jump(A.L, 0.3), jump(B.L, 0.3)), got = jump(C.L, 0.3);
    res.clicks.addRemove = {ref: +ref.toFixed(4), toggled: +got.toFixed(4), ok: got <= ref * 1.25 + 0.004};
  }
  { // reorder (eq boost ↔ ladder): a dip, not a click
    const {s, t} = take(); t.fx = [fx('eq', {bass: 255, treble: 255}, true, 'a'), fx('ladder', {cut: 90}, true, 'b')];
    const s2 = structuredClone(s); s2.tracks.at(-1).fx.reverse();
    const A = await render(s, 2.6, {clips: clips()}), B = await render(s2, 2.6, {clips: clips()});
    const C = await render(s, 2.6, {clips: clips(), events: [{at: 1.0, msg: {t: 'song', song: compile(s2)}}]});
    const ref = Math.max(jump(A.L, 0.3), jump(B.L, 0.3)), got = jump(C.L, 0.3);
    res.clicks.reorder = {ref: +ref.toFixed(4), toggled: +got.toFixed(4), ok: got <= ref * 1.25 + 0.004};
  }

  }
  /* 3. timing and cost with 16 tracks × 4 effects */
  const KIT = ['Kick', 'Snare', 'Clap', 'Closed hat', 'Open hat', 'Tom', 'Rim', 'Click'];
  const sixteen = (withFx, mix, per = 4) => {
    const s = base(); s.bpm = 170;
    s.tracks = Array.from({length: 16}, (_, i) => { const t = newTrack('drum', KIT[i % 8]); t.vol = 0.5; t.fx = []; return t; });
    s.scenes = {A: {name: 'A', bars: 1, steps: {}, clips: {}}}; s.song = [{scene: 'A', repeat: 1}];
    s.tracks.forEach((t, i) => { s.scenes.A.steps[t.id] = Array.from({length: 16}, (_, k) => k % 4 === (i === 0 ? 0 : i % 4) ? {on: true, deg: 0, vel: 100, chance: 100} : null);
      if (withFx) t.fx = Array.from({length: per}, (_, j) => fx(mix[(i * per + j) % mix.length], {}, true, 'f' + j)); });
    return s;
  };
  const NOLAT = ['eq', 'comp', 'drive', 'tube'];   // effects that don't move or smear a kick's start
  const onsets = (L, thr = 0.01) => { const ons = []; let last = -1e9; for (let i = 0; i < L.length; i++){ const a = Math.abs(L[i]) > thr; if (a && i - last > sr * 0.15) ons.push(i); if (a) last = i; } return ons; };
  if (sec === 'timing'){
  { const kickOnly = withFx => { const s = sixteen(withFx, NOLAT); s.tracks.forEach((t, i) => { if (i) t.mute = true; }); return s; };   // the others' effects still run (muted = after them)
    const A = onsets((await render(kickOnly(false), 2.5)).L), B = onsets((await render(kickOnly(true), 2.5)).L);
    const gaps = B.slice(1).map((x, i) => x - B[i]);
    res.timing = {without: A.slice(0, 6), with: B.slice(0, 6), same: A.length === B.length && A.every((x, i) => x === B[i]), gapMin: Math.min(...gaps), gapMax: Math.max(...gaps), want: 60 / 170 * sr}; }
  const SECS = 6, blocks = SECS * sr / 128;
  res.cost = {};
  for (const [name, s] of [['no effects', sixteen(false)], ['64 effects (all 34 kinds in turn)', sixteen(true, FX_TYPES)], ['64 heavy (Space, Speaker cab, Tape, Galaxy)', sixteen(true, ['space', 'cab', 'tape', 'reverb'])], ['32 heavy (2 a track)', sixteen(true, ['space', 'cab', 'tape', 'reverb'], 2)], ['32 (all kinds, 2 a track)', sixteen(true, FX_TYPES, 2)]]){
    s.tracks.forEach(t => t.mute = false);
    let best = 1e9; for (let k = 0; k < 2; k++){ const o = await render(s, SECS); best = Math.min(best, o.ms); if (bad(o.L)) res.cost.bad = name; }
    res.cost[name] = +(best * 1000 / blocks).toFixed(1);   // µs per 128-frame block
  }

  }
  if (sec === 'tails'){
  /* 4. tails */
  { const one = () => { const s = base(), t = s.tracks[1]; t.mute = false; s.scenes.A.bars = 4; s.scenes.A.steps[t.id] = [{on: true, deg: 0, vel: 100, chance: 100}]; return {s, t}; };
    const dry = await render(one().s, 2), {s, t} = one(); t.fx = [fx('space', {mix: 160, decay: 200})];
    const wet = await render(s, 2);
    res.tail = {dry: +rms(dry.L, 1.0, 1.5).toFixed(5), wet: +rms(wet.L, 1.0, 1.5).toFixed(5)};
    // after Stop (0.3 s): the reverb rings on; an echo fed back forever is faded and cleared 3 s after the input goes quiet
    const st = await render(s, 2, {events: [{at: 0.3, msg: {t: 'stop'}}]});
    res.tail.afterStop = +rms(st.L, 1.0, 1.5).toFixed(5);
    const e = one(); e.t.fx = [fx('delay', {regen: 255, mix: 160, steps: 4})];
    const ec = await render(e.s, 7, {events: [{at: 0.3, msg: {t: 'stop'}}]});
    res.tail.echo = {ringing: +rms(ec.L, 1.5, 2.5).toFixed(5), later: +rms(ec.L, 5.5, 7).toFixed(6), bad: bad(ec.L)};
    // Play again: nothing old comes back
    const again = await render(e.s, 9, {events: [{at: 0.3, msg: {t: 'stop'}}, {at: 6.0, msg: {t: 'play', mode: 'scene', scene: 'A'}}]});
    res.tail.replayHead = +rms(again.L, 5.9, 6.05).toFixed(6);
  }

  /* 5. an effect on an audio take */
  { const {s, t} = take(); const dry = await render(s, 1.5, {clips: clips()});
    t.fx = [fx('pshift', {semis: 12})]; const w = await render(s, 1.5, {clips: clips()});
    let zc = 0; for (let i = sr * 0.5 + 1; i < sr * 1.0; i++) if (w.L[i - 1] < 0 && w.L[i] >= 0) zc++;
    let diff = 0; for (let i = sr * 0.5; i < sr; i++) diff += Math.abs(w.L[i] - dry.L[i]);
    res.take = {dry: +rms(dry.L, 0.5, 1).toFixed(4), wet: +rms(w.L, 0.5, 1).toFixed(4), hzOut: zc * 2, diff: +(diff / (sr / 2)).toFixed(4)};
  }
  }
  return res;
}

console.log('dry snare rms', R.dry, '· effects made per render', R.made);
if (R.each){ const each = Object.entries(R.each);
ok(each.every(([, v]) => !v.bad), 'no effect gives NaN / Inf');
ok(each.every(([, v]) => v.rms > 0.005), 'every effect gives signal out: ' + each.map(([k, v]) => k + ' ' + v.rms).join(', '));
}
if (R.clicks) for (const [k, v] of Object.entries(R.clicks)) ok(v.ok, `no click: ${k} (largest jump ${v.toggled} at ${v.at} s, on/off alone ${v.ref})`);
if (R.timing){
ok(R.timing.same && R.timing.gapMax - R.timing.gapMin <= 1 && Math.abs(R.timing.gapMin - R.timing.want) < 1, `kick timing with 64 effects unchanged (${JSON.stringify(R.timing)})`);
console.log('cost µs per 128-frame block (budget 2667 at 48 kHz; offline render, best of 2):', JSON.stringify(R.cost));
ok(!R.cost.bad, 'no NaN with 64 effects');
}
if (R.tail){
ok(R.tail.wet > 20 * Math.max(R.tail.dry, 1e-5), `reverb tail after the hit (${R.tail.wet} vs dry ${R.tail.dry})`);
ok(R.tail.afterStop > 0.5 * R.tail.wet, `the tail rings on after Stop (${R.tail.afterStop})`);
ok(R.tail.echo.ringing > 0.005 && R.tail.echo.later < 1e-5 && !R.tail.echo.bad, `an endless echo is faded out after Stop (${JSON.stringify(R.tail.echo)})`);
ok(R.tail.replayHead < 1e-4, `Play again: no old echo (${R.tail.replayHead})`);
ok(R.take.wet > 0.05 && R.take.diff > 0.05 && Math.abs(R.take.hzOut - 440) < 20, `pitch shifter on an audio take (${JSON.stringify(R.take)})`);
}

/* ---- 6. on the page ---- */
if (!process.env.ONLY){
const p = await page();
const P = await p.evaluate(async () => {
  const {addFx, setFxParam, setFxOn, moveFx, removeFx, canAddFx} = await import('/js/fxedit.js');
  const {migrate, isSong, VERSION} = await import('/js/store.js');
  const {store, engine} = window.spores, res = {};
  res.ready = [await engine.fxReady, await engine.wasmReady];
  const tid = store.get().tracks[0].id, t = () => store.get().tracks.find(x => x.id === tid);
  const peek = () => new Promise(r => { const f = e => { if (e.data.t === 'peek'){ engine.node.port.removeEventListener('message', f); r(e.data); } }; engine.node.port.addEventListener('message', f); engine.node.port.postMessage({t: 'peek'}); });
  res.fx0 = (await peek()).fx;
  const a = addFx(store, tid, 'reverb'), b2 = addFx(store, tid, 'delay');
  await new Promise(r => setTimeout(r, 100));
  res.fx2 = (await peek()).fx;
  res.types = t().fx.map(f => f.type);
  setFxParam(store, tid, a, 'mix', 100); setFxParam(store, tid, a, 'mix', 150); setFxParam(store, tid, a, 'mix', 9999);
  res.mix = t().fx[0].p.mix;
  store.undo(); res.mixUndo = t().fx[0].p.mix;   // one drag = one Undo
  moveFx(store, tid, b2, -1); res.moved = t().fx.map(f => f.type);
  setFxOn(store, tid, a, false); res.off = t().fx.find(f => f.id === a).on;
  store.undo(); store.undo(); res.back = t().fx.map(f => f.type);
  store.undo(); store.undo(); res.none = t().fx.length;
  store.redo(); res.redo = t().fx.map(f => f.type);
  addFx(store, tid, 'eq'); addFx(store, tid, 'eq'); addFx(store, tid, 'eq'); res.full = !canAddFx(t()) && addFx(store, tid, 'eq') === null && t().fx.length === 4;
  removeFx(store, tid, a); res.removed = t().fx.length;
  { const {fxCount} = await import('/js/fxedit.js'), {newTrack} = await import('/js/store.js'); let n = 0;   // the song's limit (32): 10 tracks, fill them
    store.edit('Add track', s => { s.tracks.push(newTrack('drum'), newTrack('synth')); }); n++;
    for (const x of store.get().tracks) for (let k = 0; k < 4; k++) if (addFx(store, x.id, 'drive')) n++;
    res.songCap = {count: fxCount(store.get()), refused: addFx(store, store.get().tracks.at(-1).id, 'drive') === null};
    for (let k = 0; k < n; k++) store.undo(); res.afterUndo = fxCount(store.get()); }
  // an old v2 file, and odd effect lists
  const old = structuredClone(store.get()); old.v = 2; old.tracks.forEach(x => delete x.fx);
  const m = migrate(old); res.v2 = {v: m.v, fx: m.tracks.every(x => Array.isArray(x.fx) && !x.fx.length), isSong: isSong(old), VERSION};
  const odd = structuredClone(store.get());
  odd.tracks[0].fx = [{type: 'nope'}, {type: 'eq', p: {bass: 999, x: 3}}, {type: 'eq', id: 'same'}, {type: 'eq', id: 'same'}, {type: 'tube'}, {type: 'tube'}];
  odd.tracks[1].type = 'midi'; odd.tracks[1].fx = [{type: 'eq'}];
  const o = migrate(odd);
  res.odd = {n: o.tracks[0].fx.length, bass: o.tracks[0].fx[0].p.bass, extra: 'x' in o.tracks[0].fx[0].p, ids: new Set(o.tracks[0].fx.map(f => f.id)).size, midi: o.tracks[1].fx.length};
  await new Promise(r => setTimeout(r, 100)); res.fxNow = (await peek()).fx;
  return res;
});
ok(P.ready.join() === 'true,true', 'tfx.wasm and pump-synth.wasm reach the realtime worklet (sent as bytes)');
ok(P.fx0 === 0 && P.fx2 === 2, `the worklet makes the effects (${P.fx0} → ${P.fx2})`);
ok(P.types.join() === 'reverb,delay', 'Add effect ×2');
ok(P.mix === 255 && P.mixUndo === 48, `setting clamped (${P.mix}); a drag is one Undo (back to ${P.mixUndo})`);
ok(P.moved.join() === 'delay,reverb' && P.off === false, 'move and off');
ok(P.back.join() === 'reverb,delay' && P.none === 0 && P.redo.join() === 'reverb', `Undo / Redo (${P.back} · ${P.none} · ${P.redo})`);
ok(P.full && P.removed === 3, 'four at most; remove');
ok(P.songCap.count === 32 && P.songCap.refused && P.afterUndo === 3, `song limit (${JSON.stringify(P.songCap)}, back to ${P.afterUndo})`);
ok(P.v2.v === P.v2.VERSION && P.v2.VERSION === 3 && P.v2.fx && P.v2.isSong, `old v2 song opens (${JSON.stringify(P.v2)})`);
ok(P.odd.n === 4 && P.odd.bass === 255 && !P.odd.extra && P.odd.ids === 4 && P.odd.midi === 0, `odd effect lists cleaned (${JSON.stringify(P.odd)})`);
ok(P.fxNow === 3, `worklet follows (${P.fxNow})`);
}
ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
await b.close();
console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
