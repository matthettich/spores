/* js/engine/pump.js: the pump instruments (COIL, ORBIT, FOLD, BOING) played live inside the engine worklet.
 * 🔴 Claude only. One pump-synth.wasm instance per audio thread; each track is a handle in it (psyn_new), played with
 * MIDI note on / off at the exact sample in the block, as Thunder Plus' pump-synth-worklet.js does.
 *
 * wasm API used: psyn_stage() → 512 floats to stage values before psyn_new(type, sr); psyn_values(h) + psyn_commit(h)
 * to change values; psyn_midi(h, offset, status, d1, d2); psyn_process(h, n); psyn_out(0|1); psyn_latency(h); psyn_free(h).
 */
import {PUMP} from './pump-meta.js';

const WASI = {wasi_snapshot_preview1: {fd_close: () => 0, fd_seek: () => 0, fd_write: () => 0, proc_exit: () => 0}};
let X = null, failed = false;

export function pumpInit(module){
  if (X || failed) return !!X;
  try { X = new WebAssembly.Instance(module, WASI).exports; if (X._initialize) X._initialize(); return true; }
  catch (e) { failed = true; return false; }
}
export const pumpReady = () => !!X;

// Level trims (one note ≈ the Blip kit / Acid level): COIL and the others sit well under them as the plugins are.
const TRIM = {coil: 1.0, orbit: 2.5, fold: 2.5, boing: 2.0};

export class PumpVoice {
  constructor(kind, vals){
    this.kind = kind; this.meta = PUMP[kind]; this.h = -1; this.vals = vals || {}; this.notes = new Set(); this.quiet = 1e9;
    if (!X) return;
    const st = new Float32Array(X.memory.buffer, X.psyn_stage(), 512);
    this.fill(st);
    this.h = X.psyn_new(this.meta.t, sampleRate);
    this.lat = this.h >= 0 && X.psyn_latency ? X.psyn_latency(this.h) : 0;
  }
  fill(arr){ const ps = this.meta.params; for (let i = 0; i < ps.length; i++){ const v = this.vals[ps[i].s]; arr[i] = typeof v === 'number' && isFinite(v) ? v : ps[i].def; } }
  set(vals){
    this.vals = vals || {}; if (this.h < 0) return;
    this.fill(new Float32Array(X.memory.buffer, X.psyn_values(this.h), this.meta.params.length)); X.psyn_commit(this.h);
  }
  on(off, note, vel){ if (this.h < 0) return; X.psyn_midi(this.h, off, 0x90, note & 127, Math.max(1, Math.min(127, vel | 0))); this.notes.add(note); this.quiet = 0; }
  off(off, note){ if (this.h < 0 || !this.notes.has(note)) return; X.psyn_midi(this.h, off, 0x80, note & 127, 0); this.notes.delete(note); }
  allOff(){ for (const n of [...this.notes]) this.off(0, n); }
  // adds n samples into L / R, times g. Asleep (nothing held, silent for a second) costs nothing.
  render(L, R, n, g){
    if (this.h < 0 || this.bad) return;
    if (!this.notes.size && this.quiet > sampleRate) return;
    try {
      X.psyn_process(this.h, n);
      const b = X.memory.buffer, oL = new Float32Array(b, X.psyn_out(0), n), oR = new Float32Array(b, X.psyn_out(1), n), k = g * TRIM[this.kind];
      let pk = 0, sum = 0;
      for (let i = 0; i < n; i++){ const a = oL[i] * k, c = oR[i] * k; L[i] += a; if (R !== L) R[i] += c; const m = Math.abs(a) + Math.abs(c); if (m > pk) pk = m; sum += m; }
      if (!(sum - sum === 0)){ L.fill(0); if (R !== L) R.fill(0); this.free(); this.bad = true; return; }   // NaN: silence this voice rather than the mix
      this.quiet = this.notes.size || pk > 2e-5 ? 0 : this.quiet + n;
    } catch (e) { this.bad = true; }
  }
  free(){ if (this.h >= 0 && X) try { X.psyn_free(this.h); } catch (e) {} this.h = -1; }
}
