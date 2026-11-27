/* tests/chord-check.mjs: chords on note steps (song v5, js/chord.js). Dev only:
 *   python3 -m http.server 8765 (repo folder), then CHROME=… [PORT=8765] node tests/chord-check.mjs
 * Engine: a chord step renders every note (Acid / Coil / Modal), finite, its onset on the same sample as one note;
 * MIDI: a 3-note chord = 3 note-ons together + 3 note-offs; CV: the root only. Store: an old v4 song opens unchanged,
 * a bad chord is cleaned. UI: the Chord picker sets the notes in one Undo, Shift-click in the melody lane adds / removes
 * a note, drag and arrows move the whole chord, preview plays all of it; save / load keeps it. */
import puppeteer from 'puppeteer-core';
const PORT = process.env.PORT || 8765, URL = `http://localhost:${PORT}/`;
const b = await puppeteer.launch({executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
const p = await b.newPage(); const errs = [];
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.evaluateOnNewDocument(() => {
  window.__sent = [];
  const out = {id: 'iac', name: 'IAC Bus 1', send: (d, t) => window.__sent.push({d: [...d], t: t ?? performance.now()}), clear(){}};
  navigator.requestMIDIAccess = async () => ({outputs: new Map([['iac', out]]), onstatechange: null});
  try { localStorage.clear(); } catch (e) {}
});
await p.goto(URL, {waitUntil: 'networkidle0'}); await new Promise(r => setTimeout(r, 600));
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

/* ---- engine: offline renders ---- */
const E = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js'), {ModalCore} = await import('/js/engine/rendered.js'), {degToMidi} = await import('/js/scale.js');
  const wasm = await WebAssembly.compile(await (await fetch('/js/engine/pump-synth.wasm')).arrayBuffer());
  const sr = 48000, out = {};
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);
  // energy at one frequency (Goertzel, Hann window) over [a, b)
  const tone = (L, f, a, b) => { const w = 2 * Math.cos(2 * Math.PI * f / sr); let s1 = 0, s2 = 0;
    for (let i = a; i < b; i++){ const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - a) / (b - a)); const s0 = L[i] * h + w * s1 - s2; s2 = s1; s1 = s0; } return s1 * s1 + s2 * s2 - w * s1 * s2; };
  async function render(sound, chord, deg = 0){
    const s = structuredClone(window.spores.store.get()); s.key = 'C'; s.scale = 'minor'; s.mode = 'simple';
    const ti = 7, t = s.tracks[ti]; t.sound = sound; t.params = {}; t.oct = 3; t.fx = [];
    s.tracks.forEach((x, i) => x.mute = i !== ti);
    const k = Object.keys(s.scenes)[0]; for (const sk of Object.keys(s.scenes)) s.scenes[sk].steps[t.id] = [];
    s.scenes[k].steps[t.id] = [Object.assign({on: true, deg, vel: 100, chance: 100}, chord ? {chord} : {})];
    const c = compile(s), ct = c.tracks[ti], bufs = [];
    if (ct.rendered) for (const st of c.scenes[k].steps[ti]) if (st) for (const n of st.notes || [st.note])
      bufs.push({id: ct.id, note: n, data: ModalCore.render(Object.assign({}, ct.vals, {oct: 0, tune: n - 36}), sr, ct.vals.hold || 0.5)});
    const ctx = new OfflineAudioContext(2, sr * 1, sr); await ctx.audioWorklet.addModule('/js/engine/worklet.js');
    const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2], processorOptions: {song: c, play: {mode: 'scene', scene: k}, wasm, bufs}});
    n.connect(ctx.destination); const L = (await ctx.startRendering()).getChannelData(0);
    let bad = 0, pk = 0, first = -1; for (let i = 0; i < L.length; i++){ const a = Math.abs(L[i]); if (!isFinite(L[i])) bad++; if (a > pk) pk = a; if (first < 0 && a > 1e-4) first = i; }
    return {L, bad, pk, first, step: c.scenes[k].steps[ti][0]};
  }
  for (const sound of ['Acid bass', 'Coil · Spring harp', 'Modal · Marimba']){
    const ones = [await render(sound, null, 0), await render(sound, null, 2), await render(sound, null, 4)], ch = await render(sound, [2, 4]);
    const notes = [0, 2, 4].map(d => degToMidi(d, 'C', 'minor', 3));   // C3 E♭3 G3
    const a = ch.first + 1200, z = a + 9600;   // 25 ms after the onset, 200 ms long
    // each note's energy in the chord vs that note played alone: ≈ 1/3 (each note at 1/√3); E♭ / G vs the root alone: far more
    const ratio = notes.map((n, i) => +(tone(ch.L, hz(n), a, z) / (tone(ones[i].L, hz(n), a, z) + 1e-12)).toFixed(3));
    const vsRoot = notes.map(n => +(tone(ch.L, hz(n), a, z) / (tone(ones[0].L, hz(n), a, z) + 1e-12)).toFixed(1));
    // the voices only add (acid / rendered): before the master's tanh clip, the chord = the three notes alone, each at 1/√3, sample for sample
    const un = x => Math.atanh(Math.max(-0.999999, Math.min(0.999999, x)));
    let diff = 0; for (let i = 0; i < ch.L.length; i++) diff = Math.max(diff, Math.abs(un(ch.L[i]) - (un(ones[0].L[i]) + un(ones[1].L[i]) + un(ones[2].L[i])) / Math.sqrt(3)));
    out[sound] = {bad: ones.reduce((x, o) => x + o.bad, ch.bad), onsets: ones.map(o => o.first), onsetChord: ch.first, pk1: +ones[0].pk.toFixed(3), pkChord: +ch.pk.toFixed(3),
      ratio, vsRoot, sumDiff: +diff.toExponential(2), notes: ch.step.notes};
  }
  return out;
});
for (const [k, v] of Object.entries(E)){
  ok(v.bad === 0, `${k}: chord renders finite (${JSON.stringify(v)})`);
  ok(v.onsets[0] > 0 && v.onsetChord <= Math.min(...v.onsets) + 1 && v.onsetChord >= Math.min(...v.onsets) - 6, `${k}: chord onset on the notes' own sample (${v.onsetChord} vs alone ${v.onsets})`);
  // Coil (pump, poly in the wasm): E♭ and G show up in the chord and not in the root alone. Acid / Modal: the exact-sum check below
  // proves every note plays (each note alone is not silent: its onset); their bins overlap too much for an energy test
  if (k === 'Coil · Spring harp') ok(v.vsRoot[1] > 4 && v.vsRoot[2] > 4, `${k}: E♭ and G sound in the chord, not in the root alone (×${v.vsRoot[1]}, ×${v.vsRoot[2]})`);
  if (k !== 'Coil · Spring harp') ok(v.sumDiff < 1e-5, `${k}: chord = the 3 notes alone mixed at 1/√3, sample-exact (max diff ${v.sumDiff})`);
  ok(v.pkChord < Math.max(1.0, v.pk1 * 2), `${k}: chord level sane (peak ${v.pkChord} vs ${v.pk1})`);
  ok(JSON.stringify(v.notes) === '[48,51,55]', `${k}: compiled notes ${JSON.stringify(v.notes)}`);
}

/* ---- CV: root only (compile + the pitch output) ---- */
const CV = await p.evaluate(async () => {
  const {compile} = await import('/js/engine/engine.js'), {newTrack} = await import('/js/store.js');
  const s = structuredClone(window.spores.store.get()); const t = newTrack('cv'); t.oct = 3; s.tracks.push(t); s.key = 'C'; s.scale = 'minor';
  s.tracks.forEach(x => x.mute = x.type !== 'cv');
  const k = Object.keys(s.scenes)[0]; s.scenes[k].steps[t.id] = [{on: true, deg: 2, vel: 100, chance: 100, chord: [2, 4]}];
  const c = compile(s), st = c.scenes[k].steps[s.tracks.length - 1][0];
  const sr = 48000, ctx = new OfflineAudioContext(6, sr * 0.5, sr); ctx.destination.channelInterpretation = 'discrete';
  await ctx.audioWorklet.addModule('/js/engine/worklet.js');
  const n = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, 32], processorOptions: {song: c, play: {mode: 'scene', scene: k}}});
  n.connect(ctx.destination, 1); const B = await ctx.startRendering();
  return {notes: st.notes || null, note: st.note, cv: st.cv, pitch: +B.getChannelData(2)[Math.round(0.1 * sr)].toFixed(4)};
});
ok(CV.notes === null && CV.note === 51 && Math.abs(CV.pitch - CV.cv) < 1e-4 && Math.abs(CV.pitch - 0.025) < 1e-4, `CV plays the chord's root only (${JSON.stringify(CV)})`);

/* ---- store: migration and cleaning ---- */
const M = await p.evaluate(async () => {
  const {migrate, VERSION} = await import('/js/store.js');
  const old = {v: 4, bpm: 100, key: 'D', scale: 'major', tracks: [{id: 'a', type: 'synth', sound: 'Acid bass', fx: []}],
    scenes: {A: {name: 'A', bars: 1, steps: {a: [{on: true, deg: 3, vel: 90, chance: 100}, null, {on: false, deg: 1, vel: 100, chance: 100}]}}}, song: [{scene: 'A', repeat: 1}]};
  const before = JSON.stringify(old.scenes.A.steps), m = migrate(structuredClone(old));
  const bad = migrate({v: 5, tracks: [{id: 'a', type: 'synth', sound: 'Acid bass'}], scenes: {A: {name: 'A', bars: 1, steps: {a: [
    {on: true, deg: 0, chord: [4, 2, 2, 'x', NaN, 0, -3, 99, 7, 9]}, {on: true, deg: 0, chord: 'nope'}, {on: true, deg: 0, chord: []}]}}}, song: []});
  return {VERSION, v: m.v, same: JSON.stringify(m.scenes.A.steps) === before, bad: bad.scenes.A.steps.a.map(x => x.chord === undefined ? 'none' : x.chord)};
});
ok(M.VERSION === 5 && M.v === 5 && M.same, `an old v4 song opens as v5 with its steps unchanged (${JSON.stringify(M)})`);
ok(JSON.stringify(M.bad) === '[[2,4,7],"none","none"]', `bad chords are cleaned: ${JSON.stringify(M.bad)}`);

/* ---- MIDI: a 3-note chord on a MIDI track while really playing ---- */
await p.evaluate(() => window.spores.store.edit('test', s => {
  s.key = 'C'; s.scale = 'minor'; s.link.seedsPort = ''; s.bpm = 120;
  const t = s.tracks[7]; t.type = 'midi'; t.midi = {port: 'iac', ch: 2, clock: false}; t.oct = 3;
  for (const k of Object.keys(s.scenes)) s.scenes[k].steps[t.id] = [{on: true, deg: 0, vel: 90, chance: 100, chord: [2, 4]}];
}));
await p.evaluate(() => { window.__sent.length = 0; return window.spores.engine.play('scene', Object.keys(window.spores.store.get().scenes)[0]); });
await new Promise(r => setTimeout(r, 700));
const MI = await p.evaluate(async () => { window.spores.engine.stop(); await new Promise(r => setTimeout(r, 300));
  const on = window.__sent.filter(x => x.d[0] === 0x91), off = window.__sent.filter(x => x.d[0] === 0x81);
  return {on: on.map(x => x.d[1]), off: off.map(x => x.d[1]), onT: on.map(x => x.t), offT: off.map(x => x.t)}; });
ok(JSON.stringify(MI.on.slice(0, 3)) === '[48,51,55]' && MI.onT.slice(0, 3).every(t => t === MI.onT[0]), `MIDI: 3 note-ons together (${JSON.stringify(MI.on)})`);
ok(JSON.stringify(MI.off.slice(0, 3)) === '[48,51,55]' && MI.offT.slice(0, 3).every(t => t === MI.offT[0]) && MI.offT[0] > MI.onT[0], `MIDI: 3 matching note-offs (${JSON.stringify(MI.off)})`);

/* ---- export: a chord song renders through render.js (the File › Export path), rendered notes included ---- */
const X = await p.evaluate(async () => {
  const {renderAudio} = await import('/js/engine/render.js');
  const s = structuredClone(window.spores.store.get()); s.tracks[7].type = 'synth'; s.tracks[7].sound = 'Modal · Marimba'; s.tracks[7].params = {};
  s.tracks.forEach((t, i) => { t.mute = i !== 7; }); for (const sc of Object.values(s.scenes)) sc.mute = {}, sc.solo = {};
  s.tracks.forEach((t, i) => { if (i !== 7) for (const sc of Object.values(s.scenes)) sc.mute[t.id] = true; });
  const k = Object.keys(s.scenes)[0]; s.song = [{scene: k, repeat: 1}];
  const one = structuredClone(s); for (const sc of Object.values(one.scenes)) for (const st of sc.steps[s.tracks[7].id] || []) if (st) delete st.chord;
  const rA = await renderAudio(s, {what: 'scene', scene: k}), rB = await renderAudio(one, {what: 'scene', scene: k});
  const stat = r => { let bad = 0, e = 0; for (const x of r.mix[0]){ if (!isFinite(x)) bad++; e += x * x; } return {bad, e}; };
  return {a: stat(rA), b: stat(rB)};
});
// each of 3 notes at 1/√3: about the root's energy if all 3 notes were recorded for the export; 1/3 of it if only the root was
ok(X.a.bad === 0 && X.a.e > X.b.e * 0.7 && X.a.e < X.b.e * 1.5, `Export: a Modal chord renders finite with all its notes (energy ${X.a.e.toFixed(1)} vs the root alone ${X.b.e.toFixed(1)})`);

/* ---- UI ---- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
p.on('dialog', d => d.accept().catch(() => {}));   // (leaving a changed song asks first)
await p.setViewport({width: 1440, height: 900});
await p.goto(URL, {waitUntil: 'load'}); await sleep(1200);
await p.evaluate(() => { const e = window.spores.engine, h = e.hit.bind(e); window.hits = []; e.hit = (ti, deg, vel, chord) => { window.hits.push({ti, deg, chord}); return h(ti, deg, vel, chord); }; });
const song = () => p.evaluate(() => window.spores.store.get());
const bass = await p.evaluate(() => window.spores.store.get().tracks.findIndex(t => t.sound === 'Acid bass'));
const SK = await p.evaluate(() => Object.keys(window.spores.store.get().scenes)[0]);
const step = async i => { const s = await song(); return (s.scenes[SK].steps[s.tracks[bass].id] || [])[i]; };
await p.evaluate(() => window.spores.store.edit('x', d => { d.key = 'C'; d.scale = 'minor'; for (const l of Object.values(d.scenes.A.steps)) if (l) l.forEach(x => x && (x.on = false)); }));
const cell = async i => { const h = await p.evaluateHandle((ti, i) => document.querySelectorAll('.srow')[ti].querySelectorAll('.cell')[i], bass, i);
  await h.evaluate(e => e.scrollIntoView({block: 'center', inline: 'center'})); const r = await h.boundingBox(); return {x: r.x + r.width / 2, y: r.y + r.height / 2, h}; };
const I = 2;
let c = await cell(I); await p.mouse.click(c.x, c.y); await sleep(150);   // on
await p.mouse.click(c.x, c.y, {button: 'right'}); await sleep(200);        // select
const undoDepth = () => p.evaluate(() => window.spores.store.canUndo);
ok(!!(await p.$('select[aria-label="Chord"]')), 'the step panel has a Chord picker');
const opts = await p.$$eval('select[aria-label="Chord"] option', os => os.map(o => o.value));
ok(opts[0] === 'none' && opts.includes('triad') && opts.includes('seventh') && opts.includes('sus4'), 'Chord choices: ' + opts.join(', '));
let n = await p.evaluate(() => window.hits.length);
await p.select('select[aria-label="Chord"]', 'triad'); await sleep(200);
let st = await step(I);
ok(JSON.stringify(st.chord) === '[2,4]' && st.deg === 0, 'Triad sets the chord [2,4] on the root: ' + JSON.stringify(st));
const h1 = await p.evaluate(() => window.hits[window.hits.length - 1]);
ok(await p.evaluate(() => window.hits.length) === n + 1 && JSON.stringify(h1.chord) === '[2,4]', 'picking it previews the whole chord ' + JSON.stringify(h1));
const cellInfo = () => p.evaluate((ti, i) => { const b = document.querySelectorAll('.srow')[ti].querySelectorAll('.cell')[i]; return {chord: b.classList.contains('chord'), text: b.textContent, n1: b.style.getPropertyValue('--n1'), n2: b.style.getPropertyValue('--n2')}; }, bass, I);
let ci = await cellInfo();
ok(ci.chord && ci.text === 'Cm' && ci.n1 && ci.n2 && ci.n1 !== ci.n2, 'the grid cell shows the chord (Cm, a stripe of its notes): ' + JSON.stringify(ci));
const dots = () => p.evaluate(i => document.querySelectorAll('.mlane .mcell')[i].querySelectorAll('.mdot').length, I);
ok(await dots() === 2, 'the melody lane shows the chord\'s 2 other notes');
ok((await p.$eval('.chordname', e => e.textContent)).startsWith('Cm · C2 E♭2 G2'), 'the panel names the chord: ' + await p.$eval('.chordname', e => e.textContent));
await p.evaluate(() => window.spores.store.undo()); await sleep(150);
st = await step(I);
ok(st.on && st.chord === undefined && st.deg === 0, 'ONE undo takes the chord off, the note stays: ' + JSON.stringify(st));
await p.evaluate(() => window.spores.store.redo()); await sleep(150);
ok(JSON.stringify((await step(I)).chord) === '[2,4]', 'redo puts it back');

// Shift-click in the melody lane at deg 6's height adds B♭; at deg 4's removes G
const laneY = async d => p.evaluate((i, d) => { const b = document.querySelectorAll('.mlane .mcell')[i]; b.scrollIntoView({block: 'nearest', inline: 'center'});
  const r = b.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.bottom - 15 - 8 - (d / 7) * 52}; }, I, d);
let y = await laneY(6); n = await p.evaluate(() => window.hits.length);
await p.keyboard.down('Shift'); await p.mouse.click(y.x, y.y); await p.keyboard.up('Shift'); await sleep(150);
ok(JSON.stringify((await step(I)).chord) === '[2,4,6]', 'Shift-click adds a note at that height: ' + JSON.stringify((await step(I)).chord));
ok(await p.evaluate(() => window.hits.length) === n + 1 && JSON.stringify((await p.evaluate(() => window.hits[window.hits.length - 1])).chord) === '[2,4,6]', 'and previews the new chord');
y = await laneY(4); await p.keyboard.down('Shift'); await p.mouse.click(y.x, y.y); await p.keyboard.up('Shift'); await sleep(150);
ok(JSON.stringify((await step(I)).chord) === '[2,6]', 'Shift-click on a chord note removes it: ' + JSON.stringify((await step(I)).chord));
ok(await p.$eval('select[aria-label="Chord"]', e => e.value) === 'custom', 'the picker then says "Your own notes"');
await p.evaluate(() => window.spores.store.undo()); await sleep(150);
ok(JSON.stringify((await step(I)).chord) === '[2,4,6]', 'one undo per Shift-click');

// arrows and drag move the whole chord
await p.evaluate(() => document.activeElement && document.activeElement.blur());
await p.keyboard.press('ArrowUp'); await sleep(150);
st = await step(I);
ok(st.deg === 1 && JSON.stringify(st.chord) === '[2,4,6]', '↑ moves the whole chord: ' + JSON.stringify(st));
c = await cell(I); await p.mouse.move(c.x, c.y); await p.mouse.down();
for (let k = 1; k <= 3; k++){ await p.mouse.move(c.x, c.y - k * 14 - 2); await sleep(30); }
await p.mouse.up(); await sleep(150);
st = await step(I);
ok(st.deg === 4 && JSON.stringify(st.chord) === '[2,4,6]', 'a drag up 3 moves the whole chord: ' + JSON.stringify(st));
const hd = await p.evaluate(() => window.hits[window.hits.length - 1]);
ok(JSON.stringify(hd.chord) === '[2,4,6]', 'and previews the chord as it goes');

// None takes it off (one Undo)
await p.select('select[aria-label="Chord"]', 'none'); await sleep(150);
ok((await step(I)).chord === undefined, 'None makes it one note again');
await p.evaluate(() => window.spores.store.undo()); await sleep(150);

// copy / paste keeps chords (Paste steps path: a clone of the lane), save / load round trip through a .spores zip
const RT = await p.evaluate(async (bass) => {
  const {zipWrite, zipRead} = await import('/js/zip.js'); const store = window.spores.store;
  const bytes = zipWrite([{name: 'song.json', bytes: new TextEncoder().encode(store.serialize())}]);
  const want = JSON.stringify(store.get().scenes.A.steps[store.get().tracks[bass].id]);
  store.edit('wipe', d => { d.scenes.A.steps[d.tracks[bass].id] = []; });
  const f = zipRead(bytes).find(x => x.name === 'song.json'), ok = store.load(JSON.parse(new TextDecoder().decode(f.bytes)));
  return {ok, same: JSON.stringify(store.get().scenes.A.steps[store.get().tracks[bass].id]) === want, v: store.get().v};
}, bass);
ok(RT.ok && RT.same && RT.v === 5, 'save / load (.spores zip) keeps the chord: ' + JSON.stringify(RT));

// CV: the help text says root only
await p.evaluate(b => window.spores.store.edit('x', d => { d.tracks[b].type = 'cv'; }), bass); await sleep(200);
c = await cell(I); await p.mouse.click(c.x, c.y, {button: 'right'}); await sleep(200);
ok(/plays only the lowest note/.test(await p.$eval('.chordsec', e => e.textContent)), 'a CV track\'s chord help says only the lowest note plays');
await p.screenshot({path: '/tmp/chord-ui.png'});
ok(!errs.length, 'no page errors ' + JSON.stringify(errs));
console.log(fails ? `${fails} FAILED` : 'all ok');
await b.close(); process.exit(fails ? 1 : 0);
