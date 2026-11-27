/* js/ui/peaks.js: a take's waveform, boiled down to PEAK_BINS (min, max) pairs so a lane can be drawn quickly at any
 * width and redrawn when the gain, offset or reverse changes. Samples come from js/audiostore.js (memory first).
 *
 *   peaksFor(id, done)  → {min, max: Float32Array} now if the take is in memory; else null, and done() is called once
 *                         it has loaded (or failed: then peaksFor(id) stays null and `missing(id)` is true).
 *   missing(id)         → true once we know this computer has no samples for the take
 */
import {peekClip, getClip} from '../audiostore.js';

export const PEAK_BINS = 1024;
const cache = new Map(), gone = new Set(), waiting = new Map();

function build(c){
  const d = c.data, n = d.length, min = new Float32Array(PEAK_BINS), max = new Float32Array(PEAK_BINS);
  for (let b = 0; b < PEAK_BINS; b++){
    const a = Math.floor(b * n / PEAK_BINS), z = Math.max(a + 1, Math.floor((b + 1) * n / PEAK_BINS));
    let lo = 0, hi = 0;
    for (let i = a; i < z && i < n; i++){ const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    min[b] = lo; max[b] = hi;
  }
  return {min, max, sr: c.sr, length: n};
}

export function peaksFor(id, done){
  if (cache.has(id)) return cache.get(id);
  const c = peekClip(id);
  if (c){ const p = build(c); cache.set(id, p); return p; }
  if (gone.has(id)) return null;
  if (waiting.has(id)){ if (done) waiting.get(id).push(done); return null; }
  waiting.set(id, done ? [done] : []);
  getClip(id).then(r => {
    const fs = waiting.get(id) || []; waiting.delete(id);
    if (r) cache.set(id, build(r)); else gone.add(id);
    fs.forEach(f => f());
  });
  return null;
}
export const missing = id => gone.has(id);
