/* js/engine/fxhost.js: the track effects inside the engine worklet. 🔴 Claude only.
 *
 * Each drum / synth / audio track may have a chain of up to 4 effects (track.fx, js/engine/fx.js) after its voice or take
 * and before its volume. The effects run in tfx.wasm (...Thunder Plus' track-effects module, copied: tools/copy-fx.sh).
 * One wasm instance holds 32 effects, so two instances are made (16 tracks × 4 = 64). Host code after Thunder Plus'
 * waves/waves-worklet.js effect() and index.html's track-FX worklet (slotRun, slotNap):
 *   - bad samples (NaN, ±8 and over) are zeroed on the way in, with a ±1e-18 anti-denormal; a crash (a wasm trap)
 *     bypasses that effect for good; a runaway output (NaN, over 1e4) passes that block dry and starts it afresh;
 *     typed-array views into wasm memory are remade when the memory grew (also during tfx_process).
 *   - reverbs (Galaxy, Space, Room) run fully wet and are blended with Thunder's rvMix curve, so every Mix feels the same.
 * Spores' own rules:
 *   - On / off crossfades over 5 ms (dry ↔ through the effect); switched on again, it starts afresh (no stale echoes). A removed effect fades out the same way, then is freed.
 *     Reordering dips the track's effects output to silence over one block (2.7 ms) and back, as the order changes.
 *   - Setting changes glide (a one-pole, ~30 ms) except the ones that are choices or counts (fx.js `hard`).
 *   - An effect with silence in and out for 4 s sleeps (not Vinyl: its crackle never stops) until sound comes in.
 *   - Tails: while playing, effects run on (a reverb rings over a scene change or a muted step). After Stop, once a track
 *     has had silence going IN for 3 s, whatever still sounds (a long echo, a frozen grain cloud) fades out over 0.25 s and
 *     its effects are started afresh, so nothing old comes back on the next Play. A sound going in (a tapped step)
 *     cancels that at once.
 *   - Mute / solo / volume are after the effects (a muted track's tail is silent too), smoothed over the block.
 */
import {fxMap, rvMix, MAX_FX} from './fx.js';

const WASI = {wasi_snapshot_preview1: {fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0, proc_exit: () => 0}};
const PER = 32, INSTANCES = 2;
const NAP_S = 4, RING_S = 3, RING_FADE_S = 0.25, XF_S = 0.005, GLIDE_S = 0.03;

export class FxHost {
  constructor(sr){
    this.sr = sr; this.X = []; this.chains = new Map(); this.restart = 0; this.startFrame = 0; this.playing = false;
    this.dL = new Float32Array(128); this.dR = new Float32Array(128); this.bpm = 120; this.failed = false;
    this.glide = 1 - Math.exp(-128 / (GLIDE_S * sr));
  }
  init(module){
    if (this.X.length || this.failed) return this.X.length > 0;
    try {
      for (let k = 0; k < INSTANCES; k++){ const x = new WebAssembly.Instance(module, WASI).exports; if (x._initialize) x._initialize(); this.X.push({x, used: 0, buf: null, L: null, R: null}); }
      return true;
    } catch (e){ this.X = []; this.failed = true; return false; }
  }
  get ready(){ return this.X.length > 0; }
  get count(){ let n = 0; for (const c of this.chains.values()) for (const s of c.slots) if (s.h >= 0) n++; return n; }

  views(I){ const b = I.x.memory.buffer; if (I.buf !== b){ I.buf = b; I.L = new Float32Array(b, I.x.tfx_l(), 128); I.R = new Float32Array(b, I.x.tfx_r(), 128); } }
  pview(s){ const I = s.I, b = I.x.memory.buffer; if (s.pb !== b || s.ph !== s.h){ s.pb = b; s.ph = s.h; s.Pv = new Float32Array(b, I.x.tfx_params(s.h), 12); } return s.Pv; }
  alloc(s){
    s.h = -1; s.I = null;
    if (!this.X.length) return;
    const I = this.X.reduce((a, b) => b.used < a.used ? b : a);   // the emptier instance
    if (I.used >= PER) return;   // all 64 in use: this one passes the sound through
    let h = -1; try { h = I.x.tfx_new(s.id, this.sr); } catch (e){ h = -1; }
    if (h < 0) return;
    s.h = h; s.I = I; I.used++; s.first = true; s.asleep = false; s.quiet = 0;
  }
  free(s){ if (s.I && s.h >= 0){ try { s.I.x.tfx_free(s.h); } catch (e){} s.I.used--; } s.h = -1; s.I = null; }
  fresh(s){ const I = s.I; if (!I || s.h < 0) return; try { I.x.tfx_free(s.h); s.h = I.x.tfx_new(s.id, this.sr); } catch (e){ s.h = -1; } if (s.h < 0){ I.used--; s.I = null; } s.first = true; s.asleep = false; s.quiet = 0; }

  target(s){ const m = fxMap(s.type, s.p, this.sr, this.bpm, this.restart, 0); s.id = m.id; s.tgt = m.P; s.wet = m.wet; s.hard = m.hard; }

  /* tracks: the compiled song's (each {id, type, fx: [{id, type, on, p}]}). Effects are matched by their id. */
  sync(tracks, bpm){
    this.bpm = bpm || 120;
    for (const tr of tracks){
      const list = (tr.type === 'drum' || tr.type === 'synth' || tr.type === 'audio') && Array.isArray(tr.fx) ? tr.fx.slice(0, MAX_FX) : [];
      let c = this.chains.get(tr.id);
      if (!list.length && !c) continue;
      if (!c){ c = {L: new Float32Array(128), R: new Float32Array(128), slots: [], g: -1, dk: 0, next: null, silent: 0, ring: 0, used: false}; this.chains.set(tr.id, c); }
      const cur = c.next || c.slots, old = new Map(cur.filter(s => !s.dying).map(s => [s.key, s])), next = [];
      for (const f of list){
        const key = f.id + ':' + f.type;
        let s = old.get(key);
        if (s) old.delete(key);
        else { s = {key, type: f.type, g: 0, dying: false, h: -1}; s.p = f.p; this.target(s); if (this.X.length) this.alloc(s); }
        s.on = f.on !== false; s.p = f.p; this.target(s);
        next.push(s);
      }
      // removed (or already on their way out): fade out where they stand, then freed (run)
      for (const s of cur) if (!next.includes(s)){ s.dying = true; s.on = false; next.splice(Math.min(cur.indexOf(s), next.length), 0, s); }
      const live = a => a.filter(s => !s.dying).map(s => s.key).join();
      const moved = live(next.filter(s => cur.includes(s))) !== live(cur.filter(s => next.includes(s)));
      if (moved && c.used && c.slots.some(s => s.g > 0)){ c.next = next; if (c.dk === 0) c.dk = 1; }
      else { if (c.next) c.next = next; else c.slots = next; }
    }
    // a track that is gone: its effects go at once (its sound went with it)
    for (const [id, c] of this.chains) if (!tracks.some(t => t.id === id)){ for (const s of new Set([...c.slots, ...(c.next || [])])) this.free(s); this.chains.delete(id); }
  }
  // the wasm arrived after the song: make the effects now
  wake(){ for (const c of this.chains.values()) for (const s of c.next || c.slots) if (s.h < 0 && !s.I && !s.dead) this.alloc(s); }

  start(frame){ this.restart++; this.startFrame = frame; this.playing = true; for (const c of this.chains.values()) for (const s of c.slots) this.target(s); }
  stop(){ this.playing = false; }
  has(id){ const c = this.chains.get(id); return !!c && (c.slots.length > 0 || !!c.next); }
  buffers(id){ return this.chains.get(id); }

  /* run a track's chain on its own buffers (c.L / c.R, n frames, filled by the voices), then add it into L / R at
     `gain` (volume, 0 when muted or soloed out). f0 = the block's first frame (the trance gate's restart). */
  run(id, L, R, n, f0, gain){
    const c = this.chains.get(id); if (!c) return;
    c.used = true;
    const cL = c.L, cR = c.R;
    let ip = 0; for (let i = 0; i < n; i++){ const a = cL[i] < 0 ? -cL[i] : cL[i], b = cR[i] < 0 ? -cR[i] : cR[i]; if (a > ip) ip = a; if (b > ip) ip = b; }
    // after Stop: silence going in for RING_S → fade what is left, then start its effects afresh
    let ringG0 = 1, ringG1 = 1;
    if (ip > 1e-5 || this.playing){ c.silent = 0; c.ring = 0; }
    else {
      c.silent += n;
      if (c.silent > RING_S * this.sr && c.ring >= 0){
        ringG0 = 1 - c.ring / (RING_FADE_S * this.sr); c.ring += n; ringG1 = Math.max(0, 1 - c.ring / (RING_FADE_S * this.sr));
        if (ringG1 <= 0){ for (const s of c.slots) if (s.h >= 0 && !s.asleep) this.fresh(s); c.ring = -1; }   // done: until sound comes in again
      }
    }
    for (const s of c.slots) this.slot(s, cL, cR, n, f0);
    // reorder: down over this block, swap, up over the next
    let d0 = 1, d1 = 1;
    if (c.dk === 1){ d0 = 1; d1 = 0; c.dk = 2; c.swap = true; }
    else if (c.dk === 2){ d0 = 0; d1 = 1; c.dk = 0; }
    if (c.swap){ c.swap = false; c.slots = c.next; c.next = null; }
    // freed once faded out
    if (c.slots.some(s => s.dying && s.g <= 0)) c.slots = c.slots.filter(s => { if (s.dying && s.g <= 0){ this.free(s); return false; } return true; });
    const g0 = c.g < 0 ? gain : c.g, k0 = g0 * d0 * ringG0, dk = (gain * d1 * ringG1 - k0) / n;
    for (let i = 0; i < n; i++){ const k = k0 + dk * i; L[i] += cL[i] * k; R[i] += cR[i] * k; }
    c.g = gain;
    if (!c.slots.length && !c.next) this.chains.delete(id);   // its last effect has faded out: the track plays straight again
  }

  slot(s, L, R, n, f0){
    const tg = s.on ? 1 : 0;
    if (s.h < 0 || !s.I){ s.g = tg; return; }   // no room / crashed / no wasm: the sound passes
    if (!tg && s.g <= 0) return;
    // switched on from fully off: started afresh (what it held is from before; an old echo or grain would jump in)
    if (tg && s.g <= 0 && !s.first){ this.fresh(s); if (s.h < 0){ s.g = tg; return; } }
    let ip = 0; for (let i = 0; i < n; i++){ const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i]; if (a > ip) ip = a; if (b > ip) ip = b; }
    const fade = s.g !== tg;
    if (s.asleep && !fade){ if (ip < 1e-9) return; s.asleep = false; s.quiet = 0; }
    const I = s.I, x = I.x, dL = this.dL, dR = this.dR;
    // settings: glide toward the target, jump for choices; the trance gate restarts on Play, in time with step 1
    const Pv = this.pview(s), t = s.tgt, cur = s.cur || (s.cur = new Float32Array(12)), a = s.first ? 1 : this.glide;
    for (let i = 0; i < 12; i++) cur[i] = s.hard.includes(i) || s.first ? t[i] : cur[i] + (t[i] - cur[i]) * a;
    if (s.type === 'tgate' && s.rs !== this.restart){ s.rs = this.restart; cur[7] = Math.max(0, Math.min(1, (this.startFrame - f0) / this.sr)); }
    Pv.set(cur);
    const mix0 = s.mix ?? cur[s.wet], mix = s.wet >= 0 ? cur[s.wet] : 0; if (s.wet >= 0){ Pv[s.wet] = 1; s.mix = mix; }
    s.first = false;
    this.views(I);
    // switching: the effect's input fades with it too, so no step goes into its delay lines (an echo of it would click later)
    const G = this.G || (this.G = new Float32Array(128)), dg = 1 / (XF_S * this.sr);
    let g = s.g; for (let i = 0; i < n; i++){ if (fade) g = tg ? Math.min(1, g + dg) : Math.max(0, g - dg); G[i] = g; }
    for (let i = 0; i < n; i++){ const p = L[i], q = R[i], dn = i & 1 ? 1e-18 : -1e-18, k = G[i]; dL[i] = p; dR[i] = q; I.L[i] = (p > -8 && p < 8 ? p * k : 0) + dn; I.R[i] = (q > -8 && q < 8 ? q * k : 0) + dn; }
    try { x.tfx_process(s.h, n); }
    catch (e){ this.free(s); s.dead = true; return; }   // crashed: bypassed from now on (the sound passes: L / R untouched)
    this.views(I);   // the memory may have grown inside tfx_process
    const oL = I.L, oR = I.R;
    let bad = false, op = 0;
    for (let i = 0; i < n; i++){ const p = oL[i], q = oR[i]; if (!(p > -1e4 && p < 1e4 && q > -1e4 && q < 1e4)){ bad = true; break; } const u = p < 0 ? -p : p, v = q < 0 ? -q : q; if (u > op) op = u; if (v > op) op = v; }
    if (bad){ this.fresh(s); return; }   // its state went bad: this block passes dry, it starts afresh
    if (s.wet >= 0){
      const [a0, b0] = rvMix(mix0), [a1, b1] = rvMix(mix);
      for (let i = 0; i < n; i++){
        const f = i / n, dry = a0 + (a1 - a0) * f, w = b0 + (b1 - b0) * f, k = G[i];
        const yl = dL[i] * dry + oL[i] * w, yr = dR[i] * dry + oR[i] * w;
        L[i] = dL[i] + (yl - dL[i]) * k; R[i] = dR[i] + (yr - dR[i]) * k;
      }
    } else if (fade || g < 1){
      for (let i = 0; i < n; i++){ const k = G[i]; L[i] = dL[i] + (oL[i] - dL[i]) * k; R[i] = dR[i] + (oR[i] - dR[i]) * k; }
    } else { L.set(oL.subarray(0, n)); R.set(oR.subarray(0, n)); }
    s.g = g;
    // nap: silence in and out for NAP_S (Vinyl crackles by itself: never)
    if (s.type !== 'vinyl' && ip < 1e-9 && op < 1e-9){ if ((s.quiet += n) >= NAP_S * this.sr) s.asleep = true; } else s.quiet = 0;
  }
}
