/* js/engine/songtape.js: song-length audio takes inside the worklet. 🔴 Claude only. Used by worklet.js.
 *
 * SongTape plays an audio track's one song-length take (track.span 'song', track.take): its first sample plays on the
 * first sample of song bar `startBar` (song bars count from the first block, through blocks and repeats: songmap.js).
 * Like TapeVoice it is re-synced on every step (song mode only): read position = (song step − startBar × 16) × the
 * take's samples per step, so it can't drift and follows block changes and repeats exactly; another tempo =
 * varispeed. Unlike a loop it never wraps: before its start and after its (trimmed) end it is silent. When the
 * position jumps (the song starts again from bar 0, Play from another block) it crossfades over a few ms.
 * Scene mode: silent (worklet.js releases it).
 *
 * SongCapture records the input from a frame on, for as long as it takes (until finish(endFrame)), in chunks, so
 * nothing big is copied on the audio thread; the page joins the chunks (recorder.js).
 */
import {TapeVoice} from './tape.js';

const JUMP = 64;                       // samples: a re-sync further off than this is a jump (crossfade), not drift
const CHUNK_S = 8, MAX_S = 30 * 60;    // capture chunks of 8 s; a song take stops by itself after 30 minutes

// Catmull-Rom between d[i] and d[i+1], clamped at the ends (no wrap: a song take isn't a loop)
function readClamp(d, r){
  const L = d.length, i = Math.floor(r), t = r - i;
  if (i < 0 || i >= L) return 0;
  const y1 = d[i];
  if (t === 0) return y1;
  const y0 = d[i > 0 ? i - 1 : 0], y2 = d[i + 1 < L ? i + 1 : L - 1], y3 = d[i + 2 < L ? i + 2 : L - 1];
  return y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
}

export class SongTape extends TapeVoice {
  /* at output sample `late` samples after the step's exact frame, put the take at song step `songStep`.
     take = the compiled take ({id, sr, bpm, startBar, gain, fadeIn, fadeOut, trimStart, trimEnd}) or null. */
  sync(take, data, songStep, stepLen, late, target){
    if (!take || !data || !data.length){ this.release(); return; }
    const sr = take.sr || this.sr, per = sr * 15 / (take.bpm || 120), rate = per / stepLen, L = data.length;
    const pos = (songStep - take.startBar * 16) * per + late * rate;
    const a = Math.min(L, Math.max(0, (take.trimStart || 0) * sr)), b = Math.max(a, L - Math.max(0, (take.trimEnd || 0) * sr));
    if (pos < 0 || pos >= b){ this.release(); return; }        // before its start bar / after its end
    const c = this.cur;
    if (!c || c.data !== data || Math.abs(c.pos - pos) > JUMP){
      if (c) this.release(); else this.g = target;              // from silence: full level at once (the fade-in shapes it)
      this.cur = {id: take.id, data, L, gain: take.gain ?? 1, a, b, fi: Math.max(0, (take.fadeIn || 0) * sr),
        fo: Math.max(0, (take.fadeOut || 0) * sr), pos, rate};
    }
    Object.assign(this.cur, {pos, rate, a, b, gain: take.gain ?? 1});
  }

  sample(v){
    const p = v.pos; v.pos += v.rate;
    if (p < v.a || p >= v.b) return 0;
    let env = 1;
    if (v.fi > 0 && p - v.a < v.fi) env = (p - v.a) / v.fi;
    if (v.fo > 0 && v.b - p < v.fo) env = Math.min(env, (v.b - p) / v.fo);
    return readClamp(v.data, p) * env * v.gain;
  }
}

export class SongCapture {
  constructor(start, sr){ this.start = start; this.end = Math.round(start + MAX_S * sr); this.size = Math.round(CHUNK_S * sr); this.chunks = []; this.n = 0; this.ended = false; }
  // stop at this frame (Stop, the song's end); never later than already set, never before the start
  finish(frame){ this.end = Math.max(this.start, Math.min(this.end, Math.round(frame))); this.ended = true; }
  // input: this block's samples (or null = silence), first frame f0. Returns true once it has everything up to end.
  feed(input, f0, n){
    const a = Math.max(this.start, f0), b = Math.min(this.end, f0 + n);
    for (let f = a; f < b;){
      const j = f - this.start, ci = Math.floor(j / this.size), at = j - ci * this.size;
      while (this.chunks.length <= ci) this.chunks.push(new Float32Array(this.size));
      const k = Math.min(b - f, this.size - at);
      if (input) this.chunks[ci].set(input.subarray(f - f0, f - f0 + k), at);
      f += k;
    }
    if (b > a) this.n = b - this.start;
    return f0 + n >= this.end;
  }
  get len(){ return Math.max(0, this.end - this.start); }
}
