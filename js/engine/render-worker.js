/* js/engine/render-worker.js: records notes of the rendered engines (Modal, Scanned) off the audio thread.
 * 🔴 Claude only. In: {id, key, engine, vals, note, sr}. Out: {id, key, note, data} (data transferred). */
import {ModalCore, ScannedCore} from './rendered.js';

const C = {modal: ModalCore, scanned: ScannedCore};
const MAX_S = 8;   // seconds kept of one note (a gong can ring longer; the tail is faded)

self.onmessage = e => {
  const {id, key, engine, vals, note, sr} = e.data, E = C[engine];
  let data;
  try {
    // the note's pitch: the engines play C2 (65.4 Hz) × 2^(oct + tune/12), so oct 0 and tune = semitones above C2
    data = E.render(Object.assign({}, vals, {oct: 0, tune: note - 36}), sr, Math.max(0.05, vals.hold || 0.5));
    if (data.length > MAX_S * sr){ data = data.slice(0, MAX_S * sr); const f = Math.round(sr * 0.05); for (let i = 0; i < f; i++) data[data.length - 1 - i] *= i / f; }
  } catch (err) { data = new Float32Array(1); }
  self.postMessage({id, key, note, data}, [data.buffer]);
};
