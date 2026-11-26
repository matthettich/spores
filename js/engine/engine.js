/* js/engine/engine.js: the page's side of the engine. 🔴 Claude only (see AGENTS.md).
 *
 * Starts the AudioContext and the worklet, compiles the song into what the worklet plays (notes worked out from
 * `deg` with scale.js, so the audio thread never needs to know about keys), and turns the worklet's step messages
 * into a playhead and into MIDI (through midi.js) with the right timestamps.
 *
 *   const eng = await createEngine();      // call from a click (browsers only start audio after one)
 *   eng.setSong(song);  eng.play('scene', 'A');  eng.stop();  eng.hit(trackIndex, deg)
 *   eng.on('step', m => …)  // fires when the step is HEARD (for the playhead): {scene, counter, block, rep, events}
 *   eng.on('sched', m => …) // fires when the step is decided, ~0.1 s early, with context times (for MIDI)
 *   eng.toPerf(contextTime) // → performance.now() time of the moment it is heard
 */
import {degToMidi} from '../scale.js';
import {resolve, ENGINES} from './sounds.js';
import {cvValue, gateValue, DEFAULT_FS, CV_CHANNELS} from './cv.js';

export const STEPS_PER_BAR = 16;

/* opts.fs: CV full-scale volts on this computer (cv.js). */
export function compile(song, opts = {}){
  const fs = opts.fs || DEFAULT_FS;
  const tracks = song.tracks.map(t => {
    const o = {id: t.id, type: t.type, vol: t.vol ?? 0.8, mute: !!t.mute, solo: !!t.solo, len: song.mode === 'more' ? (t.len | 0) : 0};
    if (t.type === 'drum' || t.type === 'synth'){
      const r = resolve(t.sound, t.params);
      o.engine = r.engine; o.vals = r.vals; o.rendered = !!ENGINES[r.engine].rendered; if (r.note != null) o.drumNote = r.note;
    }
    if (t.type === 'cv'){ const cv = t.cv || {}; o.cvPitch = (cv.pitch | 0) - 1; o.cvGate = (cv.gate | 0) - 1; o.gateV = gateValue(fs); }
    return o;
  });
  const scenes = {};
  for (const [k, sc] of Object.entries(song.scenes || {})){
    const len = Math.max(1, Math.min(4, sc.bars | 0 || 1)) * STEPS_PER_BAR;
    scenes[k] = {len, steps: song.tracks.map(t => {
      const lane = (sc.steps && sc.steps[t.id]) || [], out = new Array(len).fill(null);
      for (let i = 0; i < len; i++){
        const st = lane[i]; if (!st || !st.on) continue;
        out[i] = {note: t.type === 'drum' ? (t.seedsNote ?? 36) : degToMidi(st.deg || 0, song.key, song.scale, t.oct ?? 3),
          vel: st.vel ?? 100, chance: song.mode === 'more' ? (st.chance ?? 100) : 100};
        if (t.type === 'cv') out[i].cv = cvValue(out[i].note, t.cv, t.oct ?? 3, fs);
      }
      return out;
    })};
  }
  if (!Object.keys(scenes).length) scenes.A = {len: 16, steps: tracks.map(() => new Array(16).fill(null))};
  const order = (song.song || []).filter(b => scenes[b.scene]).map(b => ({scene: b.scene, repeat: Math.max(1, b.repeat | 0), loop: !!b.loop}));
  return {bpm: song.bpm || 120, swing: song.mode === 'more' ? (song.swing || 0) : 0, tracks, scenes, song: order};
}

export async function createEngine(){
  const ctx = new (window.AudioContext || window.webkitAudioContext)({latencyHint: 'interactive'});
  await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
  // output 0: the stereo mix (→ channels 1–2); output 1: CV, straight to the interface's channels, no gain on the way
  const node = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, numberOfOutputs: 2, outputChannelCount: [2, CV_CHANNELS]});
  const master = ctx.createGain(); master.gain.value = 0.9;
  master.channelCount = 2; master.channelCountMode = 'explicit';
  const openChannels = () => { const d = ctx.destination; d.channelInterpretation = 'discrete'; try { d.channelCount = Math.max(2, d.maxChannelCount); } catch (e) {} };
  openChannels();
  node.connect(master, 0).connect(ctx.destination);
  node.connect(ctx.destination, 1);
  let cvFs = DEFAULT_FS;

  // the pump instruments' sound code: compiled here, handed to the worklet (it can't fetch). Without it, COIL / ORBIT /
  // FOLD / BOING tracks are silent and everything else plays as usual.
  const wasmReady = fetch(new URL('./pump-synth.wasm', import.meta.url)).then(r => r.arrayBuffer()).then(b => WebAssembly.compile(b))
    .then(module => { node.port.postMessage({t: 'wasm', module}); return true; }).catch(e => { console.warn('pump-synth.wasm', e); return false; });

  /* Modal / Scanned: every note a track uses is recorded in a Worker and sent to the worklet. A track's recordings
     are keyed by its settings; when they change, the notes are recorded again (a moment after the last change, so
     dragging a setting doesn't queue hundreds). */
  const worker = new Worker(new URL('./render-worker.js', import.meta.url), {type: 'module'});
  const rec = new Map();   // track id → {key, done:Set(note), want:Set(note), waiters:Map(note → [resolve])}
  let recTimer = 0, compiled = null;
  worker.onmessage = e => {
    const {id, key, note, data} = e.data, r = rec.get(id);
    if (!r || r.key !== key) return;   // settings changed since: dropped
    r.done.add(note); r.busy = false;
    node.port.postMessage({t: 'buf', id, note, data}, [data.buffer]);
    (r.waiters.get(note) || []).forEach(f => f()); r.waiters.delete(note);
    pump();
  };
  function pump(){   // send the next wanted note (one at a time, so the newest settings win)
    for (const [id, r] of rec){
      if (r.busy) return;
      for (const note of r.want) if (!r.done.has(note)){ r.busy = true; worker.postMessage({id, key: r.key, engine: r.engine, vals: r.vals, note, sr: ctx.sampleRate}); return; }
    }
  }
  function planRecordings(c){
    const seen = new Set();
    c.tracks.forEach((t, ti) => {
      if (!t.rendered) return; seen.add(t.id);
      const key = t.engine + JSON.stringify(t.vals); let r = rec.get(t.id);
      if (!r || r.key !== key){ r = {key, engine: t.engine, vals: t.vals, done: new Set(), want: new Set(), waiters: r ? r.waiters : new Map(), busy: false}; rec.set(t.id, r); }
      for (const sc of Object.values(c.scenes)) for (const st of sc.steps[ti] || []) if (st) r.want.add(st.note);
    });
    for (const id of [...rec.keys()]) if (!seen.has(id)) rec.delete(id);
    pump();
  }
  const recordNow = (id, note) => new Promise(res => { const r = rec.get(id); if (!r) return res();
    if (r.done.has(note)) return res(); r.want.add(note); (r.waiters.get(note) || r.waiters.set(note, []).get(note)).push(res); pump(); });

  const subs = {step: [], sched: [], start: [], stop: []}, emit = (k, m) => subs[k].forEach(f => { try { f(m); } catch (e) { console.error(e); } });
  let song = null, pending = [], raf = 0, playing = false;

  /* context time ↔ performance.now(), for the moment a sound comes out of the speakers. getOutputTimestamp() jumps
     by a few ms between calls (it moves in audio blocks), so the offset between the two clocks is tracked by its low edge: MIDI
     timestamps then stay steady instead of jittering by ~5 ms. */
  let off = null, offAt = 0;
  const offset = () => {
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    const o = ts && ts.performanceTime ? ts.performanceTime - ts.contextTime * 1000
      : performance.now() - (ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
    const now = performance.now();
    // the low edge of the jitter, allowed to creep up 0.2 ms a second (clock drift); re-sync after a big jump
    if (off === null || Math.abs(o - off) > 50) off = o; else off = Math.min(o, off + (now - offAt) * 2e-4);
    offAt = now;
    return off;
  };
  const toPerf = t => t * 1000 + offset();
  const heardNow = () => (performance.now() - offset()) / 1000;
  const tick = () => {
    raf = 0; const now = heardNow();
    while (pending.length && pending[0].time <= now) emit('step', pending.shift());
    if (playing || pending.length) raf = requestAnimationFrame(tick);
  };

  node.port.onmessage = e => {
    const m = e.data;
    if (m.t === 'step'){ pending.push(m); emit('sched', m); if (!raf) raf = requestAnimationFrame(tick); }
    else if (m.t === 'start'){ playing = true; emit('start', m); }
    else if (m.t === 'stop'){ playing = false; pending = []; emit('stop', m); }
  };

  return {
    ctx, node, toPerf,
    get playing(){ return playing; },
    on(k, f){ subs[k].push(f); return () => { subs[k] = subs[k].filter(g => g !== f); }; },
    wasmReady,
    setSong(s){
      song = s; compiled = compile(s, {fs: cvFs}); node.port.postMessage({t: 'song', song: compiled});
      clearTimeout(recTimer); recTimer = setTimeout(() => planRecordings(compiled), rec.size ? 150 : 0);
    },
    async play(mode = 'scene', scene = 'A', block = 0){ if (ctx.state !== 'running') await ctx.resume(); node.port.postMessage({t: 'play', mode, scene, block}); },
    stop(){ node.port.postMessage({t: 'stop'}); },
    /* CV and the output device (the interface CV leaves through; the music plays on its channels 1–2) */
    get outputChannels(){ return ctx.destination.maxChannelCount; },
    async setOutputDevice(id){ if (!ctx.setSinkId) return false; try { await ctx.setSinkId(id || ''); } catch (e) { console.warn('setSinkId', e); return false; } openChannels(); return true; },
    setCvScale(fs){ cvFs = +fs > 0 ? +fs : DEFAULT_FS; if (song) this.setSong(song); },
    get cvScale(){ return cvFs; },
    cvHold(ch, value){ node.port.postMessage({t: 'cvtest', ch, value}); },   // ch from 0; value null = let go
    scene(k){ node.port.postMessage({t: 'scene', scene: k}); },
    // play one track now: a drum hit, or a synth note at a scale step
    async hit(ti, deg = 0, vel = 100){
      if (ctx.state !== 'running') await ctx.resume();
      const t = song && song.tracks[ti]; if (!t) return;
      const note = t.type === 'drum' ? (t.seedsNote ?? 36) : degToMidi(deg, song.key, song.scale, t.oct ?? 3);
      const c = compiled && compiled.tracks[ti];
      if (c && c.rendered){ planRecordings(compiled); await recordNow(t.id, note); }   // a Modal / Scanned note not recorded yet
      node.port.postMessage({t: 'hit', ti, note, vel, len: 0.25});
      return note;
    },
  };
}
