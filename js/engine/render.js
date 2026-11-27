/* js/engine/render.js: Export's offline render (page side). 🔴 Claude only. The worklet side is bounce.js.
 *
 * The same worklet, voices, effects and recorded takes as live, in an OfflineAudioContext at 48 kHz: faster than real
 * time, the same sound (no clicks from a busy computer), with the effects' tails.
 *
 *   const r = await renderAudio(song, {what, scene, repeats, onProgress, cancelled})
 *     what 'song'   the arrangement once from the first block (a Loop-forever block plays its repeats once, as the Song
 *                   screen draws it; the blocks after it follow)
 *          'scene'  scene `scene` × `repeats` (song-length takes are silent here, as they are when a scene plays)
 *          'stems'  the song as for 'song', one stereo file per track that makes sound + the mix. MIDI / CV tracks,
 *                   muted tracks and tracks that stay silent are left out; Solo is ignored (every track counts, so the
 *                   stems add up to the mix). A stem is the track after its effects and volume, before the master clip.
 *     → {sr, mix: [L, R], stems: [{id, name, data: [L, R]}], end, length, tailCut, missing}   (null if cancelled)
 *       end = the song's last sample + 1 (where the tail starts), length = end + the tail; the tail stops where the sound
 *       falls below −90 dB, at most TAIL_S after the end (faded over the last 0.25 s if it is still sounding then).
 *       missing = takes the song refers to that have no samples here (they are silent).
 *     onProgress(0…1) as the render goes; cancelled() is asked about once a second of audio: true → stops, returns null.
 * Like live: master = tanh (in the worklet) × 0.9 (the page's master gain); the first step on sample 0.
 * Stems go 4 tracks (8 channels) to a pass, so a long song doesn't need one huge buffer; every pass plays the whole song
 * (all tracks, so chance rolls come out the same in every pass), keeping only its tracks.
 */
import {compile} from './engine.js';
import {ENGINES} from './sounds.js';
import {getClip} from '../audiostore.js';
import {clipIds} from '../store.js';

export const SR = 48000;
export const TAIL_S = 10;
const LEAD = 0.06;        // worklet.js START_DELAY: the first step's sample in the render (trimmed off)
const QUIET_S = 2;        // a tail ends after this long below the threshold
const THR_DB = -90;
const MASTER = 0.9;       // engine.js master gain
const PER_PASS = 4;       // stems per render pass
const FADE_S = 0.25;

const wasmCache = {};
const wasm = file => wasmCache[file] || (wasmCache[file] = fetch(new URL(file, import.meta.url))
  .then(r => { if (!r.ok) throw new Error(file + ' ' + r.status); return r.arrayBuffer(); }).then(b => WebAssembly.compile(b))
  .catch(e => { delete wasmCache[file]; console.warn(file, e); return null; }));

// Modal / Scanned tracks: each note they use, recorded in render-worker.js at 48 kHz
async function renderedNotes(c){
  const want = [];
  c.tracks.forEach((t, ti) => {
    if (!t.rendered) return;
    const notes = new Set();
    for (const sc of Object.values(c.scenes)) for (const st of sc.steps[ti] || []) if (st) for (const n of st.notes || [st.note]) notes.add(n);   // a chord: every note
    for (const note of notes) want.push({id: t.id, engine: t.engine, vals: t.vals, note});
  });
  if (!want.length) return [];
  const w = new Worker(new URL('./render-worker.js', import.meta.url), {type: 'module'});
  try {
    const out = [];
    for (const x of want) out.push(await new Promise(res => { w.onmessage = e => res({id: x.id, note: x.note, data: e.data.data}); w.postMessage(Object.assign({key: 'x', sr: SR}, x)); }));
    return out;
  } finally { w.terminate(); }
}

/* one render pass. opts: {song (compiled), play, steps, stems?, clips, bufs, pump, tfx, maxFrames, onFrames, cancelled}
   → {chunks: [[Float32Array per channel]], end, last} or null (cancelled) */
async function pass(o){
  const chans = o.stems ? o.stems.length * 2 : 2, lead = Math.round(LEAD * SR);
  const frames = lead + o.maxFrames + Math.round((TAIL_S + QUIET_S + 1) * SR);
  const ctx = new OfflineAudioContext(1, frames, SR);
  await ctx.audioWorklet.addModule(new URL('./worklet.js', import.meta.url));
  const bounce = {steps: o.steps, stems: o.stems || null, frames, thr: Math.pow(10, THR_DB / 20) / MASTER, quietS: QUIET_S, tailS: TAIL_S};
  // (the takes are copied: the worklet keeps what it is given)
  const node = new AudioWorkletNode(ctx, 'spores-engine', {numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [chans],
    processorOptions: {song: o.song, play: o.play, clips: o.clips.map(c => ({id: c.id, data: c.data.slice()})), bufs: o.bufs.map(b => ({id: b.id, note: b.note, data: b.data.slice()})),
      wasm: o.pump || undefined, tfx: o.tfx || undefined, bounce}});
  node.connect(ctx.destination);
  const chunks = []; let got = 0, fin = null, halted = false;
  const finished = new Promise(res => { node.port.onmessage = e => {
    const m = e.data; if (!m || m.t !== 'bounce') return;
    if (m.chunk){ chunks.push(m.chunk); got = m.at + m.chunk[0].length; o.onFrames(got); }
    else { fin = m; res(m); }
  }; });
  // once a second of audio: a chance to Cancel (the worklet hears messages only while the render is suspended)
  for (let t = 1; t * SR < frames - 256; t++) ctx.suspend(t).then(async () => {
    if (!halted && !fin && o.cancelled()){
      halted = true; node.port.postMessage({t: 'halt'});
      await Promise.race([finished, new Promise(r => setTimeout(r, 500))]);
    }
    ctx.resume();
  });
  await ctx.startRendering();
  await Promise.race([finished, new Promise(r => setTimeout(r, 2000))]);
  node.port.onmessage = null;
  if (halted || !fin || fin.state !== 'done') return null;
  return {chunks, end: fin.end, last: fin.last};
}

// the chunks of one pass → one Float32Array per channel, `len` frames (silence past what was rendered)
function join(chunks, chans, len){
  const out = Array.from({length: chans}, () => new Float32Array(len));
  let at = 0;
  for (const ch of chunks){ for (let c = 0; c < chans; c++) out[c].set(ch[c].subarray(0, Math.max(0, len - at)), at); at += ch[0].length; if (at >= len) break; }
  return out;
}

export async function renderAudio(song0, {what = 'song', scene, repeats = 1, onProgress = () => {}, cancelled = () => false} = {}){
  const s = structuredClone(song0);
  s.song = (s.song || []).map(b => Object.assign({}, b, {loop: false}));   // the arrangement once
  if (what === 'stems'){ for (const sc of Object.values(s.scenes)) sc.solo = {}; s.tracks.forEach(t => { t.solo = false; }); }   // stems: every track as itself
  const c = compile(s), stepLen = SR * 15 / Math.max(20, Math.min(300, c.bpm));
  let play, steps;
  if (what === 'scene'){
    const k = c.scenes[scene] ? scene : Object.keys(c.scenes)[0];
    play = {mode: 'scene', scene: k}; steps = c.scenes[k].len * Math.max(1, Math.min(64, repeats | 0));
  } else {
    if (!c.song.length || !c.songSteps) throw new Error('The song has no blocks yet: add some on the Song screen.');
    play = {mode: 'song', block: 0}; steps = c.songSteps;
  }
  const maxFrames = Math.ceil(steps * stepLen);
  // what the worklet needs: takes, recorded notes, the wasm modules (only when used)
  const ids = [...clipIds(s)], clips = [], missing = [];
  for (const id of ids){ const k = await getClip(id); if (k && k.data) clips.push({id, data: k.data}); else missing.push(id); }
  const usesPump = c.tracks.some(t => t.engine && ENGINES[t.engine] && ENGINES[t.engine].pump);
  const usesFx = c.tracks.some(t => t.fx && t.fx.length);
  const [bufs, pump, tfx] = await Promise.all([renderedNotes(c), usesPump ? wasm('./pump-synth.wasm') : null, usesFx ? wasm('./tfx.wasm') : null]);
  if (cancelled()) return null;

  const sound = t => t.type === 'drum' || t.type === 'synth' || t.type === 'audio';
  // a track muted in every scene the export plays makes no stem (one muted in some scenes plays in the others)
  const used = [...new Set(what === 'scene' ? [play.scene] : c.song.map(b => b.scene))].filter(k => c.scenes[k]);
  const stemTracks = what === 'stems' ? s.tracks.filter((t, i) => sound(t) && !used.every(k => c.scenes[k].mute[i])) : null;
  const groups = stemTracks ? Array.from({length: Math.ceil(stemTracks.length / PER_PASS)}, (_, g) => stemTracks.slice(g * PER_PASS, (g + 1) * PER_PASS)) : [null];
  if (stemTracks && !stemTracks.length) throw new Error('No track makes a sound to export (MIDI, CV and muted tracks are left out).');
  const expect = maxFrames + SR;   // (progress: the tail is a guess)
  const runs = [];
  for (let g = 0; g < groups.length; g++){
    const r = await pass({song: c, play, steps, stems: groups[g] && groups[g].map(t => t.id), clips, bufs, pump, tfx, maxFrames, cancelled,
      onFrames: f => onProgress(Math.min(0.99, (g + Math.min(1, f / expect)) / groups.length))});
    if (!r) return null;
    runs.push(r);
  }
  // the length: the song's end + the tail (the longest of the passes'), faded if it was still sounding at TAIL_S
  const end = runs[0].end, tailEnd = Math.max(end, ...runs.map(r => r.last + 1));
  const length = Math.min(tailEnd, end + TAIL_S * SR), cut = tailEnd > end + (TAIL_S - 0.5) * SR;
  const finish = arr => { for (const a of arr){ for (let i = 0; i < a.length; i++) a[i] *= MASTER;
    if (cut){ const f = Math.min(a.length, Math.round(FADE_S * SR)); for (let i = 0; i < f; i++) a[a.length - 1 - i] *= i / f; } } return arr; };
  const out = {sr: SR, end, length, tailCut: cut, missing, stems: [], mix: null};
  if (!stemTracks){ out.mix = finish(join(runs[0].chunks, 2, length)); onProgress(1); return out; }
  const mL = new Float32Array(length), mR = new Float32Array(length);
  groups.forEach((grp, g) => {
    const ch = join(runs[g].chunks, grp.length * 2, length);
    grp.forEach((t, k) => {
      const L = ch[2 * k], R = ch[2 * k + 1];
      let pk = 0; for (let i = 0; i < length; i++){ mL[i] += L[i]; mR[i] += R[i]; const a = Math.abs(L[i]) + Math.abs(R[i]); if (a > pk) pk = a; }
      if (pk > 0) out.stems.push({id: t.id, name: t.name || t.id, index: s.tracks.indexOf(t), data: finish([L, R])});
    });
  });
  for (let i = 0; i < length; i++){ mL[i] = Math.tanh(mL[i]); mR[i] = Math.tanh(mR[i]); }   // the worklet's master clip
  out.mix = finish([mL, mR]);
  onProgress(1);
  return out;
}
