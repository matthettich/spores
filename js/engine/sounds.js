/* js/engine/sounds.js: every sound Spores can play, and the settings each one offers. 🔴 engine code (Claude).
 *
 * A track's `sound` is a name from SOUNDS; `track.params` ({setting: value}) is laid over that sound's values, so
 * changing a setting is just an edit to the song (undoable, saved). The panel builds its controls from
 * settingsFor(soundName): `main` are the few big ones for Simple mode, `all` the full list for More.
 * A setting: {s, l (label), min, max, def, int?, log?, sq?, ch? (names for each whole value), unit?}.
 *
 * Engines:
 *   blip   drums   BlipVoice (Thunder Plus), live
 *   clap   drums   Clap808 (Spores' own, after the TR-808), live
 *   boing  drums   pump BOING spring drums (pump-synth.wasm), live; one drum per track, `kit` picks the kit preset
 *   acid   synth   AcidCore (Thunder Plus), live, mono
 *   coil, orbit, fold  synth  pump COIL / ORBIT / FOLD (pump-synth.wasm), live, poly
 *   modal, scanned     synth  Thunder Plus' rendered engines: each note recorded in a Worker, then played
 */
import {BlipVoice, Clap808, AcidCore, DRUMS, SYNTHS} from './voices.js';
import {RENDERED} from './rendered.js';
import {PUMP} from './pump-meta.js';

const BLIP_ROWS = [
  {s: 'pitch', l: 'Pitch', min: 20, max: 8000, log: true, unit: 'Hz'}, {s: 'decay', l: 'Decay', min: 5, max: 4000, log: true, unit: 'ms'},
  {s: 'kick', l: 'Pitch drop', min: 0, max: 1}, {s: 'kickT', l: 'Drop time', min: 1, max: 200, log: true, unit: 'ms'},
  {s: 'noise', l: 'Noise', min: 0, max: 1}, {s: 'click', l: 'Click', min: 0, max: 1},
  {s: 'fm', l: 'FM', min: 0, max: 1}, {s: 'fmR', l: 'FM ratio', min: 0.25, max: 8, log: true},
  {s: 'ring', l: 'Ring', min: 0, max: 1}, {s: 'ringF', l: 'Ring freq', min: 1, max: 8000, log: true, unit: 'Hz'},
  {s: 'atk', l: 'Attack', min: 0.5, max: 200, log: true, unit: 'ms'}, {s: 'drive', l: 'Drive', min: 0, max: 1},
  {s: 'filt', l: 'Filter (low ← → high)', min: -1, max: 1}, {s: 'res', l: 'Resonance', min: 0, max: 1},
  {s: 'grain', l: 'Stutter', min: 0, max: 8, int: true}, {s: 'grainT', l: 'Stutter time', min: 5, max: 200, log: true, unit: 'ms'}];
const CLAP_ROWS = [
  {s: 'tone', l: 'Tone', min: 400, max: 4000, log: true, unit: 'Hz'}, {s: 'decay', l: 'Tail', min: 30, max: 1500, log: true, unit: 'ms'},
  {s: 'room', l: 'Tail level', min: 0, max: 1}, {s: 'bursts', l: 'Hands', min: 1, max: 8, int: true},
  {s: 'spread', l: 'Hands spread', min: 2, max: 40, log: true, unit: 'ms'}, {s: 'snap', l: 'Snap', min: 0.5, max: 15, log: true, unit: 'ms'},
  {s: 'width', l: 'Width', min: 0, max: 1}, {s: 'drive', l: 'Drive', min: 0, max: 1}];
const ACID_ROWS = [
  {s: 'cut', l: 'Cutoff', min: 40, max: 6000, log: true, unit: 'Hz'}, {s: 'res', l: 'Resonance', min: 0, max: 1.05},
  {s: 'envAmt', l: 'Env amount', min: 0, max: 1}, {s: 'dec', l: 'Env decay', min: 10, max: 2000, log: true, unit: 'ms'},
  {s: 'wave', l: 'Saw ← → square', min: 0, max: 1}, {s: 'pw', l: 'Pulse width', min: 0.05, max: 0.95},
  {s: 'sub', l: 'Sub', min: 0, max: 1}, {s: 'noise', l: 'Noise', min: 0, max: 1}, {s: 'accent', l: 'Accent', min: 0, max: 1},
  {s: 'ampDec', l: 'Decay', min: 1, max: 4000, log: true, unit: 'ms'}, {s: 'sus', l: 'Sustain', min: 0, max: 1},
  {s: 'rel', l: 'Release', min: 1, max: 1000, log: true, unit: 'ms'}, {s: 'key', l: 'Key follow', min: 0, max: 1},
  {s: 'sat', l: 'Saturation', min: 0, max: 1}, {s: 'drive', l: 'Drive', min: 0, max: 1}];
const HOLD = {s: 'hold', l: 'Note length', min: 0.05, max: 4, log: true, unit: 's', def: 0.5};
// pump settings left out of the panel: the mod matrix and LFO drawings (the plugin's own editor), voices / bend / glide
const PUMP_HIDE = /^(mod\d+_|lfo\d_draw|bend|voices|voice_mode|glide|volume|follow)/;
const BOING_DRUMS = [['kick', 'Kick'], ['snare', 'Snare'], ['clap', 'Clap'], ['ltom', 'Low tom'], ['htom', 'High tom'],
  ['chat', 'Closed hat'], ['ohat', 'Open hat'], ['cym', 'Cymbal']];

const withDefs = (rows, d) => rows.map(r => Object.assign({def: d[r.s]}, r));
const pumpRows = k => PUMP[k].params.filter(p => !PUMP_HIDE.test(p.s));

export const ENGINES = {
  blip:    {label: 'Blip', kind: 'drum', rows: withDefs(BLIP_ROWS, BlipVoice.defaults()), main: ['pitch', 'decay', 'kick', 'noise', 'fm']},
  clap:    {label: '808 clap', kind: 'drum', rows: withDefs(CLAP_ROWS, Clap808.defaults()), main: ['tone', 'decay', 'room', 'bursts', 'spread']},
  boing:   {label: 'Boing (springs)', kind: 'drum', pump: 'boing', main: ['pitch', 'decay', 'drip', 'tank', 'blend']},
  acid:    {label: 'Acid', kind: 'synth', rows: withDefs(ACID_ROWS, AcidCore.defaults()), main: ['cut', 'res', 'envAmt', 'dec', 'wave']},
  coil:    {label: 'Coil (springs)', kind: 'synth', pump: 'coil', rows: pumpRows('coil'), main: ['tension', 'drip', 'decay', 'tank', 'tone']},
  orbit:   {label: 'Orbit (chaos)', kind: 'synth', pump: 'orbit', rows: pumpRows('orbit'), main: ['system', 'chaos', 'cutoff', 'drift_pitch', 'decay']},
  fold:    {label: 'Fold (west coast)', kind: 'synth', pump: 'fold', rows: pumpRows('fold'), main: ['fold', 'fm_index', 'mod_ratio', 'symmetry', 'fall']},
  modal:   {label: 'Modal (struck & bowed)', kind: 'synth', rendered: true, rows: [HOLD, ...RENDERED.modal.rows], main: ['mat', 'exc', 'bright', 'dec', 'inharm']},
  scanned: {label: 'Scanned (masses & springs)', kind: 'synth', rendered: true, rows: [HOLD, ...RENDERED.scanned.rows], main: ['stiff', 'damp', 'exc', 'path', 'urate']},
};

/* SOUNDS: name → {engine, kind, vals, drum?}. Order = the order Prev / Next steps through. */
export const SOUNDS = {};
const add = (name, engine, vals, extra) => { SOUNDS[name] = Object.assign({engine, kind: ENGINES[engine].kind, vals}, extra || {}); };
for (const [n, {engine, ...v}] of Object.entries(DRUMS)) add(n, engine || 'blip', v);
BOING_DRUMS.forEach(([d, n], i) => add('Boing ' + n.toLowerCase(), 'boing', {}, {drum: d, note: 48 + [0, 2, 4, 5, 7, 9, 11, 12][i]}));
for (const [n, v] of Object.entries(SYNTHS)) add(n, 'acid', v);
/* A step's note lasts half a step (~60 ms at 120 BPM), so a pad preset with a slow fade-in (Fold's rise, Orbit's
   attack: 0.6–1.5 s in pump) ends before it is heard — Folded drone measured −60 dB, Drifting complex −42 dB, Thomas
   pad −28 dB. Spores' copy of those presets starts faster (the long fall / release tails stay); More can slow it again. */
const FAST_IN = {fold: 'rise', orbit: 'attack'}, FAST_MS = 60;
const quick = (k, v) => FAST_IN[k] && v[FAST_IN[k]] > FAST_MS ? Object.assign({}, v, {[FAST_IN[k]]: FAST_MS}) : v;
for (const k of ['coil', 'orbit', 'fold']) for (const [n, v] of PUMP[k].pre) add(PUMP[k].name.charAt(0) + PUMP[k].name.slice(1).toLowerCase() + ' · ' + n, k, quick(k, v));
for (const k of ['modal', 'scanned']) for (const [n, v] of RENDERED[k].pre) add(ENGINES[k].label.split(' ')[0] + ' · ' + (n === 'Init' ? 'Default' : n), k, v);

export const DRUM_NAMES = Object.keys(SOUNDS).filter(n => SOUNDS[n].kind === 'drum');
export const SYNTH_NAMES = Object.keys(SOUNDS).filter(n => SOUNDS[n].kind === 'synth');

/* The settings a sound offers. Boing: the drum's own settings (kick_pitch shown as 'pitch'), then the kit's, plus
   Kit (which of BOING's kit presets the drum comes from). */
export function settingsFor(name){
  const S = SOUNDS[name]; if (!S) return {main: [], all: []};
  const E = ENGINES[S.engine];
  let all = E.rows;
  if (S.engine === 'boing'){
    const pre = S.drum + '_';
    all = [{s: 'kit', l: 'Kit', min: 0, max: PUMP.boing.pre.length - 1, int: true, def: 0, ch: PUMP.boing.pre.map(p => p[0])},
      ...PUMP.boing.params.filter(p => p.s.startsWith(pre)).map(p => Object.assign({}, p, {s: p.s.slice(pre.length), l: p.l.replace(/^\S+\s/, '')})),
      ...PUMP.boing.params.filter(p => !/^(kick|snare|clap|ltom|htom|chat|ohat|cym)_/.test(p.s) && !PUMP_HIDE.test(p.s))];
  }
  const main = E.main.map(s => all.find(r => r.s === s)).filter(Boolean);
  return {main, all};
}

/* A track's sound, resolved: {engine, kind, vals, note?}. vals = the sound's values + the track's own settings.
   Boing's per-drum names ('pitch') are turned back into the plugin's ('kick_pitch'), over the chosen kit preset. */
export function resolve(name, params){
  const S = SOUNDS[name] || SOUNDS[name === undefined ? '' : DRUM_NAMES[0]] || SOUNDS.Kick;
  const p = params || {};
  if (S.engine === 'boing'){
    const kit = PUMP.boing.pre[Math.max(0, Math.min(PUMP.boing.pre.length - 1, Math.round(p.kit || 0)))][1], vals = Object.assign({}, kit);
    for (const [k, v] of Object.entries(p)) if (k !== 'kit') vals[PUMP.boing.params.some(q => q.s === k) ? k : S.drum + '_' + k] = v;
    return {engine: 'boing', kind: 'drum', vals, note: S.note};
  }
  return {engine: S.engine, kind: S.kind, vals: Object.assign({}, S.vals, p)};
}
