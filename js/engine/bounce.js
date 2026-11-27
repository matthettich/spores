/* js/engine/bounce.js: export (File › Export…) inside the engine worklet. 🔴 Claude only.
 *
 * An export is the same worklet playing the song in an OfflineAudioContext (js/engine/render.js makes it). With
 * processorOptions.bounce = {steps, stems, frames, thr, quietS, tailS} the worklet:
 *   - plays `steps` steps from the start, then ends on the first sample after the last step (worklet.js bounceEnd: no new
 *     notes, takes fade out over 5 ms, synth notes are let go) — but the effects run on, as while playing, so a reverb or an
 *     echo rings out (the 3-second "after Stop" fade of fxhost.js never starts);
 *   - hands every rendered sample, from the first step's sample on, to the page in chunks over the port
 *     ({t: 'bounce', at, chunk: [Float32Array per channel]}, transferred), so the page gets progress as it goes and the
 *     OfflineAudioContext itself only needs one channel;
 *   - after the end, keeps going while the tail is louder than `thr` (−90 dB at the file), and stops once it has been
 *     quieter for `quietS` seconds, or `tailS` seconds after the end, or at `frames`: {t: 'bounce', state: 'done', end, last}
 *     (frames counted from the first step: end = the song's end, last = the last sample above thr, −1 if none). After
 *     that the worklet only writes silence, so the rest of the render costs next to nothing. {t: 'halt'} does the same
 *     at once (Cancel) and answers {t: 'bounce', state: 'halted'}.
 *   - stems = [track ids]: each of those tracks plays into its own pair of channels (2k, 2k + 1) of output 0, after its
 *     effects, volume and mute, before the master clip; the mix itself is not sent (the page sums the stems and clips
 *     that, which is what the worklet does: sum, then tanh). Tracks not in the list are played (so chance rolls and
 *     everything else happen exactly as in the full song) but thrown away.
 */
const CHUNK = 32768;

export class Bounce {
  constructor(o, sr, port){
    this.sr = sr; this.port = port;
    this.left = Math.max(0, o.steps | 0);
    this.stems = Array.isArray(o.stems) && o.stems.length ? o.stems.slice(0, 16) : null;
    this.chans = this.stems ? this.stems.length * 2 : 2;
    this.thr = o.thr ?? 3.5e-5;
    this.quiet = Math.round((o.quietS ?? 2) * sr);
    this.tailMax = Math.round((o.tailS ?? 10) * sr);
    this.total = o.frames | 0;
    this.start = -1; this.end = -1; this.last = -1; this.ending = false; this.done = false;
    this.bufs = new Map();
    if (this.stems) this.stems.forEach((id, k) => this.bufs.set(id, {L: new Float32Array(128), R: new Float32Array(128), k}));
    this.mL = new Float32Array(128); this.mR = new Float32Array(128);   // stems: where everything else plays (thrown away)
    this.fresh();
  }
  fresh(){ this.chunk = Array.from({length: this.chans}, () => new Float32Array(CHUNK)); this.cn = 0; this.c0 = -1; }
  stemBuf(id){ return this.stems ? this.bufs.get(id) || null : null; }
  clear(){ for (const b of this.bufs.values()){ b.L.fill(0); b.R.fill(0); } this.mL.fill(0); this.mR.fill(0); }

  /* after the block is rendered: L / R = the mix (no stems) */
  take(L, R, f0, n){
    if (this.done || this.start < 0) return;
    const a = Math.max(0, this.start - f0);
    const src = this.stems ? this.stems.flatMap(id => { const b = this.bufs.get(id); return [b.L, b.R]; }) : [L, R];
    for (let i = a; i < n; i++){
      const f = f0 + i - this.start;
      if (this.c0 < 0) this.c0 = f;
      let pk = 0;
      for (let c = 0; c < this.chans; c++){ const x = src[c][i]; this.chunk[c][this.cn] = x; const y = x < 0 ? -x : x; if (y > pk) pk = y; }
      if (this.end >= 0 && f >= this.end && pk > this.thr) this.last = f;
      if (++this.cn === CHUNK) this.flush();
    }
    if (this.end < 0) return;
    const at = f0 + n - this.start, rang = Math.max(this.end, this.last + 1);
    if (at - rang >= this.quiet || at >= this.end + this.tailMax || f0 + n >= this.total) this.finish('done');
  }
  flush(){
    if (!this.cn) return;
    const chunk = this.chunk.map(c => c.slice(0, this.cn));
    this.port.postMessage({t: 'bounce', at: this.c0, chunk}, chunk.map(c => c.buffer));
    this.fresh();
  }
  finish(state){
    if (this.done) return;
    this.flush(); this.done = true;
    this.port.postMessage({t: 'bounce', state, end: this.end, last: this.last});
  }
}
