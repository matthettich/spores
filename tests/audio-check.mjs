/* tests/audio-check.mjs (dev only): audio tracks (loop takes) in headless Chrome.
 *   python3 -m http.server 8765 (in the repo), then: CHROME=… node tests/audio-check.mjs   (puppeteer-core on your path)
 * 1. offline renders through the worklet: a take's first sample lands on the scene's first sample and it loops on bar
 *    lines (120 and 170 BPM), varispeed (a 120 BPM take in a 170 BPM song), 2-bar takes, song blocks, mute, fades, reverse
 * 2. recording in real time against a loop-back (the engine's own output → a 25 ms DelayNode → its input): the latency
 *    test measures 25 ms, and recorded kicks land on their steps within 1 ms, from Stop (count-in) and while playing
 *    (the take turned round to the loop's start), and with keep going (two takes)
 * 3. Undo / Redo after a take swap the clip in the song and in the worklet
 * 4. Save → Open (fresh browser profile) brings the WAV bytes and the samples back; an old v1 song file opens
 * 5. a fake input device opens and gives level meter values */
import puppeteer from 'puppeteer-core';
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']});
async function page(ctx = b){
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => m.type() === 'error' && p.errs.push(m.text()));
  await p.evaluateOnNewDocument(() => {
    if (!sessionStorage.getItem('init')){ sessionStorage.setItem('init', '1'); localStorage.clear(); }
    window.__writes = [];
    window.showSaveFilePicker = async o => ({name: o.suggestedName, kind: 'file', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      createWritable: async () => ({write: async d => { window.__writes.push(new Uint8Array(d)); }, close: async () => {}, abort: async () => {}})});
    window.showOpenFilePicker = async () => [{name: window.__openName, kind: 'file', getFile: async () => new File([window.__openBytes], window.__openName)}];
  });
  await p.goto('http://localhost:8765/', {waitUntil: 'networkidle0'}); await sleep(500);
  return p;
}
let p = await page();

/* ---- 1. offline ---- */
const off = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js'), {newTrack, newClip} = await import('/js/store.js');
  const sr = 48000, START = 0.06 * sr;
  // a song with one audio track and nothing else sounding
  function song(bpm, clipsA, clipsB){
    const s = structuredClone(window.spores.store.get()); s.bpm = bpm; s.mode = 'simple';
    s.tracks.forEach(t => t.mute = true);
    const t = newTrack('audio'); t.vol = 1; s.tracks.push(t);
    s.scenes = {A: {name: 'A', bars: 1, steps: {}, clips: {}}, B: {name: 'B', bars: 1, steps: {}, clips: {}}};
    if (clipsA) s.scenes.A.clips[t.id] = clipsA; if (clipsB) s.scenes.B.clips[t.id] = clipsB;
    s.song = [{scene: 'A', repeat: 1}, {scene: 'B', repeat: 1}];
    return {s, t};
  }
  async function render(s, data, secs, play = {mode: 'scene', scene: 'A'}){
    const ctx = new OfflineAudioContext(2, Math.round(sr * secs), sr);
    await ctx.audioWorklet.addModule('/js/engine/worklet.js');
    const clips = Object.entries(data).map(([id, d]) => ({id, data: d}));
    const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: compile(s), play, clips}});
    n.connect(ctx.destination);
    const buf = await ctx.startRendering();
    return Array.from(buf.getChannelData(0), x => Math.atanh(Math.max(-0.999999, Math.min(0.999999, x))));   // undo the master clip
  }
  const imp = (len, at, amp = 0.5) => { const d = new Float32Array(len); for (const i of at) d[i] = amp; return d; };
  // centre (signed centroid) of what's around frame f: Catmull-Rom keeps it exactly on the impulse's time
  const centre = (y, f) => { let a = 0, w = 0; for (let i = Math.floor(f) - 3; i <= Math.floor(f) + 4; i++){ a += i * y[i]; w += y[i]; } return w ? a / w : NaN; };
  const firstNZ = y => y.findIndex(x => Math.abs(x) > 1e-6);
  const res = {};
  const bar = bpm => 4 * 60 / bpm * sr;
  const clip = (id, bars, bpm, extra = {}) => newClip({id, bars, bpm, sr}, Object.assign({fadeIn: 0, fadeOut: 0}, extra));
  // 120 BPM, 1-bar take recorded at 120: exact samples
  {
    const L = Math.round(bar(120)), {s} = song(120, clip('k1', 1, 120));
    const y = await render(s, {k1: imp(L, [0, 1000])}, 8.2);
    const hits = []; y.forEach((x, i) => { if (Math.abs(x) > 1e-4) hits.push(i); });
    res.r120 = {first: firstNZ(y), want: START, value: +y[START].toFixed(6), wantValue: 0.5 * 0.9,
      hits, wantHits: [0, 1, 2, 3, 4].flatMap(k => [START + k * L, START + k * L + 1000])};
  }
  // 170 BPM, 1-bar take recorded at 170 (67765 samples; the bar is 67764.7 frames): centres on the bar lines
  {
    const L = Math.round(bar(170)), {s} = song(170, clip('k2', 1, 170));
    const y = await render(s, {k2: imp(L, [0])}, 6);
    res.r170 = {first: firstNZ(y), cs: [0, 1, 2, 3, 4, 5].map(k => +(centre(y, START + k * bar(170)) - (START + k * bar(170))).toFixed(4))};
  }
  // varispeed: a 120 BPM take (96000 samples, impulses at 0 and half way) in a 170 BPM song
  {
    const L = Math.round(bar(120)), {s} = song(170, clip('k3', 1, 120));
    // smooth bumps (a resampled lone impulse aliases; a bump 2 ms wide doesn't): centred at 2000 and half way + 2000
    const d = new Float32Array(L); for (let i = 0; i < L; i++) d[i] = 0.3 * (Math.exp(-(((i - 2000) / 30) ** 2)) + Math.exp(-(((i - L / 2 - 2000) / 30) ** 2)));
    const y = await render(s, {k3: d}, 6);
    const B = bar(170), k2 = 2000 * B / L;   // where the bump's centre should land in the output
    const cen = f => { let a = 0, w = 0; for (let i = Math.floor(f) - 150; i <= Math.floor(f) + 150; i++){ a += i * y[i]; w += y[i]; } return a / w; };
    res.vari = {cs: [0, 0.5, 1, 1.5, 2, 2.5, 3].map(k => +(cen(START + k * B + k2) - (START + k * B + k2)).toFixed(4))};
  }
  // a 2-bar take in a 1-bar scene: runs on through the scene's repeats (bar 2 of the take plays in the scene's 2nd bar)
  {
    const L = Math.round(bar(120)) * 2, {s} = song(120, clip('k4', 2, 120));
    const y = await render(s, {k4: imp(L, [0, L / 2 + 10])}, 8.2);
    const hits = []; y.forEach((x, i) => { if (Math.abs(x) > 1e-4) hits.push(i); });
    res.two = {hits, want: [START, START + 96000 + 10, START + 192000, START + 288000 + 10, START + 384000]};
  }
  // song mode: A (1 block, 2-bar take, impulse at 0 and at 1.5 bars) then B (its own take): B's starts on B's first sample
  {
    const {s} = song(120, clip('a', 2, 120), clip('b', 1, 120));
    const y = await render(s, {a: imp(192000, [0, 144000]), b: imp(96000, [0, 500], 0.25)}, 8.3, {mode: 'song', block: 0});
    const hits = []; y.forEach((x, i) => { if (Math.abs(x) > 1e-4) hits.push([i, +x.toFixed(3)]); });
    res.songMode = {hits: hits.map(h => h[0]), want: [START, START + 96000, START + 96500, START + 192000, START + 288000, START + 288500, START + 384000]};
  }
  // mute → silence; reverse; default fades (4 ms: first sample 0, full level 4 ms later)
  {
    const L = 96000, d = new Float32Array(L).fill(0.1);
    let {s, t} = song(120, clip('m', 1, 120)); t = s.tracks[s.tracks.length - 1]; t.mute = true;
    let y = await render(s, {m: d}, 1); res.mutePeak = Math.max(...y.map(Math.abs));
    ({s} = song(120, clip('r', 1, 120, {reverse: true})));
    y = await render(s, {r: imp(L, [L - 1, L - 101])}, 1); res.rev = [firstNZ(y) - START, y.findIndex((x, i) => i > START && Math.abs(x) > 1e-6 && i !== START) - START];
    ({s} = song(120, newClip({id: 'f', bars: 1, bpm: 120, sr})));
    y = await render(s, {f: d}, 1); res.fade = {at0: +y[START].toFixed(5), at4ms: +y[START + 192].toFixed(5), full: 0.09};
  }
  return res;
});
ok(off.r120.first === off.r120.want && Math.abs(off.r120.value - off.r120.wantValue) < 1e-6, `120 BPM: first sample on the scene start (${off.r120.first} = ${off.r120.want}), value ${off.r120.value}`);
ok(JSON.stringify(off.r120.hits) === JSON.stringify(off.r120.wantHits), '120 BPM: loops exactly on bar lines (' + off.r120.hits.join(',') + ')');
ok(off.r170.first === 2880 && off.r170.cs.every(c => Math.abs(c) < 0.01), `170 BPM: starts at 2880 (${off.r170.first}), loop starts within 0.01 sample of each bar line: ${off.r170.cs}`);
ok(off.vari.cs.every(c => Math.abs(c) < 0.02), `varispeed 120→170: the take spans exactly one 170 BPM bar (half way and bar lines off by ${off.vari.cs} samples)`);
ok(JSON.stringify(off.two.hits) === JSON.stringify(off.two.want), '2-bar take in a 1-bar scene runs on across repeats: ' + off.two.hits);
ok(JSON.stringify(off.songMode.hits) === JSON.stringify(off.songMode.want), 'song mode: block A plays its take from its start, B its own from B\'s first sample: ' + off.songMode.hits);
ok(off.mutePeak === 0, 'muted audio track is silent');
ok(off.rev[0] === 0 && off.rev[1] === 100, 'reverse: the last sample plays first (' + off.rev + ')');
ok(off.fade.at0 === 0 && Math.abs(off.fade.at4ms - off.fade.full) < 1e-4, 'default 4 ms fade-in: ' + JSON.stringify(off.fade));

/* ---- 2. recording against a loop-back ---- */
await p.evaluate(async () => {
  const {newTrack} = await import('/js/store.js');
  const st = window.spores.store, t = newTrack('audio');
  st.edit('test', s => {
    s.bpm = 120; s.mode = 'simple';
    s.tracks.forEach(x => { x.mute = x.sound !== 'Kick'; });
    s.tracks.push(t);
    const kick = s.tracks.find(x => x.sound === 'Kick').id;
    // 2 bars: kicks on every beat of bar 1, one kick at the start of bar 2 (so a take turned round wrongly shows)
    s.scenes = {A: {name: 'A', bars: 2, steps: {[kick]: [0, 4, 8, 12, 16].reduce((a, i) => (a[i] = {on: true, deg: 0, vel: 100, chance: 100}, a), [])}, clips: {}}};
    s.song = [{scene: 'A', repeat: 1}];
  });
  window.__tid = t.id;
});
const lat = await p.evaluate(async () => {
  const e = window.spores.engine, ctx = e.ctx;
  await ctx.resume();
  const d = ctx.createDelay(1); d.delayTime.value = 0.025;
  e.node.connect(d, 0);
  const r = await e.openInput({testNode: d});
  const m = await e.measureLatency();
  return {open: r.ok, m, lat: e.latency, want: (0.025 * ctx.sampleRate + 128) / ctx.sampleRate * 1000};
});
// (a loop in the audio graph is one 128-frame block longer than its DelayNode: Web Audio's rule for cycles)
ok(lat.open && lat.m.ok && Math.abs(lat.m.totalMs - lat.want) < 0.05, `latency test over a 25 ms (+128 frames) loop-back: want ${lat.want.toFixed(2)}, ` + JSON.stringify(lat.m));
ok(Math.abs(lat.lat.totalMs - lat.want) < 0.05, 'and the correction now totals that: ' + JSON.stringify(lat.lat));
const recs = await p.evaluate(async () => {
  const e = window.spores.engine, sr = e.ctx.sampleRate, step = sr * 15 / 120;
  const onsets = d => { const o = []; let last = -1e9; for (let i = 0; i < d.length; i++){ if (Math.abs(d[i]) > 0.005){ if (i - last > sr * 0.1) o.push(i); last = i; } } return o; };
  const want = [0, 4, 8, 12, 16].map(k => k * step);
  const err = d => { const o = onsets(d); return {n: o.length, ms: o.map((x, i) => +((x - want[i]) / sr * 1000).toFixed(3))}; };
  const states = []; e.on('rec', m => states.push(m.state));
  // a: from Stop: one bar of count-in, then the 2-bar take from the scene's start
  const t0 = e.ctx.currentTime;
  const a = await e.record({scene: 'A', track: window.__tid, bars: 2});
  const tookA = e.ctx.currentTime - t0;
  const peekRec = await e.peekWorklet();
  // b: while playing, from part-way through the scene: starts on a later bar line and is turned round
  await new Promise(res => { const off = e.on('sched', m => { if (m.counter >= 18 && m.counter <= 24){ off(); res(); } }); });
  const b = await e.record({scene: 'A', track: window.__tid, bars: 2});
  // c: keep going: two takes in a row, then stop
  const takes = [];
  const c = await e.record({scene: 'A', track: window.__tid, bars: 2, keepGoing: true, onTake: tk => { takes.push(tk); if (takes.length === 2) e.stopRecording(); }});
  e.stop();
  return {sr, a: err(a.data), aLen: a.data.length, aMeta: {bars: a.bars, bpm: a.bpm, sr: a.sr}, tookA: +tookA.toFixed(2), b: err(b.data),
    c: takes.map(t => err(t.data)), cLast: c && c.id === takes[1].id, states: [...new Set(states)], silentWhileRec: peekRec};
});
ok(recs.aLen === Math.round(4 * recs.sr) && recs.aMeta.sr === recs.sr && recs.aMeta.bars === 2 && recs.aMeta.bpm === 120, 'take a: exactly 2 bars long (' + recs.aLen + ' samples), ' + JSON.stringify(recs.aMeta));
ok(recs.tookA > 5.9 && recs.tookA < 6.6, 'take a: one bar of count-in, then 2 bars (' + recs.tookA + ' s)');
ok(recs.a.n === 5 && recs.a.ms.every(x => Math.abs(x) <= 1), 'take a (from Stop): kicks land within 1 ms: ' + recs.a.ms);
ok(recs.b.n === 5 && recs.b.ms.every(x => Math.abs(x) <= 1), 'take b (started mid-scene, turned round): kicks within 1 ms: ' + recs.b.ms);
ok(recs.c.length === 2 && recs.c.every(t => t.n === 5 && t.ms.every(x => Math.abs(x) <= 1)) && recs.cLast, 'keep going: two takes in a row, both within 1 ms: ' + JSON.stringify(recs.c));
ok(['count-in', 'recording', 'done', 'cancelled'].every(s => recs.states.includes(s)), 'rec states: ' + recs.states);

/* ---- 3. Undo / Redo after a take ---- */
const und = await p.evaluate(async () => {
  const {store, engine: e, keepTake} = window.spores, sr = 48000;
  const mk = at => { const d = new Float32Array(96000); d[at] = 0.5; return {id: 'u' + at + Math.random().toString(36).slice(2, 6), trackId: window.__tid, scene: 'A', data: d, sr, bars: 1, bpm: 120}; };
  const t1 = mk(0), t2 = mk(12000);
  keepTake(store, t1); keepTake(store, t2);
  const cur = () => store.get().scenes.A.clips[window.__tid].id;
  await new Promise(r => setTimeout(r, 300));
  const after2 = {song: cur(), w: (await e.peekWorklet()).clips};
  store.undo(); await new Promise(r => setTimeout(r, 300));
  const afterUndo = {song: cur(), w: (await e.peekWorklet()).clips};
  store.redo(); await new Promise(r => setTimeout(r, 300));
  const afterRedo = {song: cur(), w: (await e.peekWorklet()).clips};
  store.undo(); await new Promise(r => setTimeout(r, 300));
  // and it plays: Play, then the worklet's tape for the track holds take 1
  await e.play('scene', 'A'); await new Promise(r => setTimeout(r, 400));
  const playing = (await e.peekWorklet()).tapes[window.__tid]; e.stop();
  return {t1: t1.id, t2: t2.id, after2, afterUndo, afterRedo, playing};
});
ok(und.after2.song === und.t2 && und.after2.w.includes(und.t2) && !und.after2.w.includes(und.t1), 'after two takes: the song and the worklet hold take 2 only');
ok(und.afterUndo.song === und.t1 && und.afterUndo.w.includes(und.t1) && !und.afterUndo.w.includes(und.t2), 'Undo: take 1 back in the song and sent to the worklet again');
ok(und.afterRedo.song === und.t2 && und.afterRedo.w.includes(und.t2), 'Redo: take 2 again');
ok(und.playing === und.t1, 'playing after Undo uses take 1 (' + und.playing + ')');

/* ---- 4. Save → Open ---- */
const saved = await p.evaluate(async () => {
  const {wavBytes} = await import('/js/wav.js'), {zipRead} = await import('/js/zip.js'), {getClip} = await import('/js/audiostore.js');
  window.__writes = [];
  await window.spores.files.saveAs();
  const z = zipRead(window.__writes[0]), id = window.spores.store.get().scenes.A.clips[window.__tid].id;
  const w = z.find(f => f.name === `audio/${id}.wav`), want = wavBytes((await getClip(id)).data, 48000);
  return {names: z.map(f => f.name), id, same: !!w && w.bytes.length === want.length && w.bytes.every((x, i) => x === want[i]), bytes: Array.from(window.__writes[0])};
});
ok(saved.same && saved.names.length === 2, 'Save writes song.json + the referenced take only, WAV bytes as encoded: ' + saved.names);
const fresh = await b.createBrowserContext();
const q = await page(fresh);
const opened = await q.evaluate(async bytes => {
  const {getClip} = await import('/js/audiostore.js');
  window.__openBytes = new Uint8Array(bytes); window.__openName = 'Take test.spores';
  const before = await getClip(window.__id);
  const pr = window.spores.files.open();
  await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('.dialog button')].find(x => x.textContent === 'Open it').click();
  await pr;
  const s = window.spores.store.get(), tid = s.tracks.find(t => t.type === 'audio').id, id = s.scenes.A.clips[tid].id;
  const c = await getClip(id);
  await new Promise(r => setTimeout(r, 300));
  const w = (await window.spores.engine.peekWorklet()).clips;
  window.__writes = []; await window.spores.files.saveAs();
  return {id, sr: c && c.sr, n: c && c.data.length, peak: c ? Math.max(...c.data) : 0, inWorklet: w.includes(id), resaved: Array.from(window.__writes[0]), beforeNone: before === null};
}, saved.bytes);
ok(opened.id === saved.id && opened.n === 96000 && opened.sr === 48000 && opened.inWorklet, 'Open in a fresh profile: the take is back in IndexedDB and in the worklet: ' + JSON.stringify({id: opened.id, n: opened.n, sr: opened.sr}));
const re = await q.evaluate(async (a, b2) => {
  const {zipRead} = await import('/js/zip.js');
  const A = zipRead(new Uint8Array(a)).filter(f => f.name.startsWith('audio/')), B = zipRead(new Uint8Array(b2)).filter(f => f.name.startsWith('audio/'));
  return A.length === 1 && B.length === 1 && A[0].bytes.length === B[0].bytes.length && A[0].bytes.every((x, i) => x === B[0].bytes[i]);
}, saved.bytes, opened.resaved);
ok(re, 'saving it again gives the same WAV bytes');
// an old v1 song (plain .json, no clips anywhere)
const v1 = await q.evaluate(async () => {
  const old = {v: 1, bpm: 99, swing: 0, key: 'D', scale: 'minor', lock: true, mode: 'simple',
    tracks: [{id: 't1', name: 'Kick', type: 'drum', sound: 'Kick', vol: 0.8}], scenes: {A: {name: 'Old', bars: 1, steps: {t1: [{on: true, deg: 0, vel: 100, chance: 100}]}}},
    song: [{scene: 'A', repeat: 2}], link: {seedsPort: '', seedsCh: 16, clock: true}};
  window.__openBytes = new TextEncoder().encode(JSON.stringify(old)); window.__openName = 'old.json';
  const pr = window.spores.files.open();
  await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('.dialog button')].find(x => x.textContent === 'Open it').click();
  await pr;
  const s = window.spores.store.get();
  return {v: s.v, bpm: s.bpm, clips: JSON.stringify(s.scenes.A.clips), step: s.scenes.A.steps.t1[0].on, name: s.scenes.A.name};
});
ok(v1.v === 2 && v1.bpm === 99 && v1.clips === '{}' && v1.step && v1.name === 'Old', 'old v1 .json opens, migrated to v2: ' + JSON.stringify(v1));
ok(!q.errs.length, 'no console errors (fresh profile): ' + q.errs.join(' | '));
await q.close(); await fresh.close();

/* ---- 5. a fake input device + the level meter ---- */
const dev = await p.evaluate(async () => {
  const e = window.spores.engine;
  const r = await e.openInput({deviceId: '', channel: 1});
  const levels = []; const off = e.on('level', m => levels.push(m.peak));
  await new Promise(res => setTimeout(res, 1500)); off();
  const list = await e.audioInputs();
  e.setMonitor(true); const mon = e.monitor; e.setMonitor(false);
  const inp = e.input; e.closeInput();
  return {r, n: levels.length, max: Math.max(0, ...levels), list: list.length, mon, inp, after: e.input.open};
});
ok(dev.r.ok && dev.list > 0 && dev.inp.open, 'fake device opens: ' + JSON.stringify(dev.r) + ', inputs listed: ' + dev.list);
ok(dev.n > 30 && dev.max > 0.01, `level meter: ${dev.n} values in 1.5 s, peak ${dev.max.toFixed(3)}`);
ok(dev.mon === true && dev.after === false, 'Hear myself toggles; closeInput closes');
ok(!p.errs.length, 'no console errors: ' + p.errs.join(' | '));
console.log(bad ? `${bad} FAILED` : 'all passed');
await b.close();
process.exit(bad ? 1 : 0);
