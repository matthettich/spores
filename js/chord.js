/* js/chord.js: chords on a note step (song format v5). Pure module (no DOM): the store, the engine and the screens use it.
 *
 * A step's `deg` is its lowest note (the root, the one CV plays); `chord` (optional) lists the other notes as scale steps
 * ABOVE it: [2, 4] = the notes 2 and 4 scale steps up = a triad built from the song's own scale, so it stays in key and
 * follows a key or scale change. At most 3 (4 notes in all), each 1..MAX_ABOVE, no repeats, low to high. Because the
 * offsets are relative, moving `deg` (drag, arrow keys, ▲ ▼) moves the whole chord. No `chord` = one note, as before v5.
 */
import {scaleOf, degToMidi, KEYS} from './scale.js';

export const MAX_NOTES = 4, MAX_ABOVE = 21;

// a clean `chord` array (or null for "one note"): whole numbers 1..MAX_ABOVE, unique, sorted, at most MAX_NOTES - 1
export function cleanChord(c){
  if (!Array.isArray(c)) return null;
  const out = [...new Set(c.filter(x => typeof x === 'number' && isFinite(x)).map(Math.round).filter(x => x >= 1 && x <= MAX_ABOVE))]
    .sort((a, b) => a - b).slice(0, MAX_NOTES - 1);
  return out.length ? out : null;
}

// every note of a step as scale degrees, lowest first ([deg] for a one-note step)
export function stepDegs(st){
  const d = Math.round(st && st.deg || 0) || 0, c = st && cleanChord(st.chord);
  return c ? [d, ...c.map(o => d + o)] : [d];
}
export const isChord = st => !!(st && cleanChord(st.chord));

// the step's notes as MIDI notes (no repeats: two degrees may land on the same clamped note)
export function stepMidi(st, key, scale, oct){
  return [...new Set(stepDegs(st).map(d => degToMidi(d, key, scale, oct)))];
}

/* The Chord picker's choices for a scale: built from the scale's own notes, so every chord stays in key.
   7-note scales stack thirds (every other note of the scale): which of them is major or minor depends on the step's
   note, as in any key. Chromatic has no "every other note", so it names the semitone shapes outright. */
const SEVEN = [
  {id: 'triad', name: 'Triad (3 notes)', c: [2, 4]},
  {id: 'seventh', name: '7th (4 notes)', c: [2, 4, 6]},
  {id: 'sus2', name: 'Sus2', c: [1, 4]},
  {id: 'sus4', name: 'Sus4', c: [3, 4]},
  {id: 'add9', name: 'Add 9', c: [2, 4, 8]},
  {id: 'power', name: 'Power (root + 5th)', c: [4]},
  {id: 'octave', name: 'Octave', c: [7]},
];
const TWELVE = [
  {id: 'major', name: 'Major', c: [4, 7]},
  {id: 'minor', name: 'Minor', c: [3, 7]},
  {id: 'seventh', name: '7th', c: [4, 7, 10]},
  {id: 'maj7', name: 'Major 7th', c: [4, 7, 11]},
  {id: 'min7', name: 'Minor 7th', c: [3, 7, 10]},
  {id: 'sus2', name: 'Sus2', c: [2, 7]},
  {id: 'sus4', name: 'Sus4', c: [5, 7]},
  {id: 'power', name: 'Power (root + 5th)', c: [7]},
  {id: 'octave', name: 'Octave', c: [12]},
];
export function chordShapes(scale){
  const n = scaleOf(scale).iv.length;
  if (n === 7) return SEVEN;
  if (n === 12) return TWELVE;
  return [{id: 'triad', name: 'Triad (3 notes)', c: [2, 4]}, {id: 'power', name: 'Power', c: [Math.round(n * 4 / 7)]}, {id: 'octave', name: 'Octave', c: [n]}];
}
// which shape a step has: 'none', a shape id, or 'custom' (notes added by hand)
export function shapeOf(st, scale){
  const c = st && cleanChord(st.chord);
  if (!c) return 'none';
  const s = chordShapes(scale).find(x => x.c.join() === c.join());
  return s ? s.id : 'custom';
}

/* The chord's usual name from the notes it actually makes ("Cm", "G7", "Fsus4", "Am/C"), or '' if it has none. */
const QUAL = {'0,4,7': '', '0,3,7': 'm', '0,3,6': 'dim', '0,4,8': 'aug', '0,2,7': 'sus2', '0,5,7': 'sus4', '0,7': '5',
  '0,4,7,10': '7', '0,4,7,11': 'maj7', '0,3,7,10': 'm7', '0,3,6,10': 'm7♭5', '0,3,6,9': 'dim7', '0,2,4,7': 'add9', '0,2,3,7': 'm(add9)',
  '0,4,7,9': '6', '0,3,7,9': 'm6', '0,3,7,11': 'm(maj7)'};
export function chordName(st, key, scale){
  const ns = stepMidi(st, key, scale, 4);
  if (ns.length < 2) return '';
  const pcs = [...new Set(ns.map(n => n % 12))];
  if (pcs.length === 1) return KEYS[pcs[0]] + ' octave';
  const bass = ns[0] % 12;
  for (const r of [bass, ...pcs.filter(p => p !== bass)]){
    const q = QUAL[pcs.map(p => (p - r + 12) % 12).sort((a, b) => a - b).join()];
    if (q !== undefined) return KEYS[r] + q + (r !== bass ? '/' + KEYS[bass] : '');
  }
  return '';
}
