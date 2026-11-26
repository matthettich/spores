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

export const STEPS_PER_BAR = 16;

export function compile(song){
  const tracks = song.tracks.map(t => ({id: t.id, type: t.type, sound: t.sound || '', vol: t.vol ?? 0.8,
    mute: !!t.mute, solo: !!t.solo, len: song.mode === 'more' ? (t.len | 0) : 0}));
  const scenes = {};
  for (const [k, sc] of Object.entries(song.scenes || {})){
    const len = Math.max(1, Math.min(4, sc.bars | 0 || 1)) * STEPS_PER_BAR;
    scenes[k] = {len, steps: song.tracks.map(t => {
      const lane = (sc.steps && sc.steps[t.id]) || [], out = new Array(len).fill(null);
      for (let i = 0; i < len; i++){
        const st = lane[i]; if (!st || !st.on) continue;
        out[i] = {note: t.type === 'drum' ? (t.seedsNote ?? 36) : degToMidi(st.deg || 0, song.key, song.scale, t.oct ?? 3),
          vel: st.vel ?? 100, chance: song.mode === 'more' ? (st.chance ?? 100) : 100};
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
  const node = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, outputChannelCount: [2]});
  const master = ctx.createGain(); master.gain.value = 0.9;
  node.connect(master).connect(ctx.destination);

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
    setSong(s){ song = s; node.port.postMessage({t: 'song', song: compile(s)}); },
    async play(mode = 'scene', scene = 'A', block = 0){ if (ctx.state !== 'running') await ctx.resume(); node.port.postMessage({t: 'play', mode, scene, block}); },
    stop(){ node.port.postMessage({t: 'stop'}); },
    scene(k){ node.port.postMessage({t: 'scene', scene: k}); },
    // play one track now: a drum hit, or a synth note at a scale step
    async hit(ti, deg = 0, vel = 100){
      if (ctx.state !== 'running') await ctx.resume();
      const t = song && song.tracks[ti]; if (!t) return;
      const note = t.type === 'drum' ? (t.seedsNote ?? 36) : degToMidi(deg, song.key, song.scale, t.oct ?? 3);
      node.port.postMessage({t: 'hit', ti, note, vel, len: 0.25});
      return note;
    },
  };
}
