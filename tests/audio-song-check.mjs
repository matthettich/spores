/* tests/audio-song-check.mjs (dev only): song-length audio takes (track.span 'song') in headless Chrome.
 *   python3 -m http.server 8765 (in the repo), then: CHROME=… PORT=8765 node tests/audio-song-check.mjs   (puppeteer-core on your path)
 * 1. offline renders through the worklet: the take's first sample lands on its start bar, counted through a block
 *    boundary and a repeated block (120 and 170 BPM); Play from block 2 / 3 starts it at the right offset; it stops at the
 *    song's end (and starts again with the song); varispeed; trim + gain; silent in scene mode; a Loop-forever block
 * 2. recording in real time against a loop-back: from the start and from block 2, to the song's end, kicks within 1 ms;
 *    Stop part-way keeps the take; engine.recording is false when 'done' fires
 * 3. Undo / Redo swap the take in the song and the worklet  4. Save → Open (fresh profile)  5. songmap helpers */
import puppeteer from 'puppeteer-core';
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL0 = `http://localhost:${process.env.PORT || 8765}/`;
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
  await p.goto(URL0, {waitUntil: 'networkidle0'}); await sleep(500);
  return p;
}
let p = await page();

/* ---- 1. offline ---- */
const off = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js'), {newSongTrack, newSongTake} = await import('/js/store.js');
  const sr = 48000, START = 0.06 * sr, bar = bpm => 4 * 60 / bpm * sr;
  // blocks: A (1 bar) ×1 · B (2 bars) ×2 · A ×1  → song bars: A 0, B 1–2 and 3–4 (its repeat), A 5; the song is 6 bars
  function song(bpm, take, blocks){
    const s = structuredClone(window.spores.store.get()); s.bpm = bpm; s.mode = 'simple';
    s.tracks.forEach(t => t.mute = true);
    const t = newSongTrack(); t.vol = 1; t.take = take; s.tracks.push(t);
    s.scenes = {A: {name: 'A', bars: 1, steps: {}, clips: {}}, B: {name: 'B', bars: 2, steps: {}, clips: {}}};
    s.song = blocks || [{scene: 'A', repeat: 1}, {scene: 'B', repeat: 2}, {scene: 'A', repeat: 1}];
    return s;
  }
  async function render(s, data, secs, play = {mode: 'song', block: 0}){
    const ctx = new OfflineAudioContext(2, Math.round(sr * secs), sr);
    await ctx.audioWorklet.addModule('/js/engine/worklet.js');
    const clips = Object.entries(data).map(([id, d]) => ({id, data: d}));
    const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: compile(s), play, clips}});
    n.connect(ctx.destination);
    const buf = await ctx.startRendering();
    return Array.from(buf.getChannelData(0), x => Math.atanh(Math.max(-0.999999, Math.min(0.999999, x))));
  }
  const hitsOf = y => { const h = []; y.forEach((x, i) => { if (Math.abs(x) > 1e-4) h.push(i); }); return h; };
  // impulses (spread over a few samples when they fall between samples): the signed centroid of each cluster
  const events = y => { const out = []; let a = 0, w = 0, last = -1e9;
    y.forEach((x, i) => { if (Math.abs(x) <= 1e-5) return; if (i - last > 8 && w){ out.push(+(a / w).toFixed(3)); a = w = 0; } a += i * x; w += x; last = i; });
    if (w) out.push(+(a / w).toFixed(3)); return out; };
  const near = (got, want, tol) => got.length === want.length && got.every((g, i) => Math.abs(g - want[i]) <= tol);
  const centre = (y, f) => { let a = 0, w = 0; for (let i = Math.floor(f) - 3; i <= Math.floor(f) + 4; i++){ a += i * y[i]; w += y[i]; } return w ? a / w : NaN; };
  const tk = (id, bpm, startBar, extra = {}) => newSongTake({id, sr, bpm, startBar}, Object.assign({fadeIn: 0, fadeOut: 0}, extra));
  const res = {};
  for (const bpm of [120, 170]){
    const B = bar(bpm), r = res[bpm] = {};
    // a take recorded at this tempo, starting at song bar 3 (the 2nd repeat of block B): an impulse on each of its bars
    const L = Math.round(3 * B), d = new Float32Array(L); for (let k = 0; k < 3; k++) d[Math.round(k * B)] = 0.5;
    let y = await render(song(bpm, tk('s3', bpm, 3)), {s3: d}, (START + 7.2 * B) / sr);
    r.first = y.findIndex(x => Math.abs(x) > 1e-6);
    r.want = START + 3 * B;
    r.firstWant = Math.ceil(r.want - 1e-9);
    r.cs = [4, 5].map((k, j) => +(centre(y, START + k * B + (Math.round((j + 1) * B) - (j + 1) * B)) - (START + k * B + (Math.round((j + 1) * B) - (j + 1) * B))).toFixed(4));
    r.before = 0; for (let i = 0; i < Math.floor(START + 3 * B) - 4; i++) r.before = Math.max(r.before, Math.abs(y[i]));
    r.value = bpm === 120 ? +y[START + 3 * B].toFixed(6) : null;
    // start bar 1 (block B's first sample, across the A → B boundary), take 8 bars long: impulses at bar k + 1000;
    // the song is 6 bars, so take bars 5…7 (song bars 6…8) must not play: the song starts again, and so does the take
    const L8 = Math.round(8 * B), d8 = new Float32Array(L8); for (let k = 0; k < 8; k++) d8[Math.round(k * B) + 1000] = 0.5;
    y = await render(song(bpm, tk('s8', bpm, 1)), {s8: d8}, (START + 8.5 * B) / sr);
    r.endHits = events(y);
    // song bar 1 + k plays take bar k: k = 0…4 in the first pass, then the song is back at bar 0 (silent), bars 7, 8 = song bars 1, 2 again → take bars 0, 1
    r.endWant = [0, 1, 2, 3, 4].map(k => +(START + (1 + k) * B + Math.round(k * B) - k * B + 1000).toFixed(3)).concat([+(START + 7 * B + 1000).toFixed(3), +(START + 8 * B + Math.round(B) - B + 1000).toFixed(3)]);
    r.endOk = near(r.endHits, r.endWant, 0.02);
    // Play from block 2 (B, bar 1) and block 3 (A, bar 5): the take (start bar 0) is heard from that point on
    const Lz = Math.round(6 * B), dz = new Float32Array(Lz); dz[Math.round(1 * B) + 700] = 0.5; dz[Math.round(5 * B) + 500] = 0.25;
    y = await render(song(bpm, tk('z', bpm, 0)), {z: dz}, (START + 2 * B) / sr, {mode: 'song', block: 1});
    r.from2 = events(y).map(i => +(i - START).toFixed(3));
    r.from2want = [Math.round(1 * B) + 700 - 1 * B];
    y = await render(song(bpm, tk('z', bpm, 0)), {z: dz}, (START + 0.5 * B) / sr, {mode: 'song', block: 2});
    r.from3 = events(y).map(i => +(i - START).toFixed(3));
    r.from3want = [Math.round(5 * B) + 500 - 5 * B];
  }
  // varispeed: a 120 BPM take (bumps on its bar lines) at start bar 1 in a 170 BPM song: bumps on the 170 bar lines
  {
    const B0 = bar(120), L = Math.round(3 * B0), d = new Float32Array(L);
    for (let i = 0; i < L; i++) for (let k = 0; k < 3; k++) d[i] += 0.3 * Math.exp(-(((i - k * B0 - 2000) / 30) ** 2));
    const y = await render(song(170, tk('v', 120, 1)), {v: d}, (START + 5 * bar(170)) / sr), B = bar(170), k2 = 2000 * B / B0;
    const cen = f => { let a = 0, w = 0; for (let i = Math.floor(f) - 150; i <= Math.floor(f) + 150; i++){ a += i * y[i]; w += y[i]; } return a / w; };
    res.vari = [1, 2, 3].map(k => +(cen(START + k * B + k2) - (START + k * B + k2)).toFixed(4));
  }
  // trim + gain: trimStart hides the first 0.5 s, the take stays anchored; gain 0.5
  {
    const d = new Float32Array(96000); d[1000] = 0.5; d[30000] = 0.5;
    const y = await render(song(120, tk('t', 120, 0, {trimStart: 0.5, gain: 0.5})), {t: d}, 2);
    res.trim = {hits: hitsOf(y).map(i => i - START), v: +y[START + 30000].toFixed(6)};
  }
  // scene mode: silent
  {
    const d = new Float32Array(96000).fill(0.1);
    const y = await render(song(120, tk('q', 120, 0)), {q: d}, 1.5, {mode: 'scene', scene: 'A'});
    res.scenePeak = y.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  }
  // a Loop-forever block (A, 1 bar): the song bar keeps counting, the 4-bar take plays through once, then silence
  {
    const B = bar(120), d = new Float32Array(4 * B); for (let k = 0; k < 4; k++) d[k * B + 10] = 0.5;
    const y = await render(song(120, tk('f', 120, 0), [{scene: 'A', repeat: 1, loop: true}]), {f: d}, (START + 6 * B) / sr);
    res.loop = {hits: hitsOf(y), want: [0, 1, 2, 3].map(k => START + k * B + 10)};
  }
  return res;
});
for (const bpm of [120, 170]){
  const r = off[bpm];
  ok(r.before === 0 && r.first === r.firstWant && (bpm !== 120 || Math.abs(r.value - 0.45) < 1e-6) && r.cs.every(c => Math.abs(c) < 0.01),
    `${bpm} BPM: start bar 3 (repeat 2 of block B): silent before, first sample at ${r.first} (bar line ${r.want.toFixed(2)}${bpm === 120 ? ', value ' + r.value : ''}), its later bars within 0.01 sample: ${r.cs}`);
  ok(r.endOk, `${bpm} BPM: start bar 1 (across A → B): bars 1–5, stops at the song's end, starts again with the song: ${r.endHits} (want ${r.endWant})`);
  ok(r.from2.length === 1 && Math.abs(r.from2[0] - r.from2want[0]) < 0.02 && r.from3.length === 1 && Math.abs(r.from3[0] - r.from3want[0]) < 0.02,
    `${bpm} BPM: Play from block 2 → +${r.from2} (want ${r.from2want[0].toFixed(2)}), from block 3 → +${r.from3} (want ${r.from3want[0].toFixed(2)})`);
}
ok(off.vari.every(c => Math.abs(c) < 0.03), 'varispeed 120 → 170 from bar 1: each take bar on a song bar line (off by ' + off.vari + ' samples)');
ok(JSON.stringify(off.trim.hits) === '[30000]' && Math.abs(off.trim.v - 0.225) < 1e-6, 'trim start hides 0.5 s (anchored), gain 0.5: ' + JSON.stringify(off.trim));
ok(off.scenePeak === 0, 'silent in scene mode');
ok(JSON.stringify(off.loop.hits) === JSON.stringify(off.loop.want), 'Loop-forever block: the take plays through once, then silence: ' + off.loop.hits);

/* ---- 2. recording against a loop-back ---- */
await p.evaluate(async () => {
  const {newSongTrack} = await import('/js/store.js');
  const st = window.spores.store, t = newSongTrack();
  st.edit('test', s => {
    s.bpm = 120; s.mode = 'simple';
    s.tracks.forEach(x => { x.mute = x.sound !== 'Kick'; });
    s.tracks.push(t);
    const kick = s.tracks.find(x => x.sound === 'Kick').id, on = {on: true, deg: 0, vel: 100, chance: 100};
    // A (1 bar): kicks on 0 and 8; B (1 bar) ×2: a kick on 4 → song steps 0, 8, 20, 36
    s.scenes = {A: {name: 'A', bars: 1, steps: {[kick]: [on, , , , , , , , on]}, clips: {}}, B: {name: 'B', bars: 1, steps: {[kick]: [, , , , on]}, clips: {}}};
    s.song = [{scene: 'A', repeat: 1}, {scene: 'B', repeat: 2}];
  });
  window.__tid = t.id;
  const e = window.spores.engine, ctx = e.ctx;
  await ctx.resume();
  const d = ctx.createDelay(1); d.delayTime.value = 0.025;
  e.node.connect(d, 0);
  await e.openInput({testNode: d});
  await e.measureLatency();
});
const recs = await p.evaluate(async () => {
  const e = window.spores.engine, sr = e.ctx.sampleRate, step = sr * 15 / 120;
  const onsets = d => { const o = []; let last = -1e9; for (let i = 0; i < d.length; i++){ if (Math.abs(d[i]) > 0.005){ if (i - last > sr * 0.1) o.push(i); last = i; } } return o; };
  const err = (d, want) => { const o = onsets(d); return {n: o.length, ms: o.map((x, i) => +((x - (want[i] ?? NaN)) / sr * 1000).toFixed(3))}; };
  const states = [], recAtDone = []; e.on('rec', m => { states.push(m.state); if (m.state === 'done') recAtDone.push(e.recording); });
  const t0 = e.ctx.currentTime;
  const a = await e.recordSong({track: window.__tid, fromBlock: 0});
  const tookA = e.ctx.currentTime - t0, playingAfter = e.playing;
  const b2 = await e.recordSong({track: window.__tid, fromBlock: 1});
  // Stop part-way (about 1.2 s into the take): kept, shorter
  const pr = e.recordSong({track: window.__tid, fromBlock: 0});
  await new Promise(res => { const off = e.on('rec', m => { if (m.state === 'recording'){ off(); setTimeout(res, 1200); } }); });
  e.stop();
  const c = await pr;
  const pd = e.recordSong({track: window.__tid, fromBlock: 0});
  await new Promise(res => setTimeout(res, 2500)); e.stopRecording({discard: true});
  const dropped = await pd; e.stop();
  return {sr, a: err(a.data, [0, 8, 20, 36].map(k => k * step)), aLen: a.data.length, aMeta: {startBar: a.startBar, bpm: a.bpm, sr: a.sr, kind: a.kind},
    tookA: +tookA.toFixed(2), playingAfter, b: err(b2.data, [4, 20].map(k => k * step)), bLen: b2.data.length, bStart: b2.startBar,
    cLen: c && c.data.length, cOn: c && err(c.data, [0, 8].map(k => k * step)), dropped, states: [...new Set(states)], recAtDone};
});
ok(recs.aLen === 3 * 2 * recs.sr && recs.aMeta.startBar === 0 && recs.aMeta.kind === 'song' && recs.aMeta.bpm === 120, 'from the start: exactly the song (3 bars, ' + recs.aLen + ' samples), ' + JSON.stringify(recs.aMeta));
ok(recs.tookA > 7.9 && recs.tookA < 8.6 && recs.playingAfter, `one bar of count-in + 3 bars (${recs.tookA} s), the song plays on`);
ok(recs.a.n === 4 && recs.a.ms.every(x => Math.abs(x) <= 1), 'from the start: kicks within 1 ms: ' + recs.a.ms);
ok(recs.bStart === 1 && recs.bLen === 2 * 2 * recs.sr && recs.b.n === 2 && recs.b.ms.every(x => Math.abs(x) <= 1), `from block 2: startBar ${recs.bStart}, ${recs.bLen} samples, kicks within 1 ms: ${recs.b.ms}`);
ok(recs.cLen > 0.9 * recs.sr && recs.cLen < 1.8 * recs.sr && recs.cOn.n === 2 && recs.cOn.ms.every(x => Math.abs(x) <= 1), `Stop part-way keeps the take (${recs.cLen} samples), kicks within 1 ms: ${recs.cOn.ms}`);
ok(recs.dropped === null, 'stopRecording({discard: true}) drops it');
ok(['count-in', 'recording', 'done', 'cancelled'].every(s => recs.states.includes(s)) && recs.recAtDone.length && recs.recAtDone.every(x => x === false),
  'rec states ' + recs.states + '; engine.recording false when done fires: ' + recs.recAtDone);

/* ---- 3. Undo / Redo ---- */
const und = await p.evaluate(async () => {
  const {store, engine: e, keepSongTake} = window.spores, sr = 48000, tid = window.__tid;
  const mk = at => { const d = new Float32Array(96000); d[at] = 0.5; return {id: 'w' + at + Math.random().toString(36).slice(2, 6), kind: 'song', trackId: tid, data: d, sr, bpm: 120, startBar: 1}; };
  const t1 = mk(0), t2 = mk(12000);
  keepSongTake(store, t1); keepSongTake(store, t2);
  const cur = () => (store.get().tracks.find(t => t.id === tid).take || {}).id, wait = () => new Promise(r => setTimeout(r, 300));
  await wait(); const after2 = {song: cur(), w: (await e.peekWorklet()).clips};
  store.undo(); await wait(); const afterUndo = {song: cur(), w: (await e.peekWorklet()).clips};
  store.redo(); await wait(); const afterRedo = {song: cur(), w: (await e.peekWorklet()).clips};
  store.undo(); await wait();
  await e.play('song', 'A', 1); await new Promise(r => setTimeout(r, 400));
  const pk = await e.peekWorklet(); e.stop();
  const take = store.get().tracks.find(t => t.id === tid).take;
  return {t1: t1.id, t2: t2.id, after2, afterUndo, afterRedo, playing: pk.tapes[tid], take};
});
ok(und.after2.song === und.t2 && und.after2.w.includes(und.t2) && !und.after2.w.includes(und.t1), 'after two takes: song and worklet hold take 2 only');
ok(und.afterUndo.song === und.t1 && und.afterUndo.w.includes(und.t1) && !und.afterUndo.w.includes(und.t2), 'Undo: take 1 back in the song and the worklet');
ok(und.afterRedo.song === und.t2 && und.afterRedo.w.includes(und.t2), 'Redo: take 2 again');
ok(und.playing === und.t1, 'Play from block 2 after Undo plays take 1 (' + und.playing + ')');
ok(und.take.startBar === 1 && und.take.gain === 1 && und.take.trimStart === 0 && und.take.trimEnd === 0 && und.take.fadeIn === 0.004, 'track.take: ' + JSON.stringify(und.take));

/* ---- 4. Save → Open ---- */
const saved = await p.evaluate(async () => {
  const {wavBytes} = await import('/js/wav.js'), {zipRead} = await import('/js/zip.js'), {getClip} = await import('/js/audiostore.js');
  window.__writes = [];
  await window.spores.files.saveAs();
  const z = zipRead(window.__writes[0]), id = window.spores.store.get().tracks.find(t => t.id === window.__tid).take.id;
  const w = z.find(f => f.name === `audio/${id}.wav`), want = wavBytes((await getClip(id)).data, 48000);
  return {names: z.map(f => f.name), id, same: !!w && w.bytes.length === want.length && w.bytes.every((x, i) => x === want[i]), bytes: Array.from(window.__writes[0])};
});
ok(saved.same && saved.names.length === 2, 'Save writes song.json + audio/<id>.wav of the song take: ' + saved.names);
const fresh = await b.createBrowserContext();
const q = await page(fresh);
const opened = await q.evaluate(async bytes => {
  const {getClip} = await import('/js/audiostore.js');
  window.__openBytes = new Uint8Array(bytes); window.__openName = 'Song take.spores';
  const pr = window.spores.files.open();
  await new Promise(r => setTimeout(r, 300));
  [...document.querySelectorAll('.dialog button')].find(x => x.textContent === 'Open it').click();
  await pr;
  const s = window.spores.store.get(), t = s.tracks.find(x => x.span === 'song'), c = await getClip(t.take.id);
  await new Promise(r => setTimeout(r, 300));
  return {id: t.take.id, take: t.take, n: c && c.data.length, sr: c && c.sr, inWorklet: (await window.spores.engine.peekWorklet()).clips.includes(t.take.id),
    audioCount: s.tracks.filter(x => x.type === 'audio').length};
}, saved.bytes);
ok(opened.id === saved.id && opened.n === 96000 && opened.sr === 48000 && opened.inWorklet && opened.take.startBar === 1, 'Open in a fresh profile: track.take, IndexedDB and the worklet: ' + JSON.stringify({id: opened.id, n: opened.n, startBar: opened.take.startBar}));
ok(!q.errs.length, 'no console errors (fresh profile): ' + q.errs.join(' | '));
await q.close(); await fresh.close();

/* ---- 5. data rules + songmap ---- */
const data = await p.evaluate(async () => {
  const {migrate, newSongTrack, newTrack, canAddAudio, clipIds} = await import('/js/store.js'), {songMap, barToBlock, blockToBar, takeBars} = await import('/js/songmap.js');
  const s = structuredClone(window.spores.store.get());
  const m = songMap(s), map = {total: m.totalBars, starts: m.blocks.map(x => x.startBar), loopAt: m.loopAt};
  const bb = [0, 1, 2, 3].map(k => barToBlock(s, k)), b2 = blockToBar(s, 1);
  // a bad take, a song take on a loop track, scene clips on a song track: cleaned up
  const t = newSongTrack(), l = newTrack('audio');
  const raw = structuredClone(s); t.take = {id: 'bad id!'}; l.take = {id: 'x'}; l.span = 'nope'; raw.tracks.push(t, l);
  raw.scenes.A.clips = {[t.id]: {id: 'c1', bars: 1}};
  const mg = migrate(JSON.parse(JSON.stringify(raw)));
  const T = mg.tracks.find(x => x.id === t.id), Lt = mg.tracks.find(x => x.id === l.id);
  // counts toward the 4 audio tracks
  const four = structuredClone(s); four.tracks = four.tracks.filter(x => x.type !== 'audio').slice(0, 4); four.tracks.push(newSongTrack(), newSongTrack(), newTrack('audio'));
  const can3 = canAddAudio(four); four.tracks.push(newSongTrack());
  return {map, bb, b2, bars: takeBars({sr: 48000, bpm: 120, n: 3 * 96000}), T: {span: T.span, take: T.take}, L: {span: Lt.span, take: Lt.take},
    clipsA: Object.keys(mg.scenes.A.clips), ids: [...clipIds(mg)], can3, can4: canAddAudio(four), v: mg.v};
});
ok(JSON.stringify(data.map) === '{"total":3,"starts":[0,1],"loopAt":-1}' && data.b2 === 1 && JSON.stringify(data.bb) === '[{"index":0,"rep":0,"barInScene":0},{"index":1,"rep":0,"barInScene":0},{"index":1,"rep":1,"barInScene":0},null]' && data.bars === 3,
  'songMap / barToBlock / blockToBar / takeBars: ' + JSON.stringify(data.map) + ' ' + JSON.stringify(data.bb));
ok(data.T.span === 'song' && data.T.take === null && data.L.span === undefined && data.L.take === undefined && !data.clipsA.length && data.v === 3,
  'migrate: bad take → null, stray span / take removed from a loop track, no scene clips on a song track, v = 3 (current; effects bumped it)');
ok(data.can3 === true && data.can4 === false, 'song-length tracks count toward the 4 audio tracks');
ok(!p.errs.length, 'no console errors: ' + p.errs.join(' | '));
console.log(bad ? `${bad} FAILED` : 'all passed');
await b.close();
process.exit(bad ? 1 : 0);
