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
 *   eng.on('tlevels', lv => …) // ~60/s while anything sounds: {trackId: peak 0..1+} of what each track adds to the mix
 *   eng.toPerf(contextTime) // → performance.now() time of the moment it is heard
 * Audio tracks: loop takes play from scene.clips (their samples come from js/audiostore.js, sent to the worklet by
 * transfer); recording, the input, the level meter and the latency test are in recorder.js (API: docs/NOTES.md).
 */
import {degToMidi} from '../scale.js';
import {stepMidi} from '../chord.js';
import {resolve, ENGINES} from './sounds.js';
import {cvValue, gateValue, DEFAULT_FS, CV_CHANNELS} from './cv.js';
import {createRecorder} from './recorder.js';
import {getClip} from '../audiostore.js';
import {clipIds} from '../store.js';
import {songMap} from '../songmap.js';
import {isFxType, MAX_FX} from './fx.js';

export const STEPS_PER_BAR = 16;

/* opts.fs: CV full-scale volts on this computer (cv.js). */
export function compile(song, opts = {}){
  const fs = opts.fs || DEFAULT_FS;
  const tracks = song.tracks.map(t => {
    const o = {id: t.id, type: t.type, vol: t.vol ?? 0.8, mute: false, solo: false, len: song.mode === 'more' ? (t.len | 0) : 0};
    if (t.type === 'drum' || t.type === 'synth'){
      const r = resolve(t.sound, t.params);
      o.engine = r.engine; o.vals = r.vals; o.rendered = !!ENGINES[r.engine].rendered; if (r.note != null) o.drumNote = r.note;
    }
    if (t.type === 'audio' && t.span === 'song'){   // song-length take (songtape.js)
      o.span = 'song'; const k = t.take;
      o.take = k && k.id ? {id: k.id, sr: k.sr || 48000, bpm: k.bpm || 120, startBar: Math.max(0, k.startBar | 0), gain: k.gain ?? 1,
        fadeIn: k.fadeIn || 0, fadeOut: k.fadeOut || 0, trimStart: k.trimStart || 0, trimEnd: k.trimEnd || 0} : null;
    }
    // track effects (fx.js / fxhost.js): drum, synth and audio tracks only (MIDI and CV make no sound here)
    if ((t.type === 'drum' || t.type === 'synth' || t.type === 'audio') && Array.isArray(t.fx))
      o.fx = t.fx.filter(f => f && isFxType(f.type)).slice(0, MAX_FX).map((f, i) => ({id: String(f.id || i), type: f.type, on: f.on !== false, p: Object.assign({}, f.p)}));
    if (t.type === 'cv'){ const cv = t.cv || {}; o.cvPitch = (cv.pitch | 0) - 1; o.cvGate = (cv.gate | 0) - 1; o.gateV = gateValue(fs); }
    return o;
  });
  const scenes = {};
  for (const [k, sc] of Object.entries(song.scenes || {})){
    const len = Math.max(1, Math.min(4, sc.bars | 0 || 1)) * STEPS_PER_BAR;
    // mute / solo per scene (store.js v4); a track-wide flag (older in-memory songs, tests) counts in every scene
    scenes[k] = {len, mute: song.tracks.map(t => !!((sc.mute && sc.mute[t.id]) || t.mute)), solo: song.tracks.map(t => !!((sc.solo && sc.solo[t.id]) || t.solo)), steps: song.tracks.map((t, ti) => {
      const lane = (sc.steps && sc.steps[t.id]) || [], out = new Array(len).fill(null);
      if (t.type === 'audio') return out;   // an audio track plays its take, not steps
      for (let i = 0; i < len; i++){
        const st = lane[i]; if (!st || !st.on) continue;
        out[i] = {note: t.type === 'drum' ? (t.seedsNote ?? 36) : degToMidi(st.deg || 0, song.key, song.scale, t.oct ?? 3),
          vel: st.vel ?? 100, chance: song.mode === 'more' ? (st.chance ?? 100) : 100};
        if (t.type === 'cv') out[i].cv = cvValue(out[i].note, t.cv, t.oct ?? 3, fs);   // CV: one pitch output, so a chord plays its root
        else if (t.type !== 'drum' && st.chord){   // a chord (js/chord.js): every note, lowest (= note) first
          const ns = stepMidi(st, song.key, song.scale, t.oct ?? 3);
          if (ns.length > 1){ out[i].notes = ns; tracks[ti].poly = true; }
        }
      }
      return out;
    }), clips: song.tracks.map(t => {
      const c = t.type === 'audio' && t.span !== 'song' && sc.clips && sc.clips[t.id];
      return c && c.id ? {id: c.id, bars: c.bars || 1, sr: c.sr || 48000, gain: c.gain ?? 1, offset: c.offset || 0, pad: c.pad || 0,
        fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0, reverse: !!c.reverse} : null;
    })};
  }
  if (!Object.keys(scenes).length) scenes.A = {len: 16, steps: tracks.map(() => new Array(16).fill(null)), clips: tracks.map(() => null)};
  // blocks in play order; start = the block's first song step (songmap.js: song bars × 16), for song-length takes
  const map = songMap(song);
  const order = map.blocks.map(b => ({scene: b.scene, repeat: b.repeat, loop: b.loop, start: b.startBar * STEPS_PER_BAR}));
  return {bpm: song.bpm || 120, master: typeof song.master === 'number' ? Math.max(0, Math.min(2, song.master)) : 1, loopSong: song.loopSong !== false, swing: song.mode === 'more' ? (song.swing || 0) : 0, tracks, scenes, song: order,
    songSteps: map.totalBars * STEPS_PER_BAR, hasAudio: tracks.some(t => t.type === 'audio')};
}

export async function createEngine(){
  const ctx = new (window.AudioContext || window.webkitAudioContext)({latencyHint: 'interactive'});
  await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
  // output 0: the stereo mix (→ channels 1–2); output 1: CV, straight to the interface's channels, no gain on the way
  // input 0: the recording input (recorder.js connects one mono channel to it)
  const node = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 1, numberOfOutputs: 2, outputChannelCount: [2, CV_CHANNELS],
    channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'discrete'});
  const master = ctx.createGain(); master.gain.value = 0.9;
  master.channelCount = 2; master.channelCountMode = 'explicit';
  const openChannels = () => { const d = ctx.destination; d.channelInterpretation = 'discrete'; try { d.channelCount = Math.max(2, d.maxChannelCount); } catch (e) {} };
  openChannels();
  node.connect(master, 0).connect(ctx.destination);
  node.connect(ctx.destination, 1);
  let cvFs = DEFAULT_FS;

  // the pump instruments' sound code: compiled here, handed to the worklet (it can't fetch). Without it, COIL / ORBIT /
  // FOLD / BOING tracks are silent and everything else plays as usual.
  // (the bytes are sent and compiled there: Chrome refuses a compiled Module posted into a realtime AudioWorklet)
  const sendWasm = (file, t) => fetch(new URL(file, import.meta.url)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(bytes => new Promise(res => {
      const f = e => { if (e.data && e.data.t === t){ node.port.removeEventListener('message', f); res(!!e.data.ok); } };
      node.port.addEventListener('message', f); node.port.postMessage({t, bytes}, [bytes]);
    })).catch(e => { console.warn(file, e); return false; });
  const wasmReady = sendWasm('./pump-synth.wasm', 'wasm');

  // the track effects' sound code (tfx.wasm, from ...Thunder Plus): without it, effects pass the sound through unchanged
  const fxReady = sendWasm('./tfx.wasm', 'tfx');   // true once the worklet has made its two instances

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
      for (const sc of Object.values(c.scenes)) for (const st of sc.steps[ti] || []) if (st){ r.want.add(st.note); if (st.notes) for (const n of st.notes) r.want.add(n); }
    });
    for (const id of [...rec.keys()]) if (!seen.has(id)) rec.delete(id);
    pump();
  }
  const recordNow = (id, note) => new Promise(res => { const r = rec.get(id); if (!r) return res();
    if (r.done.has(note)) return res(); r.want.add(note); (r.waiters.get(note) || r.waiters.set(note, []).get(note)).push(res); pump(); });

  const subs = {step: [], sched: [], start: [], stop: [], level: [], tlevels: [], master: [], rec: [], take: [], input: [], missing: []}, emit = (k, m) => subs[k].forEach(f => { try { f(m); } catch (e) { console.error(e); } });
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

  /* loop takes in the worklet: exactly the ones the song refers to. Each is read from audiostore.js (memory, else
     IndexedDB) and sent as a copy by transfer; a take the song no longer uses is dropped there (Undo sends it again). */
  const sent = new Set();
  function syncClips(s){
    const want = clipIds(s);
    for (const id of [...sent]) if (!want.has(id)){ sent.delete(id); node.port.postMessage({t: 'unclip', id}); }
    for (const id of want) if (!sent.has(id)){
      sent.add(id);
      getClip(id).then(c => {
        if (!sent.has(id)) return;                                   // dropped again meanwhile
        if (!c){ sent.delete(id); emit('missing', {id}); return; }   // not in this browser (a file opened without its audio)
        const data = new Float32Array(c.data);
        node.port.postMessage({t: 'clip', id, data}, [data.buffer]);
      });
    }
  }
  const recorder = createRecorder({ctx, node, master, emit: (k, m) => emit(k, m)});

  node.port.onmessage = e => {
    const m = e.data;
    if (recorder.onMessage(m)) return;
    if (m.t === 'step'){ pending.push(m); emit('sched', m); if (!raf) raf = requestAnimationFrame(tick); }
    else if (m.t === 'start'){ playing = true; emit('start', m); }
    else if (m.t === 'stop'){ playing = false; pending = []; emit('stop', m); }
    else if (m.t === 'tlevels'){ emit('tlevels', m.lv); emit('master', {L: m.mL || 0, R: m.mR || 0}); }   // track meters: {trackId: peak} (trackmeters.js); the master's peaks (song.js)
  };

  const eng = {
    ctx, node, toPerf,
    get playing(){ return playing; },
    on(k, f){ subs[k].push(f); return () => { subs[k] = subs[k].filter(g => g !== f); }; },
    wasmReady, fxReady,
    setSong(s){
      song = s; compiled = compile(s, {fs: cvFs}); node.port.postMessage({t: 'song', song: compiled}); syncClips(s);
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
    // play one track now: a drum hit, or a synth note at a scale step (chord: the step's chord, js/chord.js: all its notes)
    async hit(ti, deg = 0, vel = 100, chord = null){
      if (ctx.state !== 'running') await ctx.resume();
      const t = song && song.tracks[ti]; if (!t) return;
      const notes = t.type === 'drum' ? [t.seedsNote ?? 36] : stepMidi({deg, chord}, song.key, song.scale, t.oct ?? 3), note = notes[0];
      const c = compiled && compiled.tracks[ti];
      if (c && c.rendered){ planRecordings(compiled); for (const n of notes) await recordNow(t.id, n); }   // a Modal / Scanned note not recorded yet
      node.port.postMessage(notes.length > 1 ? {t: 'hit', ti, note, notes, vel, len: 0.25} : {t: 'hit', ti, note, vel, len: 0.25});
      return note;
    },
  };
  // recording (recorder.js): audioInputs, openInput, closeInput, setMonitor, measureLatency, record, stopRecording, …
  Object.defineProperties(eng, Object.getOwnPropertyDescriptors(recorder.api));
  return eng;
}
