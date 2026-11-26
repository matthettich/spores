/* tests/cv-check.mjs: Tune CV and the DC check against model oscillators (Node only, no browser):
 *   node tests/cv-check.mjs
 * Prints, for a slightly off 1 V/oct VCO on a DC-coupled interface: dc true, the tuned notes' error in cents (should
 * be under ~2); on an AC-coupled interface: dc false; and the pitch detector's error on saw / sine / square waves. */
import {runTune, cvValue, detectHz, targetLog2} from '../js/engine/cv.js';

const SR = 48000, FS = 10;
function wave(hz, kind, n = 8192, noise = 0.01){
  const b = new Float32Array(n); let ph = Math.random();
  for (let i = 0; i < n; i++){ ph = (ph + hz / SR) % 1;
    b[i] = 0.3 * (kind === 'sine' ? Math.sin(2 * Math.PI * ph) : kind === 'square' ? (ph < 0.5 ? 1 : -1) : 2 * ph - 1) + noise * (Math.random() * 2 - 1); }
  return b;
}
// a VCO: C3 at 0 V, `scale` octaves per volt, `offset` octaves; AC-coupled outputs leak towards 0 V (tau seconds)
function vco({scale = 1.03, offset = 0.02, ac = false, tau = 0.4, kind = 'saw'} = {}){
  let target = 0, setAt = 0, from = 0, now = 0;
  const volts = () => ac ? (target - from) * Math.exp(-(now - setAt) / tau) : target;
  return {
    setValue(v){ from = ac ? target - volts() : 0; target = v * FS; setAt = now; },
    wait: async ms => { now += ms / 1000; },
    measure: async () => { const r = detectHz(wave(130.81 * Math.pow(2, scale * volts() + offset), kind), SR); return r && r.hz; },
  };
}

for (const kind of ['saw', 'sine', 'square']){
  const errs = [41.2, 110, 261.6, 880, 1500].map(hz => Math.abs(1200 * Math.log2(detectHz(wave(hz, kind), SR).hz / hz)));
  console.log(`detector ${kind}: worst error ${Math.max(...errs).toFixed(2)} cents`);
}
const osc = vco(), res = await runTune(osc, {fs: FS});
const play = note => 130.81 * Math.pow(2, 1.03 * cvValue(note, {cal: res.cal}) * FS + 0.02);
const tuned = [36, 48, 55, 60, 67, 72, 84, 90].map(n => 1200 * (Math.log2(play(n)) - targetLog2(n)));
console.log('DC-coupled: dc', res.dc, 'drift', res.drift.toFixed(2), 'c | perVolt', res.cal.perVolt, '| tuned error (cents):', tuned.map(c => c.toFixed(2)).join(' '));
const untuned = [48, 60, 72, 84].map(n => 1200 * (Math.log2(130.81 * Math.pow(2, 1.03 * cvValue(n, null, 3, FS) * FS + 0.02)) - targetLog2(n)));
console.log('  same VCO untuned (track oct 3: C3 = 0 V, so only the VCO’s own 3 % + offset): error (cents):', untuned.map(c => c.toFixed(1)).join(' '));
const ac = await runTune(vco({ac: true}), {fs: FS});
console.log('AC-coupled: dc', ac.dc, 'drift', ac.drift && ac.drift.toFixed(0), 'c', ac.error ? '| error: ' + ac.error : '');
const none = await runTune({setValue(){}, wait: async () => {}, measure: async () => null}, {fs: FS});
console.log('No signal:', none.error);
