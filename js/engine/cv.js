/* js/engine/cv.js: CV out (1 V per octave pitch + gate), tuning and the DC check. 🔴 Claude only.
 *
 * CV leaves through the audio interface: a DC-coupled one (Expert Sleepers ES-8 / ES-9, MOTU…) turns a sample value
 * into a voltage, full scale (1.0) = `fs` volts (ES-8 / ES-9: 10 V). Most interfaces are AC-coupled: a held voltage
 * leaks away within a second, so pitch slides back to 0 V. The DC check catches that.
 *
 * Pitch: without tuning, note → volts = (note − the track's root C) / 12, i.e. the track's root C = 0 V, 1 V per
 * octave. Tune CV measures the oscillator at 7 voltages (−1…+5 V) through an input, so afterwards each note is sent at
 * whatever value makes the oscillator play that exact pitch (A4 = 440 Hz), in tune with Spores' own sounds.
 * A tuning (track.cv.cal) is {points: [[sampleValue, log2(Hz)], …] (rising), dc: true|false|null, cents, at}, kept in
 * sample values, so it does not depend on `fs`.
 *
 * Pure module: the page uses it (compile, Tune CV); runTune takes its I/O as functions, so tests can drive it with
 * a model oscillator.
 */
export const DEFAULT_FS = 10, GATE_VOLTS = 5, CV_CHANNELS = 32;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const A4 = Math.log2(440);

export const targetLog2 = note => A4 + (note - 69) / 12;

// a note → the sample value for the pitch output
export function cvValue(note, cv, oct = 3, fs = DEFAULT_FS){
  const P = cv && cv.cal && cv.cal.points;
  if (P && P.length >= 2){
    const y = targetLog2(note);
    let i = 0; while (i < P.length - 2 && y > P[i + 1][1]) i++;   // the segment around y (ends extend the line)
    const [x0, y0] = P[i], [x1, y1] = P[i + 1];
    return clamp(x0 + (y - y0) * (x1 - x0) / (y1 - y0 || 1e-9), -1, 1);
  }
  return clamp((note - 12 * ((oct ?? 3) + 1)) / 12 / (fs || DEFAULT_FS), -1, 1);
}
export const gateValue = (fs = DEFAULT_FS) => clamp(GATE_VOLTS / (fs || DEFAULT_FS), 0, 1);

/* Pitch of a buffer (YIN). → {hz, clarity 0…1} or null when there is no clear pitch (25 Hz … 5 kHz). */
export function detectHz(buf, sr){
  const n = buf.length, maxLag = Math.min(Math.floor(sr / 25), Math.floor(n / 2)), minLag = Math.max(2, Math.floor(sr / 5000));
  let rms = 0; for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / n) < 0.003) return null;   // too quiet to measure
  const W = n - maxLag, d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++){ let s = 0; for (let i = 0; i < W; i++){ const x = buf[i] - buf[i + tau]; s += x * x; } d[tau] = s; }
  // cumulative mean normalised difference
  let run = 0; const c = new Float32Array(maxLag + 1); c[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++){ run += d[tau]; c[tau] = d[tau] * tau / (run || 1e-12); }
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) if (c[t] < 0.15){ while (t + 1 <= maxLag && c[t + 1] < c[t]) t++; tau = t; break; }
  if (tau < 0){ let best = minLag; for (let t = minLag; t <= maxLag; t++) if (c[t] < c[best]) best = t; if (c[best] > 0.35) return null; tau = best; }
  // parabolic interpolation between the neighbouring lags
  const a = c[tau - 1] ?? c[tau], b = c[tau], e = c[tau + 1] ?? c[tau], den = a - 2 * b + e;
  const t2 = tau + (den ? (a - e) / (2 * den) : 0);
  return {hz: sr / t2, clarity: clamp(1 - b, 0, 1)};
}

/* Tune one oscillator. io = {setValue(v), measure() → Promise<hz|null>, wait(ms)}, values are sample values.
   1. DC check: jump to +2 V and listen for 2.5 s. If the pitch sinks back, the outputs can't hold a voltage.
   2. Measure −1 … +5 V; keep the voltages where a clear pitch was found; fit the tuning.
   → {cal, dc, drift (cents over the 2.5 s), table: [{volts, hz}], error: message?} */
export async function runTune(io, {fs = DEFAULT_FS, onProgress = () => {}, stopped = () => false} = {}){
  const v = volts => clamp(volts / fs, -1, 1);
  const med = async () => { const xs = []; for (let k = 0; k < 3; k++){ const h = await io.measure(); if (h) xs.push(h); await io.wait(60); } xs.sort((a, b) => a - b); return xs.length ? xs[xs.length >> 1] : null; };
  onProgress('Checking the outputs can hold a voltage…', 0);
  io.setValue(v(0)); await io.wait(500);
  io.setValue(v(2)); await io.wait(150);
  const early = await med(); await io.wait(2200); const late = await med();
  if (stopped()) return {error: 'Stopped.'};
  let dc = null, drift = null;
  if (early && late){ drift = 1200 * Math.log2(late / early); dc = Math.abs(drift) < 25; }
  const table = [];
  for (let volts = -1; volts <= 5; volts++){
    if (stopped()) return {error: 'Stopped.'};
    onProgress(`Measuring ${volts > 0 ? '+' : ''}${volts} V…`, (volts + 2) / 8);
    io.setValue(v(volts)); await io.wait(volts === -1 ? 500 : 300);
    const hz = await med(); table.push({volts, value: v(volts), hz});
  }
  io.setValue(v(0));
  if (dc === false) return {dc, drift, table, error: 'These outputs can’t hold a voltage: the pitch slid back while it was held, so the interface ' +
    'is AC-coupled. CV needs a DC-coupled interface or outputs (Expert Sleepers ES-8 or ES-9, some MOTU interfaces, or a DC-coupled ' +
    'utility module).'};
  const good = table.filter(r => r.hz);
  if (good.length < 3) return {dc, drift, table, error: early || late
    ? 'Only a few voltages gave a clear pitch. Check the oscillator is patched to the pitch output and turned up.'
    : 'No pitch heard. Check the oscillator goes into the input you picked, and the input level.'};
  // keep the rising run (the oscillator's range); a point that falls is out of range or mis-heard
  // and stop where a step's octaves-per-volt is far from the others' (past the top of its range, or heard an octave off)
  const pts = []; for (const r of good){ const y = Math.log2(r.hz); if (!pts.length || y > pts[pts.length - 1][1] + 1e-3) pts.push([r.value, y]); }
  const slope = i => (pts[i + 1][1] - pts[i][1]) / ((pts[i + 1][0] - pts[i][0]) * fs);
  if (pts.length >= 3){
    const ss = pts.slice(0, -1).map((_, i) => slope(i)).sort((a, b) => a - b), mid = ss[ss.length >> 1];
    for (let i = 0; i < pts.length - 1; i++){ const k = slope(i) / mid; if (k < 0.6 || k > 1.6){ if (i < 1){ pts.splice(0, 1); i = -1; continue; } pts.length = i + 1; break; } }
  }
  if (pts.length < 3) return {dc, drift, table, error: 'The pitch did not rise with the voltage. Is the cable in the pitch (1 V/oct) input?'};
  // how close plain 1 V/oct is: octaves per volt across the measured range
  const perVolt = (pts[pts.length - 1][1] - pts[0][1]) / ((pts[pts.length - 1][0] - pts[0][0]) * fs);
  return {cal: {points: pts.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]), dc, perVolt: +perVolt.toFixed(4), at: new Date().toISOString().slice(0, 10)},
    dc, drift, table};
}
