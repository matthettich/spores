/* js/engine/tape.js: audio tracks inside the worklet: loop-take playback, the count-in / metronome click, the latency
 * test's bursts, and capturing the input. 🔴 Claude only. Used by worklet.js; pure functions on plain objects, so the
 * worklet keeps one place for timing.
 *
 * Playback (TapeVoice): a take loops in time with the sequencer. It is not free-running: on every step the worklet
 * calls sync(), which puts the read position where that step falls in the loop (steps since the scene started, mod
 * the loop's steps), so the loop starts on the scene's first sample, wraps on bar lines, and can never drift, at any
 * tempo or after a tempo change. Between steps it moves `rate` source samples per output sample (varispeed: rate =
 * the take's length / the loop's length at the song tempo), read with 4-point Catmull-Rom interpolation (exact at whole
 * positions, so at the recorded tempo and rate a take plays back sample for sample).
 */
const SMOOTH_S = 0.003, XFADE_S = 0.005;

// Catmull-Rom between d[i] and d[i+1], wrapping around the loop
function readLoop(d, r){
  const L = d.length, i = Math.floor(r), t = r - i;
  const i1 = i >= L ? i - L : i, i0 = i1 ? i1 - 1 : L - 1, i2 = i1 + 1 < L ? i1 + 1 : 0, i3 = i2 + 1 < L ? i2 + 1 : 0;
  const y0 = d[i0], y1 = d[i1], y2 = d[i2], y3 = d[i3];
  if (t === 0) return y1;
  return y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
}

export class TapeVoice {
  constructor(sr){ this.sr = sr; this.cur = null; this.old = null; this.g = 0; this.k = 1 - Math.exp(-1 / (SMOOTH_S * sr)); }

  /* at output sample `late` samples after the step's exact frame: put the loop at step `runStep`. clip = the compiled
     clip ({id, bars, gain, offset, fadeIn, fadeOut, reverse}) or null; data = its samples (Float32Array) or null. */
  sync(clip, data, runStep, stepLen, late, target){
    if (!clip || !data || !data.length){ this.release(); return; }
    const L = data.length, S = clip.bars * 16, per = L / S, rate = per / stepLen;
    const pos = (runStep % S) * per + late * rate;
    if (!this.cur || this.cur.data !== data){
      if (this.cur) this.release(); else this.g = target;    // from silence: full level at once (the take's fade-in shapes it)
      const sr = clip.sr || this.sr;
      this.cur = {id: clip.id, data, L, gain: clip.gain ?? 1, rev: !!clip.reverse, off: (clip.offset || 0) * sr,
        fi: Math.max(0, (clip.fadeIn || 0) * sr), fo: Math.max(0, (clip.fadeOut || 0) * sr), pos: 0, rate: 1};
    }
    this.cur.pos = pos; this.cur.rate = rate;
  }

  // stop (scene without a take, Stop): fade out over a few ms instead of cutting
  release(){
    if (this.cur){ this.old = Object.assign(this.cur, {x: 1, dx: 1 / (XFADE_S * this.sr), g: this.g}); this.cur = null; }
  }

  get busy(){ return !!(this.cur || this.old); }

  // add samples a…b into L / R (mono, centred). target = the track's level now (0 when muted, soloed out or being recorded)
  render(L, R, a, b, target){
    const c = this.cur, k = this.k;
    let o = this.old;
    for (let i = a; i < b; i++){
      let x = 0;
      if (c){ this.g += (target - this.g) * k; x += this.sample(c) * this.g; }
      if (o){ x += this.sample(o) * o.g * o.x; o.x -= o.dx; if (o.x <= 0) o = this.old = null; }
      if (x){ L[i] += x; if (R !== L) R[i] += x; }
    }
  }

  sample(v){
    let p = v.pos; v.pos += v.rate;
    const L = v.L;
    if (p >= L) p -= L * Math.floor(p / L);
    let env = 1;
    if (v.fi > 0 && p < v.fi) env = p / v.fi;
    if (v.fo > 0 && L - p < v.fo) env = Math.min(env, (L - p) / v.fo);
    let r = p + v.off; r -= L * Math.floor(r / L);
    if (v.rev){ r = L - 1 - r; if (r < 0) r += L; }
    return readLoop(v.data, r) * env * v.gain;
  }
}

/* Clicks (count-in, metronome) and bursts (the latency test), placed on exact frames and added to the mix. */
export class Clicks {
  constructor(sr){ this.sr = sr; this.list = []; }
  add(frame, kind){ this.list.push({frame: Math.round(frame), kind}); }
  clear(){ this.list.length = 0; }
  render(L, R, f0, n){
    const sr = this.sr;
    for (let j = this.list.length - 1; j >= 0; j--){
      const c = this.list[j], burst = c.kind === 'burst', dur = burst ? 96 : Math.round(0.03 * sr);
      if (c.frame >= f0 + n) continue;
      if (c.frame + dur <= f0){ this.list.splice(j, 1); continue; }
      const hz = c.kind === 'accent' ? 1600 : 1000, amp = c.kind === 'accent' ? 0.5 : 0.35;
      for (let i = Math.max(0, c.frame - f0); i < n; i++){
        const t = f0 + i - c.frame; if (t >= dur) break;
        // a burst: a decaying 2 kHz square starting at full height (a sharp first sample to time); a click: a short blip
        const x = burst ? 0.6 * (1 - t / dur) * ((t % 24) < 12 ? 1 : -1) : amp * Math.sin(2 * Math.PI * hz * t / sr) * Math.exp(-t / (0.008 * sr));
        L[i] += x; if (R !== L) R[i] += x;
      }
    }
  }
}

/* Capturing input frames [start, start + len) (whole frames of the context clock) into a buffer. */
export class Capture {
  constructor(start, len){ this.start = start; this.len = len; this.buf = new Float32Array(len); this.n = 0; }
  // input: this block's samples (or null for silence), first frame f0. Returns true once full.
  feed(input, f0, n){
    const a = Math.max(this.start, f0), b = Math.min(this.start + this.len, f0 + n);
    if (b > a && input) this.buf.set(input.subarray(a - f0, b - f0), a - this.start);
    if (b > a) this.n = b - this.start;
    return f0 + n >= this.start + this.len;
  }
}
