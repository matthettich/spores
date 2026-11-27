/* tests/export-check.mjs (dev only): File › Export… (js/engine/render.js + bounce.js, js/ui/export.js) in headless Chrome.
 *   python3 -m http.server 8765 (in the repo), then: CHROME=… node tests/export-check.mjs   (puppeteer-core on your path;
 *   PORT=… for another port). Needs python3 (its wave module checks the WAV files).
 * A test song: 7 drum / synth tracks (one muted, one soloed), a MIDI and a CV track, a reverb + an echo on two tracks, a
 * loop take (a 440 Hz sine) in scene A and a song-length take (a 660 Hz sine) from bar 1; blocks A ×2, B (Loop forever).
 *  1. Song export through the dialog (a mocked Save picker): the length is the arrangement + a tail; the tail ends where the
 *     sound goes under −90 dB (checked against a longer reference render); it matches a plain offline render of the same
 *     worklet within −90 dB; Solo is respected (as playing)
 *  2. Scene export ×3 at 170 BPM, a kick only on step 5: the first sound on sample ceil(4 × step), the length 3 scenes + tail
 *  3. Stems: one per non-muted drum / synth / audio track (MIDI, CV, muted left out, Solo ignored), they add up to the mix
 *     (0.9 × tanh(Σ / 0.9) within −120 dB, and the plain sum within −60 dB at these levels); the takes and the effects are in
 *     their stems (440 Hz in the loop take's, 660 Hz in the song take's, the reverb's stem rings past the end)
 *  4. every WAV is 2 channels, 48 kHz, 24-bit (python wave), the zip passes `unzip -t`
 *  5. Cancel stops a long render quickly and writes nothing
 *  6. no console errors */
import puppeteer from 'puppeteer-core';
import fs from 'fs'; import os from 'os'; import path from 'path'; import {execFileSync} from 'child_process';
const PORT = process.env.PORT || 8765;
let bad = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) bad++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'spores-export-'));
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
const errs = [];
const p = await b.newPage();
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/MIDI/.test(m.text()) && errs.push(m.text()));
await p.evaluateOnNewDocument(() => {
  if (!sessionStorage.getItem('init')){ sessionStorage.setItem('init', '1'); localStorage.clear(); }
  // the Save picker, mocked: what is written lands in window.__out
  window.showSaveFilePicker = async o => { window.__picked = o; return {name: o.suggestedName, createWritable: async () => {
    const parts = []; return {write: async x => parts.push(x instanceof Blob ? new Uint8Array(await x.arrayBuffer()) : new Uint8Array(x.buffer || x)), close: async () => { window.__out = parts[0]; }, abort: async () => {}};
  }}; };
});
await p.goto(`http://localhost:${PORT}/`, {waitUntil: 'networkidle0'}); await sleep(400);

// the test song
await p.evaluate(async () => {
  const {newTrack, newClip, newSongTrack, newSongTake} = await import('/js/store.js');
  const {fxDefaults} = await import('/js/engine/fx.js'), {putClip} = await import('/js/audiostore.js');
  const sr = 48000, sine = (hz, n, a) => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = a * Math.sin(2 * Math.PI * hz * i / sr); return d; };
  await putClip('xloop', {sr, data: sine(440, 2 * sr, 0.3)});
  await putClip('xsong', {sr, data: sine(660, 3 * sr, 0.3)});
  const s = structuredClone(window.spores.store.get());
  s.bpm = 120; s.mode = 'simple';
  s.tracks.forEach(t => { t.vol = 0.05; t.fx = []; });
  for (const sc of Object.values(s.scenes)){ sc.mute = {}; sc.solo = {}; }   // (mute / solo are per scene)
  s.tracks.forEach(t => { const l = s.scenes.A.steps[t.id] || (s.scenes.A.steps[t.id] = []); l[0] = {on: true, deg: 0, vel: 100, chance: 100}; });   // every track sounds
  s.tracks[6].sound = 'Coil · Default'; s.tracks[6].params = {};      // Lead: a pump synth (pump-synth.wasm)
  s.tracks[3].type = 'synth'; s.tracks[3].sound = 'Modal · Default'; s.tracks[3].params = {}; s.tracks[3].oct = 3;   // a rendered synth (render-worker.js)
  for (const sc of Object.values(s.scenes)) sc.mute[s.tracks[4].id] = true;   // Open hat: muted in every scene, so no stem
  s.tracks[1].fx = [{id: 'r1', type: 'reverb', on: true, p: Object.assign(fxDefaults('reverb'), {mix: 220})}];   // Snare: reverb
  s.tracks[5].fx = [{id: 'd1', type: 'delay', on: true, p: fxDefaults('delay')}];                              // Bass: echo
  const loop = newTrack('audio'); loop.vol = 0.15; const st = newSongTrack(); st.vol = 0.15;
  st.take = newSongTake({id: 'xsong', sr, bpm: 120, startBar: 1});
  const mid = newTrack('midi'), cv = newTrack('cv');
  s.tracks.push(loop, st, mid, cv);
  s.scenes.A.bars = 1; s.scenes.A.clips = {[loop.id]: newClip({id: 'xloop', bars: 1, bpm: 120, sr})};
  for (const t of [mid, cv]) s.scenes.A.steps[t.id] = [{on: true, deg: 0, vel: 100, chance: 100}];
  s.scenes.B = structuredClone(s.scenes.A); s.scenes.B.name = 'B'; s.scenes.B.bars = 2; s.scenes.B.clips = {};
  s.song = [{scene: 'A', repeat: 2}, {scene: 'B', repeat: 1, loop: true}];
  window.spores.store.replace(s, 'test song');
});
await sleep(300);

// helpers in the page: decode a 24-bit stereo WAV, a plain offline render (the worklet as the tests always render it)
await p.evaluate(() => {
  window.__dec = bytes => { const dv = new DataView(bytes.buffer, bytes.byteOffset); let o = 12, fmt;
    while (o < bytes.length){ const id = String.fromCharCode(...bytes.subarray(o, o + 4)), n = dv.getUint32(o + 4, true);
      if (id === 'fmt ') fmt = {ch: dv.getUint16(o + 10, true), sr: dv.getUint32(o + 12, true), bits: dv.getUint16(o + 22, true)};
      if (id === 'data'){ const fr = n / 6, L = new Float32Array(fr), R = new Float32Array(fr);
        for (let i = 0; i < fr; i++){ const q = o + 8 + i * 6; L[i] = (((bytes[q + 2] << 24) | (bytes[q + 1] << 16) | (bytes[q] << 8)) >> 8) / 8388607; R[i] = (((bytes[q + 5] << 24) | (bytes[q + 4] << 16) | (bytes[q + 3] << 8)) >> 8) / 8388607; }
        return {fmt, L, R}; }
      o += 8 + n + (n & 1); } };
  window.__ref = async (song, secs, play) => {
    const {compile} = await import('/js/engine/engine.js'), {getClip} = await import('/js/audiostore.js'), {clipIds} = await import('/js/store.js');
    const s = structuredClone(song); s.song = s.song.map(x => Object.assign({}, x, {loop: false}));
    const clips = []; for (const id of clipIds(s)){ const c = await getClip(id); clips.push({id, data: c.data.slice()}); }
    const tfx = await WebAssembly.compile(await (await fetch('/js/engine/tfx.wasm')).arrayBuffer());
    const wasm = await WebAssembly.compile(await (await fetch('/js/engine/pump-synth.wasm')).arrayBuffer());
    const c = compile(s), bufs = [], w = new Worker('/js/engine/render-worker.js', {type: 'module'});
    for (const [ti, t] of c.tracks.entries()) if (t.rendered){ const notes = new Set(); for (const sc of Object.values(c.scenes)) for (const x of sc.steps[ti]) if (x) notes.add(x.note);
      for (const note of notes) bufs.push(await new Promise(r => { w.onmessage = e => r({id: t.id, note, data: e.data.data}); w.postMessage({id: t.id, key: 'x', engine: t.engine, vals: t.vals, note, sr: 48000}); })); }
    w.terminate();
    const sr = 48000, ctx = new OfflineAudioContext(2, Math.round(sr * secs) + 2880, sr);
    await ctx.audioWorklet.addModule('/js/engine/worklet.js');
    const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: c, play, clips, tfx, wasm, bufs}});
    n.connect(ctx.destination);
    const buf = await ctx.startRendering();
    return [0, 1].map(c => buf.getChannelData(c).slice(2880).map(x => x * 0.9));
  };
  window.__cmp = (a, b, n) => { let m = 0; for (let i = 0; i < n; i++){ const d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; };
  window.__pk = (a, i0, i1) => { let m = 0; for (let i = i0; i < Math.min(i1, a.length); i++) m = Math.max(m, Math.abs(a[i])); return m; };
});
const db = x => (20 * Math.log10(Math.max(x, 1e-12))).toFixed(1) + ' dB';
const save = async (name) => { const b64 = await p.evaluate(() => { let s = ''; const u = window.__out; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); });
  const f = path.join(OUT, name); fs.writeFileSync(f, Buffer.from(b64, 'base64')); return f; };
const pyWave = f => JSON.parse(execFileSync('python3', ['-I', '-c', 'import wave,sys,json; w=wave.open(sys.argv[1]); print(json.dumps([w.getnchannels(), w.getframerate(), w.getsampwidth(), w.getnframes()]))', f]).toString());
// run the dialog: pick what (+ scene / repeats), Export, wait for the end
async function exportVia(what, {scene, repeats, cancelAfter} = {}){
  await p.evaluate(() => { window.__out = null; window.__lastExport = null; document.querySelectorAll('.scrim').forEach(x => x.remove()); window.spores.files.exportAudio(); });
  await sleep(100);
  const t0 = Date.now();
  await p.evaluate((what, scene, repeats) => {
    const d = document.querySelector('.xpdlg');
    [...d.querySelectorAll('.seg .tb')].find(x => x.textContent.toLowerCase() === what).click();
    if (scene){ const s = d.querySelector('select'); s.value = scene; s.dispatchEvent(new Event('change')); }
    if (repeats){ const minus = d.querySelector('[aria-label="Fewer times"]'), plus = d.querySelector('[aria-label="More times"]'); for (let i = 0; i < 70; i++) minus.click(); for (let i = 1; i < repeats; i++) plus.click(); }
    [...d.querySelectorAll('.dacts .tb')].find(x => x.textContent === 'Export').click();
  }, what, scene, repeats);
  if (cancelAfter){ await sleep(cancelAfter); await p.evaluate(() => [...document.querySelectorAll('.xpdlg .dacts .tb')].find(x => x.textContent === 'Cancel').click()); }
  let status = '';
  for (let i = 0; i < 600; i++){ await sleep(100); status = await p.evaluate(() => document.querySelector('.xpdlg .xpprog .note').textContent); if (/^(Saved|Stopped|Couldn)/.test(status)) break; }
  return {status, ms: Date.now() - t0};
}

/* 1. Song */
{
  const progress = [];
  await p.exposeFunction('__prog', x => progress.push(x));
  await p.evaluate(() => new MutationObserver(() => { const b = document.querySelector('.xpbar'); if (b) window.__prog(+b.getAttribute('aria-valuenow')); }).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['aria-valuenow']}));
  const r = await exportVia('song');
  ok(/^Saved “Song\.wav”/.test(r.status), 'song export: ' + r.status + ` (${r.ms} ms)`);
  ok(progress.length >= 3 && progress.at(-1) === 100, 'progress moved: ' + progress.slice(0, 12).join(','));
  const f = await save('song.wav'), w = pyWave(f);
  ok(w[0] === 2 && w[1] === 48000 && w[2] === 3, 'python wave: ' + JSON.stringify(w));
  const R = await p.evaluate(async () => {
    const x = window.__lastExport, d = window.__dec(window.__out), song = window.spores.store.get();
    const ref = await window.__ref(song, x.length / 48000 + 3, {mode: 'song', block: 0});
    const end = 4 * 2 * 48000;   // A (1 bar) ×2 + B (2 bars) once = 4 bars of 2 s
    return {end: x.end, expectEnd: end, length: x.length, frames: d.L.length, diff: Math.max(window.__cmp(d.L, ref[0], end), window.__cmp(d.R, ref[1], end)),
      lastPk: Math.max(window.__pk(d.L, x.length - 12000, x.length), window.__pk(d.R, x.length - 12000, x.length)),
      tailPk: window.__pk(d.L, x.end, x.length), ws: window.__picked.types[0].accept['audio/wav'][0]};
  });
  ok(R.end === R.expectEnd && R.frames === R.length, `song end at ${R.end} (expected ${R.expectEnd}), file ${R.frames} frames`);
  ok(R.length > R.end && R.length < R.end + 10 * 48000, `tail ${((R.length - R.end) / 48000).toFixed(2)} s`);
  ok(R.lastPk < 1e-4, 'the tail ends where the sound is about −90 dB (the last 0.25 s peaks at ' + db(R.lastPk) + ')');
  ok(R.diff < 3.16e-5, 'song matches a plain offline render within −90 dB: ' + db(R.diff));
  ok(R.tailPk > 1e-4, 'the tail has sound (reverb / echo): ' + db(R.tailPk));
  ok(R.ws === '.wav', 'picker asked for a .wav');
  // Solo respected in a Song export (as playing): solo the Kick, export, only the kick's sound
  await p.evaluate(() => window.spores.store.edit('Solo', s => { for (const sc of Object.values(s.scenes)) sc.solo = {[s.tracks[0].id]: true}; }));   // (solo is per scene: in every scene)
  await exportVia('song');
  const S = await p.evaluate(async () => { const d = window.__dec(window.__out), ref = await window.__ref(window.spores.store.get(), 9, {mode: 'song', block: 0});
    return {diff: window.__cmp(d.L, ref[0], 8 * 48000), len: d.L.length}; });
  ok(S.diff < 3.16e-5, 'song with Solo on = the reference with Solo: ' + db(S.diff));
}

/* 2. Scene ×3 at 170, a kick only on step 5 */
{
  await p.evaluate(() => window.spores.store.edit('test', s => { s.bpm = 170; for (const sc of Object.values(s.scenes)) sc.solo = {}; s.scenes.C = {name: 'K', bars: 1, steps: {[s.tracks[0].id]: [null, null, null, null, {on: true, deg: 0, vel: 100, chance: 100}]}, clips: {}}; }));
  const r = await exportVia('scene', {scene: 'C', repeats: 3});
  ok(/^Saved “Song - scene C\.wav”/.test(r.status), 'scene export: ' + r.status);
  const R = await p.evaluate(() => { const d = window.__dec(window.__out), x = window.__lastExport; let first = -1; for (let i = 0; i < d.L.length; i++) if (d.L[i] !== 0){ first = i; break; } return {first, at: [d.L[16942], d.L[16943]], end: x.end, length: x.length}; });
  const step = 48000 * 15 / 170;
  ok(R.first === Math.ceil(4 * step) || (R.first === Math.ceil(4 * step) + 1 && R.at[0] === 0), `first kick on sample ${R.first} (step 5 = ${(4 * step).toFixed(2)}: the hit starts on sample ${Math.ceil(4 * step)}, whose value is ${R.at[0]}; then ${R.at[1].toFixed(5)})`);
  ok(Math.abs(R.end - 3 * 16 * step) < 1, `scene ×3 ends at ${R.end} (${(3 * 16 * step).toFixed(2)})`);
  pyWave(await save('scene.wav'));
  await p.evaluate(() => window.spores.store.edit('test', s => { s.bpm = 120; delete s.scenes.C; for (const sc of Object.values(s.scenes)) sc.solo = {[s.tracks[0].id]: true}; }));   // (Solo on: stems ignore it)
}

/* 3. Stems */
{
  const r = await exportVia('stems');
  const want = await p.evaluate(() => window.spores.store.get().tracks.filter(t => ['drum', 'synth', 'audio'].includes(t.type) && !Object.values(window.spores.store.get().scenes).every(sc => sc.mute && sc.mute[t.id])).map(t => t.name));
  ok(/^Saved “Song stems\.zip”/.test(r.status) && r.status.includes(`${want.length} tracks`), 'stems export: ' + r.status);
  const f = await save('stems.zip');
  execFileSync('unzip', ['-tq', f]);
  ok(true, 'unzip -t passes');
  const dir = path.join(OUT, 'stems'); execFileSync('unzip', ['-q', '-o', f, '-d', dir]);
  const wavs = fs.readdirSync(path.join(dir, 'Song stems')).sort();
  const muted = await p.evaluate(() => window.spores.store.get().tracks[4].name);
  ok(wavs.length === want.length + 1 && wavs.includes('Song stems mix.wav') && want.every((n, k) => wavs[k] === `${String(k + 1).padStart(2, '0')} ${n}.wav`) && !wavs.some(n => n.includes(muted)),
    `stems (MIDI, CV and the muted ${muted} left out): ` + wavs.join(' | '));
  ok(wavs.every(n => { const w = pyWave(path.join(dir, 'Song stems', n)); return w[0] === 2 && w[1] === 48000 && w[2] === 3; }), 'every stem: 2 ch, 48 kHz, 24-bit (python wave)');
  const R = await p.evaluate(async () => {
    const {zipRead} = await import('/js/zip.js');
    const all = zipRead(window.__out).map(x => ({name: x.name.split('/').pop(), ...window.__dec(x.bytes)}));
    const mix = all.find(x => / mix\.wav$/.test(x.name)), stems = all.filter(x => x !== mix), n = mix.L.length;
    const sum = [new Float32Array(n), new Float32Array(n)];
    for (const s of stems) for (let i = 0; i < n; i++){ sum[0][i] += s.L[i]; sum[1][i] += s.R[i]; }
    const clip = sum.map(a => a.map(x => 0.9 * Math.tanh(x / 0.9)));
    const tone = (a, hz, i0, i1) => { let re = 0, im = 0, e = 0; for (let i = i0; i < i1; i++){ re += a[i] * Math.cos(2 * Math.PI * hz * i / 48000); im += a[i] * Math.sin(2 * Math.PI * hz * i / 48000); e += a[i] * a[i]; } return Math.sqrt(re * re + im * im) * 2 / (i1 - i0) / Math.max(1e-9, Math.sqrt(2 * e / (i1 - i0))); };
    const by = k => stems.find(x => x.name.includes(k));
    // the mix against a plain render with Solo off
    const song = structuredClone(window.spores.store.get()); for (const sc of Object.values(song.scenes)) sc.solo = {};
    const ref = await window.__ref(song, n / 48000 + 1, {mode: 'song', block: 0});
    const end = window.__lastExport.end, snare = by('Snare'), vo = by('Voice'), sv = by('Song voice'), sn = window.spores.store.get().tracks;
    return {names: stems.map(x => x.name), clipDiff: Math.max(window.__cmp(clip[0], mix.L, n), window.__cmp(clip[1], mix.R, n)),
      sumDiff: Math.max(window.__cmp(sum[0], mix.L, n), window.__cmp(sum[1], mix.R, n)), refDiff: window.__cmp(mix.L, ref[0], end),
      loop440: tone(vo.L, 440, 0, 96000), loopPk: window.__pk(vo.L, 0, n), song660: tone(sv.L, 660, 96000, 192000), songBefore: window.__pk(sv.L, 0, 96000 - 10),
      coil: window.__pk(by(sn[6].name).L, 0, n), modal: window.__pk(by(sn[3].name).L, 0, n),
      snareTail: window.__pk(snare.L, end + 4800, end + 48000), pk: Math.max(window.__pk(sum[0], 0, n), window.__pk(sum[1], 0, n))};
  });
  ok(R.clipDiff < 1e-6, 'stems → 0.9 × tanh(Σ / 0.9) = the mix: ' + db(R.clipDiff));
  ok(R.sumDiff < 1e-3, `stems add up to the mix within −60 dB: ${db(R.sumDiff)} (peak of the sum ${R.pk.toFixed(3)})`);
  ok(R.refDiff < 3.16e-5, 'the stems’ mix = a plain render with Solo off, within −90 dB: ' + db(R.refDiff));
  ok(R.loop440 > 0.9 && R.loopPk > 0.01, `loop take in its stem: 440 Hz purity ${R.loop440.toFixed(3)}`);
  ok(R.song660 > 0.9 && R.songBefore < 1e-6, `song take in its stem from bar 1: 660 Hz purity ${R.song660.toFixed(3)}, silent before (${db(R.songBefore)})`);
  ok(R.coil > 1e-3 && R.modal > 1e-3, `pump (Coil) and rendered (Modal) synths in their stems: ${db(R.coil)}, ${db(R.modal)}`);
  ok(R.snareTail > 1e-4, 'the Snare’s reverb rings in its stem after the end: ' + db(R.snareTail));
}

/* 5. Cancel */
{
  await p.evaluate(() => window.spores.store.edit('test', s => { for (const sc of Object.values(s.scenes)) sc.solo = {}; }));
  const r = await exportVia('scene', {scene: 'A', repeats: 64, cancelAfter: 400});
  const out = await p.evaluate(() => window.__out);
  ok(/^Stopped/.test(r.status) && !out && r.ms < 5000, `Cancel: "${r.status}" after ${r.ms} ms, nothing written`);
  const again = await exportVia('scene', {scene: 'A', repeats: 1});
  ok(/^Saved/.test(again.status), 'a new export after Cancel works: ' + again.status);
}

/* 6. */
ok(!errs.length, 'no console errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await b.close();
fs.rmSync(OUT, {recursive: true, force: true});
console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
